'use strict';

// WebSocket server untuk real-time monitoring dan progress tracking
const { Server } = require('socket.io');

let io = null;

/**
 * Initialize WebSocket server
 * @param {object} httpServer - HTTP server instance
 * @returns {object} Socket.IO instance
 */
function initWebSocket(httpServer) {
  io = new Server(httpServer, {
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    console.log(`  [websocket] Client connected: ${socket.id}`);

    socket.on('disconnect', () => {
      console.log(`  [websocket] Client disconnected: ${socket.id}`);
    });

    // Send initial connection confirmation
    socket.emit('connected', {
      message: 'Connected to SMM Panel WebSocket',
      timestamp: new Date().toISOString(),
    });
  });

  return io;
}

/**
 * Broadcast order progress update
 * @param {number} orderId - Order ID
 * @param {object} data - Progress data
 */
function broadcastOrderProgress(orderId, data) {
  if (!io) return;
  
  io.emit('order:progress', {
    orderId,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast execution update
 * @param {number} executionId - Execution ID
 * @param {object} data - Execution data
 */
function broadcastExecutionUpdate(executionId, data) {
  if (!io) return;
  
  io.emit('execution:update', {
    executionId,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast account health check result
 * @param {number} accountId - Account ID
 * @param {object} data - Health check data
 */
function broadcastHealthCheck(accountId, data) {
  if (!io) return;
  
  io.emit('account:health', {
    accountId,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast queue statistics
 * @param {object} stats - Queue stats
 */
function broadcastQueueStats(stats) {
  if (!io) return;
  
  io.emit('queue:stats', {
    ...stats,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Broadcast system notification
 * @param {string} type - Notification type (info, warning, error, success)
 * @param {string} message - Notification message
 * @param {object} data - Additional data
 */
function broadcastNotification(type, message, data = {}) {
  if (!io) return;
  
  io.emit('notification', {
    type,
    message,
    ...data,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Get connected clients count
 * @returns {number} Number of connected clients
 */
function getConnectedClients() {
  if (!io) return 0;
  return io.sockets.sockets.size;
}

module.exports = {
  initWebSocket,
  broadcastOrderProgress,
  broadcastExecutionUpdate,
  broadcastHealthCheck,
  broadcastQueueStats,
  broadcastNotification,
  getConnectedClients,
};
