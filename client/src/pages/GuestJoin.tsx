import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SymbolIcon } from '../components/SymbolIcon.js';

export const GuestJoin: React.FC = () => {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();

  const [loading, setLoading] = useState(true);
  const [shareData, setShareData] = useState<any>(null);
  const [expiredState, setExpiredState] = useState<string | null>(null);

  const [pin, setPin] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) return;
    checkLink();
  }, [token]);

  const checkLink = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.shares.getPublicGuestShare(token!);
      if (res.valid && res.share) {
        setShareData(res.share);
        // If no PIN required, auto-connect immediately!
        if (!res.share.hasPin) {
          handleConnectDirect();
        }
      } else {
        const getExpirationMessage = (reason?: string, msg?: string) => {
          if (msg) return msg;
          switch (reason) {
            case 'expired': return 'This guest share link has expired.';
            case 'revoked': return 'This share link was revoked by the owner.';
            case 'max_uses_reached': return 'This guest link has reached its maximum connection limit.';
            default: return 'This guest share link has expired or is no longer available.';
          }
        };
        setExpiredState(getExpirationMessage(res.reason, res.message));
      }
    } catch (err: any) {
      setExpiredState(err.message || 'This guest share link has expired or is no longer available.');
    } finally {
      setLoading(false);
    }
  };

  const handleConnectDirect = async () => {
    setConnecting(true);
    setError(null);
    try {
      const res = await api.shares.verifyGuestPinAndConnect(token!, undefined);
      navigate('/session/guest', {
        state: {
          tunnelToken: res.token,
          deviceName: res.device.name,
          protocol: res.device.protocol,
        }
      });
    } catch (err: any) {
      setError(err.message || 'Failed to initialize session');
      setConnecting(false);
    }
  };

  const handleSubmitPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pin.trim()) {
      setError('Please enter the required PIN code');
      return;
    }

    setConnecting(true);
    setError(null);
    try {
      const res = await api.shares.verifyGuestPinAndConnect(token!, pin.trim());
      navigate('/session/guest', {
        state: {
          tunnelToken: res.token,
          deviceName: res.device.name,
          protocol: res.device.protocol,
        }
      });
    } catch (err: any) {
      setError(err.message || 'Incorrect PIN code');
      setConnecting(false);
    }
  };

  return (
    <div className="min-h-screen bg-background flex flex-col justify-center items-center px-4 sm:px-6 relative overflow-hidden text-slate-100">
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] bg-brand-600/10 rounded-full blur-3xl pointer-events-none" />

      {/* Loading state */}
      {loading && (
        <div className="text-center">
          <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-3" />
          <p className="text-xs text-slate-400">Verifying guest share link...</p>
        </div>
      )}

      {/* Expired / Revoked state */}
      {!loading && expiredState && (
        <div className="w-full max-w-md rounded-3xl bg-surface-card border border-surface-border shadow-2xl p-8 text-center animate-in fade-in zoom-in-95">
          <div className="w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto mb-4 text-amber-400">
            <SymbolIcon name="clock.badge.exclamationmark" className="w-7 h-7" />
          </div>
          <h2 className="text-xl font-bold text-white mb-2">Link Expired</h2>
          <p className="text-xs text-slate-400 mb-6 leading-relaxed">
            {expiredState}
            <br />
            Please request a new share link from the device owner.
          </p>
          <div className="pt-4 border-t border-surface-border">
            <span className="text-[11px] text-slate-500 font-mono">
              Shoreline Connect Guest Portal
            </span>
          </div>
        </div>
      )}

      {/* PIN Required Form */}
      {!loading && !expiredState && shareData && (
        <div className="w-full max-w-md rounded-3xl bg-surface-card border border-surface-border shadow-2xl p-8 animate-in fade-in zoom-in-95">
          <div className="flex flex-col items-center text-center mb-6">
            <div className="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 mb-3">
              <SymbolIcon
                name={shareData.protocol === 'rdp' ? 'display' : shareData.protocol === 'ssh' ? 'terminal' : 'display.2'}
                className="w-6 h-6"
              />
            </div>
            <h2 className="text-xl font-bold text-white">{shareData.deviceName}</h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Shared by <strong className="text-slate-200">{shareData.creatorName}</strong>
            </p>
          </div>

          <form onSubmit={handleSubmitPin} className="space-y-4">
            {error && (
              <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2">
                <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {shareData.hasPin ? (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5 text-center">
                  This session is protected with a PIN Code
                </label>
                <div className="relative">
                  <input
                    type="password"
                    autoFocus
                    required
                    maxLength={8}
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="Enter PIN..."
                    className="w-full text-center px-4 py-3 rounded-2xl bg-surface border border-surface-border text-white text-lg font-mono tracking-widest focus:ring-1 focus:ring-brand-500 focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <p className="text-xs text-slate-400 text-center py-2">
                Click below to start your guest remote session.
              </p>
            )}

            <button
              type="submit"
              disabled={connecting}
              className="w-full py-3 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-sm font-semibold shadow-glow shadow-brand-500/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {connecting ? (
                <>
                  <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-4 h-4 animate-spin" />
                  <span>Launching Remote Session...</span>
                </>
              ) : (
                <>
                  <span>Connect to Remote Desktop</span>
                  <SymbolIcon name="arrow.right" className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          <div className="mt-6 pt-4 border-t border-surface-border/60 text-center text-[10px] text-slate-500">
            Link auto-expires {new Date(shareData.expiresAt).toLocaleTimeString()}
          </div>
        </div>
      )}

    </div>
  );
};
