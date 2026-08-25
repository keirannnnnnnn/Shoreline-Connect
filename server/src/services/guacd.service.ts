import net from 'net';
import { WebSocket } from 'ws';
import { config } from '../config/env.js';
import { DeviceService, DeviceCredentials, DeviceParameters } from './device.service.js';
import { AuditService } from './audit.service.js';

export interface GuacamoleTunnelSession {
  sessionId: string;
  deviceId: string;
  userId?: string | null;
  guestShareId?: string | null;
  connectionMethod: 'owner' | 'shared_user' | 'guest_link';
  clientIp?: string;
  userAgent?: string;
}

export class GuacdService {
  /**
   * Parse a single Guacamole instruction string (length-prefixed CSV, ending in ';')
   * e.g. "4.size,1.0,4.1024,3.768;" -> ["size", "0", "1024", "768"]
   */
  static parseInstruction(instructionStr: string): string[] {
    const elements: string[] = [];
    let pos = 0;

    while (pos < instructionStr.length) {
      const dotIndex = instructionStr.indexOf('.', pos);
      if (dotIndex === -1) break;

      const lenStr = instructionStr.substring(pos, dotIndex);
      const len = parseInt(lenStr, 10);
      if (isNaN(len)) break;

      const valStart = dotIndex + 1;
      const valEnd = valStart + len;
      const val = instructionStr.substring(valStart, valEnd);
      elements.push(val);

      pos = valEnd;
      if (instructionStr[pos] === ',' || instructionStr[pos] === ';') {
        pos += 1;
      }
    }

    return elements;
  }

  /**
   * Format an array of strings into a Guacamole instruction string
   * e.g. ["select", "rdp"] -> "6.select,3.rdp;"
   */
  static formatInstruction(elements: (string | number | undefined | null)[]): string {
    return elements
      .map(el => {
        const str = el !== undefined && el !== null ? String(el) : '';
        const byteLen = Buffer.byteLength(str, 'utf8');
        return `${byteLen}.${str}`;
      })
      .join(',') + ';';
  }

  /**
   * Handle WebSocket tunnel connection for a session
   */
  static handleWebSocketConnection(
    ws: WebSocket,
    sessionInfo: GuacamoleTunnelSession,
    clientParams: { width?: number; height?: number; dpi?: number; audio?: string[] }
  ) {
    const { sessionId, deviceId } = sessionInfo;

    const deviceConfig = DeviceService.getDeviceConnectionConfig(deviceId);
    if (!deviceConfig) {
      this.sendGuacError(ws, 'Device configuration not found or corrupted');
      ws.close(1008, 'Device not found');
      return;
    }

    // Record session start in audit logs
    AuditService.startSession({
      sessionId,
      userId: sessionInfo.userId,
      guestShareId: sessionInfo.guestShareId,
      deviceId: deviceConfig.id,
      deviceName: deviceConfig.name,
      protocol: deviceConfig.protocol,
      connectionMethod: sessionInfo.connectionMethod,
      clientIp: sessionInfo.clientIp,
      userAgent: sessionInfo.userAgent,
    });

    console.log(`[GuacdService] Initiating connection to guacd (${config.guacd.host}:${config.guacd.port}) for device: ${deviceConfig.name} (${deviceConfig.protocol})`);

    // Connect to guacd TCP socket
    const guacdSocket = new net.Socket();
    let isConnectedToGuacd = false;
    let guacdBuffer = '';

    guacdSocket.connect(config.guacd.port, config.guacd.host, () => {
      isConnectedToGuacd = true;
      console.log(`[GuacdService] Connected to guacd daemon. Starting handshake for ${deviceConfig.protocol}...`);

      // Step 1: Send select instruction
      const selectInstruction = this.formatInstruction(['select', deviceConfig.protocol]);
      guacdSocket.write(selectInstruction);
    });

    guacdSocket.on('data', (data) => {
      const incoming = data.toString('utf8');
      guacdBuffer += incoming;

      // Process complete instructions separated by ';'
      let semicolonIndex = guacdBuffer.indexOf(';');
      while (semicolonIndex !== -1) {
        const instruction = guacdBuffer.substring(0, semicolonIndex + 1);
        guacdBuffer = guacdBuffer.substring(semicolonIndex + 1);

        this.processGuacdInstruction(instruction, guacdSocket, ws, deviceConfig, clientParams);
        semicolonIndex = guacdBuffer.indexOf(';');
      }
    });

    guacdSocket.on('error', (err) => {
      console.warn(`[GuacdService] guacd socket error: ${err.message}`);
      if (!isConnectedToGuacd) {
        // Fallback / friendly message when guacd daemon is not running
        this.sendGuacError(ws, `guacd daemon is not reachable at ${config.guacd.host}:${config.guacd.port}. Ensure guacd is running.`);
      }
      AuditService.endSession(sessionId, 'failed', err.message);
      if (ws.readyState === WebSocket.OPEN) {
        ws.close(1011, `guacd connection error: ${err.message}`);
      }
    });

    guacdSocket.on('close', () => {
      console.log(`[GuacdService] guacd connection closed for session: ${sessionId}`);
      AuditService.endSession(sessionId, 'closed');
      if (ws.readyState === WebSocket.OPEN) {
        ws.close();
      }
    });

    // Forward WebSocket messages from client to guacd
    ws.on('message', (message) => {
      if (guacdSocket && !guacdSocket.destroyed && isConnectedToGuacd) {
        guacdSocket.write(message.toString());
      }
    });

    ws.on('close', () => {
      console.log(`[GuacdService] Client WebSocket closed for session: ${sessionId}`);
      AuditService.endSession(sessionId, 'closed');
      if (guacdSocket && !guacdSocket.destroyed) {
        guacdSocket.end();
      }
    });

    ws.on('error', (err) => {
      console.error(`[GuacdService] WebSocket error for session ${sessionId}:`, err);
      AuditService.endSession(sessionId, 'failed', err.message);
      if (guacdSocket && !guacdSocket.destroyed) {
        guacdSocket.end();
      }
    });
  }

  /**
   * Process and forward Guacamole protocol instructions
   */
  private static processGuacdInstruction(
    instruction: string,
    guacdSocket: net.Socket,
    ws: WebSocket,
    deviceConfig: {
      id: string;
      name: string;
      protocol: 'rdp' | 'vnc' | 'ssh';
      host: string;
      port: number;
      credentials: DeviceCredentials;
      parameters: DeviceParameters;
    },
    clientParams: { width?: number; height?: number; dpi?: number; audio?: string[] }
  ) {
    const parsed = this.parseInstruction(instruction);
    const opcode = parsed[0];

    // Handle handshake "args" instruction from guacd
    if (opcode === 'args') {
      const expectedArgs = parsed.slice(1);
      const width = clientParams.width || deviceConfig.parameters.width || 1280;
      const height = clientParams.height || deviceConfig.parameters.height || 720;
      const dpi = clientParams.dpi || deviceConfig.parameters.dpi || 96;

      // 1. Send size instruction
      const sizeInst = this.formatInstruction(['size', width, height, dpi]);
      guacdSocket.write(sizeInst);

      // 2. Send audio formats
      if (clientParams.audio && clientParams.audio.length > 0) {
        const audioInst = this.formatInstruction(['audio', ...clientParams.audio]);
        guacdSocket.write(audioInst);
      } else {
        const audioInst = this.formatInstruction(['audio', 'audio/ogg', 'audio/mp4', 'audio/webm', 'audio/wav']);
        guacdSocket.write(audioInst);
      }

      // 3. Send video formats (empty/supported)
      const videoInst = this.formatInstruction(['video']);
      guacdSocket.write(videoInst);

      // 4. Send image formats (Crucial for guacd display rendering!)
      const imageInst = this.formatInstruction(['image', 'image/png', 'image/jpeg', 'image/webp']);
      guacdSocket.write(imageInst);

      // 5. Build response values for expected args
      const argValues = this.buildConnectionArgs(expectedArgs, deviceConfig, width, height, dpi);
      const connectInst = this.formatInstruction(['connect', ...argValues]);
      guacdSocket.write(connectInst);
      return;
    }

    // Forward all other instructions (ready, sync, draw, copy, mouse, key, etc.) to WebSocket
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(instruction);
    }
  }

  /**
   * Map device parameters and credentials to guacd's expected argument schema
   */
  private static buildConnectionArgs(
    expectedArgs: string[],
    deviceConfig: {
      protocol: 'rdp' | 'vnc' | 'ssh';
      host: string;
      port: number;
      credentials: DeviceCredentials;
      parameters: DeviceParameters;
    },
    width: number,
    height: number,
    dpi: number
  ): string[] {
    const creds = deviceConfig.credentials;
    const params = deviceConfig.parameters;

    const valueMap: Record<string, string> = {
      'hostname': deviceConfig.host,
      'port': String(deviceConfig.port),
      'username': creds.username || '',
      'password': creds.password || '',
      'private-key': creds.privateKey || '',
      'passphrase': creds.passphrase || '',
      'domain': params.domain || '',
      'security': params.security || 'any',
      'ignore-cert': params.ignoreCert !== false ? 'true' : 'false',
      'disable-auth': 'false',
      'width': String(width),
      'height': String(height),
      'dpi': String(dpi),
      'color-depth': String(params.colorDepth || 24),
      
      // Audio settings
      'enable-audio': params.audio !== false ? 'true' : 'false',
      'disable-audio': params.audio === false ? 'true' : 'false',
      'enable-audio-input': 'false',

      // Storage & Drive redirection
      'enable-drive': params.driveRedirect ? 'true' : 'false',
      'create-drive-path': 'false',

      // Keyboard & Localization
      'server-layout': params.keyboardLayout || 'en-us-qwerty',
      'timezone': params.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
      
      // Performance & Rendering settings (Fixes Windows 10/11 / Server EGFX arbitration teardown)
      'disable-gfx': params['disable-gfx'] !== undefined ? String(params['disable-gfx']) : 'true',
      'disable-glyph-caching': params['disable-glyph-caching'] !== undefined ? String(params['disable-glyph-caching']) : 'true',
      'disable-bitmap-caching': params['disable-bitmap-caching'] !== undefined ? String(params['disable-bitmap-caching']) : 'false',
      'disable-offscreen-caching': params['disable-offscreen-caching'] !== undefined ? String(params['disable-offscreen-caching']) : 'false',
      'enable-font-smoothing': params.fontSmoothing !== false ? 'true' : 'false',
      'enable-theming': params.theming !== false ? 'true' : 'false',
      'enable-wallpaper': params.wallpaper !== false ? 'true' : 'false',
      'enable-full-window-drag': params.fullWindowDrag !== false ? 'true' : 'false',
      'enable-desktop-composition': params.desktopComposition !== false ? 'true' : 'false',
      'enable-menu-animations': params.menuAnimations !== false ? 'true' : 'false',
      'enable-printing': 'false',
      'resize-method': params['resize-method'] || 'display-update',
      'client-name': params.clientName || 'ShorelineConnect',
      'console': params.console ? 'true' : 'false',

      // Terminal (SSH)
      'font-size': String(params.fontSize || 14),
      'cursor': params.cursorStyle || 'ibeam',
      'scrollback': '2000',
    };

    return expectedArgs.map(argName => {
      // If guacd sends a protocol version token (e.g. "VERSION_1_5_0"), echo it back unchanged
      if (argName.startsWith('VERSION_')) {
        return argName;
      }
      return valueMap[argName] ?? (params[argName] !== undefined ? String(params[argName]) : '');
    });
  }

  /**
   * Send a Guacamole error instruction to the client
   */
  private static sendGuacError(ws: WebSocket, message: string) {
    if (ws.readyState === WebSocket.OPEN) {
      const errorInst = this.formatInstruction(['error', message, 514]);
      ws.send(errorInst);
    }
  }
}
