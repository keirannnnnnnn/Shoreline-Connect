import React, { useState, useEffect, useCallback } from 'react';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { api } from '../lib/api.js';
import { UpdatesOverview, SoftwareGroup, UpdateJob, UpdateAuditLog, SoftwareInventoryHistoryItem } from '../types/index.js';
export const Updates: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'inventory' | 'jobs' | 'audit'>('inventory');

  // Overview KPIs
  const [overview, setOverview] = useState<UpdatesOverview | null>(null);

  // Software Inventory
  const [inventory, setInventory] = useState<SoftwareGroup[]>([]);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [loadingInventory, setLoadingInventory] = useState<boolean>(true);
  const [expandedApp, setExpandedApp] = useState<string | null>(null);

  // Device Detail / History Modal
  const [selectedDeviceModal, setSelectedDeviceModal] = useState<{
    deviceId: string;
    deviceName: string;
    items: any[];
    history: SoftwareInventoryHistoryItem[];
  } | null>(null);

  // Jobs
  const [jobs, setJobs] = useState<UpdateJob[]>([]);
  const [loadingJobs, setLoadingJobs] = useState<boolean>(false);
  const [selectedJobLog, setSelectedJobLog] = useState<UpdateJob | null>(null);

  // Audit Logs
  const [auditLogs, setAuditLogs] = useState<UpdateAuditLog[]>([]);
  const [loadingAudit, setLoadingAudit] = useState<boolean>(false);

  // Status message
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Load Overview KPIs
  const loadOverview = useCallback(async () => {
    try {
      const res = await api.updates.getOverview();
      setOverview(res);
    } catch (err) {
      console.error('Failed to load overview', err);
    }
  }, []);

  // Load Inventory
  const loadInventory = useCallback(async (search?: string) => {
    setLoadingInventory(true);
    try {
      const res = await api.updates.getFleetInventory(search);
      setInventory(res.inventory);
    } catch (err) {
      console.error('Failed to load inventory', err);
    } finally {
      setLoadingInventory(false);
    }
  }, []);

  // Load Jobs
  const loadJobs = useCallback(async () => {
    setLoadingJobs(true);
    try {
      const res = await api.updates.getJobs(100);
      setJobs(res.jobs);
    } catch (err) {
      console.error('Failed to load jobs', err);
    } finally {
      setLoadingJobs(false);
    }
  }, []);

  // Load Audit
  const loadAudit = useCallback(async () => {
    setLoadingAudit(true);
    try {
      const res = await api.updates.getAuditLogs(200);
      setAuditLogs(res.logs);
    } catch (err) {
      console.error('Failed to load audit logs', err);
    } finally {
      setLoadingAudit(false);
    }
  }, []);

  useEffect(() => {
    loadOverview();
    if (activeTab === 'inventory') {
      loadInventory(searchQuery);
    } else if (activeTab === 'jobs') {
      loadJobs();
    } else if (activeTab === 'audit') {
      loadAudit();
    }
  }, [activeTab, loadOverview, loadInventory, loadJobs, loadAudit, searchQuery]);

  // Open Device Inventory Detail Modal
  const handleOpenDeviceDetail = async (deviceId: string) => {
    try {
      const res = await api.updates.getDeviceInventory(deviceId);
      setSelectedDeviceModal({
        deviceId,
        deviceName: res.deviceName,
        items: res.items,
        history: res.history,
      });
    } catch (err: any) {
      alert(`Failed to load device inventory: ${err.message}`);
    }
  };

  // Trigger On-Demand Rescan
  const handleTriggerRescan = async (deviceId: string, deviceName: string) => {
    try {
      const res = await api.updates.rescanDevice(deviceId);
      setStatusMessage(`Rescan queued for ${deviceName} (Job ID: ${res.jobId})`);
      setTimeout(() => setStatusMessage(null), 4000);
      loadOverview();
      if (activeTab === 'jobs') loadJobs();
    } catch (err: any) {
      alert(`Failed to queue rescan: ${err.message}`);
    }
  };

  // Cancel Job
  const handleCancelJob = async (jobId: string) => {
    if (!window.confirm('Are you sure you want to cancel this queued job?')) return;
    try {
      await api.updates.cancelJob(jobId);
      loadJobs();
      loadOverview();
    } catch (err: any) {
      alert(`Failed to cancel job: ${err.message}`);
    }
  };

  // Status Badge Helper
  const getJobStatusBadge = (status: string) => {
    switch (status) {
      case 'queued':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">Queued</span>;
      case 'sent':
      case 'downloading':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20">Dispatched</span>;
      case 'running':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 animate-pulse">Running</span>;
      case 'succeeded':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">Succeeded</span>;
      case 'failed':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-500/10 text-red-400 border border-red-500/20">Failed</span>;
      case 'timed_out':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-purple-500/10 text-purple-400 border border-purple-500/20">Timed Out</span>;
      case 'cancelled':
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20">Cancelled</span>;
      default:
        return <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-800 text-slate-300">{status}</span>;
    }
  };

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Status Toast */}
        {statusMessage && (
          <div className="p-3.5 rounded-2xl bg-cyan-950/80 border border-cyan-500/40 text-cyan-300 text-xs font-semibold flex items-center justify-between shadow-lg backdrop-blur-md">
            <div className="flex items-center gap-2">
              <SymbolIcon name="checkmark.circle.fill" className="w-4 h-4 text-cyan-400" />
              <span>{statusMessage}</span>
            </div>
            <button onClick={() => setStatusMessage(null)} className="text-slate-400 hover:text-white">
              <SymbolIcon name="xmark" className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-glow shadow-cyan-500/10">
              <SymbolIcon name="arrow.clockwise" className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Updates & Software Management</h1>
              <p className="text-xs text-slate-400 mt-0.5">Agent-driven software discovery, package inventory, and update dispatch</p>
            </div>
          </div>
        </div>

        {/* Top Overview KPI Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-4 rounded-2xl bg-surface-card border border-surface-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Updates Needed</span>
              <SymbolIcon name="arrow.trianglehead.clockwise" className="w-4 h-4 text-cyan-400" />
            </div>
            <div className="text-2xl font-bold text-white">{overview?.devicesWithUpdates || 0}</div>
            <p className="text-[11px] text-slate-500">Devices with available updates</p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-card border border-surface-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Failed Jobs (7d)</span>
              <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 text-red-400" />
            </div>
            <div className={`text-2xl font-bold ${(overview?.failedJobsLast7Days || 0) > 0 ? 'text-red-400' : 'text-white'}`}>
              {overview?.failedJobsLast7Days || 0}
            </div>
            <p className="text-[11px] text-slate-500">Unsuccessful update tasks</p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-card border border-surface-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Pending Reboot</span>
              <SymbolIcon name="arrow.clockwise.circle.fill" className="w-4 h-4 text-amber-400" />
            </div>
            <div className="text-2xl font-bold text-white">{overview?.devicesPendingReboot || 0}</div>
            <p className="text-[11px] text-slate-500">Devices awaiting restart</p>
          </div>

          <div className="p-4 rounded-2xl bg-surface-card border border-surface-border space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Software Tracked</span>
              <SymbolIcon name="square.grid.2x2.fill" className="w-4 h-4 text-blue-400" />
            </div>
            <div className="text-2xl font-bold text-white">{overview?.totalTrackedSoftware || 0}</div>
            <p className="text-[11px] text-slate-500">Total discovered installs</p>
          </div>
        </div>

        {/* Sub-View Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-surface-border pb-3">
          <button
            onClick={() => setActiveTab('inventory')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'inventory'
                ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
            }`}
          >
            <SymbolIcon name="square.stack.3d.up.fill" className="w-4 h-4 text-cyan-400" />
            <span>Software Inventory</span>
          </button>

          <button
            onClick={() => setActiveTab('jobs')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'jobs'
                ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
            }`}
          >
            <SymbolIcon name="list.bullet.rectangle" className="w-4 h-4 text-blue-400" />
            <span>Jobs Queue</span>
          </button>

          <button
            onClick={() => setActiveTab('audit')}
            className={`px-4 py-2 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all ${
              activeTab === 'audit'
                ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
            }`}
          >
            <SymbolIcon name="doc.text.magnifyingglass" className="w-4 h-4 text-purple-400" />
            <span>Audit Trail</span>
          </button>
        </div>

        {/* SUB-VIEW: SOFTWARE INVENTORY */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            {/* Search Bar */}
            <div className="flex items-center justify-between gap-4">
              <div className="relative flex-1 max-w-md">
                <SymbolIcon name="magnifyingglass" className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  placeholder="Search fleet software, publishers, or versions..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-4 py-2 rounded-xl bg-surface border border-surface-border text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 placeholder:text-slate-500"
                />
              </div>

              <button
                onClick={() => loadInventory(searchQuery)}
                className="px-3.5 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-300 flex items-center gap-1.5 transition-all"
              >
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 text-cyan-400" />
                <span>Refresh</span>
              </button>
            </div>

            {loadingInventory ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
                <p className="text-xs">Gathering fleet software inventory...</p>
              </div>
            ) : inventory.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-surface-card border border-surface-border space-y-3">
                <SymbolIcon name="square.grid.2x2" className="w-10 h-10 text-slate-500 mx-auto" />
                <h3 className="text-sm font-bold text-white">No software discovered yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Agents will discover installed software upon startup and during their scheduled scan.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-border bg-surface/60 text-slate-400">
                      <th className="text-left px-4 py-3 font-semibold">Application</th>
                      <th className="text-left px-4 py-3 font-semibold">Publisher</th>
                      <th className="text-left px-4 py-3 font-semibold">Installed Versions & Drift</th>
                      <th className="text-left px-4 py-3 font-semibold">Devices</th>
                      <th className="text-right px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {inventory.map((group) => {
                      const groupKey = `${group.name}___${group.publisher || ''}`;
                      const isExpanded = expandedApp === groupKey;
                      const uniqueVersions = Array.from(new Set(group.installs.map((i) => i.version).filter(Boolean)));
                      const hasVersionDrift = uniqueVersions.length > 1;

                      return (
                        <React.Fragment key={groupKey}>
                          <tr
                            onClick={() => setExpandedApp(isExpanded ? null : groupKey)}
                            className="border-b border-surface-border/40 hover:bg-surface-hover/60 transition-colors cursor-pointer"
                          >
                            <td className="px-4 py-3 font-bold text-white flex items-center gap-2">
                              <SymbolIcon
                                name={isExpanded ? 'chevron.down' : 'chevron.right'}
                                className="w-3.5 h-3.5 text-slate-400"
                              />
                              <span>{group.name}</span>
                            </td>
                            <td className="px-4 py-3 text-slate-400">{group.publisher || '—'}</td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                {uniqueVersions.map((v) => (
                                  <span
                                    key={v}
                                    className="px-2 py-0.5 rounded text-[11px] font-mono bg-surface border border-surface-border text-slate-200"
                                  >
                                    v{v}
                                  </span>
                                ))}
                                {hasVersionDrift && (
                                  <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                                    Version Drift
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="px-4 py-3 font-semibold text-cyan-300">
                              {group.installs.length} {group.installs.length === 1 ? 'device' : 'devices'}
                            </td>
                            <td className="px-4 py-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setExpandedApp(isExpanded ? null : groupKey);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300"
                              >
                                {isExpanded ? 'Hide' : 'Details'}
                              </button>
                            </td>
                          </tr>

                          {/* Expanded Installed Device Rows */}
                          {isExpanded && (
                            <tr className="bg-black/30 border-b border-surface-border">
                              <td colSpan={5} className="p-4 space-y-2">
                                <div className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
                                  Installed on {group.installs.length} devices:
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-2.5">
                                  {group.installs.map((inst) => (
                                    <div
                                      key={inst.id}
                                      className="p-3 rounded-xl bg-surface border border-surface-border flex items-center justify-between gap-2"
                                    >
                                      <div className="space-y-0.5 min-w-0">
                                        <div
                                          onClick={() => handleOpenDeviceDetail(inst.deviceId)}
                                          className="text-xs font-bold text-white hover:text-cyan-300 cursor-pointer truncate flex items-center gap-1.5"
                                        >
                                          <SymbolIcon name="server.rack" className="w-3.5 h-3.5 text-cyan-400 flex-shrink-0" />
                                          <span className="truncate">{inst.deviceName}</span>
                                        </div>
                                        <div className="text-[11px] text-slate-400 flex items-center gap-2">
                                          <span>v{inst.version || 'unknown'}</span>
                                          <span className="text-slate-600">•</span>
                                          <span className="uppercase text-[10px] font-mono">{inst.source}</span>
                                          {inst.isPerUser && (
                                            <span className="text-[10px] text-amber-400">(Per-User)</span>
                                          )}
                                        </div>
                                      </div>

                                      <button
                                        onClick={() => handleTriggerRescan(inst.deviceId, inst.deviceName)}
                                        title="Trigger on-demand rescan"
                                        className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-cyan-400"
                                      >
                                        <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5" />
                                      </button>
                                    </div>
                                  ))}
                                </div>
                              </td>
                            </tr>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-VIEW: JOBS QUEUE */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Recent Update & Scan Jobs</h2>
              <button
                onClick={() => loadJobs()}
                className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-300 flex items-center gap-1.5"
              >
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 text-cyan-400" />
                <span>Refresh Jobs</span>
              </button>
            </div>

            {loadingJobs ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
                <p className="text-xs">Loading jobs...</p>
              </div>
            ) : jobs.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-surface-card border border-surface-border space-y-3">
                <SymbolIcon name="list.bullet.rectangle" className="w-10 h-10 text-slate-500 mx-auto" />
                <h3 className="text-sm font-bold text-white">No jobs recorded yet</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Tasks triggered from this tab or scheduled by agents will appear here.
                </p>
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-border bg-surface/60 text-slate-400">
                      <th className="text-left px-4 py-3 font-semibold">Device</th>
                      <th className="text-left px-4 py-3 font-semibold">Job Type</th>
                      <th className="text-left px-4 py-3 font-semibold">Status</th>
                      <th className="text-left px-4 py-3 font-semibold">Created By</th>
                      <th className="text-left px-4 py-3 font-semibold">Created</th>
                      <th className="text-right px-4 py-3 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {jobs.map((job) => (
                      <tr key={job.id} className="border-b border-surface-border/40 hover:bg-surface-hover/60 transition-colors">
                        <td className="px-4 py-3 font-semibold text-white">{job.device_name || job.device_id}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-cyan-300 font-semibold">{job.job_type}</span>
                        </td>
                        <td className="px-4 py-3">{getJobStatusBadge(job.status)}</td>
                        <td className="px-4 py-3 text-slate-400">{job.created_by_username || 'System'}</td>
                        <td className="px-4 py-3 text-slate-400">{new Date(job.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-2">
                            {(job.stdout || job.stderr || job.status === 'failed' || job.status === 'succeeded') && (
                              <button
                                onClick={() => setSelectedJobLog(job)}
                                className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300"
                              >
                                View Logs
                              </button>
                            )}
                            {job.status === 'queued' && (
                              <button
                                onClick={() => handleCancelJob(job.id)}
                                className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-400 border border-red-500/20"
                              >
                                Cancel
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* SUB-VIEW: AUDIT TRAIL */}
        {activeTab === 'audit' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white">Immutable Software Management Audit Trail</h2>
              <button
                onClick={() => loadAudit()}
                className="px-3 py-1.5 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-300 flex items-center gap-1.5"
              >
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 text-cyan-400" />
                <span>Refresh Logs</span>
              </button>
            </div>

            {loadingAudit ? (
              <div className="py-20 text-center text-slate-400 space-y-3">
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-cyan-400 mx-auto" />
                <p className="text-xs">Loading audit logs...</p>
              </div>
            ) : auditLogs.length === 0 ? (
              <div className="p-12 text-center rounded-3xl bg-surface-card border border-surface-border space-y-3">
                <SymbolIcon name="doc.text.magnifyingglass" className="w-10 h-10 text-slate-500 mx-auto" />
                <h3 className="text-sm font-bold text-white">No audit records yet</h3>
              </div>
            ) : (
              <div className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-surface-border bg-surface/60 text-slate-400">
                      <th className="text-left px-4 py-3 font-semibold">Timestamp</th>
                      <th className="text-left px-4 py-3 font-semibold">User</th>
                      <th className="text-left px-4 py-3 font-semibold">Action</th>
                      <th className="text-left px-4 py-3 font-semibold">Target Device</th>
                      <th className="text-left px-4 py-3 font-semibold">Details</th>
                    </tr>
                  </thead>
                  <tbody>
                    {auditLogs.map((log) => (
                      <tr key={log.id} className="border-b border-surface-border/40 hover:bg-surface-hover/60 transition-colors">
                        <td className="px-4 py-3 text-slate-400">{new Date(log.created_at).toLocaleString()}</td>
                        <td className="px-4 py-3 font-semibold text-white">{log.username}</td>
                        <td className="px-4 py-3">
                          <span className="font-mono text-cyan-400">{log.action}</span>
                        </td>
                        <td className="px-4 py-3 text-slate-300">{log.device_name || log.device_id || '—'}</td>
                        <td className="px-4 py-3 font-mono text-[11px] text-slate-400 truncate max-w-xs">
                          {log.details_json || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>

      {/* JOB LOG MODAL */}
      {selectedJobLog && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-2">
                  <SymbolIcon name="doc.text.magnifyingglass" className="w-4 h-4 text-cyan-400" />
                  <span>Job Output & Execution Details</span>
                </h3>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Job ID: {selectedJobLog.id} • Device: {selectedJobLog.device_name || selectedJobLog.device_id}
                </p>
              </div>
              <button
                onClick={() => setSelectedJobLog(null)}
                className="p-1 rounded-lg bg-surface text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex items-center gap-3 text-xs">
              <div>Status: {getJobStatusBadge(selectedJobLog.status)}</div>
              {selectedJobLog.exit_code !== undefined && selectedJobLog.exit_code !== null && (
                <div className="text-slate-300">
                  Exit Code: <span className="font-mono font-bold text-white">{selectedJobLog.exit_code}</span>
                </div>
              )}
              {selectedJobLog.reboot_required === 1 && (
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-500/15 text-amber-300 border border-amber-500/30">
                  Reboot Pending
                </span>
              )}
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs">
              {selectedJobLog.stdout && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Standard Output</span>
                  <pre className="p-3.5 rounded-xl bg-slate-950 border border-surface-border text-slate-200 whitespace-pre-wrap leading-relaxed select-text">
                    {selectedJobLog.stdout}
                  </pre>
                </div>
              )}

              {selectedJobLog.stderr && (
                <div className="space-y-1">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-red-400">Standard Error</span>
                  <pre className="p-3.5 rounded-xl bg-red-950/20 border border-red-500/30 text-red-200 whitespace-pre-wrap leading-relaxed select-text">
                    {selectedJobLog.stderr}
                  </pre>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedJobLog(null)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {/* DEVICE INVENTORY & HISTORY MODAL */}
      {selectedDeviceModal && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-4xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[88vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center">
                  <SymbolIcon name="server.rack" className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">{selectedDeviceModal.deviceName}</h3>
                  <p className="text-[11px] text-slate-400">Discovered Software & Installation History</p>
                </div>
              </div>
              <button
                onClick={() => setSelectedDeviceModal(null)}
                className="p-1 rounded-lg bg-surface text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-6">
              {/* Installed Software Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Currently Installed ({selectedDeviceModal.items.length})
                  </h4>
                  <button
                    onClick={() => handleTriggerRescan(selectedDeviceModal.deviceId, selectedDeviceModal.deviceName)}
                    className="px-2.5 py-1 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-[11px] font-bold flex items-center gap-1"
                  >
                    <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3 h-3" />
                    <span>Rescan Now</span>
                  </button>
                </div>

                <div className="rounded-xl border border-surface-border overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-surface text-slate-400 border-b border-surface-border">
                        <th className="text-left px-3.5 py-2 font-semibold">Name</th>
                        <th className="text-left px-3.5 py-2 font-semibold">Version</th>
                        <th className="text-left px-3.5 py-2 font-semibold">Publisher</th>
                        <th className="text-left px-3.5 py-2 font-semibold">Source</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedDeviceModal.items.map((item) => (
                        <tr key={item.id} className="border-b border-surface-border/40 hover:bg-surface-hover/40">
                          <td className="px-3.5 py-2 font-semibold text-white truncate max-w-xs">{item.name}</td>
                          <td className="px-3.5 py-2 font-mono text-cyan-300">{item.version || '—'}</td>
                          <td className="px-3.5 py-2 text-slate-400">{item.publisher || '—'}</td>
                          <td className="px-3.5 py-2 font-mono uppercase text-[10px] text-slate-400">{item.source}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Version History Diffs */}
              {selectedDeviceModal.history.length > 0 && (
                <div className="space-y-2">
                  <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Software Change History ({selectedDeviceModal.history.length})
                  </h4>
                  <div className="space-y-1.5">
                    {selectedDeviceModal.history.map((hist) => (
                      <div
                        key={hist.id}
                        className="p-2.5 rounded-xl bg-surface border border-surface-border flex items-center justify-between text-xs"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                              hist.change_type === 'added'
                                ? 'bg-emerald-500/15 text-emerald-400'
                                : hist.change_type === 'removed'
                                ? 'bg-red-500/15 text-red-400'
                                : 'bg-cyan-500/15 text-cyan-400'
                            }`}
                          >
                            {hist.change_type}
                          </span>
                          <span className="font-semibold text-white">{hist.name}</span>
                          {hist.change_type === 'modified' && (
                            <span className="text-slate-400">
                              (v{hist.old_version || 'old'} &rarr; <span className="text-cyan-300">v{hist.new_version}</span>)
                            </span>
                          )}
                          {hist.change_type === 'added' && hist.new_version && (
                            <span className="text-emerald-300">(v{hist.new_version})</span>
                          )}
                        </div>
                        <span className="text-[11px] text-slate-500">{new Date(hist.changed_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <div className="flex justify-end pt-2">
              <button
                onClick={() => setSelectedDeviceModal(null)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
