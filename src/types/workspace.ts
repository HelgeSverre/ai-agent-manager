export interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  projects: Project[];
  settings: WorkspaceSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface Project {
  id: string;
  name: string;
  path: string; // Absolute path to the project directory
  description?: string;
  sessions: string[]; // Array of session IDs
  settings?: ProjectSettings;
  createdAt: Date;
  updatedAt: Date;
}

export interface WorkspaceSettings {
  defaultModel?: string;
  defaultBranch?: string;
  autoSave?: boolean;
  theme?: "light" | "dark" | "system";
}

export interface ProjectSettings {
  excludePaths?: string[];
  customPrompts?: Record<string, string>;
  envVars?: Record<string, string>;
}

export interface WorkspaceState {
  activeWorkspaceId?: string;
  activeProjectId?: string;
  recentProjects?: Array<{
    workspaceId: string;
    projectId: string;
    lastAccessed: Date;
  }>;
}
