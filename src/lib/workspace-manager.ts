import { promises as fs } from "fs";
import path from "path";
import os from "os";
import { v4 as uuidv4 } from "uuid";
import { WorkspaceConfig, Project, WorkspaceState } from "../types/workspace";
import { createLogger } from "./logger";

const logger = createLogger("workspace-manager");

export class WorkspaceManager {
  private workspacesDir: string;
  private currentWorkspace?: WorkspaceConfig;
  private workspaceState: WorkspaceState = {};

  constructor() {
    // Check for local .ai-agent-manager directory first
    const localDir = path.join(process.cwd(), ".ai-agent-manager");
    const globalDir = path.join(os.homedir(), ".ai-agent-manager");

    // Use local directory if it exists, otherwise use global
    this.workspacesDir = localDir;

    // In development mode, use current directory as workspace
    if (process.env.NODE_ENV === "development") {
      logger.info(
        "Running in development mode - using current directory as workspace",
      );
    }
  }

  async initialize(): Promise<void> {
    try {
      // Ensure workspace directory exists
      await fs.mkdir(this.workspacesDir, { recursive: true });

      // Load workspace state
      await this.loadWorkspaceState();

      // Load current workspace if one is active
      if (this.workspaceState.activeWorkspaceId) {
        await this.loadWorkspace(this.workspaceState.activeWorkspaceId);
      } else if (process.env.NODE_ENV === "development") {
        // Create a default development workspace
        await this.createDefaultDevWorkspace();
      }

      logger.info("WorkspaceManager initialized", {
        workspacesDir: this.workspacesDir,
        activeWorkspace: this.currentWorkspace?.name,
      });
    } catch (error) {
      logger.error("Failed to initialize WorkspaceManager", error);
      throw error;
    }
  }

  private async loadWorkspaceState(): Promise<void> {
    const statePath = path.join(this.workspacesDir, "workspace-state.json");
    try {
      const data = await fs.readFile(statePath, "utf-8");
      this.workspaceState = JSON.parse(data);
    } catch (error) {
      // State file doesn't exist yet, that's ok
      logger.debug("No workspace state file found, starting fresh");
    }
  }

  private async saveWorkspaceState(): Promise<void> {
    const statePath = path.join(this.workspacesDir, "workspace-state.json");
    await fs.writeFile(
      statePath,
      JSON.stringify(this.workspaceState, null, 2),
      "utf-8",
    );
  }

  async createWorkspace(
    name: string,
    description?: string,
  ): Promise<WorkspaceConfig> {
    const workspace: WorkspaceConfig = {
      id: uuidv4(),
      name,
      description,
      projects: [],
      settings: {
        theme: "dark",
        autoSave: true,
      },
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    // Save workspace config
    await this.saveWorkspace(workspace);

    // Set as active workspace
    await this.setActiveWorkspace(workspace.id);

    logger.info("Created workspace", {
      id: workspace.id,
      name: workspace.name,
    });
    return workspace;
  }

  private async saveWorkspace(workspace: WorkspaceConfig): Promise<void> {
    const workspacePath = path.join(
      this.workspacesDir,
      `workspace-${workspace.id}.json`,
    );
    await fs.writeFile(
      workspacePath,
      JSON.stringify(workspace, null, 2),
      "utf-8",
    );
  }

  async loadWorkspace(workspaceId: string): Promise<WorkspaceConfig> {
    const workspacePath = path.join(
      this.workspacesDir,
      `workspace-${workspaceId}.json`,
    );
    try {
      const data = await fs.readFile(workspacePath, "utf-8");
      this.currentWorkspace = JSON.parse(data);
      return this.currentWorkspace;
    } catch (error) {
      logger.error("Failed to load workspace", { workspaceId, error });
      throw new Error(`Workspace ${workspaceId} not found`);
    }
  }

  async setActiveWorkspace(workspaceId: string): Promise<void> {
    this.workspaceState.activeWorkspaceId = workspaceId;
    await this.saveWorkspaceState();
    await this.loadWorkspace(workspaceId);
  }

  async listWorkspaces(): Promise<WorkspaceConfig[]> {
    try {
      const files = await fs.readdir(this.workspacesDir);
      const workspaceFiles = files.filter(
        (f) => f.startsWith("workspace-") && f.endsWith(".json"),
      );

      const workspaces = await Promise.all(
        workspaceFiles.map(async (file) => {
          const data = await fs.readFile(
            path.join(this.workspacesDir, file),
            "utf-8",
          );
          return JSON.parse(data) as WorkspaceConfig;
        }),
      );

      return workspaces.sort(
        (a, b) =>
          new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
      );
    } catch (error) {
      logger.error("Failed to list workspaces", error);
      return [];
    }
  }

  async createProject(
    workspaceId: string,
    name: string,
    projectPath: string,
    description?: string,
  ): Promise<Project> {
    const workspace = await this.loadWorkspace(workspaceId);

    const project: Project = {
      id: uuidv4(),
      name,
      path: path.resolve(projectPath),
      description,
      sessions: [],
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    workspace.projects.push(project);
    workspace.updatedAt = new Date();

    await this.saveWorkspace(workspace);

    logger.info("Created project", {
      workspaceId,
      projectId: project.id,
      name: project.name,
      path: project.path,
    });

    return project;
  }

  async getProject(
    workspaceId: string,
    projectId: string,
  ): Promise<Project | undefined> {
    const workspace = await this.loadWorkspace(workspaceId);
    return workspace.projects.find((p) => p.id === projectId);
  }

  async updateProject(
    workspaceId: string,
    projectId: string,
    updates: Partial<Project>,
  ): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    const projectIndex = workspace.projects.findIndex(
      (p) => p.id === projectId,
    );

    if (projectIndex === -1) {
      throw new Error(
        `Project ${projectId} not found in workspace ${workspaceId}`,
      );
    }

    workspace.projects[projectIndex] = {
      ...workspace.projects[projectIndex],
      ...updates,
      updatedAt: new Date(),
    };

    workspace.updatedAt = new Date();
    await this.saveWorkspace(workspace);
  }

  async addSessionToProject(
    workspaceId: string,
    projectId: string,
    sessionId: string,
  ): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    const project = workspace.projects.find((p) => p.id === projectId);

    if (!project) {
      throw new Error(
        `Project ${projectId} not found in workspace ${workspaceId}`,
      );
    }

    if (!project.sessions.includes(sessionId)) {
      project.sessions.push(sessionId);
      project.updatedAt = new Date();
      workspace.updatedAt = new Date();
      await this.saveWorkspace(workspace);
    }
  }

  getCurrentWorkspace(): WorkspaceConfig | undefined {
    return this.currentWorkspace;
  }

  getCurrentProject(): Project | undefined {
    if (!this.currentWorkspace || !this.workspaceState.activeProjectId) {
      return undefined;
    }
    return this.currentWorkspace.projects.find(
      (p) => p.id === this.workspaceState.activeProjectId,
    );
  }

  async setActiveProject(projectId: string): Promise<void> {
    if (!this.currentWorkspace) {
      throw new Error("No active workspace");
    }

    const project = this.currentWorkspace.projects.find(
      (p) => p.id === projectId,
    );
    if (!project) {
      throw new Error(`Project ${projectId} not found in current workspace`);
    }

    this.workspaceState.activeProjectId = projectId;
    await this.saveWorkspaceState();

    // Update recent projects
    if (!this.workspaceState.recentProjects) {
      this.workspaceState.recentProjects = [];
    }

    // Remove existing entry if present
    this.workspaceState.recentProjects =
      this.workspaceState.recentProjects.filter(
        (rp) =>
          !(
            rp.workspaceId === this.currentWorkspace!.id &&
            rp.projectId === projectId
          ),
      );

    // Add to front of recent projects
    this.workspaceState.recentProjects.unshift({
      workspaceId: this.currentWorkspace.id,
      projectId,
      lastAccessed: new Date(),
    });

    // Keep only last 10 recent projects
    this.workspaceState.recentProjects =
      this.workspaceState.recentProjects.slice(0, 10);

    await this.saveWorkspaceState();
  }

  private async createDefaultDevWorkspace(): Promise<void> {
    const workspace = await this.createWorkspace(
      "Development Workspace",
      "Default workspace for development",
    );

    // Create a project for the current directory
    const currentDir = process.cwd();
    const projectName = path.basename(currentDir);

    await this.createProject(
      workspace.id,
      projectName,
      currentDir,
      "Current development project",
    );
  }

  async deleteWorkspace(workspaceId: string): Promise<void> {
    const workspacePath = path.join(
      this.workspacesDir,
      `workspace-${workspaceId}.json`,
    );
    await fs.unlink(workspacePath);

    // If this was the active workspace, clear it
    if (this.workspaceState.activeWorkspaceId === workspaceId) {
      this.workspaceState.activeWorkspaceId = undefined;
      this.workspaceState.activeProjectId = undefined;
      this.currentWorkspace = undefined;
      await this.saveWorkspaceState();
    }

    logger.info("Deleted workspace", { workspaceId });
  }

  async deleteProject(workspaceId: string, projectId: string): Promise<void> {
    const workspace = await this.loadWorkspace(workspaceId);
    workspace.projects = workspace.projects.filter((p) => p.id !== projectId);
    workspace.updatedAt = new Date();
    await this.saveWorkspace(workspace);

    // If this was the active project, clear it
    if (this.workspaceState.activeProjectId === projectId) {
      this.workspaceState.activeProjectId = undefined;
      await this.saveWorkspaceState();
    }

    logger.info("Deleted project", { workspaceId, projectId });
  }
}
