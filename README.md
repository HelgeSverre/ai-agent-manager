# AI Agent Manager

**Status: Work in Progress - Not ready for production use**

A WebSocket-based application for managing multiple Claude AI sessions in parallel. Each session runs in an isolated git worktree with its own branch, allowing for independent work environments.

Inspired by [claude-squad](https://github.com/smtg-ai/claude-squad) - a tool for running multiple Claude agents in parallel.

## Architecture

The system consists of three main components:

1. **Backend (Node.js/Bun)**
   - `AgentManager`: Manages Claude sessions using the Claude Code SDK
   - `WebSocketServer`: Handles real-time communication with the frontend
   - Creates isolated git worktrees for each session

2. **Frontend (Alpine.js)**
   - Single-page application for monitoring and controlling sessions
   - Real-time terminal output display
   - Session management interface

3. **Session Isolation**
   - Each Claude session runs in its own git worktree
   - Sessions have their own branches for change tracking
   - Session state is persisted and can be resumed

## Prerequisites

- Node.js 18+ or Bun
- Git repository (sessions will create worktrees from this repo)
- Claude Code SDK access

## Installation

```bash
# Clone the repository
git clone <repository-url>
cd ai-agent-manager

# Install dependencies
bun install
# or
npm install
```

## Usage

1. Start the server:
```bash
bun start
# or
npm start
```

2. Open your browser to `http://localhost:3768` (or the port shown in console)

3. Create a new session:
   - Enter a task description
   - Click "Create Session"
   - Monitor the session output in real-time

4. Managing sessions:
   - View active sessions in the Sessions tab
   - Send messages to active sessions
   - Archive completed sessions
   - Delete sessions to clean up resources

## Commands

- `bun start` - Start the development server
- `bun run format` - Format code with Prettier
- `bun test` - Run tests
- `bun run clean` - Clean log files
- `bun run nuke` - Remove all dependencies and lock files

## Session States

- **Active**: Session is currently running
- **Paused**: Session was active but is temporarily stopped
- **Completed**: Session finished successfully
- **Error**: Session encountered an error

## Current Limitations

- Session resumption after server restart is not fully implemented
- File browser functionality is limited
- Git integration (viewing commits, diffs) is incomplete
- No authentication or multi-user support

## Technical Details

- Uses Claude Code SDK (`@anthropic-ai/claude-code`) for Claude integration
- WebSocket communication via Socket.IO
- Git worktrees for session isolation
- Session state persisted to `agent-state.json`
- Frontend built with Alpine.js and Tailwind CSS

## Development

See [CLAUDE.md](CLAUDE.md) for detailed development guidance and architecture notes.