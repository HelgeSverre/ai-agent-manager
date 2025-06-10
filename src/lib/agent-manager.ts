import { EventEmitter } from "events";
import { v4 as uuidv4 } from "uuid";
import simpleGit, { SimpleGit } from "simple-git";
import * as fs from "fs/promises";
import * as path from "path";
import winston from "winston";
import { execa } from "execa";
import {
  AgentSession,
  ClaudeMessage,
  FileNode,
  GitCommit,
} from "../types/agent";

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || "info",
  format: winston.format.combine(
    winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss" }),
    winston.format.errors({ stack: true }),
    winston.format.json(),
  ),
  defaultMeta: { service: "agent-manager" },
  transports: [
    new winston.transports.File({
      filename: "logs/error.log",
      level: "error",
      maxsize: 5242880, // 5MB
      maxFiles: 5,
    }),
    new winston.transports.File({
      filename: "logs/combined.log",
      maxsize: 5242880, // 5MB
      maxFiles: 10,
    }),
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
    new winston.transports.Console({
      level: process.env.NODE_ENV === "production" ? "warn" : "info",
      format: winston.format.combine(
        winston.format.timestamp({ format: "HH:mm:ss" }),
        winston.format.colorize({ all: true }),
        winston.format.printf(
          ({ timestamp, level, message, service, ...meta }) => {
            let output = `${timestamp} [${service || "app"}] ${level}: ${message}`;

            // Format additional metadata
            const metaKeys = Object.keys(meta);
            if (metaKeys.length > 0) {
              const cleanMeta = { ...meta };
              delete cleanMeta.timestamp;
              delete cleanMeta.service;

              if (Object.keys(cleanMeta).length > 0) {
                // Pretty print JSON metadata
                output += "\n" + JSON.stringify(cleanMeta, null, 2);
              }
            }

            return output;
          },
        ),
      ),
    }),
  ],
});

export class AgentManager extends EventEmitter {
  private sessions: Map<string, AgentSession> = new Map();
  private processes: Map<string, any> = new Map(); // execa subprocess
  private git: SimpleGit;
  private baseRepoPath: string;
  private worktreesPath: string;
  private stateFilePath: string;
  private autoSaveInterval: NodeJS.Timeout | null = null;
  private debugMode: boolean = false;

  constructor(baseRepoPath: string = process.env.BASE_REPO_PATH || "./repo") {
    super();
    this.baseRepoPath = baseRepoPath;
    this.worktreesPath = path.join(this.baseRepoPath, ".worktrees");
    this.stateFilePath = path.join(this.baseRepoPath, "agent-state.json");
    this.debugMode =
      process.env.CLAUDE_DEBUG_MODE === "true" ||
      process.env.ANTHROPIC_LOG === "debug";
    this.git = simpleGit(this.baseRepoPath);
  }

  async initialize() {
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
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    this.sessions.set(sessionId, session);

    // Log session creation
    logger.info("Session created", {
      sessionId: sessionId.substring(0, 8),
      name,
      branch: branchName,
      taskPreview: task.substring(0, 80) + (task.length > 80 ? "..." : ""),
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
      logger.info("Starting Claude process", {
        sessionId: sessionId.substring(0, 8),
        task: task.substring(0, 50),
      });

      // Match claude-code-js implementation
      const args = ["--output-format", "json", "-p", task];

      logger.debug("Executing Claude command", {
        sessionId: sessionId.substring(0, 8),
        cwd: session.worktreePath,
        command: "claude",
        args: args,
      });

      const result = await execa("claude", args, {
        cwd: session.worktreePath,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        reject: false,
        timeout: 60000,
        shell: false,
      });

      logger.debug("Claude process result", {
        sessionId: sessionId.substring(0, 8),
        exitCode: result.exitCode,
        stdout: result.stdout?.substring(0, 200),
        stderr: result.stderr,
        failed: result.failed,
        timedOut: result.timedOut,
      });

      if (result.exitCode === 0 && result.stdout) {
        try {
          // Parse JSON response like claude-code-js does
          let message: ClaudeMessage;
          const stdoutJson = JSON.parse(result.stdout);

          if (Array.isArray(stdoutJson)) {
            message = stdoutJson[stdoutJson.length - 1] as ClaudeMessage;
          } else {
            message = stdoutJson as ClaudeMessage;
          }

          this.handleClaudeMessage(sessionId, message);

          // Update session status based on message type
          if (message.type === "result") {
            this.updateSessionStatus(sessionId, "completed");
          }
        } catch (parseError) {
          logger.error("Failed to parse Claude response", {
            sessionId: sessionId.substring(0, 8),
            error: (parseError as Error).message,
            stdout: result.stdout,
          });
          this.emit("session:error", {
            sessionId,
            error: "Failed to parse Claude response",
          });
          this.updateSessionStatus(sessionId, "error");
        }
      } else {
        // Handle error
        const errorMessage = result.stderr || result.stdout || "Unknown error";
        logger.error("Claude process failed", {
          sessionId: sessionId.substring(0, 8),
          exitCode: result.exitCode,
          error: errorMessage,
        });
        this.emit("session:error", { sessionId, error: errorMessage });
        this.updateSessionStatus(sessionId, "error");
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
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill("SIGSTOP");
      this.updateSessionStatus(sessionId, "paused");
    }
  }

  async resumeSession(sessionId: string, prompt?: string) {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error("Session not found");

    if (!session.claudeSessionId) {
      throw new Error("No Claude session ID to resume");
    }

    try {
      logger.info("Resuming Claude session", {
        sessionId: sessionId.substring(0, 8),
        claudeSessionId: session.claudeSessionId,
      });

      // Build args for resume matching claude-code-js pattern
      const args = ["--output-format", "json"];

      if (prompt) {
        args.push("-p", prompt);
      }

      args.push("--resume", session.claudeSessionId);

      // Run Claude with resume
      const result = await execa("claude", args, {
        cwd: session.worktreePath,
        env: {
          ...process.env,
          ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
        },
        stdin: "ignore",
        stdout: "pipe",
        stderr: "pipe",
        reject: false,
        timeout: 60000,
      });

      if (result.exitCode === 0 && result.stdout) {
        try {
          // Parse the JSON response
          let message: ClaudeMessage;
          const parsed = JSON.parse(result.stdout);

          // Handle array or single object response
          if (Array.isArray(parsed)) {
            message = parsed[parsed.length - 1];
          } else {
            message = parsed;
          }

          this.handleClaudeMessage(sessionId, message);

          // Update session status
          if (message.type === "result") {
            this.updateSessionStatus(sessionId, "completed");
          }
        } catch (parseError) {
          logger.error("Failed to parse Claude resume response", {
            sessionId: sessionId.substring(0, 8),
            error: (parseError as Error).message,
          });
          this.emit("session:error", {
            sessionId,
            error: "Failed to parse Claude response",
          });
        }
      } else {
        // Handle error
        const errorMessage = result.stderr || result.stdout || "Unknown error";
        logger.error("Claude resume failed", {
          sessionId: sessionId.substring(0, 8),
          error: errorMessage,
        });
        this.emit("session:error", { sessionId, error: errorMessage });
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
    }
  }

  async stopSession(sessionId: string) {
    const process = this.processes.get(sessionId);
    if (process) {
      process.kill("SIGTERM");
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

    const git = simpleGit(session.worktreePath);
    const log = await git.log(["--oneline", "-n", "20"]);

    return log.all.map((commit) => ({
      hash: commit.hash.substring(0, 7),
      message: commit.message,
      time: new Date(commit.date).toLocaleString(),
      author: commit.author_name,
    }));
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
            // Mark as completed if it was active when saved
            status:
              sessionData.status === "active"
                ? "completed"
                : sessionData.status,
          };

          this.sessions.set(session.id, session);

          logger.info("Restored session", {
            sessionId: session.id,
            name: session.name,
            status: session.status,
            branch: session.branch,
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

  async shutdown(): Promise<void> {
    logger.info("Shutting down AgentManager...");

    // Stop auto-save
    this.stopAutoSave();

    // Save final state
    await this.saveState();

    // Stop all active processes
    for (const [sessionId, process] of this.processes.entries()) {
      logger.info("Stopping process for session", { sessionId });
      process.kill("SIGTERM");
    }

    this.processes.clear();

    logger.info("AgentManager shutdown complete");
  }
}
