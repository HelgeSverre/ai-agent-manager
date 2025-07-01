export interface TerminalMessage {
  id: number;
  type: "assistant" | "user" | "error" | "info" | "success" | "warning";
  content: string;
  timestamp: Date;
}

export interface AgentSession {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  status: SessionStatus;
  progress: number;
  needsIntervention: boolean;
  claudeSessionId?: string;
  process?: any;
  tokensUsed: number;
  cost: number;
  messages: TerminalMessage[];
  archived?: boolean;
  createdAt: Date;
  updatedAt: Date;
  // Workspace/Project references
  workspaceId?: string;
  projectId?: string;
  task?: string; // The original task/instructions
}

export type SessionStatus = "active" | "paused" | "completed" | "error";

export interface ClaudeMessage {
  type: "assistant" | "user" | "result" | "system";
  subtype?: string;
  message?: any;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
  duration_api_ms?: number;
  is_error?: boolean;
  num_turns?: number;
  result?: string;
  tools?: string[];
  mcp_servers?: any[];
}

export interface FileNode {
  path: string;
  name: string;
  type: "file" | "folder";
  content?: string;
  children?: FileNode[];
}

export interface GitCommit {
  hash: string;
  message: string;
  time: string;
  author: string;
}
