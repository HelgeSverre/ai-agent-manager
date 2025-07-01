import { Server as SocketIOServer } from "socket.io";
import { AgentManager } from "./agent-manager";
import { watch } from "chokidar";

export class WebSocketServer {
  private io: SocketIOServer;
  private agentManager: AgentManager;
  private fileWatchers: Map<string, any> = new Map();

  constructor(io: SocketIOServer, agentManager: AgentManager) {
    this.io = io;
    this.agentManager = agentManager;
    this.setupEventHandlers();
    this.setupAgentManagerListeners();
  }

  private setupEventHandlers() {
    this.io.on("connection", (socket) => {
      console.log(`📱 Client connected: ${socket.id.substring(0, 8)}`);

      // Send initial sessions and debug mode status
      const sessions = this.agentManager.getAllSessions().map((session) => ({
        ...session,
        terminalOutput: session.messages || [],
      }));
      socket.emit("sessions:list", sessions);
      socket.emit("debug:status", {
        enabled: this.agentManager.getDebugMode(),
      });

      // Handle session creation
      socket.on(
        "session:create",
        async (data: { name?: string; task: string }) => {
          try {
            const session = await this.agentManager.createSession(
              data.name,
              data.task,
            );
            this.io.emit("session:created", {
              ...session,
              terminalOutput: session.messages || [],
            });

            // Start file watcher for this session
            this.startFileWatcher(session.id);
          } catch (error: any) {
            socket.emit("error", {
              message: "Failed to create session",
              error: error.message,
            });
          }
        },
      );

      // Handle session control
      socket.on("session:pause", async (sessionId: string) => {
        await this.agentManager.pauseSession(sessionId);
      });

      socket.on(
        "session:resume",
        async (data: { sessionId: string; prompt?: string }) => {
          await this.agentManager.resumeSession(data.sessionId, data.prompt);
        },
      );

      socket.on("session:stop", async (sessionId: string) => {
        await this.agentManager.stopSession(sessionId);
        this.stopFileWatcher(sessionId);
      });

      // Handle file operations
      socket.on("files:list", async (sessionId: string) => {
        try {
          const files = await this.agentManager.getSessionFiles(sessionId);
          socket.emit("files:list", { sessionId, files });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to list files",
            error: error.message,
          });
        }
      });

      socket.on(
        "file:read",
        async (data: { sessionId: string; path: string }) => {
          try {
            const content = await this.agentManager.getFileContent(
              data.sessionId,
              data.path,
            );
            socket.emit("file:content", {
              sessionId: data.sessionId,
              path: data.path,
              content,
            });
          } catch (error: any) {
            socket.emit("error", {
              message: "Failed to read file",
              error: error.message,
            });
          }
        },
      );

      socket.on(
        "file:save",
        async (data: { sessionId: string; path: string; content: string }) => {
          try {
            await this.agentManager.saveFileContent(
              data.sessionId,
              data.path,
              data.content,
            );
            socket.emit("file:saved", {
              sessionId: data.sessionId,
              path: data.path,
            });
          } catch (error: any) {
            socket.emit("error", {
              message: "Failed to save file",
              error: error.message,
            });
          }
        },
      );

      // Handle git operations
      socket.on("git:log", async (sessionId: string) => {
        try {
          const commits = await this.agentManager.getGitLog(sessionId);
          socket.emit("git:log", { sessionId, commits });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to get git log",
            error: error.message,
          });
        }
      });

      // Handle session archive/delete
      socket.on("session:archive", async (sessionId: string) => {
        try {
          await this.agentManager.archiveSession(sessionId);
          socket.emit("session:archived", { sessionId });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to archive session",
            error: error.message,
          });
        }
      });

      socket.on("session:delete", async (sessionId: string) => {
        try {
          await this.agentManager.deleteSession(sessionId);
          this.stopFileWatcher(sessionId);
          socket.emit("session:deleted", { sessionId });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to delete session",
            error: error.message,
          });
        }
      });

      socket.on("session:unarchive", async (sessionId: string) => {
        try {
          await this.agentManager.unarchiveSession(sessionId);
          socket.emit("session:unarchived", { sessionId });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to unarchive session",
            error: error.message,
          });
        }
      });

      // Handle debug mode control
      socket.on("debug:toggle", (enabled: boolean) => {
        this.agentManager.setDebugMode(enabled);
        this.io.emit("debug:status", { enabled });
      });

      socket.on("debug:status", () => {
        socket.emit("debug:status", {
          enabled: this.agentManager.getDebugMode(),
        });
      });

      // Handle workspace operations
      socket.on("workspace:list", async () => {
        try {
          const workspaces = await this.agentManager.getWorkspaces();
          const currentWorkspace =
            await this.agentManager.getCurrentWorkspace();
          socket.emit("workspace:list", {
            workspaces,
            currentWorkspaceId: currentWorkspace?.id,
          });
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to list workspaces",
            error: error.message,
          });
        }
      });

      socket.on(
        "workspace:create",
        async (data: { name: string; description?: string }) => {
          try {
            const workspace = await this.agentManager
              .getWorkspaceManager()
              .createWorkspace(data.name, data.description);
            this.io.emit("workspace:created", workspace);
          } catch (error: any) {
            socket.emit("error", {
              message: "Failed to create workspace",
              error: error.message,
            });
          }
        },
      );

      socket.on("workspace:switch", async (workspaceId: string) => {
        try {
          await this.agentManager.switchWorkspace(workspaceId);
          const workspace = await this.agentManager.getCurrentWorkspace();
          this.io.emit("workspace:switched", workspace);
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to switch workspace",
            error: error.message,
          });
        }
      });

      socket.on(
        "project:create",
        async (data: { name: string; path: string; description?: string }) => {
          try {
            const currentWorkspace =
              await this.agentManager.getCurrentWorkspace();
            if (!currentWorkspace) {
              throw new Error("No active workspace");
            }

            const project = await this.agentManager
              .getWorkspaceManager()
              .createProject(
                currentWorkspace.id,
                data.name,
                data.path,
                data.description,
              );
            this.io.emit("project:created", project);
          } catch (error: any) {
            socket.emit("error", {
              message: "Failed to create project",
              error: error.message,
            });
          }
        },
      );

      socket.on("project:switch", async (projectId: string) => {
        try {
          await this.agentManager.switchProject(projectId);
          const project = await this.agentManager.getCurrentProject();
          this.io.emit("project:switched", project);
        } catch (error: any) {
          socket.emit("error", {
            message: "Failed to switch project",
            error: error.message,
          });
        }
      });

      socket.on("disconnect", () => {
        console.log(`📱 Client disconnected: ${socket.id.substring(0, 8)}`);
      });
    });
  }

  private setupAgentManagerListeners() {
    // Forward all agent manager events to connected clients
    this.agentManager.on("claude:message", (data) => {
      this.io.emit("claude:message", data);
    });

    this.agentManager.on("session:status", (data) => {
      this.io.emit("session:status", data);
    });

    this.agentManager.on("session:init", (data) => {
      this.io.emit("session:init", data);
    });

    this.agentManager.on("session:message", (data) => {
      this.io.emit("session:message", data);
    });

    this.agentManager.on("session:complete", (data) => {
      this.io.emit("session:complete", data);
    });

    this.agentManager.on("session:intervention", (data) => {
      this.io.emit("session:intervention", data);
    });

    this.agentManager.on("session:error", (data) => {
      this.io.emit("session:error", data);
    });
  }

  private startFileWatcher(sessionId: string) {
    const session = this.agentManager.getSession(sessionId);
    if (!session) return;

    const watcher = watch(session.worktreePath, {
      ignored: /(^|[\/\\])\../, // ignore dotfiles
      persistent: true,
      ignoreInitial: true,
    });

    watcher
      .on("add", (filePath) => {
        this.io.emit("file:added", { sessionId, path: filePath });
      })
      .on("change", (filePath) => {
        this.io.emit("file:changed", { sessionId, path: filePath });
      })
      .on("unlink", (filePath) => {
        this.io.emit("file:removed", { sessionId, path: filePath });
      });

    this.fileWatchers.set(sessionId, watcher);
  }

  private stopFileWatcher(sessionId: string) {
    const watcher = this.fileWatchers.get(sessionId);
    if (watcher) {
      watcher.close();
      this.fileWatchers.delete(sessionId);
    }
  }
}
