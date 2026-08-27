import React, { useEffect, useState, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, MonitoredDevice } from '../lib/api.js';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';

export const Monitoring: React.FC = () => {
  const navigate = useNavigate();
  const [devices, setDevices] = useState<MonitoredDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'online' | 'offline' | 'pending'>('all');

  const fetchDevices = async (isInitial = false) => {
    try {
      if (isInitial) setLoading(true);
      const res = await api.monitoring.getDevices();
      setDevices(res.devices);
    } catch (err) {
      console.error('Failed to fetch monitored devices:', err);
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchDevices(true);
    // Poll every 10s for live metrics updates
    const interval = setInterval(() => {
      fetchDevices(false);
    }, 10000);
    return () => clearInterval(interval);
  }, []);

  const filteredDevices = useMemo(() => {
    return devices.filter((d) => {
      const matchSearch =
        d.device_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        d.host.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (d.system_info?.hostname && d.system_info.hostname.toLowerCase().includes(searchQuery.toLowerCase())) ||
        (d.system_info?.os && d.system_info.os.toLowerCase().includes(searchQuery.toLowerCase()));

      const matchStatus = statusFilter === 'all' || d.status === statusFilter;
      return matchSearch && matchStatus;
    });
  }, [devices, searchQuery, statusFilter]);

  const stats = useMemo(() => {
    const total = devices.length;
    const online = devices.filter((d) => d.status === 'online').length;
    const offline = devices.filter((d) => d.status === 'offline').length;
    const pending = devices.filter((d) => d.status === 'pending').length;

    let totalCpu = 0;
    let totalRam = 0;
    let activeCount = 0;
    devices.forEach((d) => {
      if (d.status === 'online' && d.current_metrics) {
        totalCpu += d.current_metrics.cpu_usage;
        totalRam += d.current_metrics.ram_percent;
        activeCount++;
      }
    });

    const avgCpu = activeCount > 0 ? (totalCpu / activeCount).toFixed(1) : '0';
    const avgRam = activeCount > 0 ? (totalRam / activeCount).toFixed(1) : '0';

    return { total, online, offline, pending, avgCpu, avgRam };
  }, [devices]);

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatNetRate = (bytesSec: number): string => {
    if (!bytesSec || bytesSec === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesSec) / Math.log(k));
    return parseFloat((bytesSec / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatUptime = (seconds: number): string => {
    if (!seconds || seconds <= 0) return 'Just started';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const getProgressColor = (pct: number): string => {
    if (pct >= 90) return 'bg-danger shadow-danger/20';
    if (pct >= 75) return 'bg-amber-400 shadow-amber-400/20';
    return 'bg-brand-500 shadow-brand-500/20';
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Header & Stats Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold text-white flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
                <SymbolIcon name="waveform.path.ecg" className="w-5 h-5" />
              </div>
              <span>Device Monitoring</span>
            </h1>
            <p className="text-xs text-slate-400 mt-1">
              Live lightweight resource telemetry, CPU/RAM/Disk metrics, and historical performance tracking.
            </p>
          </div>

          {/* Quick Stats Pills */}
          <div className="flex items-center gap-2 flex-wrap">
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs">
              <span className="text-slate-400">Total:</span>
              <span className="font-semibold text-white">{stats.total}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs">
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
              <span className="text-slate-400">Online:</span>
              <span className="font-semibold text-emerald-400">{stats.online}</span>
            </div>
            {stats.offline > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs">
                <span className="w-2 h-2 rounded-full bg-red-400" />
                <span className="text-slate-400">Offline:</span>
                <span className="font-semibold text-red-400">{stats.offline}</span>
              </div>
            )}
            {stats.pending > 0 && (
              <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs">
                <span className="w-2 h-2 rounded-full bg-amber-400" />
                <span className="text-slate-400">Pending Install:</span>
                <span className="font-semibold text-amber-400">{stats.pending}</span>
              </div>
            )}
          </div>
        </div>

        {/* Filter & Search Toolbar */}
        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
          <div className="relative w-full sm:w-80">
            <SymbolIcon name="magnifyingglass" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search monitored devices..."
              className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
            />
          </div>

          <div className="flex items-center gap-1.5 w-full sm:w-auto overflow-x-auto">
            {(['all', 'online', 'offline', 'pending'] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                  statusFilter === s
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Device Cards Grid */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-brand-500 mb-3" />
            <p className="text-xs">Loading device telemetry...</p>
          </div>
        ) : filteredDevices.length === 0 ? (
          <div className="py-16 text-center rounded-3xl bg-surface-card/40 border border-surface-border border-dashed p-8">
            <div className="w-14 h-14 rounded-2xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center mx-auto mb-3 text-brand-400">
              <SymbolIcon name="waveform.path.ecg" className="w-7 h-7" />
            </div>
            <h3 className="text-base font-bold text-white mb-1">No Monitored Devices Found</h3>
            <p className="text-xs text-slate-400 max-w-md mx-auto mb-5">
              {devices.length === 0
                ? "You haven't enabled monitoring on any devices yet. Edit a device in the Devices tab and toggle 'Enable Monitoring' to get your one-command install script."
                : 'No devices matched your search or status filter.'}
            </p>
            {devices.length === 0 && (
              <Link
                to="/"
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow transition-all"
              >
                <SymbolIcon name="macbook.and.iphone" className="w-4 h-4" />
                <span>Go to Devices Inventory</span>
              </Link>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredDevices.map((dev) => {
              const m = dev.current_metrics;
              const isOnline = dev.status === 'online';
              const isPending = dev.status === 'pending';

              return (
                <div
                  key={dev.device_id}
                  onClick={() => navigate(`/monitoring/${dev.device_id}`)}
                  className="group relative rounded-3xl bg-surface-card border border-surface-border hover:border-surface-borderLight p-5 flex flex-col justify-between transition-all duration-200 hover:shadow-xl cursor-pointer"
                >
                  {/* Top Bar: Device Name & Status */}
                  <div>
                    <div className="flex items-start justify-between gap-3 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <div className="w-4 h-4 flex-shrink-0 flex items-center justify-center">
                            {dev.system_info?.os?.toLowerCase().includes('win') || dev.system_info?.platform?.toLowerCase().includes('win') ? (
                              <SymbolIcon name="White WIndows 11 Icon.png" className="w-3.5 h-3.5" />
                            ) : dev.system_info?.os?.toLowerCase().includes('linux') || dev.system_info?.platform?.toLowerCase().includes('linux') ? (
                              <SymbolIcon name="Linux Logo.png" className="w-3.5 h-3.5" />
                            ) : (
                              <SymbolIcon name="display" className="w-3.5 h-3.5 text-slate-400" />
                            )}
                          </div>
                          <h3 className="text-sm font-bold text-white group-hover:text-brand-300 transition-colors truncate">
                            {dev.device_name}
                          </h3>
                          {dev.is_shared && (
                            <span className="px-1.5 py-0.5 rounded text-[9px] font-medium bg-purple-500/10 text-purple-400 border border-purple-500/20">
                              Shared
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-slate-400 font-mono truncate mt-0.5">
                          {dev.system_info?.platform_version || dev.system_info?.os || dev.system_info?.hostname || dev.host}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="uppercase text-[10px] font-mono px-2 py-0.5 rounded-md bg-surface border border-surface-border text-slate-400">
                          {dev.protocol}
                        </span>
                        <span
                          className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                            isOnline
                              ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                              : isPending
                              ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                              : 'bg-red-500/10 text-red-400 border-red-500/20'
                          }`}
                        >
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              isOnline ? 'bg-emerald-400 animate-pulse' : isPending ? 'bg-amber-400' : 'bg-red-400'
                            }`}
                          />
                          <span className="capitalize">{dev.status}</span>
                        </span>
                      </div>
                    </div>

                    {/* Metrics Section */}
                    {isPending ? (
                      <div className="my-6 p-4 rounded-2xl bg-surface/60 border border-surface-border text-center space-y-2">
                        <SymbolIcon name="clock.arrow.circlepath" className="w-5 h-5 text-amber-400 mx-auto" />
                        <p className="text-xs font-semibold text-amber-300">Agent Waiting to Connect</p>
                        <p className="text-[11px] text-slate-400">
                          Click to view your one-command install script for this device.
                        </p>
                      </div>
                    ) : (
                      <div className="space-y-3.5 my-3">
                        
                        {/* CPU Utilization */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400 flex items-center gap-1">
                              <SymbolIcon name="cpu" className="w-3.5 h-3.5 text-slate-500" />
                              <span>CPU</span>
                            </span>
                            <span className="font-semibold text-white font-mono">
                              {m ? `${m.cpu_usage.toFixed(1)}%` : '—'}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-surface overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(
                                m ? m.cpu_usage : 0
                              )}`}
                              style={{ width: `${Math.min(m ? m.cpu_usage : 0, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* RAM Utilization */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400 flex items-center gap-1">
                              <SymbolIcon name="memorychip" className="w-3.5 h-3.5 text-slate-500" />
                              <span>Memory</span>
                            </span>
                            <span className="font-semibold text-white font-mono text-[11px]">
                              {m && m.ram_total > 0
                                ? `${formatBytes(m.ram_used)} / ${formatBytes(m.ram_total)} (${m.ram_percent.toFixed(0)}%)`
                                : '—'}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-surface overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(
                                m ? m.ram_percent : 0
                              )}`}
                              style={{ width: `${Math.min(m ? m.ram_percent : 0, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Primary Disk Utilization */}
                        <div>
                          <div className="flex justify-between text-xs mb-1">
                            <span className="text-slate-400 flex items-center gap-1">
                              <SymbolIcon name="internaldrive.fill" className="w-3.5 h-3.5 text-slate-500" />
                              <span>Primary Storage</span>
                            </span>
                            <span className="font-semibold text-white font-mono text-[11px]">
                              {m ? `${m.disk_percent.toFixed(0)}%` : '—'}
                            </span>
                          </div>
                          <div className="w-full h-2 rounded-full bg-surface overflow-hidden">
                            <div
                              className={`h-full rounded-full transition-all duration-500 ${getProgressColor(
                                m ? m.disk_percent : 0
                              )}`}
                              style={{ width: `${Math.min(m ? m.disk_percent : 0, 100)}%` }}
                            />
                          </div>
                        </div>

                        {/* Network Throughput & Temp Stats */}
                        <div className="pt-2 border-t border-surface-border/60 flex items-center justify-between text-[11px] text-slate-400 font-mono">
                          <div className="flex items-center gap-1.5">
                            <SymbolIcon name="network" className="w-3.5 h-3.5 text-slate-500" />
                            <span>
                              ↓ {m ? formatNetRate(m.net_rx_bytes_sec) : '0 B/s'}
                            </span>
                            <span className="text-slate-600">|</span>
                            <span>
                              ↑ {m ? formatNetRate(m.net_tx_bytes_sec) : '0 B/s'}
                            </span>
                          </div>

                          {m && m.cpu_temp !== null && m.cpu_temp !== undefined && (
                            <div className="flex items-center gap-1 text-slate-300">
                              <SymbolIcon name="thermometer.medium" className="w-3.5 h-3.5 text-amber-400" />
                              <span>{m.cpu_temp.toFixed(0)}°C</span>
                            </div>
                          )}
                        </div>

                      </div>
                    )}
                  </div>

                  {/* Card Footer: OS Specs, Uptime, Quick Connect */}
                  <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between text-xs">
                    <div className="text-[11px] text-slate-500 truncate max-w-[170px]" title={dev.system_info?.platform_version || dev.system_info?.os || dev.host}>
                      {dev.system_info?.platform_version || dev.system_info?.os
                        ? `${dev.system_info.platform_version || dev.system_info.os}`
                        : m && m.uptime > 0
                        ? `Up: ${formatUptime(m.uptime)}`
                        : `Host: ${dev.host}`}
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/session/${dev.device_id}`);
                        }}
                        className="px-2.5 py-1 rounded-lg bg-surface-active hover:bg-brand-600 hover:text-white text-slate-300 text-[11px] font-medium border border-surface-border transition-colors flex items-center gap-1"
                        title="Open remote session"
                      >
                        <SymbolIcon name="play.fill" className="w-2.5 h-2.5" />
                        <span>Connect</span>
                      </button>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/monitoring/${dev.device_id}`);
                        }}
                        className="p-1 rounded-lg hover:bg-surface-hover text-slate-400 hover:text-white transition-colors"
                        title="View detailed metrics and charts"
                      >
                        <SymbolIcon name="chevron.right" className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </main>
    </div>
  );
};
