import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Device, Folder } from '../types/index.js';
import { api } from '../lib/api.js';
import { Navbar } from '../components/Navbar.js';
import { DeviceCard } from '../components/DeviceCard.js';
import { RecentConnections } from '../components/RecentConnections.js';
import { AddDeviceModal } from '../components/AddDeviceModal.js';
import { ShareModal } from '../components/ShareModal.js';
import { FolderModal } from '../components/FolderModal.js';
import { SearchModal } from '../components/SearchModal.js';
import { SymbolIcon } from '../components/SymbolIcon.js';

export const Dashboard: React.FC = () => {
  const { user, isAdmin } = useAuth();
  const navigate = useNavigate();

  const [devices, setDevices] = useState<Device[]>([]);
  const [recents, setRecents] = useState<any[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [loading, setLoading] = useState(true);

  // Filters
  const [selectedTab, setSelectedTab] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');

  // Modals
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [isShareOpen, setIsShareOpen] = useState(false);
  const [isFolderOpen, setIsFolderOpen] = useState(false);
  const [managingFolder, setManagingFolder] = useState<Folder | null>(null);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [editingDevice, setEditingDevice] = useState<Device | null>(null);

  useEffect(() => {
    loadData();
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setIsSearchOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const loadData = async () => {
    setLoading(true);
    try {
      const [devicesRes, recentsRes, foldersRes] = await Promise.all([
        api.devices.getAll(),
        api.devices.getRecents(),
        api.folders.getAll(),
      ]);
      setDevices(devicesRes.devices);
      setRecents(recentsRes.recents);
      setFolders(foldersRes.folders);
    } catch (err: any) {
      console.error('Failed to load dashboard data:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFavorite = async (deviceId: string) => {
    try {
      const { isFavorite } = await api.devices.toggleFavorite(deviceId);
      setDevices((prev) =>
        prev.map((d) => (d.id === deviceId ? { ...d, is_favorite: isFavorite ? 1 : 0 } : d))
      );
    } catch (err: any) {
      console.error(err);
    }
  };

  const handleShare = (device: Device) => {
    setSelectedDevice(device);
    setIsShareOpen(true);
  };

  const handleEdit = (device: Device) => {
    setEditingDevice(device);
    setIsAddOpen(true);
  };

  const handleDelete = async (device: Device) => {
    if (window.confirm(`Are you sure you want to delete "${device.name}"?`)) {
      try {
        await api.devices.delete(device.id);
        await loadData();
      } catch (err: any) {
        alert(err.message || 'Failed to delete device');
      }
    }
  };

  const getIconForProto = (proto: string) => {
    switch (proto.toLowerCase()) {
      case 'rdp': return 'display';
      case 'ssh': return 'terminal';
      case 'vnc': return 'display.2';
      default: return 'network';
    }
  };

  const getColorForProto = (proto: string) => {
    switch (proto.toLowerCase()) {
      case 'rdp': return 'text-blue-400 bg-blue-500/10 border-blue-500/20';
      case 'ssh': return 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20';
      case 'vnc': return 'text-amber-400 bg-amber-500/10 border-amber-500/20';
      default: return 'text-slate-400 bg-slate-500/10 border-slate-500/20';
    }
  };

  // Filtered devices based on active tab and search query
  const filteredDevices = devices.filter((d) => {
    const matchesSearch =
      d.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
      d.protocol.toLowerCase().includes(searchQuery.toLowerCase());

    if (!matchesSearch) return false;

    if (selectedTab === 'all') return true;
    if (selectedTab === 'favorites') return !!d.is_favorite;
    if (selectedTab === 'rdp') return d.protocol === 'rdp';
    if (selectedTab === 'ssh') return d.protocol === 'ssh';
    if (selectedTab === 'vnc') return d.protocol === 'vnc';
    if (selectedTab.startsWith('folder:')) {
      const folderId = selectedTab.split(':')[1];
      return d.folder_id === folderId;
    }
    return true;
  });

  const activeFolder = selectedTab.startsWith('folder:')
    ? folders.find((f) => `folder:${f.id}` === selectedTab) || null
    : null;

  const favorites = devices.filter((d) => !!d.is_favorite);

  // Counts for tabs
  const rdpCount = devices.filter((d) => d.protocol === 'rdp').length;
  const sshCount = devices.filter((d) => d.protocol === 'ssh').length;
  const vncCount = devices.filter((d) => d.protocol === 'vnc').length;

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar
        onOpenSearch={() => setIsSearchOpen(true)}
      />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Welcome & Stats Banner */}
        <div className="mb-8 flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight">
              Welcome back, {user?.display_name || user?.username}
            </h1>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-slate-400">Total Devices:</span>
              <strong className="text-white font-mono">{devices.length}</strong>
            </div>

            <button
              onClick={() => {
                setEditingDevice(null);
                setIsAddOpen(true);
              }}
              className="flex items-center gap-1.5 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all active:scale-95"
            >
              <SymbolIcon name="plus" className="w-4 h-4" />
              <span>Add Device</span>
            </button>
          </div>
        </div>

        {/* 1. Recent Connections */}
        <RecentConnections recents={recents} />

        {/* 2. Favourites Section (Compact Tiles) */}
        {favorites.length > 0 && selectedTab === 'all' && (
          <div className="mb-8">
            <div className="flex items-center gap-2 mb-3.5">
              <SymbolIcon name="star.fill" className="w-4 h-4 text-amber-400" />
              <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
                Starred Favourites ({favorites.length})
              </h2>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
              {favorites.map((dev) => (
                <div
                  key={`fav-${dev.id}`}
                  onClick={() => navigate(`/session/${dev.id}`)}
                  className="group rounded-xl bg-surface-card/90 hover:bg-surface-hover border border-surface-border hover:border-surface-borderLight p-3.5 transition-all duration-150 cursor-pointer shadow-sm flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div className={`w-9 h-9 rounded-lg flex items-center justify-center border flex-shrink-0 ${getColorForProto(dev.protocol)}`}>
                      <SymbolIcon name={getIconForProto(dev.protocol)} className="w-4 h-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-semibold text-sm text-slate-200 group-hover:text-white truncate">
                        {dev.name}
                      </p>
                      <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                        <span className="uppercase font-mono font-medium text-[10px] text-slate-500">{dev.protocol}</span>
                        {dev.folder_name && (
                          <>
                            <span>•</span>
                            <span className="truncate">{dev.folder_name}</span>
                          </>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleFavorite(dev.id);
                      }}
                      className="p-1 rounded-lg text-amber-400 hover:text-amber-300 hover:bg-surface-active transition-colors"
                      title="Remove from favorites"
                    >
                      <SymbolIcon name="star.fill" className="w-3.5 h-3.5" />
                    </button>
                    <div className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg bg-surface-active text-slate-300">
                      <SymbolIcon name="arrow.up.right" className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 3. Main Device Inventory Filter Tabs */}
        <div className="mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-surface-border">
            
            {/* Tabs */}
            <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 scrollbar-none">
              <button
                onClick={() => setSelectedTab('all')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  selectedTab === 'all'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'bg-surface-card hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-surface-border'
                }`}
              >
                <span>All Devices</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20 font-mono">
                  {devices.length}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('rdp')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  selectedTab === 'rdp'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-surface-card hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-surface-border'
                }`}
              >
                <SymbolIcon name="display" className="w-3.5 h-3.5 text-blue-400" />
                <span>RDP</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20 font-mono">
                  {rdpCount}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('ssh')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  selectedTab === 'ssh'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'bg-surface-card hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-surface-border'
                }`}
              >
                <SymbolIcon name="terminal" className="w-3.5 h-3.5 text-emerald-400" />
                <span>SSH</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20 font-mono">
                  {sshCount}
                </span>
              </button>

              <button
                onClick={() => setSelectedTab('vnc')}
                className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                  selectedTab === 'vnc'
                    ? 'bg-amber-600 text-white shadow-sm'
                    : 'bg-surface-card hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-surface-border'
                }`}
              >
                <SymbolIcon name="display.2" className="w-3.5 h-3.5 text-amber-400" />
                <span>VNC</span>
                <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-black/20 font-mono">
                  {vncCount}
                </span>
              </button>

              {/* Custom Folders in Tabs */}
              {folders.map((f) => (
                <button
                  key={f.id}
                  onClick={() => setSelectedTab(`folder:${f.id}`)}
                  className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold transition-all flex items-center gap-1.5 whitespace-nowrap ${
                    selectedTab === `folder:${f.id}`
                      ? 'bg-surface-active text-white border border-brand-500'
                      : 'bg-surface-card hover:bg-surface-hover text-slate-400 hover:text-slate-200 border border-surface-border'
                  }`}
                >
                  <SymbolIcon name={f.icon || 'folder.fill'} className="w-3.5 h-3.5" style={{ color: f.color }} />
                  <span>{f.name}</span>
                </button>
              ))}

              <button
                onClick={() => {
                  setManagingFolder(null);
                  setIsFolderOpen(true);
                }}
                className="px-2.5 py-1.5 rounded-xl text-xs font-medium bg-surface hover:bg-surface-hover text-slate-400 hover:text-white border border-dashed border-surface-border flex items-center gap-1"
                title="Create custom folder"
              >
                <SymbolIcon name="folder.badge.plus" className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">New Folder</span>
              </button>
            </div>

            {/* Quick search input */}
            <div className="relative w-full sm:w-64">
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Filter by name or IP..."
                className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-white text-xs placeholder-slate-500 focus:ring-1 focus:ring-brand-500 focus:outline-none"
              />
              <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-500">
                <SymbolIcon name="magnifyingglass" className="w-3.5 h-3.5" />
              </div>
            </div>

          </div>
        </div>

        {/* Active Folder Header Banner */}
        {activeFolder && (
          <div className="mb-6 p-4 rounded-2xl bg-surface-card border border-surface-border flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 shadow-sm">
            <div className="flex items-center gap-3">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center border flex-shrink-0"
                style={{
                  backgroundColor: `${activeFolder.color}15`,
                  borderColor: `${activeFolder.color}30`,
                  color: activeFolder.color,
                }}
              >
                <SymbolIcon name={activeFolder.icon || 'folder.fill'} className="w-5 h-5" />
              </div>
              <div>
                <h2 className="text-base font-bold text-white flex items-center gap-2">
                  <span>{activeFolder.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-surface-active text-slate-400 font-normal">
                    {filteredDevices.length} {filteredDevices.length === 1 ? 'device' : 'devices'}
                  </span>
                </h2>
                <p className="text-xs text-slate-400">Custom organization folder</p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setManagingFolder(activeFolder);
                  setIsFolderOpen(true);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-brand-600/10 hover:bg-brand-600/20 text-brand-400 border border-brand-500/20 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <SymbolIcon name="plus.circle" className="w-3.5 h-3.5" />
                <span>Add / Manage Devices in Folder</span>
              </button>

              <button
                onClick={async () => {
                  if (window.confirm(`Delete folder "${activeFolder.name}"? Devices inside will be moved to root.`)) {
                    await api.folders.delete(activeFolder.id);
                    setSelectedTab('all');
                    await loadData();
                  }
                }}
                className="p-1.5 rounded-xl text-slate-500 hover:text-danger hover:bg-danger/10 transition-colors"
                title="Delete Folder"
              >
                <SymbolIcon name="trash" className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}

        {/* 4. Devices Grid */}
        {loading ? (
          <div className="py-20 text-center">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-brand-500 mx-auto mb-3" />
            <p className="text-xs text-slate-400">Loading remote devices...</p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="py-20 text-center rounded-3xl bg-surface-card/50 border border-dashed border-surface-border p-8">
            <div className="w-12 h-12 rounded-2xl bg-surface-active flex items-center justify-center text-slate-500 mx-auto mb-3">
              <SymbolIcon name="server.rack" className="w-6 h-6" />
            </div>
            <h3 className="text-base font-semibold text-slate-200 mb-1">
              {searchQuery ? 'No matching devices found' : activeFolder ? `No devices in "${activeFolder.name}"` : 'No devices in this category'}
            </h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto mb-5">
              {searchQuery
                ? 'Try adjusting your search terms.'
                : activeFolder
                ? 'Add existing devices to this folder using the button above.'
                : 'Add your first RDP, SSH, or VNC remote connection to get started.'}
            </p>
            {activeFolder ? (
              <button
                onClick={() => {
                  setManagingFolder(activeFolder);
                  setIsFolderOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all"
              >
                <SymbolIcon name="plus.circle" className="w-4 h-4" />
                <span>Add Existing Devices to this Folder</span>
              </button>
            ) : (
              <button
                onClick={() => {
                  setEditingDevice(null);
                  setIsAddOpen(true);
                }}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all"
              >
                <SymbolIcon name="plus" className="w-4 h-4" />
                <span>Add Device</span>
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDevices.map((dev) => (
              <DeviceCard
                key={dev.id}
                device={dev}
                onToggleFavorite={handleToggleFavorite}
                onShare={handleShare}
                onEdit={handleEdit}
                onDelete={handleDelete}
              />
            ))}
          </div>
        )}

      </main>

      {/* Modals */}
      <AddDeviceModal
        isOpen={isAddOpen}
        onClose={() => {
          setIsAddOpen(false);
          setEditingDevice(null);
        }}
        onSuccess={loadData}
        editDevice={editingDevice}
        folders={folders}
        isAdmin={isAdmin}
      />

      <ShareModal
        isOpen={isShareOpen}
        onClose={() => {
          setIsShareOpen(false);
          setSelectedDevice(null);
        }}
        device={selectedDevice}
      />

      <FolderModal
        isOpen={isFolderOpen}
        onClose={() => {
          setIsFolderOpen(false);
          setManagingFolder(null);
        }}
        onSuccess={loadData}
        folder={managingFolder}
        devices={devices}
      />

      <SearchModal
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        devices={devices}
        folders={folders}
      />
    </div>
  );
};
