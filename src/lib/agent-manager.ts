import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import simpleGit, { SimpleGit } from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import winston from "winston";
import {
  query,
  type SDKMessage,
  type Options,
} from "@anthropic-ai/claude-code";
import {
  AgentSession,
  ClaudeMessage,
  FileNode,
  GitCommit,
  TerminalMessage,
} from "../types/agent";
import { WorkspaceManager } from "./workspace-manager";
import { createLogger } from "./logger";

const logger = createLogger("agent-manager");

// Add custom session log transport
logger.add(
  new winston.transports.File({
    filename: "logs/sessions.log",
    level: "info",
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
      winston.format.label({ label: "SESSION" }),
      winston.format.json(),
    ),
    maxsize: 5242880, // 5MB
    maxFiles: 5,
  }),
);

export class AgentManager extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private processes: Map<string, any> = new Map(); // execa subprocess
  private git: SimpleGit;
  private baseRepoPath: string;
  private worktreesPath: string;
  private stateFilePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private debugMode: boolean = false;
  private workspaceManager: WorkspaceManager;

  constructor(baseRepoPath: string = process.env.BASE_REPO_PATH || "./repo") {
    super();
    this.baseRepoPath = baseRepoPath;
    this.worktreesPath = path.join(this.baseRepoPath, ".worktrees");
    this.stateFilePath = path.join(this.baseRepoPath, "agent-state.json");
    this.debugMode =
      process.env.CLAUDE_DEBUG_MODE === "true" ||
      process.env.ANTHROPIC_LOG === "debug";
    this.git = simpleGit(this.baseRepoPath);
    this.workspaceManager = new WorkspaceManager();
  }

  async initialize() {
    // Initialize workspace manager first
    await this.workspaceManager.initialize();

    // Ensure base repo exists
    try {
      await fs.access(this.baseRepoPath);
    } catch {
      logger.info("Initializing base repository...");
      await fs.mkdir(this.baseRepoPath, { recursive: true });
      await this.git.init();
      await this.git.addConfig("user.name", "Claude Agent");
      await this.git.addConfig("user.email", "claude@agent.local");

      // Create initial commit
      const readmePath = path.join(this.baseRepoPath, "README.md");
      await fs.writeFile(
        readmePath,
        "# Claude Agent Workspace\n\nThis is the base repository for Claude agents.",
      );
      await this.git.add("README.md");
      await this.git.commit("Initial commit");
    }

    // Ensure directories exist
    await fs.mkdir(this.worktreesPath, { recursive: true });
    await fs.mkdir("logs", { recursive: true });

    // Load persisted sessions
    await this.loadState();

    // Start auto-save timer
    this.startAutoSave();

    logger.info("AgentManager ready", {
      baseRepoPath: this.baseRepoPath,
      existingSessions: this.sessions.size,
      debugMode: this.debugMode,
      currentWorkspace: this.workspaceManager.getCurrentWorkspace()?.name,
    });
  }

  async createSession(
    name: string | undefined,
    task: string,
  ): Promise<AgentSession> {
    const sessionId = uuidv4();
    // Generate default name if not provided
    const sessionName =
      name ||
      `session-${new Date().toISOString().split("T")[0]}-${sessionId.substring(0, 8)}`;
    const branchName = `agent/${sessionName.toLowerCase().replace(/\s+/g, "-")}-${Date.now()}`;
    const worktreePath = path.join(this.worktreesPath, sessionId);

    // Create git worktree
    try {
      await this.git.raw(["worktree", "add", "-b", branchName, worktreePath]);
    } catch (error) {
      logger.error("Failed to create worktree:", error);
      throw new Error("Failed to create worktree");
    }

    // Get current workspace and project
    const currentWorkspace = this.workspaceManager.getCurrentWorkspace();
    const currentProject = this.workspaceManager.getCurrentProject();

    const session: AgentSession = {
      id: sessionId,
      name: sessionName,
      branch: branchName,
      worktreePath,
      status: "active",
      progress: 0,
      needsIntervention: false,
      tokensUsed: 0,
      cost: 0,
      messages: [],
      createdAt: new Date(),
      updatedAt: new Date(),
      workspaceId: currentWorkspace?.id,
      projectId: currentProject?.id,
      task,
    };

    this.sessions.set(sessionId, session);

    // Add session to current project if exists
    if (currentWorkspace?.id && currentProject?.id) {
      await this.workspaceManager.addSessionToProject(
        currentWorkspace.id,
        currentProject.id,
        sessionId,
      );
    }

    // Log session creation
    logger.info("Session created", {
      sessionId: sessionId.substring(0, 8),
      name,
      branch: branchName,
      taskPreview: task.substring(0, 80) + (task.length > 80 ? "..." : ""),
      workspace: currentWorkspace?.name,
      project: currentProject?.name,
    });

    // Save state after session creation
    await this.saveState();

    // Start Claude process
    await this.startClaudeProcess(sessionId, task);

    return session;
  }

  private async startClaudeProcess(sessionId: string, task: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    try {
      logger.info("Starting Claude process with SDK", {
        sessionId: sessionId.substring(0, 8),
        task: task.substring(0, 50),
      });

      // Use SDK instead of CLI
      const abortController = new AbortController();
      this.processes.set(sessionId, abortController);

      const options: Options = {
        cwd: session.worktreePath,
        abortController,
        maxTurns: 10,
        model: process.env.ANTHROPIC_MODEL || undefined,
      };

      logger.debug("Starting Claude SDK query", {
        sessionId: sessionId.substring(0, 8),
        cwd: session.worktreePath,
        options: { ...options, abortController: undefined },
      });

      // Process messages as they come in
      for await (const message of query({ prompt: task, options })) {
        // Convert SDK message to our ClaudeMessage format
        const claudeMessage = this.convertSDKMessage(message);

        // Store session ID if available
        if (message.session_id && !session.claudeSessionId) {
          session.claudeSessionId = message.session_id;
        }

        this.handleClaudeMessage(sessionId, claudeMessage);

        // Update session status based on message type
        if (message.type === "result") {
          this.updateSessionStatus(sessionId, "completed");
          break;
        }
      }
    } catch (error) {
      logger.error("Failed to start Claude process", {
        sessionId: sessionId.substring(0, 8),
        error: (error as Error).message,
      });
      this.emit("session:error", {
        sessionId,
        error: `Failed to start Claude: ${(error as Error).message}`,
      });
      this.updateSessionStatus(sessionId, "error");
    } finally {
      // Clean up abort controller
      this.processes.delete(sessionId);
    }
  }

  private convertSDKMessage(sdkMessage: SDKMessage): ClaudeMessage {
    switch (sdkMessage.type) {
      case "system":
        return {
          type: "system",
          subtype: sdkMessage.subtype,
          tools: sdkMessage.tools,
          mcp_servers: sdkMessage.mcp_servers,
          session_id: sdkMessage.session_id,
        };

      case "assistant":
        return {
          type: "assistant",
          message: sdkMessage.message,
          session_id: sdkMessage.session_id,
        };

      case "user":
        return {
          type: "user",
          message: sdkMessage.message,
          session_id: sdkMessage.session_id,
        };

      case "result":
        return {
          type: "result",
          subtype: sdkMessage.subtype,
          result: "result" in sdkMessage ? sdkMessage.result : undefined,
          cost_usd: sdkMessage.total_cost_usd,
          duration_ms: sdkMessage.duration_ms,
          duration_api_ms: sdkMessage.duration_api_ms,
          is_error: sdkMessage.is_error,
          num_turns: sdkMessage.num_turns,
          session_id: sdkMessage.session_id,
        };

      default:
        return sdkMessage as any;
    }
  }

  private handleClaudeMessage(sessionId: string, message: ClaudeMessage) {
    const session = this.sessions.get(sessionId);
    if (!session) return;

    // Log Claude messages
    logger.debug("Claude message received", {
      sessionId,
      messageType: message.type,
      subtype: message.subtype,
      cost: message.cost_usd,
      sessionName: session.name,
    });

    // Update session with Claude session ID
    if (message.session_id && !session.claudeSessionId) {
      session.claudeSessionId = message.session_id;
      logger.info("Claude session ID assigned", {
        sessionId,
        claudeSessionId: message.session_id,
      });
    }

    // Create a unique message ID
    const messageId = Date.now() + Math.floor(Math.random() * 1000);

    // Store messages in session for persistence
    if (message.type === "assistant") {
      // Handle content that might be an array or object from SDK
      let contentStr = "";
      if (message.message?.content) {
        if (typeof message.message.content === "string") {
          contentStr = message.message.content;
        } else if (Array.isArray(message.message.content)) {
          // Extract text from content blocks
          contentStr = message.message.content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("\n");
        }
      }

      if (contentStr) {
        const terminalMessage: TerminalMessage = {
          id: messageId,
          type: "assistant",
          content:
            contentStr.substring(0, 500) +
            (contentStr.length > 500 ? "..." : ""),
          timestamp: new Date(),
        };
        session.messages.push(terminalMessage);
      }
    } else if (message.type === "user") {
      // Handle user content similarly
      let contentStr = "";
      if (message.message?.content) {
        if (typeof message.message.content === "string") {
          contentStr = message.message.content;
        } else if (Array.isArray(message.message.content)) {
          contentStr = message.message.content
            .filter((block: any) => block.type === "text")
            .map((block: any) => block.text)
            .join("\n");
        }
      }

      if (contentStr) {
        const terminalMessage: TerminalMessage = {
          id: messageId,
          type: "user",
          content: contentStr,
          timestamp: new Date(),
        };
        session.messages.push(terminalMessage);
      }
    } else if (message.type === "result") {
      const content = message.result || "Task completed";
      const terminalMessage: TerminalMessage = {
        id: messageId,
        type: "assistant",
        content: content,
        timestamp: new Date(),
      };
      session.messages.push(terminalMessage);
    }

    // Handle different message types
    switch (message.type) {
      case "system":
        if (message.subtype === "init") {
          this.emit("session:init", {
            sessionId,
            tools: message.tools,
            mcpServers: message.mcp_servers,
          });
        }
        break;

      case "assistant":
      case "user":
        this.emit("session:message", { sessionId, message });
        break;

      case "result":
        if (message.cost_usd) {
          session.cost += message.cost_usd;
        }
        if (message.subtype === "success") {
          session.progress = 100;
          logger.info("Session completed successfully", {
            sessionId,
            cost: session.cost,
            duration: Date.now() - session.createdAt.getTime(),
          });
          this.emit("session:complete", { sessionId, result: message.result });
        } else if (message.subtype === "error_max_turns") {
          session.needsIntervention = true;
          logger.warn("Session needs intervention - max turns reached", {
            sessionId,
            turns: message.num_turns,
            cost: session.cost,
          });
          this.emit("session:intervention", {
            sessionId,
            reason: "Max turns reached",
          });
        }
        break;
    }

    // Emit raw message for frontend
    this.emit("claude:message", { sessionId, message });

    // Update session
    session.updatedAt = new Date();
    this.sessions.set(sessionId, session);
  }

  async pauseSession(sessionId: string) {
    // With SDK, we can't pause - we need to stop and later resume
    const abortController = this.processes.get(sessionId);
    if (abortController && abortController instanceof AbortController) {
      abortController.abort();
      this.updateSessionStatus(sessionId, "paused");
    }
  }

  async resumeSession(sessionId: string, prompt?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    if (!session.claudeSessionId) {
      throw new Error("No Claude session ID to resume");
    }

    // Check if worktree still exists
    try {
      await fs.access(session.worktreePath);
    } catch (error) {
      logger.error("Worktree path does not exist", {
        sessionId: sessionId.substring(0, 8),
        worktreePath: session.worktreePath,
      });
      throw new Error("Session worktree no longer exists. Cannot resume.");
    }

    try {
      logger.info("Resuming Claude session with SDK", {
        sessionId: sessionId.substring(0, 8),
        claudeSessionId: session.claudeSessionId,
      });

      // Use SDK with resume option
      const abortController = new AbortController();
      this.processes.set(sessionId, abortController);

      const options: Options = {
        cwd: session.worktreePath,
        abortController,
        maxTurns: 10,
        model: process.env.ANTHROPIC_MODEL || undefined,
        resume: session.claudeSessionId,
      };

      // Update session status to active
      this.updateSessionStatus(sessionId, "active");

      // Process messages as they come in
      // SDK requires a non-empty prompt, so use a continuation prompt if none provided
      for await (const message of query({
        prompt: prompt || "Please continue with the task.",
        options,
      })) {
        // Convert SDK message to our ClaudeMessage format
        const claudeMessage = this.convertSDKMessage(message);

        this.handleClaudeMessage(sessionId, claudeMessage);

        // Update session status based on message type
        if (message.type === "result") {
          this.updateSessionStatus(sessionId, "completed");
          break;
        }
      }
    } catch (error) {
      logger.error("Failed to resume Claude session", {
        sessionId: sessionId.substring(0, 8),
        error: (error as Error).message,
      });
      this.emit("session:error", {
        sessionId,
        error: `Failed to resume: ${(error as Error).message}`,
      });
      this.updateSessionStatus(sessionId, "error");
    } finally {
      // Clean up abort controller
      this.processes.delete(sessionId);
    }
  }

  async stopSession(sessionId: string) {
    const abortController = this.processes.get(sessionId);
    if (abortController && abortController instanceof AbortController) {
      abortController.abort();
    }
    this.updateSessionStatus(sessionId, "completed");
  }

  async getSessionFiles(sessionId: string): Promise<FileNode[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    const walkDir = async (
      dir: string,
      relativePath: string = "",
    ): Promise<FileNode[]> => {
      const items = await fs.readdir(dir, { withFileTypes: true });
      const nodes: FileNode[] = [];

      for (const item of items) {
        // Skip .git and node_modules
        if (item.name === ".git" || item.name === "node_modules") continue;

        const fullPath = path.join(dir, item.name);
        const itemRelativePath = path.join(relativePath, item.name);

        if (item.isDirectory()) {
          nodes.push({
            path: itemRelativePath,
            name: item.name,
            type: "folder",
            children: await walkDir(fullPath, itemRelativePath),
          });
        } else {
          nodes.push({
            path: itemRelativePath,
            name: item.name,
            type: "file",
          });
        }
      }

      return nodes;
    };

    return walkDir(session.worktreePath);
  }

  async getFileContent(sessionId: string, filePath: string): Promise<string> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    const fullPath = path.join(session.worktreePath, filePath);
    return fs.readFile(fullPath, "utf-8");
  }

  async saveFileContent(
    sessionId: string,
    filePath: string,
    content: string,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    const fullPath = path.join(session.worktreePath, filePath);
    await fs.writeFile(fullPath, content, "utf-8");
  }

  async getGitLog(sessionId: string): Promise<GitCommit[]> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    try {
      // Check if worktree path exists
      await fs.access(session.worktreePath);

      const git = simpleGit(session.worktreePath);
      const log = await git.log(["--oneline", "-n", "20"]);

      return log.all.map((commit) => ({
        hash: commit.hash.substring(0, 7),
        message: commit.message,
        time: new Date(commit.date).toLocaleString(),
        author: commit.author_name,
      }));
    } catch (error) {
      logger.warn("Failed to get git log", {
        sessionId,
        worktreePath: session.worktreePath,
        error: (error as Error).message,
      });

      // Return empty array if git log fails (e.g., no commits yet or path doesn't exist)
      return [];
    }
  }

  private updateSessionStatus(
    sessionId: string,
    status: AgentSession["status"],
  ) {
    const session = this.sessions.get(sessionId);
    if (session) {
      const oldStatus = session.status;
      session.status = status;
      session.updatedAt = new Date();
      this.sessions.set(sessionId, session);

      logger.info("Session status updated", {
        sessionId,
        oldStatus,
        newStatus: status,
        sessionName: session.name,
      });

      this.emit("session:status", { sessionId, status });

      // Save state on status changes
      this.saveState().catch((error) =>
        logger.error("Failed to save state after status update", {
          error: (error as Error).message,
        }),
      );
    }
  }

  getAllSessions(): AgentSession[] {
    return Array.from(this.sessions.values());
  }

  getSession(sessionId: string): AgentSession | undefined {
    return this.sessions.get(sessionId);
  }

  setDebugMode(enabled: boolean): void {
    const oldDebugMode = this.debugMode;
    this.debugMode = enabled;

    logger.info("Debug mode changed", {
      oldDebugMode,
      newDebugMode: enabled,
      anthropicLogLevel: enabled ? "debug" : "not set",
    });
  }

  getDebugMode(): boolean {
    return this.debugMode;
  }

  // Workspace methods
  getWorkspaceManager(): WorkspaceManager {
    return this.workspaceManager;
  }

  async getWorkspaces() {
    return this.workspaceManager.listWorkspaces();
  }

  async getCurrentWorkspace() {
    return this.workspaceManager.getCurrentWorkspace();
  }

  async getCurrentProject() {
    return this.workspaceManager.getCurrentProject();
  }

  async switchWorkspace(workspaceId: string) {
    await this.workspaceManager.setActiveWorkspace(workspaceId);
    // TODO: Reload sessions for the new workspace
  }

  async switchProject(projectId: string) {
    await this.workspaceManager.setActiveProject(projectId);
    // TODO: Filter sessions by project
  }

  // Persistence methods
  private async saveState(): Promise<void> {
    try {
      const state = {
        timestamp: new Date().toISOString(),
        sessions: Array.from(this.sessions.entries()).map(([id, session]) => ({
          ...session,
          id,
          // Don't persist process references
          process: undefined,
        })),
      };

      await fs.writeFile(this.stateFilePath, JSON.stringify(state, null, 2));
      logger.debug("State saved successfully", {
        sessionCount: this.sessions.size,
      });
    } catch (error) {
      logger.error("Failed to save state", { error: (error as Error).message });
    }
  }

  private async loadState(): Promise<void> {
    try {
      await fs.access(this.stateFilePath);
      const stateData = await fs.readFile(this.stateFilePath, "utf-8");
      const state = JSON.parse(stateData);

      if (state.sessions && Array.isArray(state.sessions)) {
        for (const sessionData of state.sessions) {
          const session: AgentSession = {
            ...sessionData,
            createdAt: new Date(sessionData.createdAt),
            updatedAt: new Date(sessionData.updatedAt),
            // Keep status as-is, but mark it as paused if it was active
            // This allows resumption while indicating it's not currently running
            status:
              sessionData.status === "active" ? "paused" : sessionData.status,
            // Store the Claude session ID for resumption
            claudeSessionId: sessionData.claudeSessionId,
            // Restore messages array or initialize empty if not present
            messages: sessionData.messages
              ? sessionData.messages.map((msg: any) => ({
                  ...msg,
                  timestamp: new Date(msg.timestamp),
                }))
              : [],
          };

          this.sessions.set(session.id, session);

          logger.info("Restored session", {
            sessionId: session.id,
            name: session.name,
            status: session.status,
            branch: session.branch,
            messageCount: session.messages.length,
            claudeSessionId: session.claudeSessionId,
            canResume: session.status === "paused" && !!session.claudeSessionId,
          });
        }
      }

      logger.info("State loaded successfully", {
        sessionCount: this.sessions.size,
        stateTimestamp: state.timestamp,
      });
    } catch (error) {
      if ((error as any).code !== "ENOENT") {
        logger.error("Failed to load state", {
          error: (error as Error).message,
        });
      } else {
        logger.info("No existing state file found, starting fresh");
      }
    }
  }

  private startAutoSave(): void {
    // Save state every 30 seconds
    this.autoSaveInterval = setInterval(async () => {
      await this.saveState();
    }, 30000);

    logger.debug("Auto-save started", { intervalMs: 30000 });
  }

  private stopAutoSave(): void {
    if (this.autoSaveInterval) {
      clearInterval(this.autoSaveInterval);
      this.autoSaveInterval = null;
      logger.debug("Auto-save stopped");
    }
  }

  async resumeRestoredSession(
    sessionId: string,
    prompt?: string,
  ): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !session.claudeSessionId) {
      return false;
    }

    try {
      // Check if worktree still exists
      await fs.access(session.worktreePath);

      logger.info("Resuming restored session", {
        sessionId,
        claudeSessionId: session.claudeSessionId,
        name: session.name,
      });

      await this.resumeSession(sessionId, prompt);
      return true;
    } catch (error) {
      logger.error("Failed to resume restored session", {
        sessionId,
        error: (error as Error).message,
      });
      return false;
    }
  }

  async archiveSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Mark session as archived
    session.archived = true;
    session.updatedAt = new Date();
    this.sessions.set(sessionId, session);

    logger.info("Session archived", {
      sessionId,
      name: session.name,
    });

    // Save state
    await this.saveState();
  }

  async unarchiveSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Mark session as unarchived
    session.archived = false;
    session.updatedAt = new Date();
    this.sessions.set(sessionId, session);

    logger.info("Session unarchived", {
      sessionId,
      name: session.name,
    });

    // Save state
    await this.saveState();
  }

  async deleteSession(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    // Stop any running process
    const abortController = this.processes.get(sessionId);
    if (abortController && abortController instanceof AbortController) {
      abortController.abort();
      this.processes.delete(sessionId);
    }

    // Remove worktree
    try {
      await this.git.raw([
        "worktree",
        "remove",
        session.worktreePath,
        "--force",
      ]);
      logger.info("Removed worktree", {
        sessionId,
        worktreePath: session.worktreePath,
      });
    } catch (error) {
      logger.error("Failed to remove worktree", {
        sessionId,
        worktreePath: session.worktreePath,
        error: (error as Error).message,
      });
    }

    // Remove from sessions map
    this.sessions.delete(sessionId);

    logger.info("Session deleted", {
      sessionId,
      name: session.name,
    });

    // Save state
    await this.saveState();
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down AgentManager...");

    // Stop auto-save
    this.stopAutoSave();

    // Save final state
    await this.saveState();

    // Stop all active processes
    for (const [sessionId, abortController] of this.processes.entries()) {
      logger.info("Stopping process for session", { sessionId });
      if (abortController instanceof AbortController) {
        abortController.abort();
      }
    }

    this.processes.clear();

    logger.info("AgentManager shutdown complete");
  }
}
