# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

AI Agent Manager - A backend service for managing Claude AI agent sessions with a web-based frontend interface. Built with TypeScript and Bun runtime.

## Commands

```bash
# Install dependencies
bun install

# Start the development server
bun run start

# Format code
bun run format
```

## Architecture

### Core Components

1. **Agent Management** (`src/lib/agent-manager.ts`):
   - Manages Claude CLI processes in isolated git worktrees
   - Each session runs in its own branch with a unique worktree directory
   - Extends EventEmitter for internal event handling

2. **WebSocket Server** (`src/lib/websocket-server.ts`):
   - Handles real-time communication between frontend and backend
   - Key events: createSession, pauseSession, resumeSession, stopSession, editFile, commitFiles

3. **Server** (`src/server.ts`):
   - Express server with Socket.IO integration
   - Serves static frontend from /public
   - CORS enabled for frontend communication

### Key Patterns

- **Event-Driven Architecture**: AgentManager emits events for session updates, output, file changes
- **Process Management**: Spawns and manages Claude CLI processes with proper cleanup
- **File System Integration**: Uses chokidar for file watching and simple-git for version control
- **Real-time Updates**: All agent output and file changes streamed to frontend via WebSocket

### Persistence & Logging

- **State Persistence**: Sessions automatically saved to `{BASE_REPO_PATH}/agent-state.json`
- **Auto-restore**: Sessions restored on startup with previous state
- **Structured Logging**: Separate log files in `logs/` directory:
  - `logs/combined.log` - All application logs
  - `logs/error.log` - Error-level logs only
  - `logs/sessions.log` - Session-specific events
- **Log Rotation**: Automatic rotation with 5MB file size limit

### Debug Mode

- **Environment Variable**: Set `CLAUDE_DEBUG_MODE=true` or `ANTHROPIC_LOG=debug`
- **Runtime Control**: Toggle via WebSocket events (`debug:toggle`, `debug:status`)
- **Effect**: Injects `ANTHROPIC_LOG=debug` into Claude CLI processes for detailed API logging
- **Useful For**: Debugging Claude API requests, response times, and rate limiting issues

### Environment Variables

Required in `.env`:
- `ANTHROPIC_API_KEY` - Claude API key
- `BASE_REPO_PATH` - Directory for git worktrees (default: ./repo)
- `FRONTEND_URL` - Frontend URL for CORS (default: http://localhost:3001)
- `PORT` - Server port (default: 3000)
- `LOG_LEVEL` - Logging level (default: info)
- `CLAUDE_DEBUG_MODE` - Enable debug mode for Claude CLI processes (default: false)