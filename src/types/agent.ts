export interface AgentSession {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  status: "active" | "paused" | "completed" | "error";
  progress: number;
  needsIntervention: boolean;
  claudeSessionId?: string;
  process?: any;
  tokensUsed: number;
  cost: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface ClaudeMessage {
  type: "assistant" | "user" | "result" | "system";
  subtype?: string;
  message?: any;
  session_id?: string;
  cost_usd?: number;
  duration_ms?: number;
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
