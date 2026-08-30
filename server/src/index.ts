import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import path from 'path';
import fs from 'fs';
import jwt from 'jsonwebtoken';

import { config } from './config/env.js';
import { initDatabase } from './db/database.js';
import { GuacdService } from './services/guacd.service.js';

import authRoutes from './routes/auth.routes.js';
import deviceRoutes from './routes/device.routes.js';
import shareRoutes from './routes/share.routes.js';
import adminRoutes from './routes/admin.routes.js';
import symbolRoutes from './routes/symbol.routes.js';
import { monitoringRouter } from './routes/monitoring.routes.js';
import { dashboardRouter } from './routes/dashboard.routes.js';
import { trackingRouter } from './routes/tracking.routes.js';
import { cloudRouter } from './routes/cloud.routes.js';
import { backupRouter } from './routes/backup.routes.js';
import { MonitoringService } from './services/monitoring.service.js';
import { TrackingService } from './services/tracking.service.js';
import { CloudService } from './services/cloud.service.js';

// 1. Initialize SQLite Database & Background Jobs
initDatabase();
MonitoringService.startBackgroundJob();
TrackingService.startBackgroundJob();
CloudService.startBackgroundJob();

// 2. Setup Express application
const app = express();

app.use(cors({
  origin: true,
  credentials: true,
}));
app.use(cookieParser());
app.use(express.json());

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/devices', deviceRoutes);
app.use('/api/shares', shareRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/symbols', symbolRoutes);
app.use('/api/monitoring', monitoringRouter);
app.use('/api/dashboard', dashboardRouter);
app.use('/api/tracking', trackingRouter);
app.use('/api/cloud', cloudRouter);
app.use('/api/backup', backupRouter);

// Direct static route for Symbols
app.use('/symbols', express.static(config.symbolsDir, {
  maxAge: '1d',
  setHeaders: (res, path) => {
    if (path.endsWith('.svg')) {
      res.setHeader('Content-Type', 'image/svg+xml');
    }
  }
}));

// Production Frontend Static Serving
const clientDistPath = path.resolve(__dirname, '../../client/dist');
if (fs.existsSync(clientDistPath)) {
  console.log(`📦 Serving production client build from: ${clientDistPath}`);
  app.use(express.static(clientDistPath));
  app.get('*', (req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/ws') || req.path.startsWith('/symbols')) {
      return next();
    }
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

// 3. Create HTTP & WebSocket Server
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });

// Handle WebSocket upgrade for Guacamole tunnel
server.on('upgrade', (request, socket, head) => {
  const url = new URL(request.url || '', `http://${request.headers.host}`);
  
  if (url.pathname === '/ws/tunnel') {
    const token = url.searchParams.get('token');
    
    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    try {
      const payload = jwt.verify(token, config.jwtSecret) as any;
      if (payload.type !== 'tunnel' || !payload.deviceId) {
        socket.write('HTTP/1.1 403 Forbidden\r\n\r\n');
        socket.destroy();
        return;
      }

      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request, payload, url.searchParams);
      });
    } catch (err: any) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
    }
  } else {
    socket.destroy();
  }
});

// WebSocket Connection handler
wss.on('connection', (ws: WebSocket, request: http.IncomingMessage, payload: any, searchParams: URLSearchParams) => {
  const clientIp = (request.headers['x-forwarded-for'] as string || request.socket.remoteAddress || '').split(',')[0].trim();
  const userAgent = request.headers['user-agent'] || '';

  const width = parseInt(searchParams.get('width') || '1280', 10);
  const height = parseInt(searchParams.get('height') || '720', 10);
  const dpi = parseInt(searchParams.get('dpi') || '96', 10);
  const audio = searchParams.getAll('audio');

  GuacdService.handleWebSocketConnection(
    ws,
    {
      sessionId: payload.sessionId || `sess_${Date.now()}`,
      deviceId: payload.deviceId,
      userId: payload.userId || null,
      guestShareId: payload.guestShareId || null,
      connectionMethod: payload.connectionMethod || 'owner',
      clientIp,
      userAgent,
    },
    { width, height, dpi, audio }
  );
});

// 4. Start Server
server.listen(config.port, '0.0.0.0', () => {
  console.log(`
  ======================================================
  🌊  Shoreline Connect Server v1.0.0
  ======================================================
  📡  API & Web:    http://0.0.0.0:${config.port}
  🔒  Active Dir:   ${config.ad.domain} (${config.ad.url})
  🔐  Dev Auth:     ${config.devAuthMode ? 'ENABLED (Simulated fallback active)' : 'DISABLED (Live AD strictly enforced)'}
  🖥️   guacd Daemon: ${config.guacd.host}:${config.guacd.port}
  🎨  Symbols Dir:  ${config.symbolsDir}
  ======================================================
  `);
});
