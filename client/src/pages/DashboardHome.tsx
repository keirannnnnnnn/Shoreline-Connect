import React, { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { SearchModal } from '../components/SearchModal.js';
import { api, MonitoredDevice } from '../lib/api.js';
import { Device, Folder, DashboardWidgetConfig, WidgetCatalogItem } from '../types/index.js';

export const DashboardHome: React.FC = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [layout, setLayout] = useState<DashboardWidgetConfig[]>([]);
  const [catalog, setCatalog] = useState<WidgetCatalogItem[]>([]);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);

  // Widget Data States
  const [monitoredDevices, setMonitoredDevices] = useState<MonitoredDevice[]>([]);
  const [allDevices, setAllDevices] = useState<Device[]>([]);
  const [folders, setFolders] = useState<Folder[]>([]);

  useEffect(() => {
    loadDashboard();
  }, []);

  const loadDashboard = async () => {
    try {
      const [layoutRes, widgetsRes] = await Promise.all([
        api.dashboard.getLayout(),
        api.dashboard.getWidgets(),
      ]);

      setLayout(layoutRes.layout || []);
      setCatalog(widgetsRes.widgets || []);
    } catch (err) {
      console.error('Failed to load dashboard layout:', err);
    }

    // Load data for widgets
    try {
      const [monRes, devRes, foldRes] = await Promise.allSettled([
        api.monitoring.getDevices(),
        api.devices.getAll(),
        api.folders.getAll(),
      ]);

      if (monRes.status === 'fulfilled') setMonitoredDevices(monRes.value.devices || []);
      if (devRes.status === 'fulfilled') setAllDevices(devRes.value.devices || []);
      if (foldRes.status === 'fulfilled') setFolders(foldRes.value.folders || []);
    } catch (err) {
      console.error('Failed to load widget data:', err);
    }
  };

  const saveLayout = async (newLayout: DashboardWidgetConfig[]) => {
    setLayout(newLayout);
    try {
      await api.dashboard.saveLayout(newLayout);
    } catch (err) {
      console.error('Failed to persist layout:', err);
    }
  };

  const handleAddWidget = (widgetType: string) => {
    const catalogItem = catalog.find(c => c.type === widgetType);
    if (!catalogItem) return;

    const newWidget: DashboardWidgetConfig = {
      instanceId: `w-${widgetType}-${Date.now()}`,
      type: widgetType,
      title: catalogItem.title,
      w: catalogItem.defaultSize.w || 6,
      order: layout.length,
      enabled: true,
    };

    const nextLayout = [...layout, newWidget];
    saveLayout(nextLayout);
    setIsPickerOpen(false);
  };

  const handleRemoveWidget = (instanceId: string) => {
    const nextLayout = layout.filter(w => w.instanceId !== instanceId);
    saveLayout(nextLayout);
  };

  const handleMoveWidget = (index: number, direction: 'up' | 'down') => {
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= layout.length) return;

    const nextLayout = [...layout];
    const [moved] = nextLayout.splice(index, 1);
    nextLayout.splice(targetIndex, 0, moved);

    // Re-index orders
    const reindexed = nextLayout.map((item, idx) => ({ ...item, order: idx }));
    saveLayout(reindexed);
  };

  const handleResetLayout = () => {
    if (!window.confirm('Reset dashboard to default widget arrangement?')) return;
    const defaultLayout: DashboardWidgetConfig[] = [
      { instanceId: `w-fleet-${Date.now()}`, type: 'fleet-health', title: 'Fleet Health Overview', w: 12, order: 0, enabled: true },
      { instanceId: `w-quick-${Date.now() + 1}`, type: 'quick-connect', title: 'Quick Launch', w: 6, order: 1, enabled: true },
      { instanceId: `w-sys-${Date.now() + 2}`, type: 'system-status', title: 'System Information', w: 6, order: 2, enabled: true },
    ];
    saveLayout(defaultLayout);
  };

  // Fleet Health Stats Calculation
  const totalMonitored = monitoredDevices.length;
  const onlineCount = monitoredDevices.filter(d => d.status === 'online').length;
  const offlineCount = monitoredDevices.filter(d => d.status === 'offline').length;

  const highLoadDevices = monitoredDevices.filter(d => {
    const cpu = d.current_metrics?.cpu_usage || 0;
    const ram = d.current_metrics?.ram_percent || 0;
    return d.status === 'online' && (cpu > 80 || ram > 85);
  });

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar onOpenSearch={() => setIsSearchOpen(true)} />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
        
        {/* Welcome & Dashboard Controls Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
              <span>Welcome back, {user?.display_name?.split(' ')[0] || user?.username}</span>
            </h1>
            <p className="text-xs text-slate-400">
              Your personalized modular control center for devices, telemetry, and secure workflows.
            </p>
          </div>

          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => setIsPickerOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 transition-all flex items-center gap-1.5"
            >
              <SymbolIcon name="plus" className="w-3.5 h-3.5" />
              <span>Add Widget</span>
            </button>

            <button
              onClick={handleResetLayout}
              className="px-3 py-2 rounded-xl bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-300 text-xs font-semibold transition-all flex items-center gap-1.5"
              title="Reset to default arrangement"
            >
              <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 text-slate-400" />
              <span>Reset Layout</span>
            </button>
          </div>
        </div>

        {/* Dynamic Widget Grid Canvas */}
        {layout.length === 0 ? (
          <div className="p-12 rounded-3xl bg-surface-card border border-surface-border text-center space-y-4">
            <div className="w-12 h-12 rounded-2xl bg-brand-500/10 border border-brand-500/20 text-brand-400 flex items-center justify-center mx-auto">
              <SymbolIcon name="square.grid.2x2" className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">Your dashboard is empty</h3>
              <p className="text-xs text-slate-400 max-w-sm mx-auto mt-1">
                Customize your home screen by adding widgets for fleet monitoring, quick session launching, and device metrics.
              </p>
            </div>
            <button
              onClick={() => setIsPickerOpen(true)}
              className="px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold inline-flex items-center gap-2"
            >
              <SymbolIcon name="plus" className="w-3.5 h-3.5" />
              <span>Add Your First Widget</span>
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
            {layout.map((widget, index) => {
              const colSpan = widget.w === 12 ? 'col-span-12' : widget.w === 6 ? 'col-span-12 lg:col-span-6' : 'col-span-12 sm:col-span-6 lg:col-span-4';

              return (
                <div
                  key={widget.instanceId}
                  className={`${colSpan} rounded-3xl bg-surface-card border border-surface-border p-6 space-y-4 flex flex-col transition-all hover:border-surface-borderLight shadow-sm`}
                >
                  {/* Widget Card Header */}
                  <div className="flex items-center justify-between pb-3 border-b border-surface-border">
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-lg bg-surface-active flex items-center justify-center text-brand-400">
                        {widget.type === 'fleet-health' && <SymbolIcon name="waveform.path.ecg" className="w-4 h-4" />}
                        {widget.type === 'quick-connect' && <SymbolIcon name="macbook.and.iphone" className="w-4 h-4" />}
                        {widget.type === 'system-status' && <SymbolIcon name="server.rack" className="w-4 h-4" />}
                      </div>
                      <span className="text-xs font-bold text-white">{widget.title}</span>
                    </div>

                    {/* Widget Management Actions */}
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => handleMoveWidget(index, 'up')}
                        disabled={index === 0}
                        className="p-1 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                        title="Move left / up"
                      >
                        <SymbolIcon name="chevron.left" className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => handleMoveWidget(index, 'down')}
                        disabled={index === layout.length - 1}
                        className="p-1 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
                        title="Move right / down"
                      >
                        <SymbolIcon name="chevron.right" className="w-3 h-3" />
                      </button>

                      <button
                        onClick={() => handleRemoveWidget(widget.instanceId)}
                        className="p-1 rounded-lg hover:bg-danger/20 text-slate-400 hover:text-danger transition-colors ml-1"
                        title="Remove widget"
                      >
                        <SymbolIcon name="xmark" className="w-3 h-3" />
                      </button>
                    </div>
                  </div>

                  {/* Widget Content Body */}
                  <div className="flex-1">
                    {/* 1. Fleet Health & Monitoring Widget */}
                    {widget.type === 'fleet-health' && (
                      <div className="space-y-4">
                        {/* Summary Metrics Badges */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                          <div className="p-3.5 rounded-2xl bg-surface border border-surface-border">
                            <span className="text-[10px] text-slate-400 font-semibold block">Total Monitored</span>
                            <span className="text-xl font-bold text-white font-mono mt-0.5 block">{totalMonitored}</span>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-emerald-500/10 border border-emerald-500/20">
                            <span className="text-[10px] text-emerald-300 font-semibold block">Online Agents</span>
                            <span className="text-xl font-bold text-emerald-400 font-mono mt-0.5 block">{onlineCount}</span>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-amber-500/10 border border-amber-500/20">
                            <span className="text-[10px] text-amber-300 font-semibold block">Offline / Inactive</span>
                            <span className="text-xl font-bold text-amber-400 font-mono mt-0.5 block">{offlineCount}</span>
                          </div>

                          <div className="p-3.5 rounded-2xl bg-danger/10 border border-danger/20">
                            <span className="text-[10px] text-danger font-semibold block">High Load Alerts</span>
                            <span className="text-xl font-bold text-danger font-mono mt-0.5 block">{highLoadDevices.length}</span>
                          </div>
                        </div>

                        {/* High Load Warning Banner if any */}
                        {highLoadDevices.length > 0 && (
                          <div className="p-3 rounded-xl bg-danger/10 border border-danger/30 text-danger text-xs flex items-center justify-between">
                            <div className="flex items-center gap-2">
                              <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 flex-shrink-0" />
                              <span>{highLoadDevices.length} machine(s) are reporting critical CPU or memory utilization.</span>
                            </div>
                            <Link to="/monitoring" className="underline font-semibold text-[11px]">Inspect</Link>
                          </div>
                        )}

                        {/* Top Monitored Devices List */}
                        <div className="space-y-2">
                          <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-1">
                            <span>Device Fleet</span>
                            <Link to="/monitoring" className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                              <span>View Full Fleet</span>
                              <SymbolIcon name="chevron.right" className="w-2.5 h-2.5" />
                            </Link>
                          </div>

                          {monitoredDevices.length === 0 ? (
                            <p className="text-xs text-slate-500 py-3 text-center">No monitoring agents connected yet.</p>
                          ) : (
                            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                              {monitoredDevices.slice(0, 6).map(dev => (
                                <Link
                                  key={dev.id}
                                  to={`/monitoring/${dev.device_id}`}
                                  className="p-3 rounded-2xl bg-surface hover:bg-surface-hover border border-surface-border transition-all flex items-center justify-between text-xs"
                                >
                                  <div className="min-w-0 pr-2">
                                    <p className="font-semibold text-white truncate">{dev.device_name}</p>
                                    <div className="flex items-center gap-2 mt-0.5 text-[10px] text-slate-400">
                                      <span className={`w-1.5 h-1.5 rounded-full ${dev.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                                      <span className="capitalize">{dev.status}</span>
                                      {dev.current_metrics && (
                                        <span className="font-mono text-slate-300">CPU {Math.round(dev.current_metrics.cpu_usage)}%</span>
                                      )}
                                    </div>
                                  </div>
                                  <SymbolIcon name="chevron.right" className="w-3 h-3 text-slate-500" />
                                </Link>
                              ))}
                            </div>
                          )}
                        </div>
                      </div>
                    )}

                    {/* 2. Quick Connect Widget */}
                    {widget.type === 'quick-connect' && (
                      <div className="space-y-3">
                        <div className="flex items-center justify-between text-[11px] text-slate-400 font-semibold px-1">
                          <span>Recent Connections</span>
                          <Link to="/devices" className="text-brand-400 hover:text-brand-300 flex items-center gap-1">
                            <span>All Devices</span>
                            <SymbolIcon name="chevron.right" className="w-2.5 h-2.5" />
                          </Link>
                        </div>

                        {allDevices.length === 0 ? (
                          <p className="text-xs text-slate-500 py-4 text-center">No devices configured yet.</p>
                        ) : (
                          <div className="space-y-2">
                            {allDevices.slice(0, 4).map(dev => (
                              <div
                                key={dev.id}
                                className="p-3 rounded-2xl bg-surface border border-surface-border flex items-center justify-between text-xs"
                              >
                                <div className="flex items-center gap-2.5 min-w-0">
                                  <div className={`w-7 h-7 rounded-lg flex items-center justify-center font-bold text-[10px] ${
                                    dev.protocol === 'rdp' ? 'bg-blue-500/10 text-blue-400' :
                                    dev.protocol === 'ssh' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                                  }`}>
                                    {dev.protocol.toUpperCase()}
                                  </div>
                                  <div className="min-w-0">
                                    <p className="font-semibold text-white truncate">{dev.name}</p>
                                    <p className="text-[10px] text-slate-400 font-mono truncate">{dev.host}</p>
                                  </div>
                                </div>

                                <button
                                  onClick={() => navigate(`/session/${dev.id}`)}
                                  className="px-3 py-1.5 rounded-xl bg-brand-600/80 hover:bg-brand-600 text-white text-[11px] font-semibold flex items-center gap-1 shadow-sm transition-all"
                                >
                                  <SymbolIcon name="play.fill" className="w-2.5 h-2.5" />
                                  <span>Connect</span>
                                </button>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    {/* 3. System Status Widget */}
                    {widget.type === 'system-status' && (
                      <div className="space-y-3 text-xs">
                        <div className="p-3.5 rounded-2xl bg-surface border border-surface-border space-y-2">
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Directory Domain</span>
                            <span className="text-white font-mono font-semibold">shoreline.icu</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Logged In Account</span>
                            <span className="text-brand-300 font-mono">{user?.username}</span>
                          </div>
                          <div className="flex items-center justify-between">
                            <span className="text-slate-400">Account Access Level</span>
                            <span className={`px-2 py-0.5 rounded-md font-semibold text-[10px] ${
                              user?.role === 'admin' ? 'bg-purple-500/20 text-purple-300' : 'bg-blue-500/20 text-blue-300'
                            }`}>
                              {user?.role === 'admin' ? 'Administrator' : 'Standard User'}
                            </span>
                          </div>
                        </div>

                        <div className="p-3 rounded-2xl bg-surface border border-surface-border flex items-center justify-between text-slate-300">
                          <div className="flex items-center gap-2">
                            <SymbolIcon name="shield.lefthalf.filled" className="w-4 h-4 text-emerald-400" />
                            <span className="text-[11px]">Guacamole Protocol Daemon</span>
                          </div>
                          <span className="text-emerald-400 font-semibold text-[11px]">Active (Port 4822)</span>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Add Widget Picker Modal */}
        {isPickerOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm animate-in fade-in">
            <div className="relative w-full max-w-lg rounded-3xl bg-surface-card border border-surface-border p-6 shadow-2xl space-y-5 animate-in zoom-in-95">
              <div className="flex items-center justify-between pb-3 border-b border-surface-border">
                <div className="flex items-center gap-2">
                  <SymbolIcon name="square.grid.2x2" className="w-5 h-5 text-brand-400" />
                  <h3 className="text-base font-bold text-white">Add Dashboard Widget</h3>
                </div>
                <button
                  onClick={() => setIsPickerOpen(false)}
                  className="p-1 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white"
                >
                  <SymbolIcon name="xmark" className="w-4 h-4" />
                </button>
              </div>

              <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
                {catalog.map(item => (
                  <div
                    key={item.id}
                    className="p-4 rounded-2xl bg-surface border border-surface-border hover:border-surface-borderLight flex items-start justify-between gap-4 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-9 h-9 rounded-xl bg-surface-active flex items-center justify-center text-brand-400 flex-shrink-0 mt-0.5">
                        <SymbolIcon name={item.icon} className="w-5 h-5" />
                      </div>
                      <div>
                        <h4 className="font-semibold text-white text-xs">{item.title}</h4>
                        <p className="text-[11px] text-slate-400 mt-1 leading-relaxed">{item.description}</p>
                      </div>
                    </div>

                    <button
                      onClick={() => handleAddWidget(item.type)}
                      className="px-3 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold flex-shrink-0 shadow-sm transition-all"
                    >
                      Add
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Quick Search Modal */}
        <SearchModal
          isOpen={isSearchOpen}
          onClose={() => setIsSearchOpen(false)}
          devices={allDevices}
          folders={folders}
        />

      </main>
    </div>
  );
};
