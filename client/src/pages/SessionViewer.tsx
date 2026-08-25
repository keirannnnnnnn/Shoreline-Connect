import React, { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import Guacamole from 'guacamole-common-js';
import { api } from '../lib/api.js';
import { SymbolIcon } from '../components/SymbolIcon.js';

export const SessionViewer: React.FC = () => {
  const { id, token: guestToken } = useParams<{ id?: string; token?: string }>();
  const navigate = useNavigate();
  const location = useLocation();

  const containerRef = useRef<HTMLDivElement>(null);
  const clientRef = useRef<Guacamole.Client | null>(null);
  const tunnelRef = useRef<Guacamole.WebSocketTunnel | null>(null);
  const lastSyncedClipboardRef = useRef<string>('');

  const [deviceName, setDeviceName] = useState<string>('Remote Session');
  const [protocol, setProtocol] = useState<string>('rdp');
  const [connectionStatus, setConnectionStatus] = useState<'connecting' | 'connected' | 'disconnected' | 'error'>('connecting');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  
  // Toolbar state
  const [toolbarOpen, setToolbarOpen] = useState(true);
  const [scaleMode, setScaleMode] = useState<'fit' | 'native'>('fit');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [sessionSeconds, setSessionSeconds] = useState(0);

  // Clipboard sync modal
  const [isClipboardModalOpen, setIsClipboardModalOpen] = useState(false);
  const [clipboardText, setClipboardText] = useState('');

  // Session duration timer
  useEffect(() => {
    let interval: any = null;
    if (connectionStatus === 'connected') {
      interval = setInterval(() => {
        setSessionSeconds((s) => s + 1);
      }, 1000);
    }
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [connectionStatus]);

  const formatSessionTime = (totalSec: number) => {
    const hrs = Math.floor(totalSec / 3600);
    const mins = Math.floor((totalSec % 3600) / 60);
    const secs = totalSec % 60;
    if (hrs > 0) {
      return `${hrs}:${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    }
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  };

  useEffect(() => {
    let tunnel: Guacamole.WebSocketTunnel | null = null;
    let client: Guacamole.Client | null = null;
    let mouse: Guacamole.Mouse | null = null;
    let keyboard: Guacamole.Keyboard | null = null;

    // 2-Way Clipboard Sync (Local to Remote)
    const syncLocalToRemote = async () => {
      try {
        if (navigator.clipboard && navigator.clipboard.readText && clientRef.current) {
          const text = await navigator.clipboard.readText();
          if (text && text !== lastSyncedClipboardRef.current) {
            lastSyncedClipboardRef.current = text;
            const stream = clientRef.current.createClipboardStream('text/plain');
            const writer = new Guacamole.StringWriter(stream);
            writer.sendText(text);
            writer.sendEnd();
          }
        }
      } catch {}
    };

    const handlePasteEvent = (e: ClipboardEvent) => {
      const text = e.clipboardData?.getData('text/plain');
      if (text && clientRef.current) {
        lastSyncedClipboardRef.current = text;
        const stream = clientRef.current.createClipboardStream('text/plain');
        const writer = new Guacamole.StringWriter(stream);
        writer.sendText(text);
        writer.sendEnd();
      }
    };

    const startSession = async () => {
      setConnectionStatus('connecting');
      setErrorMessage(null);

      try {
        let tunnelToken = '';
        
        // Mode 1: Authenticated device session
        if (id) {
          const res = await api.devices.getConnectToken(id);
          tunnelToken = res.token;
          setDeviceName(res.device.name);
          setProtocol(res.device.protocol);
        } 
        // Mode 2: Guest share session passed via state or query
        else if (location.state && location.state.tunnelToken) {
          tunnelToken = location.state.tunnelToken;
          setDeviceName(location.state.deviceName || 'Guest Session');
          setProtocol(location.state.protocol || 'rdp');
        } else {
          throw new Error('No valid session token provided');
        }

        const width = window.innerWidth;
        const height = window.innerHeight;
        const dpi = window.devicePixelRatio ? Math.round(window.devicePixelRatio * 96) : 96;

        // Build WebSocket tunnel URL
        const protocolWs = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocolWs}//${window.location.host}/ws/tunnel?token=${encodeURIComponent(tunnelToken)}&width=${width}&height=${height}&dpi=${dpi}&audio=audio/ogg&audio=audio/mp4`;

        tunnel = new Guacamole.WebSocketTunnel(wsUrl);
        client = new Guacamole.Client(tunnel);

        tunnelRef.current = tunnel;
        clientRef.current = client;

        // Display element
        const display = client.getDisplay();
        const displayElement = display.getElement();

        let observer: MutationObserver | null = null;

        if (containerRef.current) {
          containerRef.current.innerHTML = '';
          displayElement.classList.add('guacamole-display');
          displayElement.style.zIndex = '1';
          containerRef.current.appendChild(displayElement);

          // Force z-index on canvas layers (overrides guacamole-common-js inline z-index: -1)
          const enforceCanvasZIndex = () => {
            if (containerRef.current) {
              containerRef.current.querySelectorAll('canvas').forEach((canvas) => {
                canvas.style.setProperty('z-index', '1', 'important');
              });
            }
          };

          enforceCanvasZIndex();

          // MutationObserver catches dynamically painted / allocated canvas layers immediately without delay
          observer = new MutationObserver(() => {
            enforceCanvasZIndex();
          });

          observer.observe(containerRef.current, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['style'],
          });
        }

        // Connection state handling
        client.onstatechange = (state: number) => {
          switch (state) {
            case 0: // IDLE
            case 1: // CONNECTING
            case 2: // WAITING
              setConnectionStatus('connecting');
              break;
            case 3: // CONNECTED
              setConnectionStatus('connected');
              break;
            case 4: // DISCONNECTING
            case 5: // DISCONNECTED
              setConnectionStatus('disconnected');
              break;
          }
        };

        client.onerror = (status: { code: number; message: string }) => {
          console.error('[Guacamole Client Error]', status);
          setConnectionStatus('error');
          setErrorMessage(status.message || 'Remote session encountered an error.');
        };

        // Attach Mouse Handler
        mouse = new Guacamole.Mouse(displayElement);
        mouse.onmousedown = (mouseState: any) => {
          if (client) client.sendMouseState(mouseState);
        };
        mouse.onmouseup = (mouseState: any) => {
          if (client) client.sendMouseState(mouseState);
        };
        mouse.onmousemove = (mouseState: any) => {
          if (client) client.sendMouseState(mouseState);
        };

        // Attach Keyboard Handler
        keyboard = new Guacamole.Keyboard(document);
        keyboard.onkeydown = (keysym: number) => {
          if (client) client.sendKeyEvent(1, keysym);
        };
        keyboard.onkeyup = (keysym: number) => {
          if (client) client.sendKeyEvent(0, keysym);
        };

        // 2-Way Clipboard Sync (Remote to Local)
        client.onclipboard = (stream: any, mimetype: string) => {
          if (mimetype.startsWith('text/')) {
            const reader = new Guacamole.StringReader(stream);
            let incomingText = '';
            reader.ontext = (chunk: string) => {
              incomingText += chunk;
            };
            reader.onend = () => {
              if (incomingText) {
                lastSyncedClipboardRef.current = incomingText;
                setClipboardText(incomingText);
                if (navigator.clipboard && navigator.clipboard.writeText) {
                  navigator.clipboard.writeText(incomingText).catch(() => {});
                }
              }
            };
          }
        };

        window.addEventListener('paste', handlePasteEvent);
        window.addEventListener('focus', syncLocalToRemote);
        if (containerRef.current) {
          containerRef.current.addEventListener('pointerdown', syncLocalToRemote);
        }

        // Connect to guacd
        client.connect('');

      } catch (err: any) {
        console.error('[Session Error]', err);
        setConnectionStatus('error');
        setErrorMessage(err.message || 'Failed to initialize session tunnel');
      }
    };

    startSession();

    return () => {
      window.removeEventListener('paste', handlePasteEvent);
      window.removeEventListener('focus', syncLocalToRemote);
      if (keyboard) {
        keyboard.onkeydown = null;
        keyboard.onkeyup = null;
      }
      if (client) {
        try { client.disconnect(); } catch {}
      }
      if (containerRef.current) {
        containerRef.current.innerHTML = '';
      }
    };
  }, [id, guestToken, location.state]);

  // Apply display scaling
  const applyScale = (mode: 'fit' | 'native') => {
    if (!clientRef.current) return;
    const display = clientRef.current.getDisplay();
    if (!display) return;

    if (mode === 'fit') {
      const dispWidth = display.getWidth();
      const dispHeight = display.getHeight();
      if (dispWidth > 0 && dispHeight > 0) {
        const scale = Math.min(window.innerWidth / dispWidth, window.innerHeight / dispHeight);
        display.scale(scale);
      }
    } else {
      display.scale(1.0);
    }
  };

  const handleToggleScaleMode = () => {
    const nextMode = scaleMode === 'fit' ? 'native' : 'fit';
    setScaleMode(nextMode);
    applyScale(nextMode);
  };

  useEffect(() => {
    const handleResize = () => {
      if (scaleMode === 'fit' && clientRef.current) {
        applyScale('fit');
      }
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [scaleMode]);

  // Send Ctrl+Alt+Del
  const handleSendCtrlAltDel = () => {
    if (!clientRef.current) return;
    const client = clientRef.current;
    // Keysyms: Ctrl (0xFFE3), Alt (0xFFE9), Delete (0xFFFF)
    client.sendKeyEvent(1, 0xFFE3); // Ctrl down
    client.sendKeyEvent(1, 0xFFE9); // Alt down
    client.sendKeyEvent(1, 0xFFFF); // Del down
    setTimeout(() => {
      client.sendKeyEvent(0, 0xFFFF); // Del up
      client.sendKeyEvent(0, 0xFFE9); // Alt up
      client.sendKeyEvent(0, 0xFFE3); // Ctrl up
    }, 100);
  };

  // Send Clipboard text
  const handleSendClipboard = () => {
    if (!clientRef.current || !clipboardText) return;
    const client = clientRef.current;
    const stream = client.createClipboardStream('text/plain');
    const writer = new Guacamole.StringWriter(stream);
    writer.sendText(clipboardText);
    writer.sendEnd();
    setIsClipboardModalOpen(false);
    setClipboardText('');
  };

  // Toggle Fullscreen
  const handleToggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
      setIsFullscreen(true);
    } else {
      document.exitFullscreen().catch(() => {});
      setIsFullscreen(false);
    }
  };

  // Disconnect
  const handleDisconnect = () => {
    if (clientRef.current) {
      clientRef.current.disconnect();
    }
    navigate('/');
  };

  return (
    <div className="relative w-screen h-screen bg-black overflow-hidden select-none flex flex-col justify-center items-center">
      
      {/* 1. Floating Glass Toolbar (Collapsible at top) */}
      <div
        className={`fixed top-4 left-1/2 -translate-x-1/2 z-50 transition-all duration-300 ${
          toolbarOpen ? 'translate-y-0 opacity-100' : '-translate-y-16 opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-2 rounded-2xl bg-surface/90 backdrop-blur-xl border border-surface-borderLight shadow-2xl text-xs text-slate-200">
          
          {/* Device & Status */}
          <div className="flex items-center gap-2 pr-3 border-r border-surface-border">
            <span className={`w-2 h-2 rounded-full ${
              connectionStatus === 'connected' ? 'bg-emerald-400 animate-pulse' :
              connectionStatus === 'connecting' ? 'bg-amber-400 animate-pulse' : 'bg-red-500'
            }`} />
            <span className="font-bold text-white max-w-[140px] truncate">{deviceName}</span>
            <span className="uppercase text-[10px] font-mono px-1.5 py-0.5 rounded bg-surface-active text-slate-400 border border-surface-border">
              {protocol}
            </span>
          </div>

          {/* Session Duration */}
          <div className="flex items-center gap-1.5 px-2 text-slate-400 font-mono text-[11px]">
            <SymbolIcon name="stopwatch" className="w-3.5 h-3.5 text-slate-500" />
            <span>{formatSessionTime(sessionSeconds)}</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-1 pl-2 border-l border-surface-border">
            {protocol === 'rdp' && (
              <button
                onClick={handleSendCtrlAltDel}
                className="px-2.5 py-1 rounded-lg bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-200 hover:text-white transition-colors"
                title="Send Ctrl+Alt+Delete to Remote Session"
              >
                Ctrl+Alt+Del
              </button>
            )}

            <button
              onClick={handleToggleScaleMode}
              className="p-1.5 rounded-lg bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white transition-colors"
              title={scaleMode === 'fit' ? 'Scale: Fit to Window (Click for 1:1)' : 'Scale: 1:1 Native Resolution (Click to Fit)'}
            >
              <SymbolIcon name={scaleMode === 'fit' ? 'aspectratio' : 'arrow.up.left.and.down.right.magnifyingglass'} className="w-4 h-4" />
            </button>

            <button
              onClick={() => setIsClipboardModalOpen(true)}
              className="p-1.5 rounded-lg bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white transition-colors"
              title="Send text / clipboard to session"
            >
              <SymbolIcon name="doc.on.clipboard" className="w-4 h-4" />
            </button>

            <button
              onClick={handleToggleFullscreen}
              className="p-1.5 rounded-lg bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white transition-colors"
              title="Toggle Fullscreen"
            >
              <SymbolIcon name={isFullscreen ? 'arrow.down.right.and.arrow.up.left' : 'arrow.up.left.and.arrow.down.right'} className="w-4 h-4" />
            </button>

            <button
              onClick={handleDisconnect}
              className="flex items-center gap-1 px-3 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 transition-colors font-semibold ml-1"
              title="Disconnect and leave session"
            >
              <SymbolIcon name="xmark" className="w-3.5 h-3.5" />
              <span>Leave</span>
            </button>
          </div>
        </div>
      </div>

      {/* Toolbar Toggle Notch */}
      <button
        onClick={() => setToolbarOpen(!toolbarOpen)}
        className="fixed top-0 left-1/2 -translate-x-1/2 z-40 px-3 py-0.5 rounded-b-xl bg-surface-card border border-surface-border text-slate-400 hover:text-white text-[10px] transition-all shadow-md"
      >
        <SymbolIcon name={toolbarOpen ? 'chevron.up' : 'chevron.down'} className="w-3 h-3" />
      </button>

      {/* 2. Guacamole Canvas Viewport */}
      <div
        ref={containerRef}
        className="guac-viewport w-full h-full flex items-center justify-center overflow-hidden cursor-default"
      />

      {/* 3. Connecting / Error Overlays */}
      {connectionStatus === 'connecting' && (
        <div className="absolute inset-0 bg-background/90 backdrop-blur-md flex flex-col items-center justify-center p-6 z-30 animate-in fade-in">
          <div className="w-16 h-16 rounded-3xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mb-4 text-brand-400">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Connecting to {deviceName}</h2>
          <p className="text-xs text-slate-400 max-w-sm text-center">
            Brokering connection via <strong className="text-slate-300">guacd</strong> protocol engine...
          </p>
        </div>
      )}

      {connectionStatus === 'error' && (
        <div className="absolute inset-0 bg-background/95 backdrop-blur-md flex flex-col items-center justify-center p-6 z-30 animate-in fade-in">
          <div className="w-16 h-16 rounded-3xl bg-danger/10 border border-danger/20 flex items-center justify-center mb-4 text-danger">
            <SymbolIcon name="exclamationmark.triangle.fill" className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-bold text-white mb-1">Connection Failed</h2>
          <p className="text-xs text-danger max-w-md text-center mb-6 font-mono">
            {errorMessage || 'Unable to establish session. Ensure target host and guacd daemon are online.'}
          </p>
          <div className="flex items-center gap-3">
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow transition-all"
            >
              Retry Connection
            </button>
            <button
              onClick={() => navigate('/')}
              className="px-4 py-2 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold transition-all"
            >
              Back to Dashboard
            </button>
          </div>
        </div>
      )}

      {/* 4. Clipboard Sync Modal */}
      {isClipboardModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-3xl bg-surface-card border border-surface-border shadow-2xl p-6 space-y-4 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <SymbolIcon name="doc.on.clipboard" className="w-4 h-4 text-brand-400" />
                <span>Send Text to Remote Clipboard</span>
              </h3>
              <button onClick={() => setIsClipboardModalOpen(false)} className="text-slate-400 hover:text-white">
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <textarea
              autoFocus
              rows={5}
              value={clipboardText}
              onChange={(e) => setClipboardText(e.target.value)}
              placeholder="Paste or type text here to send directly into the remote session..."
              className="w-full p-3 rounded-2xl bg-surface border border-surface-border text-white text-xs font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
            />

            <div className="flex justify-end gap-2">
              <button
                onClick={() => setIsClipboardModalOpen(false)}
                className="px-3.5 py-1.5 rounded-xl text-slate-400 hover:text-white text-xs"
              >
                Cancel
              </button>
              <button
                onClick={handleSendClipboard}
                className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20"
              >
                Send to Session
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
