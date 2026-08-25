import React, { useState, useEffect } from 'react';
import { Device, User, DeviceShare, GuestShare } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';
import { api } from '../lib/api.js';

interface ShareModalProps {
  isOpen: boolean;
  onClose: () => void;
  device: Device | null;
}

export const ShareModal: React.FC<ShareModalProps> = ({
  isOpen,
  onClose,
  device,
}) => {
  const [activeTab, setActiveTab] = useState<'internal' | 'guest'>('internal');
  const [users, setUsers] = useState<User[]>([]);
  const [selectedUserId, setSelectedUserId] = useState('');
  
  // Internal shares
  const [existingUserShares, setExistingUserShares] = useState<DeviceShare[]>([]);
  
  // Guest share form
  const [durationMinutes, setDurationMinutes] = useState(60);
  const [durationLabel, setDurationLabel] = useState('1 Hour');
  const [requirePin, setRequirePin] = useState(false);
  const [pinCode, setPinCode] = useState('');
  const [generatedLink, setGeneratedLink] = useState<{ url: string; pin?: string; expiresAt: string } | null>(null);
  const [existingGuestShares, setExistingGuestShares] = useState<GuestShare[]>([]);
  const [copied, setCopied] = useState(false);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && device) {
      loadData();
    } else {
      setGeneratedLink(null);
      setSelectedUserId('');
      setRequirePin(false);
      setPinCode('');
      setError(null);
    }
  }, [isOpen, device]);

  const loadData = async () => {
    if (!device) return;
    try {
      const [usersRes, sharesRes, myGuestRes] = await Promise.all([
        api.auth.getUsers(),
        api.shares.getDeviceShares(device.id),
        api.shares.getMyGuestShares(),
      ]);
      setUsers(usersRes.users.filter(u => u.id !== device.owner_id));
      setExistingUserShares(sharesRes.shares);
      setExistingGuestShares(myGuestRes.guestShares.filter(g => g.device_id === device.id && !g.is_expired && !g.revoked_at));
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleShareWithUser = async () => {
    if (!device || !selectedUserId) return;
    setLoading(true);
    setError(null);
    try {
      await api.shares.shareWithUser(device.id, selectedUserId);
      setSelectedUserId('');
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to share with user');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeUserShare = async (shareId: string) => {
    try {
      await api.shares.revokeUserShare(shareId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke user share');
    }
  };

  const handleGenerateGuestLink = async () => {
    if (!device) return;
    setLoading(true);
    setError(null);
    try {
      const { share } = await api.shares.createGuestShare({
        deviceId: device.id,
        durationMinutes,
        durationLabel,
        pin: requirePin && pinCode.trim() ? pinCode.trim() : undefined,
      });

      const fullUrl = `${window.location.origin}/guest/${share.token}`;
      setGeneratedLink({
        url: fullUrl,
        pin: share.rawPin,
        expiresAt: share.expires_at,
      });
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to create guest link');
    } finally {
      setLoading(false);
    }
  };

  const handleRevokeGuestShare = async (shareId: string) => {
    try {
      await api.shares.revokeGuestShare(shareId);
      await loadData();
    } catch (err: any) {
      setError(err.message || 'Failed to revoke guest share');
    }
  };

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  if (!isOpen || !device) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl rounded-3xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400">
              <SymbolIcon name="square.and.arrow.up.fill" className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                Share <span className="text-brand-400">"{device.name}"</span>
              </h2>
              <p className="text-xs text-slate-400">
                Grant internal Shoreline user access or generate external PIN-protected guest links.
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-surface-hover transition-colors"
          >
            <SymbolIcon name="xmark" className="w-4 h-4" />
          </button>
        </div>

        {/* Tab Buttons */}
        <div className="flex border-b border-surface-border bg-surface/50 px-6 pt-3">
          <button
            onClick={() => setActiveTab('internal')}
            className={`pb-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'internal'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="person.2.fill" className="w-4 h-4" />
            <span>1. User-to-User (Internal)</span>
          </button>

          <button
            onClick={() => setActiveTab('guest')}
            className={`pb-3 px-4 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'guest'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="link.badge.plus" className="w-4 h-4" />
            <span>2. Guest Links (External)</span>
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-5">
          {error && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2">
              <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 flex-shrink-0" />
              <span>{error}</span>
            </div>
          )}

          {/* TAB 1: INTERNAL USER SHARING */}
          {activeTab === 'internal' && (
            <div className="space-y-5">
              <div className="p-3.5 rounded-2xl bg-surface border border-surface-border text-xs text-slate-400">
                <p className="font-semibold text-slate-200 mb-0.5">Binary Full-Control Access</p>
                <p>Shared users will see this device directly on their dashboard and can connect with full control. You can revoke access at any time.</p>
              </div>

              {/* Add User Share Form */}
              <div className="flex gap-2">
                <select
                  value={selectedUserId}
                  onChange={(e) => setSelectedUserId(e.target.value)}
                  className="flex-1 px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-brand-500 focus:outline-none"
                >
                  <option value="">Select Shoreline AD User...</option>
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.display_name} ({u.username}@shoreline.icu)
                    </option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={handleShareWithUser}
                  disabled={!selectedUserId || loading}
                  className="px-4 py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold transition-all disabled:opacity-50 flex items-center gap-1.5"
                >
                  <SymbolIcon name="plus" className="w-3.5 h-3.5" />
                  <span>Share</span>
                </button>
              </div>

              {/* Existing User Shares List */}
              <div className="pt-2">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2.5 flex items-center gap-1.5">
                  <SymbolIcon name="person.crop.circle.badge.checkmark" className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Active User Shares ({existingUserShares.length})</span>
                </h4>

                {existingUserShares.length === 0 ? (
                  <p className="text-xs text-slate-500 py-3 text-center">No users currently have shared access to this device.</p>
                ) : (
                  <div className="space-y-2">
                    {existingUserShares.map((s) => (
                      <div
                        key={s.id}
                        className="flex items-center justify-between p-3 rounded-xl bg-surface border border-surface-border"
                      >
                        <div className="flex items-center gap-2.5">
                          <div className="w-7 h-7 rounded-lg bg-surface-active flex items-center justify-center text-xs font-bold text-brand-400">
                            {s.shared_with_display_name?.charAt(0) || 'U'}
                          </div>
                          <div>
                            <p className="text-xs font-semibold text-slate-200">{s.shared_with_display_name}</p>
                            <p className="text-[10px] text-slate-400 font-mono">{s.shared_with_username}@shoreline.icu</p>
                          </div>
                        </div>

                        <button
                          type="button"
                          onClick={() => handleRevokeUserShare(s.id)}
                          className="px-2.5 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger text-xs font-medium border border-danger/20 transition-colors"
                        >
                          Revoke
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* TAB 2: GUEST SHARE LINKS */}
          {activeTab === 'guest' && (
            <div className="space-y-5">
              <div className="p-3.5 rounded-2xl bg-surface border border-surface-border text-xs text-slate-400">
                <p className="font-semibold text-slate-200 mb-0.5">No Account or Active Directory Auth Required</p>
                <p>Anyone with the link can access the remote session until it automatically expires. You can set an optional PIN code for security.</p>
              </div>

              {/* Guest Link Creator */}
              <div className="space-y-3 p-4 rounded-2xl bg-surface/60 border border-surface-border">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Link Expiration Duration
                  </label>
                  <div className="grid grid-cols-5 gap-2">
                    {[
                      { label: '15m', minutes: 15, text: '15 Minutes' },
                      { label: '1h', minutes: 60, text: '1 Hour' },
                      { label: '4h', minutes: 240, text: '4 Hours' },
                      { label: '24h', minutes: 1440, text: '24 Hours' },
                      { label: '7d', minutes: 10080, text: '7 Days' },
                    ].map((d) => (
                      <button
                        key={d.label}
                        type="button"
                        onClick={() => {
                          setDurationMinutes(d.minutes);
                          setDurationLabel(d.text);
                        }}
                        className={`py-1.5 px-2 rounded-xl text-xs font-semibold border transition-all ${
                          durationMinutes === d.minutes
                            ? 'bg-brand-500 text-white border-brand-400 shadow-sm'
                            : 'bg-surface hover:bg-surface-hover border-surface-border text-slate-300'
                        }`}
                      >
                        {d.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="pt-2">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300 mb-2">
                    <input
                      type="checkbox"
                      checked={requirePin}
                      onChange={(e) => setRequirePin(e.target.checked)}
                      className="w-4 h-4 rounded text-brand-500 focus:ring-0 bg-surface border-surface-border cursor-pointer"
                    />
                    <SymbolIcon name="lock.fill" className="w-3.5 h-3.5 text-amber-400" />
                    <span>Require PIN Code for Session Access</span>
                  </label>

                  {requirePin && (
                    <input
                      type="text"
                      maxLength={8}
                      value={pinCode}
                      onChange={(e) => setPinCode(e.target.value)}
                      placeholder="e.g. 4892"
                      className="w-full px-3.5 py-2 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono tracking-widest focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={handleGenerateGuestLink}
                  disabled={loading}
                  className="w-full py-2.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all flex items-center justify-center gap-2"
                >
                  <SymbolIcon name="link" className="w-4 h-4" />
                  <span>Generate Guest Share Link ({durationLabel})</span>
                </button>
              </div>

              {/* Display Newly Generated Link */}
              {generatedLink && (
                <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 space-y-2.5 animate-in fade-in">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-emerald-300 flex items-center gap-1.5">
                      <SymbolIcon name="checkmark.circle.fill" className="w-4 h-4 text-emerald-400" />
                      <span>Guest Link Ready</span>
                    </span>
                    <span className="text-[10px] text-slate-400">
                      Expires: {new Date(generatedLink.expiresAt).toLocaleTimeString()}
                    </span>
                  </div>

                  <div className="p-2.5 rounded-xl bg-surface border border-surface-border flex items-center justify-between gap-2">
                    <span className="text-xs font-mono text-slate-200 truncate select-all">{generatedLink.url}</span>
                    <button
                      type="button"
                      onClick={() => copyToClipboard(generatedLink.url + (generatedLink.pin ? ` (PIN: ${generatedLink.pin})` : ''))}
                      className="px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold flex-shrink-0 transition-colors"
                    >
                      {copied ? 'Copied!' : 'Copy Link'}
                    </button>
                  </div>

                  {generatedLink.pin && (
                    <div className="flex items-center gap-2 text-xs text-amber-300">
                      <SymbolIcon name="key.fill" className="w-3.5 h-3.5 text-amber-400" />
                      <span>Required PIN: <strong className="font-mono text-white">{generatedLink.pin}</strong></span>
                    </div>
                  )}
                </div>
              )}

              {/* Active Guest Links */}
              <div className="pt-2">
                <h4 className="text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                  <SymbolIcon name="clock.fill" className="w-3.5 h-3.5 text-brand-400" />
                  <span>Active Guest Links for this Device ({existingGuestShares.length})</span>
                </h4>

                {existingGuestShares.length === 0 ? (
                  <p className="text-xs text-slate-500 py-2 text-center">No active guest links.</p>
                ) : (
                  <div className="space-y-2">
                    {existingGuestShares.map((g) => (
                      <div
                        key={g.id}
                        className="p-3 rounded-xl bg-surface border border-surface-border flex items-center justify-between text-xs"
                      >
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-slate-200">{g.duration_label} Link</span>
                            {g.has_pin && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-300 border border-amber-500/20 font-medium">
                                PIN Protected
                              </span>
                            )}
                          </div>
                          <p className="text-[10px] text-slate-400">
                            Expires {new Date(g.expires_at).toLocaleString()} • {g.use_count} connections
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => copyToClipboard(`${window.location.origin}/guest/${g.token}`)}
                            className="px-2 py-1 rounded-lg bg-surface-active hover:bg-surface-hover text-slate-300 text-xs transition-colors"
                          >
                            Copy
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRevokeGuestShare(g.id)}
                            className="px-2 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger text-xs font-medium border border-danger/20 transition-colors"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-surface-border bg-surface flex justify-end">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-surface-active hover:bg-surface-hover text-slate-300 hover:text-white text-xs font-semibold transition-colors"
          >
            Close
          </button>
        </div>

      </div>
    </div>
  );
};
