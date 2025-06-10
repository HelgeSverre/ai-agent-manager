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

2. **WebSocketServer** (`src/lib/websocket-server.ts`): Real-time communication

   - Handles WebSocket connections from frontend
   - Forwards events between frontend and AgentManager
   - Manages file watchers for real-time file changes

3. **Frontend** (`public/index.html`): Single-page Alpine.js application
   - Session management interface
   - Real-time terminal output display
   - File browser and editor
   - Git log viewer
   - TODO task management

### Key Features

- **Session Isolation**: Each Claude session runs in its own git worktree
- **Real-time Updates**: WebSocket communication for live session monitoring
- **File Management**: Browse, edit, and save files in session workspaces
- **Git Integration**: Automatic branch creation and commit tracking
- **TODO Management**: Track and manage tasks per session

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

### Phase 5: Workspace & Project Management

- [ ] Implement "Workspace" concept

  - Collection of projects with shared configuration
  - Persist in `~/.ai-agent-manager/workspace.json`
  - Or use `./.ai-agent-manager/` if exists in current directory
  - In dev mode, use current project folder as workspace

- [ ] Implement "Project" concept

  - A directory where Claude runs with related session information
  - Allow multiple agents per project simultaneously
  - Project-level settings and templates

- [ ] Add project switching in frontend
  - UI to switch between different projects/repositories
  - Show which agents are working on which project
  - Support scenarios like: 3 agents on project A, 2 on project B

### Phase 6: Session Management

- [ ] Session templates for common tasks
- [ ] Session resumption across server restarts
- [ ] Export/import session configurations
- [ ] Session collaboration features

### Phase 7: Advanced Features

- [ ] Authentication and multi-user support
- [ ] Cost tracking and limits per project/user
- [ ] Claude tool use integration (Bash, FileEditor, etc.)
- [ ] Docker deployment option
- [ ] CLI client for the agent manager
- [ ] Custom system prompts per session type
- [ ] Session analytics and reporting

## Development Notes

### Claude CLI Integration

- Uses `execa` instead of Node's `spawn` for better process management
- Claude CLI is invoked with `claude -p "task" --output-format json`
- Responses are parsed as complete JSON objects (not streaming)
- Session resumption uses `claude --resume <session-id> --output-format json`

### Session Management

- Each session gets its own git worktree for isolation
- Session state is persisted to `agent-state.json`
- Sessions are automatically marked as completed when server restarts

### WebSocket Events

- `session:create` - Create new session
- `claude:message` - Claude response received
- `session:status` - Session status changed
- `session:error` - Error in session
- `files:list` - Request file listing
- `file:read/save` - File operations

### Testing Strategy

- Unit tests for individual components using Vitest
- Integration tests for full workflow scenarios
- Mock Claude CLI for predictable testing
- Coverage reports for code quality assurance
