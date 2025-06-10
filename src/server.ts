import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { AgentManager } from "./lib/agent-manager";
import { WebSocketServer } from "./lib/websocket-server";

dotenv.config();

const app = express();
const httpServer = createServer(app);

// CORS setup
app.use(
  cors({
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
  }),
);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Serve static files (optional - for hosting the frontend)
app.use(express.static("public"));

// Initialize Socket.io
const io = new Server(httpServer, {
  cors: {
    origin: process.env.FRONTEND_URL || "http://localhost:3001",
    methods: ["GET", "POST"],
  },
});

// Initialize managers
const agentManager = new AgentManager();
const webSocketServer = new WebSocketServer(io, agentManager);

// Start server
const PORT = process.env.PORT || 3000;

async function start() {
  try {
    await agentManager.initialize();

    httpServer.listen(PORT, () => {
      console.log(`\n🚀 AI Agent Manager Ready`);
      console.log(`   Server:    http://localhost:${PORT}`);
      console.log(`   WebSocket: ws://localhost:${PORT}`);
      console.log(`   Frontend:  http://localhost:${PORT}/index.html\n`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
}

start();

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`${signal} received, shutting down gracefully`);

  try {
    // Shutdown agent manager first
    await agentManager.shutdown();

    // Close HTTP server
    httpServer.close(() => {
      console.log("Server closed");
      process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
      console.error("Force exiting after timeout");
      process.exit(1);
    }, 10000);
  } catch (error) {
    console.error("Error during shutdown:", error);
    process.exit(1);
  }
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
