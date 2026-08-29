import React, { useState, useEffect } from 'react';
import { Device, Folder, User } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';

interface AddDeviceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  editDevice?: Device | null;
  folders: Folder[];
  isAdmin?: boolean;
}

export const AddDeviceModal: React.FC<AddDeviceModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  editDevice,
  folders,
  isAdmin = false,
}) => {
  const { user: currentUser } = useAuth();
  const [activeTab, setActiveTab] = useState<'general' | 'credentials' | 'advanced' | 'monitoring'>('general');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Monitoring state
  const [monitoringInfo, setMonitoringInfo] = useState<any | null>(null);
  const [installPlatform, setInstallPlatform] = useState<'linux' | 'windows'>('linux');
  const [copiedCmd, setCopiedCmd] = useState(false);

  // Users list for admin on-behalf provisioning
  const [usersList, setUsersList] = useState<User[]>([]);
  const [targetUserId, setTargetUserId] = useState<string>('');

  // Form states
  const [name, setName] = useState('');
  const [protocol, setProtocol] = useState<'rdp' | 'ssh' | 'vnc'>('rdp');
  const [host, setHost] = useState('');
  const [port, setPort] = useState<number>(3389);
  const [folderId, setFolderId] = useState<string>('');
  const [isFavorite, setIsFavorite] = useState(false);

  // Credentials
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [passphrase, setPassphrase] = useState('');

  // Advanced parameters
  const [domain, setDomain] = useState('');
  const [security, setSecurity] = useState<'any' | 'nla' | 'tls' | 'rdp'>('any');
  const [ignoreCert, setIgnoreCert] = useState(true);
  const [audio, setAudio] = useState(true);
  const [colorDepth, setColorDepth] = useState<number>(24);
  const [keyboardLayout, setKeyboardLayout] = useState('en-us-qwerty');

  useEffect(() => {
    if (isAdmin && isOpen) {
      api.auth.getUsers().then(({ users }) => setUsersList(users)).catch(() => {});
    }
  }, [isAdmin, isOpen]);

  useEffect(() => {
    if (editDevice) {
      setName(editDevice.name);
      setProtocol(editDevice.protocol);
      setHost(editDevice.host);
      setPort(editDevice.port);
      setFolderId(editDevice.folder_id || '');
      setIsFavorite(!!editDevice.is_favorite);

      // Fetch monitoring status
      api.monitoring.getDeviceAgentStatus(editDevice.id)
        .then((res) => setMonitoringInfo(res.info))
        .catch(() => setMonitoringInfo(null));

      const params = typeof editDevice.parameters === 'string'
        ? JSON.parse(editDevice.parameters || '{}')
        : (editDevice.parameters || {});

      setDomain(params.domain || '');
      setSecurity(params.security || 'any');
      setIgnoreCert(params.ignoreCert !== false);
      setAudio(params.audio !== false);
      setColorDepth(params.colorDepth || 24);
      setKeyboardLayout(params.keyboardLayout || 'en-us-qwerty');
      setUsername('');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
    } else {
      setName('');
      setProtocol('rdp');
      setHost('');
      setPort(3389);
      setFolderId('');
      setIsFavorite(false);
      setUsername('');
      setPassword('');
      setPrivateKey('');
      setPassphrase('');
      setDomain('');
      setSecurity('any');
      setIgnoreCert(true);
      setAudio(true);
      setColorDepth(24);
      setKeyboardLayout('en-us-qwerty');
      setTargetUserId('');
    }
    setActiveTab('general');
    setError(null);
  }, [editDevice, isOpen]);

  const handleProtocolChange = (newProto: 'rdp' | 'ssh' | 'vnc') => {
    setProtocol(newProto);
    if (!editDevice) {
      if (newProto === 'rdp') setPort(3389);
      if (newProto === 'ssh') setPort(22);
      if (newProto === 'vnc') setPort(5900);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !host.trim()) {
      setError('Please provide a valid Device Name and Host / IP address');
      return;
    }

    setLoading(true);
    setError(null);

    const payload = {
      name: name.trim(),
      protocol,
      host: host.trim(),
      port: Number(port),
      folderId: folderId || null,
      isFavorite,
      targetUserId: isAdmin && targetUserId ? targetUserId : undefined,
      credentials: {
        username: username.trim() || undefined,
        password: password || undefined,
        privateKey: privateKey || undefined,
        passphrase: passphrase || undefined,
      },
      parameters: {
        domain: domain.trim() || undefined,
        security,
        ignoreCert,
        audio,
        colorDepth: Number(colorDepth),
        keyboardLayout,
      },
    };

    try {
      if (editDevice) {
        await api.devices.update(editDevice.id, payload);
      } else {
        await api.devices.create(payload);
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save device');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 overflow-y-auto">
      {/* Backdrop */}
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      {/* Modal Container */}
      <div className="relative w-full max-w-2xl rounded-3xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95">
        
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <SymbolIcon name={editDevice ? 'pencil' : 'plus.circle.fill'} className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-white">
                {editDevice ? 'Edit Remote Device' : 'Add New Remote Device'}
              </h2>
              <p className="text-xs text-slate-400">
                Credentials are encrypted with AES-256-GCM and stored securely at rest.
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

        {/* Tab Navigation */}
        <div className="flex items-center gap-2 px-6 pt-4 border-b border-surface-border bg-surface/50">
          <button
            type="button"
            onClick={() => setActiveTab('general')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'general'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="info.circle" className="w-4 h-4" />
            <span>1. General & Host</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('credentials')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'credentials'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="key.fill" className="w-4 h-4" />
            <span>2. Stored Credentials</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('advanced')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'advanced'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="slider.horizontal.3" className="w-4 h-4" />
            <span>3. Guacamole Tuning</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('monitoring')}
            className={`pb-3 px-3 text-xs font-semibold border-b-2 flex items-center gap-2 transition-all ${
              activeTab === 'monitoring'
                ? 'border-brand-500 text-brand-400'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <SymbolIcon name="waveform.path.ecg" className="w-4 h-4" />
            <span>4. Monitoring</span>
          </button>
        </div>

        {/* Form Body */}
        <form onSubmit={handleSubmit}>
          <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
            {error && (
              <div className="p-3.5 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2.5">
                <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* TAB 1: GENERAL */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                {/* Admin on-behalf user selection */}
                {isAdmin && !editDevice && (
                  <div className="p-3.5 rounded-2xl bg-purple-500/10 border border-purple-500/20">
                    <label className="block text-xs font-semibold text-purple-300 mb-1.5 flex items-center gap-1.5">
                      <SymbolIcon name="person.badge.key.fill" className="w-3.5 h-3.5 text-purple-400" />
                      <span>Admin Provisioning: Assign to User (On-Behalf)</span>
                    </label>
                    <select
                      value={targetUserId}
                      onChange={(e) => setTargetUserId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-purple-500/30 text-white text-xs focus:ring-1 focus:ring-purple-500 focus:outline-none"
                    >
                      <option value="">Create for myself ({currentUser?.display_name || currentUser?.username || 'Myself'})</option>
                      {usersList.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.display_name} ({u.username}@shoreline.icu)
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-[11px] text-purple-300/80">
                      Isolation Rule: Devices created on a user's behalf appear on their dashboard with full control and NOT on your main dashboard.
                    </p>
                  </div>
                )}

                {/* Protocol Selection */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-2">
                    Connection Protocol
                  </label>
                  <div className="grid grid-cols-3 gap-3">
                    {[
                      { id: 'rdp', name: 'RDP', desc: 'Windows Remote Desktop', icon: 'display' },
                      { id: 'ssh', name: 'SSH', desc: 'Linux / Unix Terminal', icon: 'terminal' },
                      { id: 'vnc', name: 'VNC', desc: 'Virtual Network Console', icon: 'display.2' },
                    ].map((p) => (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => handleProtocolChange(p.id as any)}
                        className={`p-3 rounded-2xl border text-left transition-all flex flex-col justify-between ${
                          protocol === p.id
                            ? 'bg-brand-500/10 border-brand-500 text-white shadow-glow shadow-brand-500/10'
                            : 'bg-surface hover:bg-surface-hover border-surface-border text-slate-400'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="font-bold text-sm">{p.name}</span>
                          <SymbolIcon name={p.icon} className="w-4 h-4 text-brand-400" />
                        </div>
                        <span className="text-[10px] text-slate-400">{p.desc}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Device Name */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Device Name <span className="text-brand-400">*</span>
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g. Main Workstation, Lab Server, Bastion"
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm focus:ring-1 focus:ring-brand-500 focus:outline-none"
                  />
                </div>

                {/* Host & Port */}
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Host IP / Tailscale / FQDN <span className="text-brand-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={host}
                      onChange={(e) => setHost(e.target.value)}
                      placeholder="e.g. 100.64.0.12 or 192.168.1.100"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Port
                    </label>
                    <input
                      type="number"
                      required
                      value={port}
                      onChange={(e) => setPort(Number(e.target.value))}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    />
                  </div>
                </div>

                {/* Folder & Favorite */}
                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Assign to Custom Folder
                    </label>
                    <select
                      value={folderId}
                      onChange={(e) => setFolderId(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl bg-surface border border-surface-border text-slate-200 text-xs focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    >
                      <option value="">No folder (Root inventory)</option>
                      {folders.map((f) => (
                        <option key={f.id} value={f.id}>{f.name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="flex items-center pt-5">
                    <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-300">
                      <input
                        type="checkbox"
                        checked={isFavorite}
                        onChange={(e) => setIsFavorite(e.target.checked)}
                        className="w-4 h-4 rounded text-brand-500 focus:ring-0 bg-surface border-surface-border cursor-pointer"
                      />
                      <SymbolIcon name="star.fill" className="w-3.5 h-3.5 text-amber-400" />
                      <span>Star as Favorite</span>
                    </label>
                  </div>
                </div>
              </div>
            )}

            {/* TAB 2: CREDENTIALS */}
            {activeTab === 'credentials' && (
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-surface border border-surface-border text-xs text-slate-400 flex items-start gap-2.5">
                  <SymbolIcon name="lock.shield.fill" className="w-4 h-4 text-emerald-400 flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-semibold text-slate-200">Zero Re-Authentication Guarantee</p>
                    <p>Credentials provided here are stored server-side with AES-256-GCM. Clicking the device connects instantly with zero login prompts.</p>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Username
                    </label>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder={protocol === 'ssh' ? 'root or ubuntu' : 'Administrator'}
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    />
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Password {editDevice && '(Leave blank to keep existing)'}
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••••••"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    />
                  </div>
                </div>

                {protocol === 'ssh' && (
                  <div className="space-y-3 pt-2">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        SSH Private Key (Optional PEM/OpenSSH format)
                      </label>
                      <textarea
                        rows={4}
                        value={privateKey}
                        onChange={(e) => setPrivateKey(e.target.value)}
                        placeholder="-----BEGIN RSA PRIVATE KEY-----&#10;..."
                        className="w-full px-3 py-2 rounded-xl bg-surface border border-surface-border text-white text-xs font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Private Key Passphrase (If encrypted key)
                      </label>
                      <input
                        type="password"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        placeholder="Passphrase"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: ADVANCED GUACAMOLE TUNING */}
            {activeTab === 'advanced' && (
              <div className="space-y-4">
                {protocol === 'rdp' && (
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Active Directory / NetBIOS Domain
                      </label>
                      <input
                        type="text"
                        value={domain}
                        onChange={(e) => setDomain(e.target.value)}
                        placeholder="SHORELINE"
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Security Mode
                      </label>
                      <select
                        value={security}
                        onChange={(e) => setSecurity(e.target.value as any)}
                        className="w-full px-3 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-brand-500 focus:outline-none"
                      >
                        <option value="any">Negotiate (Any)</option>
                        <option value="nla">NLA (Network Level Auth)</option>
                        <option value="tls">TLS</option>
                        <option value="rdp">Standard RDP Encryption</option>
                      </select>
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Color Depth
                    </label>
                    <select
                      value={colorDepth}
                      onChange={(e) => setColorDepth(Number(e.target.value))}
                      className="w-full px-3 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    >
                      <option value="24">24-bit True Color (Recommended)</option>
                      <option value="32">32-bit High Quality</option>
                      <option value="16">16-bit Fast Low-Bandwidth</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                      Keyboard Layout
                    </label>
                    <select
                      value={keyboardLayout}
                      onChange={(e) => setKeyboardLayout(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-brand-500 focus:outline-none"
                    >
                      <option value="en-us-qwerty">English (US - QWERTY)</option>
                      <option value="en-gb-qwerty">English (UK - QWERTY)</option>
                      <option value="de-de-qwertz">German (DE - QWERTZ)</option>
                      <option value="fr-fr-azerty">French (FR - AZERTY)</option>
                    </select>
                  </div>
                </div>

                <div className="space-y-3 pt-2">
                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={ignoreCert}
                      onChange={(e) => setIgnoreCert(e.target.checked)}
                      className="w-4 h-4 rounded text-brand-500 focus:ring-0 bg-surface border-surface-border cursor-pointer"
                    />
                    <span>Ignore SSL/TLS certificate warnings (Recommended for homelabs)</span>
                  </label>

                  <label className="flex items-center gap-2.5 cursor-pointer text-xs text-slate-300">
                    <input
                      type="checkbox"
                      checked={audio}
                      onChange={(e) => setAudio(e.target.checked)}
                      className="w-4 h-4 rounded text-brand-500 focus:ring-0 bg-surface border-surface-border cursor-pointer"
                    />
                    <span>Enable Remote Audio Streaming</span>
                  </label>
                </div>
              </div>
            )}

            {/* TAB 4: MONITORING */}
            {activeTab === 'monitoring' && (
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-xs font-bold text-white flex items-center gap-1.5">
                        <SymbolIcon name="waveform.path.ecg" className="w-4 h-4 text-brand-400" />
                        <span>Beszel-style Resource Monitoring</span>
                      </h4>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        Lightweight Go agent pushes CPU, RAM, Disk, Net, Load & Temp telemetry over HTTPS.
                      </p>
                    </div>

                    {editDevice && (
                      <button
                        type="button"
                        onClick={async () => {
                          if (!editDevice) return;
                          if (monitoringInfo) {
                            if (confirm('Disable monitoring on this device?')) {
                              await api.monitoring.disable(editDevice.id);
                              setMonitoringInfo(null);
                            }
                          } else {
                            const res = await api.monitoring.enable(editDevice.id);
                            setMonitoringInfo({
                              agent: res.agent,
                              rawToken: res.rawToken,
                              installLinux: res.installLinux,
                              installWindows: res.installWindows,
                            });
                          }
                        }}
                        className={`px-3 py-1 rounded-xl text-xs font-semibold border transition-all ${
                          monitoringInfo
                            ? 'bg-danger/10 border-danger/30 text-danger hover:bg-danger/20'
                            : 'bg-brand-600 hover:bg-brand-500 text-white shadow-glow'
                        }`}
                      >
                        {monitoringInfo ? 'Disable Monitoring' : 'Enable Monitoring'}
                      </button>
                    )}
                  </div>

                  {!editDevice ? (
                    <div className="pt-2 border-t border-surface-border/60">
                      <p className="text-xs text-slate-300">
                        ⚡ Monitoring can be activated immediately once the device is created. You will receive a one-command install script on the device dashboard.
                      </p>
                    </div>
                  ) : monitoringInfo ? (
                    <div className="space-y-3 pt-3 border-t border-surface-border">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2">
                          <span className="text-slate-400">Agent Status:</span>
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            monitoringInfo.agent.status === 'online'
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : monitoringInfo.agent.status === 'pending'
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}>
                            <span className="capitalize">{monitoringInfo.agent.status}</span>
                          </span>
                        </div>

                        <button
                          type="button"
                          onClick={async () => {
                            if (!editDevice || !confirm('Regenerate agent token?')) return;
                            const res = await api.monitoring.regenerateToken(editDevice.id);
                            setMonitoringInfo({
                              agent: res.agent,
                              rawToken: res.rawToken,
                              installLinux: res.installLinux,
                              installWindows: res.installWindows,
                            });
                          }}
                          className="text-[11px] text-danger hover:underline"
                        >
                          Regenerate Token
                        </button>
                      </div>

                      {/* Script Platform Tabs */}
                      <div className="flex rounded-xl bg-surface-card p-1 border border-surface-border text-xs">
                        <button
                          type="button"
                          onClick={() => setInstallPlatform('linux')}
                          className={`flex-1 py-1 rounded-lg font-medium transition-all ${
                            installPlatform === 'linux' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Linux (curl | sudo bash)
                        </button>
                        <button
                          type="button"
                          onClick={() => setInstallPlatform('windows')}
                          className={`flex-1 py-1 rounded-lg font-medium transition-all ${
                            installPlatform === 'windows' ? 'bg-brand-600 text-white' : 'text-slate-400 hover:text-white'
                          }`}
                        >
                          Windows (PowerShell)
                        </button>
                      </div>

                      <div className="relative">
                        <pre className="p-3 rounded-xl bg-surface-card border border-surface-border text-[11px] font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all select-all">
                          {installPlatform === 'linux' ? monitoringInfo.installLinux : monitoringInfo.installWindows}
                        </pre>
                      </div>

                      <div className="flex justify-end">
                        <button
                          type="button"
                          onClick={() => {
                            const cmd = installPlatform === 'linux' ? monitoringInfo.installLinux : monitoringInfo.installWindows;
                            navigator.clipboard.writeText(cmd);
                            setCopiedCmd(true);
                            setTimeout(() => setCopiedCmd(false), 2000);
                          }}
                          className="px-3 py-1.5 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-xs font-semibold text-white transition-all flex items-center gap-1.5"
                        >
                          <SymbolIcon name={copiedCmd ? 'checkmark' : 'doc.on.clipboard'} className="w-3.5 h-3.5" />
                          <span>{copiedCmd ? 'Copied!' : 'Copy Install Command'}</span>
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 border-t border-surface-border/60">
                      <p className="text-xs text-slate-400">
                        Monitoring is currently not enabled for this device. Click <strong className="text-white">Enable Monitoring</strong> above to generate your one-command install script.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Footer Actions */}
          <div className="px-6 py-4 border-t border-surface-border bg-surface flex items-center justify-between">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white hover:bg-surface-hover text-xs font-semibold transition-colors"
            >
              Cancel
            </button>

            <div className="flex items-center gap-2">
              {activeTab !== 'general' && (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === 'monitoring') setActiveTab('advanced');
                    else if (activeTab === 'advanced') setActiveTab('credentials');
                    else setActiveTab('general');
                  }}
                  className="px-3.5 py-2 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold transition-colors"
                >
                  Previous
                </button>
              )}

              {activeTab !== 'monitoring' ? (
                <button
                  type="button"
                  onClick={() => {
                    if (activeTab === 'general') setActiveTab('credentials');
                    else if (activeTab === 'credentials') setActiveTab('advanced');
                    else setActiveTab('monitoring');
                  }}
                  className="px-4 py-2 rounded-xl bg-surface-active hover:bg-surface-hover border border-surface-borderLight text-white text-xs font-semibold transition-colors"
                >
                  Next Step
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading}
                  className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                >
                  {loading && <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 animate-spin" />}
                  <span>{editDevice ? 'Save Changes' : 'Create Device'}</span>
                </button>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  );
};
