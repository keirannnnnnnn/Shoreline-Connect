import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Folder, User, Device, GuestShare, SessionLog, SystemSettings, UpdateStatus } from '../types/index.js';
import { api } from '../lib/api.js';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { FolderModal } from '../components/FolderModal.js';
import { AddDeviceModal } from '../components/AddDeviceModal.js';

export const Settings: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();

  const activeTabParam = searchParams.get('tab') || 'profile';
  const [activeTab, setActiveTab] = useState<string>(activeTabParam);

  // General user data
  const [folders, setFolders] = useState<Folder[]>([]);
  const [guestShares, setGuestShares] = useState<GuestShare[]>([]);
  const [isFolderModalOpen, setIsFolderModalOpen] = useState(false);

  // Admin: AD Settings
  const [adSettings, setAdSettings] = useState<SystemSettings>({
    ad_domain: 'shoreline.icu',
    ad_url: 'ldap://shoreline.icu:389',
    ad_base_dn: 'DC=shoreline,DC=icu',
    ad_admin_group: 'Shoreline-Admins',
    ad_user_group: 'Shoreline-Users',
    git_repo_url: '',
    git_branch: 'main',
  });
  const [adSaveStatus, setAdSaveStatus] = useState<string | null>(null);

  // Admin: Users & On-Behalf Devices
  const [allUsers, setAllUsers] = useState<User[]>([]);
  const [selectedUserForDevices, setSelectedUserForDevices] = useState<User | null>(null);
  const [adminCreatedDevices, setAdminCreatedDevices] = useState<Device[]>([]);
  const [isOnBehalfAddModalOpen, setIsOnBehalfAddModalOpen] = useState(false);

  // Admin: Audit Logs
  const [auditLogs, setAuditLogs] = useState<SessionLog[]>([]);
  const [auditSearch, setAuditSearch] = useState('');
  const [auditTotal, setAuditTotal] = useState(0);

  // Admin: Self-Update
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateCheckResult, setUpdateCheckResult] = useState<{ hasUpdates: boolean; message: string } | null>(null);
  const [isUpdating, setIsUpdating] = useState(false);
  const [updateLogs, setUpdateLogs] = useState<string | null>(null);

  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setActiveTab(searchParams.get('tab') || 'profile');
  }, [searchParams]);

  useEffect(() => {
    loadGeneralData();
    if (isAdmin) {
      loadAdminData();
    }
  }, [isAdmin]);

  const loadGeneralData = async () => {
    try {
      const [foldersRes, guestRes] = await Promise.all([
        api.folders.getAll(),
        api.shares.getMyGuestShares(),
      ]);
      setFolders(foldersRes.folders);
      setGuestShares(guestRes.guestShares);
    } catch (err) {
      console.error(err);
    }
  };

  const loadAdminData = async () => {
    try {
      const [settingsRes, usersRes, logsRes, updateRes] = await Promise.all([
        api.admin.getSettings(),
        api.admin.getUsers(),
        api.admin.getSessionLogs({ limit: 50 }),
        api.admin.getUpdateStatus(),
      ]);
      setAdSettings(settingsRes.settings);
      setAllUsers(usersRes.users);
      setAuditLogs(logsRes.logs);
      setAuditTotal(logsRes.total);
      setUpdateStatus(updateRes.status);
    } catch (err) {
      console.error(err);
    }
  };

  const handleTabChange = (tabId: string) => {
    setActiveTab(tabId);
    setSearchParams({ tab: tabId });
  };

  const handleDeleteFolder = async (folderId: string) => {
    if (window.confirm('Delete this folder? Devices in this folder will be moved to root.')) {
      await api.folders.delete(folderId);
      await loadGeneralData();
    }
  };

  const handleRevokeGuestShare = async (shareId: string) => {
    await api.shares.revokeGuestShare(shareId);
    await loadGeneralData();
  };

  // Admin: Save AD settings
  const handleSaveAdSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setAdSaveStatus(null);
    try {
      await api.admin.updateSettings(adSettings);
      setAdSaveStatus('Active Directory settings saved successfully.');
    } catch (err: any) {
      setAdSaveStatus(`Error saving settings: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  // Admin: View on-behalf devices for a selected user
  const handleSelectUser = async (targetUser: User) => {
    setSelectedUserForDevices(targetUser);
    try {
      const res = await api.admin.getUserDevices(targetUser.id);
      setAdminCreatedDevices(res.devices);
    } catch (err) {
      console.error(err);
    }
  };

  // Admin: Check update
  const handleCheckUpdate = async () => {
    setLoading(true);
    setUpdateCheckResult(null);
    try {
      const res = await api.admin.checkForUpdates();
      setUpdateCheckResult(res);
      const statusRes = await api.admin.getUpdateStatus();
      setUpdateStatus(statusRes.status);
    } catch (err: any) {
      setUpdateCheckResult({ hasUpdates: false, message: err.message });
    } finally {
      setLoading(false);
    }
  };

  // Admin: Apply update
  const handleApplyUpdate = async () => {
    if (!window.confirm('Apply latest update and restart the Shoreline Connect service?')) return;
    setIsUpdating(true);
    setUpdateLogs(null);
    try {
      const res = await api.admin.applyUpdate({
        repoUrl: adSettings.git_repo_url,
        branch: adSettings.git_branch,
      });
      setUpdateLogs(res.output || res.message);
    } catch (err: any) {
      setUpdateLogs(`Update failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Settings Header */}
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
            <SymbolIcon name="gearshape.fill" className="w-6 h-6 text-brand-400" />
            <span>Settings & Administration</span>
          </h1>
          <p className="text-xs text-slate-400 mt-0.5">
            Manage your personal profile, custom folders, shared links, and enterprise Active Directory mappings.
          </p>
        </div>

        {/* Layout: Sidebar Tabs + Main Content */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          
          {/* Left Tabs */}
          <div className="space-y-1">
            <div className="text-[10px] font-bold uppercase tracking-wider text-slate-400 px-3 mb-2">
              User Preferences
            </div>

            <button
              onClick={() => handleTabChange('profile')}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === 'profile'
                  ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name="person.crop.circle" className="w-4 h-4 text-brand-400" />
              <span>My Profile</span>
            </button>

            <button
              onClick={() => handleTabChange('folders')}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === 'folders'
                  ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name="folder.fill" className="w-4 h-4 text-blue-400" />
              <span>Custom Folders</span>
              <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-surface font-mono text-slate-400">
                {folders.length}
              </span>
            </button>

            <button
              onClick={() => handleTabChange('guest-links')}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                activeTab === 'guest-links'
                  ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name="link" className="w-4 h-4 text-emerald-400" />
              <span>Active Guest Links</span>
              <span className="ml-auto px-1.5 py-0.5 rounded text-[10px] bg-surface font-mono text-slate-400">
                {guestShares.length}
              </span>
            </button>

            {/* Admin Section */}
            {isAdmin && (
              <div className="pt-6 space-y-1">
                <div className="text-[10px] font-bold uppercase tracking-wider text-purple-400 px-3 mb-2 flex items-center gap-1.5">
                  <SymbolIcon name="shield.lefthalf.filled" className="w-3.5 h-3.5" />
                  <span>Admin Controls</span>
                </div>

                <button
                  onClick={() => handleTabChange('ad')}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    activeTab === 'ad'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                >
                  <SymbolIcon name="lock.shield" className="w-4 h-4 text-purple-400" />
                  <span>Active Directory Mapping</span>
                </button>

                <button
                  onClick={() => handleTabChange('users')}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    activeTab === 'users'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                >
                  <SymbolIcon name="person.2.badge.gearshape" className="w-4 h-4 text-purple-400" />
                  <span>User Directory & Provisioning</span>
                </button>

                <button
                  onClick={() => handleTabChange('audit')}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    activeTab === 'audit'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                >
                  <SymbolIcon name="doc.text.magnifyingglass" className="w-4 h-4 text-purple-400" />
                  <span>Session Audit Logs</span>
                </button>

                <button
                  onClick={() => handleTabChange('update')}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-xs font-semibold transition-all text-left ${
                    activeTab === 'update'
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-slate-400 hover:text-purple-300 hover:bg-purple-500/10'
                  }`}
                >
                  <SymbolIcon name="arrow.trianglehead.2.clockwise.rotate.90" className="w-4 h-4 text-purple-400" />
                  <span>Self-Update System</span>
                </button>
              </div>
            )}
          </div>

          {/* Right Main Panel */}
          <div className="md:col-span-3">
            
            {/* 1. MY PROFILE */}
            {activeTab === 'profile' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white">Active Directory Profile</h2>
                  <p className="text-xs text-slate-400">Your authenticated credentials against Shoreline.icu domain</p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1">
                    <span className="text-[11px] text-slate-400">Display Name</span>
                    <p className="font-semibold text-white text-sm">{user?.display_name}</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1">
                    <span className="text-[11px] text-slate-400">sAMAccountName</span>
                    <p className="font-semibold text-white font-mono text-sm">{user?.username}</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1">
                    <span className="text-[11px] text-slate-400">Domain Email</span>
                    <p className="font-semibold text-white font-mono text-sm">{user?.email || `${user?.username}@shoreline.icu`}</p>
                  </div>

                  <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1">
                    <span className="text-[11px] text-slate-400">Active Directory Role</span>
                    <div className="flex items-center gap-2 pt-0.5">
                      <span className={`px-2 py-0.5 text-xs font-semibold rounded-md border ${
                        user?.role === 'admin' 
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {user?.role === 'admin' ? 'Administrator' : 'General User'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="pt-4 border-t border-surface-border text-xs text-slate-500 flex items-center gap-2">
                  <SymbolIcon name="lock.fill" className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Authentication managed strictly via Active Directory. No local accounts.</span>
                </div>
              </div>
            )}

            {/* 2. CUSTOM FOLDERS */}
            {activeTab === 'folders' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div className="flex items-center justify-between">
                  <div>
                    <h2 className="text-base font-bold text-white">Custom Folders</h2>
                    <p className="text-xs text-slate-400">Group your devices for clean dashboard filtering</p>
                  </div>

                  <button
                    onClick={() => setIsFolderModalOpen(true)}
                    className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all"
                  >
                    <SymbolIcon name="plus" className="w-4 h-4" />
                    <span>Create Folder</span>
                  </button>
                </div>

                {folders.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    No custom folders created yet. Click "Create Folder" to organize your devices.
                  </div>
                ) : (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    {folders.map((f) => (
                      <div
                        key={f.id}
                        className="p-4 rounded-2xl bg-surface border border-surface-border flex items-center justify-between"
                      >
                        <div className="flex items-center gap-3">
                          <div
                            className="w-10 h-10 rounded-xl flex items-center justify-center border"
                            style={{ backgroundColor: `${f.color}15`, borderColor: `${f.color}30`, color: f.color }}
                          >
                            <SymbolIcon name={f.icon || 'folder.fill'} className="w-5 h-5" />
                          </div>
                          <div>
                            <p className="font-semibold text-white text-sm">{f.name}</p>
                            <p className="text-xs text-slate-400">{f.device_count || 0} devices</p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleDeleteFolder(f.id)}
                          className="p-2 rounded-xl text-slate-500 hover:text-danger hover:bg-danger/10 transition-colors"
                          title="Delete folder"
                        >
                          <SymbolIcon name="trash" className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 3. ACTIVE GUEST LINKS */}
            {activeTab === 'guest-links' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white">Active Guest Share Links</h2>
                  <p className="text-xs text-slate-400">External time-limited session links generated for non-AD guests</p>
                </div>

                {guestShares.length === 0 ? (
                  <div className="py-12 text-center text-xs text-slate-500">
                    No active guest share links. You can generate them by clicking the Share icon on any device card.
                  </div>
                ) : (
                  <div className="space-y-3">
                    {guestShares.map((g) => (
                      <div
                        key={g.id}
                        className="p-4 rounded-2xl bg-surface border border-surface-border flex items-center justify-between"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-semibold text-white text-sm">{g.device_name}</span>
                            <span className="px-2 py-0.5 rounded text-[10px] bg-brand-500/10 text-brand-400 border border-brand-500/20 font-medium">
                              {g.duration_label} Link
                            </span>
                            {g.has_pin && (
                              <span className="px-2 py-0.5 rounded text-[10px] bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                                PIN Protected
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-slate-400">
                            Expires: <strong className="text-slate-300">{new Date(g.expires_at).toLocaleString()}</strong> • {g.use_count} connections established
                          </p>
                        </div>

                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => {
                              navigator.clipboard.writeText(`${window.location.origin}/guest/${g.token}`);
                              alert('Link copied to clipboard!');
                            }}
                            className="px-3 py-1.5 rounded-xl bg-surface-active hover:bg-surface-hover text-slate-200 text-xs font-semibold transition-colors"
                          >
                            Copy URL
                          </button>
                          <button
                            onClick={() => handleRevokeGuestShare(g.id)}
                            className="px-3 py-1.5 rounded-xl bg-danger/10 hover:bg-danger/20 text-danger border border-danger/20 text-xs font-semibold transition-colors"
                          >
                            Revoke
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* 4. ADMIN: ACTIVE DIRECTORY SETTINGS */}
            {isAdmin && activeTab === 'ad' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <SymbolIcon name="lock.shield.fill" className="w-5 h-5 text-purple-400" />
                    <span>Active Directory & LDAP Configuration</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Configure domain mappings for Shoreline.icu domain controllers
                  </p>
                </div>

                {adSaveStatus && (
                  <div className="p-3.5 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-300 text-xs">
                    {adSaveStatus}
                  </div>
                )}

                <form onSubmit={handleSaveAdSettings} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Domain Name
                      </label>
                      <input
                        type="text"
                        value={adSettings.ad_domain || ''}
                        onChange={(e) => setAdSettings({ ...adSettings, ad_domain: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        LDAP / LDAPS Server URL
                      </label>
                      <input
                        type="text"
                        value={adSettings.ad_url || ''}
                        onChange={(e) => setAdSettings({ ...adSettings, ad_url: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                        Base DN
                      </label>
                      <input
                        type="text"
                        value={adSettings.ad_base_dn || ''}
                        onChange={(e) => setAdSettings({ ...adSettings, ad_base_dn: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-purple-300 mb-1.5">
                        Admin Role AD Group Name
                      </label>
                      <input
                        type="text"
                        value={adSettings.ad_admin_group || ''}
                        onChange={(e) => setAdSettings({ ...adSettings, ad_admin_group: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-purple-500/40 text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-semibold text-blue-300 mb-1.5">
                        General User AD Group Name
                      </label>
                      <input
                        type="text"
                        value={adSettings.ad_user_group || ''}
                        onChange={(e) => setAdSettings({ ...adSettings, ad_user_group: e.target.value })}
                        className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-blue-500/40 text-white text-sm font-mono focus:ring-1 focus:ring-purple-500 focus:outline-none"
                      />
                    </div>
                  </div>

                  <div className="pt-4 border-t border-surface-border flex justify-end">
                    <button
                      type="submit"
                      disabled={loading}
                      className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-glow shadow-purple-500/20 transition-all"
                    >
                      Save Active Directory Settings
                    </button>
                  </div>
                </form>
              </div>
            )}

            {/* 5. ADMIN: USER DIRECTORY & ON-BEHALF PROVISIONING */}
            {isAdmin && activeTab === 'users' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <SymbolIcon name="person.2.badge.gearshape" className="w-5 h-5 text-purple-400" />
                    <span>User Directory & On-Behalf Device Provisioning</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Isolation Rule: Devices created on a user's behalf appear on their dashboard and are manageable only from their profile page here.
                  </p>
                </div>

                {/* Users List Table */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {allUsers.map((u) => (
                    <div
                      key={u.id}
                      onClick={() => handleSelectUser(u)}
                      className={`p-4 rounded-2xl border transition-all cursor-pointer ${
                        selectedUserForDevices?.id === u.id
                          ? 'bg-purple-500/10 border-purple-500 shadow-glow shadow-purple-500/20'
                          : 'bg-surface hover:bg-surface-hover border-surface-border'
                      }`}
                    >
                      <div className="flex items-center gap-3 mb-2">
                        <div className="w-9 h-9 rounded-xl bg-surface-active flex items-center justify-center font-bold text-brand-300">
                          {u.display_name.charAt(0)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-white text-xs truncate">{u.display_name}</p>
                          <p className="text-[10px] text-slate-400 font-mono truncate">{u.username}@shoreline.icu</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between pt-2 border-t border-surface-border text-[10px]">
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${
                          u.role === 'admin' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                        }`}>
                          {u.role === 'admin' ? 'Domain Admin' : 'Domain User'}
                        </span>
                        <span className="text-purple-400 flex items-center gap-1 font-semibold">
                          View Devices <SymbolIcon name="chevron.right" className="w-2.5 h-2.5" />
                        </span>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Selected User Details & On-Behalf Device Manager */}
                {selectedUserForDevices && (
                  <div className="mt-8 p-6 rounded-3xl bg-surface/60 border border-purple-500/30 space-y-5 animate-in fade-in">
                    <div className="flex items-center justify-between">
                      <div>
                        <h3 className="text-sm font-bold text-white flex items-center gap-2">
                          <SymbolIcon name="person.crop.circle" className="w-4 h-4 text-purple-400" />
                          <span>Devices provisioned for {selectedUserForDevices.display_name}</span>
                        </h3>
                        <p className="text-xs text-slate-400">
                          Manage devices created on behalf of this user.
                        </p>
                      </div>

                      <button
                        onClick={() => setIsOnBehalfAddModalOpen(true)}
                        className="px-3 py-1.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center gap-1.5 transition-all shadow-glow shadow-purple-500/20"
                      >
                        <SymbolIcon name="plus" className="w-3.5 h-3.5" />
                        <span>Add Device for {selectedUserForDevices.display_name.split(' ')[0]}</span>
                      </button>
                    </div>

                    {adminCreatedDevices.length === 0 ? (
                      <p className="text-xs text-slate-500 py-4 text-center">
                        No devices created on behalf of this user yet.
                      </p>
                    ) : (
                      <div className="space-y-2">
                        {adminCreatedDevices.map((dev) => (
                          <div
                            key={dev.id}
                            className="p-3.5 rounded-2xl bg-surface border border-surface-border flex items-center justify-between text-xs"
                          >
                            <div className="flex items-center gap-3">
                              <div className={`w-8 h-8 rounded-xl flex items-center justify-center font-semibold text-[10px] ${
                                dev.protocol === 'rdp' ? 'bg-blue-500/10 text-blue-400' :
                                dev.protocol === 'ssh' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                              }`}>
                                {dev.protocol.toUpperCase()}
                              </div>
                              <div>
                                <p className="font-semibold text-white">{dev.name}</p>
                                <p className="text-[10px] text-slate-400 font-mono">{dev.host}:{dev.port}</p>
                              </div>
                            </div>

                            <button
                              onClick={async () => {
                                if (window.confirm(`Delete "${dev.name}"?`)) {
                                  await api.devices.delete(dev.id);
                                  handleSelectUser(selectedUserForDevices);
                                }
                              }}
                              className="px-2.5 py-1 rounded-lg bg-danger/10 hover:bg-danger/20 text-danger text-xs font-medium border border-danger/20 transition-colors"
                            >
                              Delete
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* 6. ADMIN: AUDIT LOGS */}
            {isAdmin && activeTab === 'audit' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h2 className="text-base font-bold text-white flex items-center gap-2">
                      <SymbolIcon name="doc.text.magnifyingglass" className="w-5 h-5 text-purple-400" />
                      <span>Session Audit Logs ({auditTotal})</span>
                    </h2>
                    <p className="text-xs text-slate-400">Complete audit trail of all remote session connections</p>
                  </div>

                  <input
                    type="text"
                    value={auditSearch}
                    onChange={(e) => setAuditSearch(e.target.value)}
                    placeholder="Search by user, device, IP..."
                    className="px-3.5 py-1.5 rounded-xl bg-surface border border-surface-border text-white text-xs placeholder-slate-500 focus:ring-1 focus:ring-purple-500 focus:outline-none"
                  />
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-surface-border text-[11px] font-semibold uppercase text-slate-400">
                        <th className="pb-3 px-3">Start Time</th>
                        <th className="pb-3 px-3">User / Identity</th>
                        <th className="pb-3 px-3">Device</th>
                        <th className="pb-3 px-3">Method</th>
                        <th className="pb-3 px-3">Client IP</th>
                        <th className="pb-3 px-3">Duration</th>
                        <th className="pb-3 px-3">Status</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-surface-border/50 font-mono text-[11px]">
                      {auditLogs.map((log) => (
                        <tr key={log.id} className="hover:bg-surface/50">
                          <td className="py-2.5 px-3 text-slate-300">{new Date(log.started_at).toLocaleString()}</td>
                          <td className="py-2.5 px-3 font-sans text-white font-medium">
                            {log.user_display_name || (log.connection_method === 'guest_link' ? 'Guest User' : 'Unknown')}
                          </td>
                          <td className="py-2.5 px-3 font-sans text-slate-200">
                            {log.device_name} ({log.protocol.toUpperCase()})
                          </td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold ${
                              log.connection_method === 'owner' ? 'bg-blue-500/10 text-blue-400' :
                              log.connection_method === 'shared_user' ? 'bg-purple-500/10 text-purple-400' : 'bg-amber-500/10 text-amber-400'
                            }`}>
                              {log.connection_method}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{log.client_ip || '127.0.0.1'}</td>
                          <td className="py-2.5 px-3 text-slate-300">{log.duration_seconds ? `${log.duration_seconds}s` : 'Active'}</td>
                          <td className="py-2.5 px-3">
                            <span className={`px-2 py-0.5 rounded text-[10px] font-sans font-semibold ${
                              log.status === 'active' ? 'bg-emerald-500/10 text-emerald-400' :
                              log.status === 'closed' ? 'bg-slate-500/10 text-slate-400' : 'bg-danger/10 text-danger'
                            }`}>
                              {log.status}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* 7. ADMIN: SELF-UPDATE PANEL */}
            {isAdmin && activeTab === 'update' && (
              <div className="rounded-3xl bg-surface-card border border-surface-border p-6 space-y-6">
                <div>
                  <h2 className="text-base font-bold text-white flex items-center gap-2">
                    <SymbolIcon name="arrow.trianglehead.2.clockwise.rotate.90" className="w-5 h-5 text-purple-400" />
                    <span>Application Self-Update Mechanism</span>
                  </h2>
                  <p className="text-xs text-slate-400">
                    Pull latest code, rebuild frontend/backend, and restart the running service with zero terminal intervention.
                  </p>
                </div>

                {/* Git Status Card */}
                {updateStatus && (
                  <div className="p-5 rounded-2xl bg-surface border border-surface-border space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-xs text-slate-400">Current Running Commit</span>
                      <span className="px-2.5 py-0.5 rounded-lg bg-surface-active text-purple-300 font-mono text-xs font-bold border border-purple-500/30">
                        {updateStatus.currentCommit}
                      </span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Branch</span>
                      <span className="text-white font-mono">{updateStatus.branch}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Last Commit Date</span>
                      <span className="text-slate-300">{updateStatus.commitDate}</span>
                    </div>

                    <div className="flex items-center justify-between text-xs">
                      <span className="text-slate-400">Commit Message</span>
                      <span className="text-slate-200 font-medium">{updateStatus.commitMessage}</span>
                    </div>
                  </div>
                )}

                {/* Update Check Result Message */}
                {updateCheckResult && (
                  <div className={`p-4 rounded-2xl border text-xs ${
                    updateCheckResult.hasUpdates
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                      : 'bg-surface border-surface-border text-slate-300'
                  }`}>
                    {updateCheckResult.message}
                  </div>
                )}

                {/* Update Execution Logs */}
                {updateLogs && (
                  <div className="p-4 rounded-2xl bg-black/60 border border-surface-border font-mono text-[11px] text-slate-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                    {updateLogs}
                  </div>
                )}

                {/* Action Buttons */}
                <div className="flex items-center gap-3 pt-2">
                  <button
                    onClick={handleCheckUpdate}
                    disabled={loading || isUpdating}
                    className="px-4 py-2.5 rounded-xl bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-200 text-xs font-semibold transition-all flex items-center gap-2"
                  >
                    <SymbolIcon name="arrow.clockwise" className="w-3.5 h-3.5" />
                    <span>Check for Updates</span>
                  </button>

                  <button
                    onClick={handleApplyUpdate}
                    disabled={isUpdating}
                    className="px-5 py-2.5 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold shadow-glow shadow-purple-500/20 transition-all flex items-center gap-2"
                  >
                    {isUpdating ? (
                      <>
                        <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 animate-spin" />
                        <span>Updating & Rebuilding...</span>
                      </>
                    ) : (
                      <>
                        <SymbolIcon name="sparkles" className="w-3.5 h-3.5" />
                        <span>Update Now</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            )}

          </div>

        </div>

      </main>

      {/* Modals */}
      <FolderModal
        isOpen={isFolderModalOpen}
        onClose={() => setIsFolderModalOpen(false)}
        onSuccess={loadGeneralData}
      />

      {selectedUserForDevices && (
        <AddDeviceModal
          isOpen={isOnBehalfAddModalOpen}
          onClose={() => setIsOnBehalfAddModalOpen(false)}
          onSuccess={() => handleSelectUser(selectedUserForDevices)}
          folders={folders}
          isAdmin={true}
        />
      )}

    </div>
  );
};
