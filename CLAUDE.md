# CLAUDE.md

This file provides guidance to Claude Code when working with this AI Agent Manager project.

## Architecture Overview

The AI Agent Manager is a WebSocket-based application that manages multiple Claude AI sessions in parallel. The system creates isolated git worktrees for each session and provides a web interface to monitor and control the agents.

### Core Components

1. **AgentManager** (`src/lib/agent-manager.ts`): Core session management

   - Creates and manages Claude CLI processes
   - Handles git worktree creation for session isolation
   - Tracks session state and persistence
   - Uses `execa` for robust process execution with JSON output format
   - Integrates with WorkspaceManager for project organization

2. **WebSocketServer** (`src/lib/websocket-server.ts`): Real-time communication

   - Handles WebSocket connections from frontend
   - Forwards events between frontend and AgentManager
   - Manages file watchers for real-time file changes
   - Handles workspace/project operations

3. **WorkspaceManager** (`src/lib/workspace-manager.ts`): Workspace and project organization

   - Manages workspaces (collections of projects)
   - Handles project creation and switching
   - Persists workspace configuration to `~/.ai-agent-manager/`
   - Tracks active workspace/project and recent projects

4. **Frontend** (`public/index.html`): Single-page Alpine.js application
   - Session management interface
   - Real-time terminal output display
   - File browser and editor
   - Git log viewer
   - TODO task management
   - Workspace/project management UI

### Key Features

- **Session Isolation**: Each Claude session runs in its own git worktree
- **Real-time Updates**: WebSocket communication for live session monitoring
- **File Management**: Browse, edit, and save files in session workspaces
- **Git Integration**: Automatic branch creation and commit tracking
- **TODO Management**: Track and manage tasks per session
- **Workspace Organization**: Group projects and sessions into workspaces
- **Message Persistence**: Session conversations are saved and restored
- **Auto Port Selection**: Server automatically finds available port

## Common Development Commands

### Development

- `bun start` - Start the development server
- `bun run format` - Format code with Prettier

### Testing

- `bun test` - Run all tests with Vitest
- `bun run test:ui` - Run tests with interactive UI
- `bun run test:coverage` - Run tests with coverage report
- `bun run test:run` - Run tests once (non-watch mode)

### Maintenance

- `bun run clean` - Clean log files
- `bun run nuke` - Remove all dependencies and lock files

## TODO / Roadmap

### Immediate Priorities

1. **Session Resumption** - Currently sessions are marked as "completed" on restart

   - [x] Properly restore session state when server restarts (now marked as "paused" instead of "completed")
   - [x] Maintain Claude session ID for proper continuation
   - [ ] Add UI button to resume paused sessions
   - [ ] Test actual session resumption with Claude CLI

2. **Workspace/Project Management** ✅

   - [x] Created workspace/project data models
   - [x] Implemented WorkspaceManager class
   - [x] Integrated workspace manager with AgentManager
   - [x] Added WebSocket handlers for workspace operations
   - [x] Add UI for workspace/project switching
   - [x] Tested workspace/project functionality
   - [ ] Filter sessions by current project
   - [ ] Migrate existing sessions to workspace structure

3. **File Browser Improvements**

   - [ ] Show actual files from session worktree
   - [ ] Fix file editing/saving functionality
   - [ ] Add file creation/deletion capabilities

4. **Git Integration**
   - [ ] Show actual git commits from session branch
   - [ ] Add ability to commit changes from UI
   - [ ] Show git diff/status

### Phase 1: Core Fixes ✅

- [x] Fix Claude CLI integration using proper JSON format with execa
- [x] Switch from Playwright to Vitest for testing
- [x] Remove broken telemetry system
- [x] Clean up project structure

### Phase 2: UI Improvements ✅

- [x] Make session name optional (generate default name if not provided)
- [x] Display session ID in the agent session card in frontend
- [x] Fix dark mode toggle - light mode currently broken
- [x] Show error status properly in session cards

### Phase 2.5: Additional Improvements ✅

- [x] Message persistence - terminal output stored in agent-state.json
- [x] Session archive/delete functionality
- [x] Debug console for frontend troubleshooting
- [x] Interactive messaging - ability to send messages to Claude in active sessions
- [x] Automatic port selection - server finds available port automatically
- [x] Fixed Alpine.js rendering errors with proper null checks
- [x] Improved scrolling for terminal and debug console

### Phase 3: Terminal Integration

- [ ] Add xterm.js for running commands alongside Claude sessions
  - Interactive terminal in each session
  - Run scripts and tasks without going through Claude
  - Maintain terminal history per session
  - Allow direct command execution in session workspace

### Phase 4: TODO Management

- [ ] Sync TODO tab items to TODO.md file in project directory
  - One TODO.md per session in the session's worktree
  - Auto-sync when TODOs are updated in the UI
  - Markdown format for easy reading outside the app
  - Load existing TODO.md files when session is restored

### Phase 2.6: Workspace & Project Management ✅

- [x] Implement "Workspace" concept

  - Collection of projects with shared configuration
  - Persist in `~/.ai-agent-manager/` in user's home directory
  - Workspace settings include theme, auto-save, model preferences

- [x] Implement "Project" concept

  - A directory where Claude runs with related session information
  - Sessions automatically associated with current project
  - Project metadata includes name, path, description

- [x] Add project switching in frontend
  - Workspaces view with sidebar for workspace selection
  - Projects displayed in main area with session counts
  - Create/edit/delete workspaces and projects
  - Current workspace/project shown in header

### Phase 6: Session Management

- [ ] Session templates for common tasks
- [ ] Session resumption across server restarts
- [ ] Export/import session configurations
- [ ] Session collaboration features
- [ ] Import existing Claude sessions from CLI
  - Use `claude --resume` to list all stored sessions
  - Allow users to import and manage external sessions
  - Recover orphaned or lost sessions

### Phase 7: Advanced Features

- [ ] Authentication and multi-user support
- [ ] Cost tracking and limits per project/user
- [ ] Claude tool use integration (Bash, FileEditor, etc.)
- [ ] Docker deployment option
- [ ] CLI client for the agent manager
- [ ] Custom system prompts per session type
- [ ] Session analytics and reporting

## Development Notes

### Data Models

#### Workspace

```typescript
interface WorkspaceConfig {
  id: string;
  name: string;
  description?: string;
  projects: Project[];
  settings: WorkspaceSettings;
  createdAt: Date;
  updatedAt: Date;
}
```

#### Project

```typescript
interface Project {
  id: string;
  name: string;
  path: string;
  description?: string;
  sessions: string[]; // Session IDs
  createdAt: Date;
  updatedAt: Date;
}
```

#### Session

```typescript
interface AgentSession {
  id: string;
  name: string;
  branch: string;
  worktreePath: string;
  status: "active" | "paused" | "completed" | "error";
  workspaceId?: string;
  projectId?: string;
  task?: string;
  messages: TerminalMessage[];
  claudeSessionId?: string;
  // ... other fields
}
```

### Claude CLI Integration

- Uses `execa` instead of Node's `spawn` for better process management
- Claude CLI is invoked with `claude -p "task" --output-format json`
- Responses are parsed as complete JSON objects (not streaming)
- Session resumption uses `claude --resume <session-id> --output-format json`
- **Important**: Running `claude --resume` without an ID returns a list of all Claude's stored sessions
  - This could be used to "scan folders for existing sessions"
  - Useful for importing sessions that were created outside the Agent Manager
  - Could help recover orphaned sessions

### Session Management

- Each session gets its own git worktree for isolation
- Session state is persisted to `agent-state.json`
- Sessions are automatically marked as "paused" when server restarts (if they were active)
- Sessions store their Claude session ID for resumption
- Sessions are associated with workspaces and projects
- Message history is persisted and restored

### WebSocket Events

#### Session Events

- `session:create` - Create new session
- `session:created` - Session successfully created
- `session:archive` - Archive a session
- `session:unarchive` - Unarchive a session
- `session:delete` - Delete a session
- `session:status` - Session status changed
- `session:error` - Error in session
- `session:message` - Send message to active session
- `claude:message` - Claude response received

#### File Events

- `files:list` - Request file listing
- `file:read` - Read file content
- `file:save` - Save file content

#### Workspace Events

- `workspace:list` - Get all workspaces
- `workspace:create` - Create new workspace
- `workspace:created` - Workspace created
- `workspace:switch` - Switch active workspace
- `workspace:current` - Get current workspace

#### Project Events

- `project:create` - Create new project
- `project:created` - Project created
- `project:switch` - Switch active project
- `project:switched` - Project switched
- `project:delete` - Delete project

### Workspace Persistence

- Workspaces are stored in `~/.ai-agent-manager/`
- Configuration files:
  - `workspaces.json` - All workspace configurations
  - `state.json` - Active workspace/project and recent projects
- Each workspace can contain multiple projects
- Projects reference directories on the filesystem
- Sessions within projects are tracked by their IDs

### Testing Strategy

- Unit tests for individual components using Vitest
- Integration tests for full workflow scenarios
- Mock Claude CLI for predictable testing
- Coverage reports for code quality assurance
