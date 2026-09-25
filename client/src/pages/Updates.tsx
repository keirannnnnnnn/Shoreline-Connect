import React, { useState, useEffect } from 'react';
import { api } from '../lib/api.js';
import { useAuth } from '../context/AuthContext.js';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import {
  UpdatesOverview,
  SoftwareGroup,
  UpdateJob,
  UpdateAuditLog,
  AgentItem,
  AgentBuildItem,
  ScriptItem,
  ScriptParameterDef,
} from '../types/index.js';

export const Updates: React.FC = () => {
  const { user } = useAuth();
  const isAdmin = user?.permissions?.tabs?.updates?.isAdmin || user?.role === 'admin';

  const [activeTab, setActiveTab] = useState<'overview' | 'inventory' | 'scripts' | 'agents' | 'jobs' | 'audit'>('overview');

  // Data States
  const [overview, setOverview] = useState<UpdatesOverview | null>(null);
  const [inventory, setInventory] = useState<SoftwareGroup[]>([]);
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentBuilds, setAgentBuilds] = useState<AgentBuildItem[]>([]);
  const [scripts, setScripts] = useState<ScriptItem[]>([]);
  const [jobs, setJobs] = useState<UpdateJob[]>([]);
  const [auditLogs, setAuditLogs] = useState<UpdateAuditLog[]>([]);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState('');
  const [scriptSearch, setScriptSearch] = useState('');
  const [jobStatusFilter, setJobStatusFilter] = useState('all');

  // Accordion for compact Software Inventory
  const [expandedSoftwareKey, setExpandedSoftwareKey] = useState<string | null>(null);

  // Drawers & Modals
  const [selectedJobLogs, setSelectedJobLogs] = useState<UpdateJob | null>(null);

  // Script Modal
  const [isScriptModalOpen, setIsScriptModalOpen] = useState(false);
  const [editingScript, setEditingScript] = useState<ScriptItem | null>(null);
  const [scriptForm, setScriptForm] = useState({
    name: '',
    description: '',
    target_os: 'all' as 'windows' | 'linux' | 'all',
    script_type: 'powershell' as 'powershell' | 'batch' | 'bash',
    timeout_seconds: 600,
    script_content: '',
    parameters: [] as ScriptParameterDef[],
    notes: '',
  });

  // Run Script Modal
  const [runningScript, setRunningScript] = useState<ScriptItem | null>(null);
  const [targetDeviceIds, setTargetDeviceIds] = useState<string[]>([]);
  const [runtimeParams, setRuntimeParams] = useState<Record<string, string>>({});
  const [scriptExpiryOption, setScriptExpiryOption] = useState<string>('none');

  // Agent Modals & Version State
  const [latestServerVersion, setLatestServerVersion] = useState<string>('1.1.0');
  const [showAdvancedBuilds, setShowAdvancedBuilds] = useState<boolean>(false);
  const [isUploadAgentModalOpen, setIsUploadAgentModalOpen] = useState(false);
  const [isBuildsDrawerOpen, setIsBuildsDrawerOpen] = useState(false);
  const [agentUploadForm, setAgentUploadForm] = useState({
    version: '1.1.0',
    target_os: 'windows' as 'windows' | 'linux',
    target_arch: 'amd64' as 'amd64' | 'arm64',
    notes: '',
  });
  const [agentUploadFile, setAgentUploadFile] = useState<File | null>(null);
  const [selectedAgentIds, setSelectedAgentIds] = useState<string[]>([]);
  const [bulkTargetBuildId, setBulkTargetBuildId] = useState<string>('');

  // Selected Jobs for Bulk Action
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);

  // Action status message
  const [actionMessage, setActionMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const showMsg = (text: string, type: 'success' | 'error' = 'success') => {
    setActionMessage({ text, type });
    setTimeout(() => setActionMessage(null), 5000);
  };

  const loadData = async () => {
    try {
      const [ov, inv, agsRes, blds, scrs, jbs, aud] = await Promise.all([
        api.updates.getOverview().catch(() => null),
        api.updates.getFleetInventory(searchQuery).catch(() => []),
        api.updates.getAgents().catch(() => ({ latestVersion: '1.1.0', agents: [] })),
        api.updates.getAgentBuilds().catch(() => []),
        api.updates.getScripts().catch(() => []),
        api.updates.getJobs(100).catch(() => []),
        api.updates.getAuditLogs(200).catch(() => []),
      ]);
      setOverview(ov);
      setInventory(inv);
      if (agsRes && 'agents' in agsRes) {
        setAgents(agsRes.agents);
        if (agsRes.latestVersion) setLatestServerVersion(agsRes.latestVersion);
      } else if (Array.isArray(agsRes)) {
        setAgents(agsRes);
      }
      setAgentBuilds(blds);
      setScripts(scrs);
      setJobs(jbs);
      setAuditLogs(aud);
    } catch (err: any) {
      console.error('Failed to load updates data:', err);
    }
  };

  useEffect(() => {
    loadData();
    const interval = setInterval(() => {
      api.updates.getJobs(100).then(setJobs).catch(() => {});
      api.updates.getAgents().then((res) => {
        if (res && 'agents' in res) {
          setAgents(res.agents);
          if (res.latestVersion) setLatestServerVersion(res.latestVersion);
        } else if (Array.isArray(res)) {
          setAgents(res);
        }
      }).catch(() => {});
      api.updates.getOverview().then(setOverview).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleUpdateAllOutdated = async () => {
    try {
      const res = await api.updates.updateAllOutdatedAgents();
      if (res.queuedCount === 0) {
        showMsg('All agents are already up to date.');
      } else {
        showMsg(`Queued updates for ${res.queuedCount} outdated agents.`);
      }
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleRescanDevice = async (deviceId: string) => {
    try {
      await api.updates.rescanDevice(deviceId);
      showMsg('Rescan job queued for device.');
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleRescanAll = async () => {
    try {
      const res = await api.updates.rescanAll();
      showMsg(`Queued inventory rescans across ${res.queuedCount} monitored devices.`);
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleCancelJob = async (jobId: string) => {
    try {
      await api.updates.cancelJob(jobId);
      showMsg('Job cancelled.');
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleBulkCancelJobs = async () => {
    if (selectedJobIds.length === 0) return;
    try {
      const res = await api.updates.cancelJobsBulk(selectedJobIds);
      showMsg(`Cancelled ${res.cancelledCount} jobs.`);
      setSelectedJobIds([]);
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleSingleAgentUpdate = async (deviceId: string, buildId?: string | null) => {
    try {
      await api.updates.updateAgent(deviceId, buildId);
      showMsg('Agent self-update job dispatched to device.');
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleBulkAgentUpdate = async () => {
    if (selectedAgentIds.length === 0) {
      showMsg('Please select at least one device', 'error');
      return;
    }
    try {
      const res = await api.updates.updateAgentFleet(selectedAgentIds, bulkTargetBuildId || null);
      showMsg(`Agent update queued for ${res.queuedCount} devices.`);
      setSelectedAgentIds([]);
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleUploadAgentBuild = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!agentUploadFile) {
      showMsg('Please select a binary file', 'error');
      return;
    }
    try {
      const fd = new FormData();
      fd.append('version', agentUploadForm.version);
      fd.append('target_os', agentUploadForm.target_os);
      fd.append('target_arch', agentUploadForm.target_arch);
      fd.append('notes', agentUploadForm.notes);
      fd.append('binary', agentUploadFile);

      await api.updates.uploadAgentBuild(fd);
      showMsg('Agent build uploaded successfully.');
      setIsUploadAgentModalOpen(false);
      setAgentUploadFile(null);
      api.updates.getAgentBuilds().then(setAgentBuilds);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleSetDefaultBuild = async (buildId: string) => {
    try {
      await api.updates.setDefaultAgentBuild(buildId);
      showMsg('Promoted agent build to install default.');
      api.updates.getAgentBuilds().then(setAgentBuilds);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleDeleteBuild = async (buildId: string) => {
    if (!confirm('Are you sure you want to delete this agent build?')) return;
    try {
      await api.updates.deleteAgentBuild(buildId);
      showMsg('Agent build deleted.');
      api.updates.getAgentBuilds().then(setAgentBuilds);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleOpenScriptModal = (scr?: ScriptItem) => {
    if (scr) {
      setEditingScript(scr);
      let parsedParams: ScriptParameterDef[] = [];
      if (scr.parameters_schema_json) {
        try { parsedParams = JSON.parse(scr.parameters_schema_json); } catch {}
      }
      setScriptForm({
        name: scr.name,
        description: scr.description || '',
        target_os: scr.target_os,
        script_type: scr.script_type,
        timeout_seconds: scr.timeout_seconds || 600,
        script_content: scr.script_content || '',
        parameters: parsedParams,
        notes: '',
      });
    } else {
      setEditingScript(null);
      setScriptForm({
        name: '',
        description: '',
        target_os: 'all',
        script_type: 'powershell',
        timeout_seconds: 600,
        script_content: '',
        parameters: [],
        notes: 'Initial version',
      });
    }
    setIsScriptModalOpen(true);
  };

  const handleSaveScript = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const payload = {
        name: scriptForm.name,
        description: scriptForm.description,
        targetOs: scriptForm.target_os,
        scriptType: scriptForm.script_type,
        timeoutSeconds: scriptForm.timeout_seconds,
        parametersSchemaJson: scriptForm.parameters,
        scriptContent: scriptForm.script_content,
        notes: scriptForm.notes,
      };

      if (editingScript) {
        await api.updates.updateScript(editingScript.id, payload);
        showMsg('Script updated with new version.');
      } else {
        await api.updates.createScript(payload);
        showMsg('New script created in library.');
      }
      setIsScriptModalOpen(false);
      api.updates.getScripts().then(setScripts);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleDeleteScript = async (scriptId: string) => {
    if (!confirm('Are you sure you want to delete this script?')) return;
    try {
      await api.updates.deleteScript(scriptId);
      showMsg('Script removed from library.');
      api.updates.getScripts().then(setScripts);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const handleOpenRunScriptModal = (scr: ScriptItem) => {
    setRunningScript(scr);
    let parsedParams: ScriptParameterDef[] = [];
    if (scr.parameters_schema_json) {
      try { parsedParams = JSON.parse(scr.parameters_schema_json); } catch {}
    }
    const initialParams: Record<string, string> = {};
    for (const p of parsedParams) {
      initialParams[p.name] = p.defaultValue || '';
    }
    setRuntimeParams(initialParams);

    const compatibleDevs = agents
      .filter((a) => (scr.target_os === 'all' || a.os === scr.target_os) && a.status === 'online')
      .map((a) => a.deviceId);
    setTargetDeviceIds(compatibleDevs);
  };

  const handleExecuteScript = async () => {
    if (!runningScript) return;
    if (targetDeviceIds.length === 0) {
      showMsg('Please select at least one target device', 'error');
      return;
    }

    let expiresAt: string | null = null;
    if (scriptExpiryOption === '1h') {
      expiresAt = new Date(Date.now() + 3600000).toISOString();
    } else if (scriptExpiryOption === '24h') {
      expiresAt = new Date(Date.now() + 86400000).toISOString();
    } else if (scriptExpiryOption === '7d') {
      expiresAt = new Date(Date.now() + 7 * 86400000).toISOString();
    }

    try {
      const res = await api.updates.deployScript({
        scriptId: runningScript.id,
        deviceIds: targetDeviceIds,
        parameters: runtimeParams,
        expiresAt,
      });
      showMsg(`Script dispatched to ${res.queuedCount} devices.`);
      setRunningScript(null);
      setActiveTab('jobs');
      api.updates.getJobs().then(setJobs);
    } catch (err: any) {
      showMsg(err.message, 'error');
    }
  };

  const filteredInventory = inventory.filter((group) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      group.name.toLowerCase().includes(q) ||
      (group.publisher && group.publisher.toLowerCase().includes(q)) ||
      group.installs.some((inst) => inst.deviceName.toLowerCase().includes(q) || inst.version?.toLowerCase().includes(q))
    );
  });

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col font-sans selection:bg-brand-500/30 selection:text-brand-200">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        {/* Toast alert message */}
        {actionMessage && (
          <div
            className={`p-3.5 rounded-2xl flex items-center justify-between shadow-lg backdrop-blur-md border text-xs ${
              actionMessage.type === 'success'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
                : 'bg-red-500/10 border-red-500/30 text-red-300'
            }`}
          >
            <div className="flex items-center gap-2.5">
              <SymbolIcon
                name={actionMessage.type === 'success' ? 'checkmark.circle.fill' : 'exclamationmark.triangle.fill'}
                className="w-4 h-4"
              />
              <span className="font-medium">{actionMessage.text}</span>
            </div>
            <button onClick={() => setActionMessage(null)} className="opacity-60 hover:opacity-100 text-xs">
              Dismiss
            </button>
          </div>
        )}

        {/* Page Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white flex items-center gap-2.5">
              <SymbolIcon name="arrow.clockwise" className="w-6 h-6 text-brand-400" />
              <span>Updates & Software</span>
            </h1>
            <p className="text-xs sm:text-sm text-slate-400 mt-0.5">
              Fleet software discovery, agent updates, and remote script automation.
            </p>
          </div>
        </div>

        {/* Unified Sub-Tabs Bar */}
        <div className="flex items-center gap-1.5 p-1 rounded-2xl bg-surface border border-surface-border overflow-x-auto">
          {[
            { key: 'overview', label: 'Overview', icon: 'square.grid.2x2' },
            { key: 'inventory', label: 'Software Inventory', icon: 'shippingbox.fill', count: inventory.length },
            { key: 'scripts', label: 'Script Library', icon: 'chevron.left.forwardslash.chevron.right', count: scripts.length },
            { key: 'agents', label: 'Agents', icon: 'macbook.and.iphone', count: agents.length },
            {
              key: 'jobs',
              label: 'Jobs Queue',
              icon: 'clock.fill',
              count: jobs.filter((j) => ['queued', 'waiting_for_device', 'running'].includes(j.status)).length || undefined,
            },
            { key: 'audit', label: 'Audit Log', icon: 'shield.fill' },
          ].map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key as any)}
              className={`px-3.5 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-2 transition-all whitespace-nowrap ${
                activeTab === tab.key
                  ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name={tab.icon} className="w-3.5 h-3.5" />
              <span>{tab.label}</span>
              {tab.count !== undefined && tab.count > 0 && (
                <span
                  className={`px-1.5 py-0.5 rounded text-[10px] font-mono ${
                    activeTab === tab.key ? 'bg-brand-500/20 text-brand-300' : 'bg-surface text-slate-400'
                  }`}
                >
                  {tab.count}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* =========================================================================
            TAB 1: OVERVIEW
            ========================================================================= */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* KPI Cards */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              <div className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-5 hover:border-surface-borderLight transition-all">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Tracked Software</span>
                  <SymbolIcon name="shippingbox.fill" className="w-4 h-4 text-brand-400" />
                </div>
                <div className="text-2xl font-bold text-white tracking-tight mt-2">
                  {overview?.totalTrackedSoftware ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Discovered across all devices</div>
              </div>

              <div className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-5 hover:border-surface-borderLight transition-all">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Monitored Agents</span>
                  <SymbolIcon name="waveform.path.ecg" className="w-4 h-4 text-emerald-400" />
                </div>
                <div className="text-2xl font-bold text-white tracking-tight mt-2 flex items-baseline gap-1.5">
                  <span className="text-emerald-400">{overview?.agentsOnline ?? 0}</span>
                  <span className="text-xs font-normal text-slate-500">/ {overview?.totalMonitoredAgents ?? agents.length} online</span>
                </div>
                <div className="text-[11px] text-emerald-400 mt-1">15s reporting interval</div>
              </div>

              <div className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-5 hover:border-surface-borderLight transition-all">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Pending Reboots</span>
                  <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-4 h-4 text-amber-400" />
                </div>
                <div
                  className={`text-2xl font-bold tracking-tight mt-2 ${
                    (overview?.devicesPendingReboot ?? 0) > 0 ? 'text-amber-400' : 'text-white'
                  }`}
                >
                  {overview?.devicesPendingReboot ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Registry / system flags</div>
              </div>

              <div className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-5 hover:border-surface-borderLight transition-all">
                <div className="flex items-center justify-between text-slate-400 text-xs font-medium">
                  <span>Failed Jobs (7d)</span>
                  <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 text-red-400" />
                </div>
                <div
                  className={`text-2xl font-bold tracking-tight mt-2 ${
                    (overview?.failedJobsLast7Days ?? 0) > 0 ? 'text-red-400' : 'text-white'
                  }`}
                >
                  {overview?.failedJobsLast7Days ?? 0}
                </div>
                <div className="text-[11px] text-slate-500 mt-1">Requires review</div>
              </div>
            </div>

            {/* Quick Management Shortcuts */}
            <div className="bg-surface-card border border-surface-border rounded-2xl p-5">
              <h2 className="text-sm font-bold text-white mb-3">Quick Navigation</h2>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <button
                  onClick={() => setActiveTab('inventory')}
                  className="p-3.5 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-left transition flex items-start gap-3 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400 group-hover:scale-105 transition-transform">
                    <SymbolIcon name="shippingbox.fill" className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">Software Inventory</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Explore discovered apps & version distribution</div>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('scripts')}
                  className="p-3.5 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-left transition flex items-start gap-3 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 group-hover:scale-105 transition-transform">
                    <SymbolIcon name="chevron.left.forwardslash.chevron.right" className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">Script Library</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">PowerShell, batch, and bash automation</div>
                  </div>
                </button>

                <button
                  onClick={() => setActiveTab('agents')}
                  className="p-3.5 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-left transition flex items-start gap-3 group"
                >
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 border border-purple-500/20 flex items-center justify-center text-purple-400 group-hover:scale-105 transition-transform">
                    <SymbolIcon name="macbook.and.iphone" className="w-4 h-4" />
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-white">Agent Fleet</div>
                    <div className="text-[11px] text-slate-400 mt-0.5">Push self-updates and manage builds</div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 2: COMPACT SOFTWARE INVENTORY
            ========================================================================= */}
        {activeTab === 'inventory' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
              <div className="relative w-full sm:w-80">
                <SymbolIcon name="magnifyingglass" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search software or publisher..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto justify-between sm:justify-end">
                <div className="text-xs text-slate-400 px-2">
                  <strong className="text-white">{filteredInventory.length}</strong> packages
                </div>
                {isAdmin && (
                  <button
                    onClick={handleRescanAll}
                    className="px-3 py-1.5 bg-brand-500/10 hover:bg-brand-500/20 text-brand-300 border border-brand-500/30 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all"
                  >
                    <SymbolIcon name="arrow.clockwise" className="w-3.5 h-3.5" />
                    <span>Rescan All Fleet</span>
                  </button>
                )}
              </div>
            </div>

            {/* Compact Table */}
            {filteredInventory.length === 0 ? (
              <div className="py-16 text-center rounded-2xl bg-surface-card border border-surface-border border-dashed p-8">
                <SymbolIcon name="shippingbox.fill" className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                <h3 className="text-sm font-bold text-white mb-1">No Software Found</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  {inventory.length === 0
                    ? 'Agents periodically report installed packages. Click "Rescan All Fleet" to initiate discovery.'
                    : 'No software records matched your search.'}
                </p>
              </div>
            ) : (
              <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden shadow-sm">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-surface-border text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-surface-active/50">
                      <th className="p-3.5 pl-4">Application / Package</th>
                      <th className="p-3.5">Publisher</th>
                      <th className="p-3.5">Installed Versions</th>
                      <th className="p-3.5 text-center">Devices</th>
                      <th className="p-3.5 pr-4 text-right">Details</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-border/50 text-xs">
                    {filteredInventory.map((group, idx) => {
                      const isExpanded = expandedSoftwareKey === group.name;
                      const uniqueVersions = Array.from(new Set(group.installs.map((i) => i.version || 'Unknown')));

                      return (
                        <React.Fragment key={idx}>
                          <tr
                            onClick={() => setExpandedSoftwareKey(isExpanded ? null : group.name)}
                            className="hover:bg-surface-hover/60 transition cursor-pointer"
                          >
                            <td className="p-3.5 pl-4">
                              <div className="font-semibold text-white flex items-center gap-2">
                                <SymbolIcon name="shippingbox.fill" className="w-3.5 h-3.5 text-brand-400 shrink-0" />
                                <span>{group.name}</span>
                              </div>
                            </td>
                            <td className="p-3.5 text-slate-400">
                              {group.publisher || <span className="text-slate-600">—</span>}
                            </td>
                            <td className="p-3.5">
                              <div className="flex flex-wrap gap-1">
                                {uniqueVersions.map((v, vIdx) => {
                                  const countForVer = group.installs.filter((i) => (i.version || 'Unknown') === v).length;
                                  return (
                                    <span
                                      key={vIdx}
                                      className="px-2 py-0.5 rounded-lg bg-surface border border-surface-border text-[11px] font-mono text-slate-300"
                                    >
                                      {v} <span className="text-slate-500 font-sans">({countForVer})</span>
                                    </span>
                                  );
                                })}
                              </div>
                            </td>
                            <td className="p-3.5 text-center">
                              <span className="px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20 font-semibold text-[11px]">
                                {group.installs.length}
                              </span>
                            </td>
                            <td className="p-3.5 pr-4 text-right">
                              <SymbolIcon
                                name={isExpanded ? 'chevron.up' : 'chevron.down'}
                                className="w-3.5 h-3.5 text-slate-400 inline-block transition-transform"
                              />
                            </td>
                          </tr>

                          {/* Accordion Per-Device Drilldown */}
                          {isExpanded && (
                            <tr className="bg-surface/30">
                              <td colSpan={5} className="p-3 pl-8 pr-4">
                                <div className="rounded-xl border border-surface-border bg-surface-card/80 p-3 space-y-2">
                                  <div className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider mb-1">
                                    Installed Devices Breakdown ({group.installs.length})
                                  </div>
                                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                                    {group.installs.map((inst) => (
                                      <div
                                        key={inst.id}
                                        className="p-2.5 rounded-lg bg-surface border border-surface-border flex items-center justify-between text-xs"
                                      >
                                        <div className="space-y-0.5">
                                          <div className="font-semibold text-white flex items-center gap-1.5">
                                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
                                            <span>{inst.deviceName}</span>
                                          </div>
                                          <div className="text-[11px] font-mono text-slate-400">
                                            v{inst.version || 'unknown'} {inst.arch ? `(${inst.arch})` : ''}
                                            {inst.source && <span className="ml-1 uppercase text-slate-500">[{inst.source}]</span>}
                                          </div>
                                        </div>
                                        {isAdmin && (
                                          <button
                                            onClick={(e) => {
                                              e.stopPropagation();
                                              handleRescanDevice(inst.deviceId);
                                            }}
                                            className="px-2 py-1 rounded bg-surface-card hover:bg-surface-active text-slate-300 border border-surface-border text-[11px] transition"
                                            title="Rescan device"
                                          >
                                            Rescan
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
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

        {/* =========================================================================
            TAB 3: SCRIPT LIBRARY
            ========================================================================= */}
        {activeTab === 'scripts' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
              <div className="relative w-full sm:w-80">
                <SymbolIcon name="magnifyingglass" className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search scripts by name..."
                  value={scriptSearch}
                  onChange={(e) => setScriptSearch(e.target.value)}
                  className="w-full pl-9 pr-3 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              {isAdmin && (
                <button
                  onClick={() => handleOpenScriptModal()}
                  className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold flex items-center gap-1.5 shadow-sm transition-all"
                >
                  <SymbolIcon name="plus" className="w-3.5 h-3.5" />
                  <span>New Script</span>
                </button>
              )}
            </div>

            {scripts.length === 0 ? (
              <div className="py-16 text-center rounded-2xl bg-surface-card border border-surface-border border-dashed p-8">
                <SymbolIcon name="chevron.left.forwardslash.chevron.right" className="w-8 h-8 mx-auto mb-2 text-slate-500" />
                <h3 className="text-sm font-bold text-white mb-1">No Scripts in Library</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  Create versioned PowerShell, batch, or bash scripts with runtime parameters.
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {scripts
                  .filter(
                    (s) =>
                      s.name.toLowerCase().includes(scriptSearch.toLowerCase()) ||
                      s.description?.toLowerCase().includes(scriptSearch.toLowerCase())
                  )
                  .map((scr) => (
                    <div
                      key={scr.id}
                      className="bg-surface-card border border-surface-border rounded-2xl p-4 sm:p-5 flex flex-col justify-between hover:border-surface-borderLight transition-all"
                    >
                      <div>
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-bold text-white flex items-center gap-2">
                              <span>{scr.name}</span>
                              <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20 uppercase font-mono">
                                {scr.script_type}
                              </span>
                            </h3>
                            {scr.description && <p className="text-xs text-slate-400 mt-1">{scr.description}</p>}
                          </div>
                          <span className="text-[11px] px-2 py-0.5 rounded-md bg-surface text-slate-400 border border-surface-border font-mono">
                            v{scr.latest_version || 1}
                          </span>
                        </div>

                        <div className="mt-3 flex items-center gap-3 text-xs text-slate-400">
                          <span>
                            Target: <strong className="text-slate-200 capitalize">{scr.target_os}</strong>
                          </span>
                          <span>•</span>
                          <span>
                            Timeout: <strong className="text-slate-200">{scr.timeout_seconds}s</strong>
                          </span>
                        </div>
                      </div>

                      <div className="mt-4 pt-3 border-t border-surface-border flex items-center justify-between">
                        {isAdmin && (
                          <div className="flex items-center gap-1.5">
                            <button
                              onClick={() => handleOpenScriptModal(scr)}
                              className="px-2.5 py-1 bg-surface hover:bg-surface-hover text-slate-300 rounded-lg text-xs font-medium border border-surface-border transition"
                            >
                              Edit
                            </button>
                            <button
                              onClick={() => handleDeleteScript(scr.id)}
                              className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium border border-red-500/20 transition"
                            >
                              Delete
                            </button>
                          </div>
                        )}

                        {isAdmin && (
                          <button
                            onClick={() => handleOpenRunScriptModal(scr)}
                            className="px-3 py-1 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-semibold flex items-center gap-1.5 transition ml-auto"
                          >
                            <SymbolIcon name="play.fill" className="w-3 h-3" />
                            <span>Run Script</span>
                          </button>
                        )}
                      </div>
                    </div>
                  ))}
              </div>
            )}
          </div>
        )}

        {/* =========================================================================
            TAB 4: AGENTS MANAGEMENT
            ========================================================================= */}
        {activeTab === 'agents' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
              <div className="flex items-center gap-2 text-xs text-slate-400 px-2 flex-wrap">
                <span>
                  <strong className="text-white">{agents.length}</strong> monitored devices
                </span>
                <span>•</span>
                <span className="text-emerald-400 font-medium">
                  {agents.filter((a) => a.status === 'online').length} online
                </span>
                <span>•</span>
                <span className="px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-brand-500/10 text-brand-300 border border-brand-500/20">
                  Latest available: v{latestServerVersion}
                </span>
              </div>

              {isAdmin && (
                <div className="flex items-center gap-2 flex-wrap">
                  {agents.filter((a) => a.isOutdated).length > 0 && (
                    <button
                      onClick={handleUpdateAllOutdated}
                      className="px-3 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-sm flex items-center gap-1.5 transition"
                    >
                      <SymbolIcon name="arrow.triangle.2.circlepath" className="w-3.5 h-3.5" />
                      <span>Update all outdated ({agents.filter((a) => a.isOutdated).length})</span>
                    </button>
                  )}

                  <button
                    onClick={handleBulkAgentUpdate}
                    disabled={selectedAgentIds.length === 0}
                    className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition ${
                      selectedAgentIds.length > 0
                        ? 'bg-surface-active text-white border border-surface-borderLight shadow-sm hover:bg-surface-hover'
                        : 'bg-surface text-slate-500 cursor-not-allowed border border-surface-border'
                    }`}
                  >
                    Update Selected ({selectedAgentIds.length})
                  </button>

                  <button
                    onClick={() => setShowAdvancedBuilds(!showAdvancedBuilds)}
                    className={`px-2.5 py-1.5 rounded-xl text-xs font-medium border transition flex items-center gap-1.5 ${
                      showAdvancedBuilds
                        ? 'bg-surface-active text-white border-surface-borderLight'
                        : 'bg-surface-card hover:bg-surface-hover text-slate-400 border-surface-border'
                    }`}
                    title="Toggle custom uploaded builds & manual version override"
                  >
                    <SymbolIcon name="slider.horizontal.3" className="w-3.5 h-3.5" />
                    <span>Advanced</span>
                  </button>

                  {showAdvancedBuilds && (
                    <>
                      {agentBuilds.length > 0 && selectedAgentIds.length > 0 && (
                        <select
                          value={bulkTargetBuildId}
                          onChange={(e) => setBulkTargetBuildId(e.target.value)}
                          className="px-2.5 py-1.5 rounded-xl bg-surface-card border border-surface-border text-xs text-slate-200 focus:outline-none"
                        >
                          <option value="">Default Server Build</option>
                          {agentBuilds.map((b) => (
                            <option key={b.id} value={b.id}>
                              v{b.version} ({b.target_os}/{b.target_arch}) {b.is_install_default === 1 ? '★' : ''}
                            </option>
                          ))}
                        </select>
                      )}

                      <button
                        onClick={() => setIsBuildsDrawerOpen(true)}
                        className="px-3 py-1.5 bg-surface-card hover:bg-surface-hover text-slate-200 border border-surface-border rounded-xl text-xs font-medium transition"
                      >
                        Manage Builds ({agentBuilds.length})
                      </button>

                      <button
                        onClick={() => setIsUploadAgentModalOpen(true)}
                        className="px-3 py-1.5 bg-surface-card hover:bg-surface-hover text-slate-200 border border-surface-border rounded-xl text-xs font-medium flex items-center gap-1.5 transition"
                      >
                        <SymbolIcon name="arrow.up.circle" className="w-3.5 h-3.5 text-brand-400" />
                        <span>Upload Build</span>
                      </button>
                    </>
                  )}
                </div>
              )}
            </div>

            {/* Agents Table */}
            <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-surface-active/50">
                    {isAdmin && (
                      <th className="p-3.5 pl-4 w-10">
                        <input
                          type="checkbox"
                          checked={selectedAgentIds.length === agents.length && agents.length > 0}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedAgentIds(agents.map((a) => a.deviceId));
                            else setSelectedAgentIds([]);
                          }}
                          className="rounded border-surface-border bg-surface text-brand-500 focus:ring-0"
                        />
                      </th>
                    )}
                    <th className="p-3.5">Device</th>
                    <th className="p-3.5">Platform</th>
                    <th className="p-3.5">Agent Version</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Last Seen</th>
                    {isAdmin && <th className="p-3.5 pr-4 text-right">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border/50 text-xs">
                  {agents.map((ag) => {
                    const isSelected = selectedAgentIds.includes(ag.deviceId);
                    return (
                      <tr key={ag.deviceId} className="hover:bg-surface-hover/60 transition">
                        {isAdmin && (
                          <td className="p-3.5 pl-4">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                if (e.target.checked) setSelectedAgentIds([...selectedAgentIds, ag.deviceId]);
                                else setSelectedAgentIds(selectedAgentIds.filter((id) => id !== ag.deviceId));
                              }}
                              className="rounded border-surface-border bg-surface text-brand-500 focus:ring-0"
                            />
                          </td>
                        )}
                        <td className="p-3.5">
                          <div className="font-semibold text-white">{ag.deviceName}</div>
                          <div className="text-[11px] text-slate-500 font-mono">{ag.host}</div>
                        </td>
                        <td className="p-3.5 text-slate-400 capitalize">{ag.platform}</td>
                        <td className="p-3.5">
                          <div className="flex items-center gap-2">
                            <span className="px-2.5 py-0.5 rounded-full text-xs font-mono font-semibold bg-brand-500/10 text-brand-300 border border-brand-500/20">
                              v{ag.agentVersion}
                            </span>
                            {ag.isOutdated ? (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20">
                                Outdated
                              </span>
                            ) : (
                              <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                                Up to date
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="p-3.5">
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                              ag.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-surface text-slate-400'
                            }`}
                          >
                            <span
                              className={`w-1.5 h-1.5 rounded-full mr-1.5 ${
                                ag.status === 'online' ? 'bg-emerald-400 animate-pulse' : 'bg-slate-500'
                              }`}
                            />
                            {ag.status}
                          </span>
                        </td>
                        <td className="p-3.5 text-slate-400">
                          {ag.lastSeenAt ? new Date(ag.lastSeenAt).toLocaleTimeString() : 'Never'}
                        </td>
                        {isAdmin && (
                          <td className="p-3.5 pr-4 text-right space-x-1.5">
                            <button
                              onClick={() => handleRescanDevice(ag.deviceId)}
                              className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border text-xs transition"
                              title="Rescan software inventory"
                            >
                              Rescan
                            </button>
                            <button
                              onClick={() => handleSingleAgentUpdate(ag.deviceId)}
                              className="px-2.5 py-1 rounded-lg bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 border border-brand-500/30 text-xs font-medium transition"
                            >
                              Push Update
                            </button>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 5: JOBS QUEUE
            ========================================================================= */}
        {activeTab === 'jobs' && (
          <div className="space-y-4">
            {/* Toolbar */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
              <div className="flex items-center gap-1.5 overflow-x-auto w-full sm:w-auto">
                {['all', 'waiting_for_device', 'queued', 'running', 'succeeded', 'failed'].map((st) => (
                  <button
                    key={st}
                    onClick={() => setJobStatusFilter(st)}
                    className={`px-3 py-1 rounded-lg text-xs font-medium capitalize transition-colors ${
                      jobStatusFilter === st
                        ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                    }`}
                  >
                    {st.replace(/_/g, ' ')}
                  </button>
                ))}
              </div>

              {isAdmin && selectedJobIds.length > 0 && (
                <button
                  onClick={handleBulkCancelJobs}
                  className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-semibold transition"
                >
                  Cancel Selected ({selectedJobIds.length})
                </button>
              )}
            </div>

            <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden shadow-sm">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-surface-border text-[11px] font-bold text-slate-400 uppercase tracking-wider bg-surface-active/50">
                    {isAdmin && (
                      <th className="p-3.5 pl-4 w-10">
                        <input
                          type="checkbox"
                          checked={
                            selectedJobIds.length ===
                              jobs.filter((j) => ['queued', 'waiting_for_device'].includes(j.status)).length &&
                            selectedJobIds.length > 0
                          }
                          onChange={(e) => {
                            if (e.target.checked)
                              setSelectedJobIds(
                                jobs.filter((j) => ['queued', 'waiting_for_device'].includes(j.status)).map((j) => j.id)
                              );
                            else setSelectedJobIds([]);
                          }}
                          className="rounded border-surface-border bg-surface text-brand-500 focus:ring-0"
                        />
                      </th>
                    )}
                    <th className="p-3.5">Type</th>
                    <th className="p-3.5">Device</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Created</th>
                    <th className="p-3.5">By</th>
                    <th className="p-3.5 pr-4 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-surface-border/50 text-xs">
                  {jobs
                    .filter((j) => jobStatusFilter === 'all' || j.status === jobStatusFilter)
                    .map((job) => {
                      const isSelectable = ['queued', 'waiting_for_device'].includes(job.status);
                      return (
                        <tr key={job.id} className="hover:bg-surface-hover/60 transition">
                          {isAdmin && (
                            <td className="p-3.5 pl-4">
                              {isSelectable && (
                                <input
                                  type="checkbox"
                                  checked={selectedJobIds.includes(job.id)}
                                  onChange={(e) => {
                                    if (e.target.checked) setSelectedJobIds([...selectedJobIds, job.id]);
                                    else setSelectedJobIds(selectedJobIds.filter((id) => id !== job.id));
                                  }}
                                  className="rounded border-surface-border bg-surface text-brand-500 focus:ring-0"
                                />
                              )}
                            </td>
                          )}
                          <td className="p-3.5 font-mono text-xs text-white uppercase font-medium">
                            {job.job_type.replace(/_/g, ' ')}
                          </td>
                          <td className="p-3.5 text-slate-300">{job.device_name || 'Unknown'}</td>
                          <td className="p-3.5">
                            <span
                              className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium ${
                                job.status === 'succeeded'
                                  ? 'bg-emerald-500/10 text-emerald-400'
                                  : job.status === 'waiting_for_device'
                                  ? 'bg-amber-500/10 text-amber-400 border border-amber-500/30'
                                  : job.status === 'queued'
                                  ? 'bg-blue-500/10 text-blue-400'
                                  : job.status === 'running' || job.status === 'downloading'
                                  ? 'bg-purple-500/10 text-purple-400 animate-pulse'
                                  : job.status === 'failed' || job.status === 'timed_out'
                                  ? 'bg-red-500/10 text-red-400'
                                  : 'bg-surface text-slate-400'
                              }`}
                            >
                              {job.status === 'waiting_for_device' && (
                                <SymbolIcon name="clock.fill" className="w-3 h-3 mr-1 text-amber-400" />
                              )}
                              {job.status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="p-3.5 text-slate-400">{new Date(job.created_at).toLocaleTimeString()}</td>
                          <td className="p-3.5 text-slate-400">{job.created_by_username}</td>
                          <td className="p-3.5 pr-4 text-right space-x-1.5">
                            {(job.stdout || job.stderr) && (
                              <button
                                onClick={() => setSelectedJobLogs(job)}
                                className="px-2.5 py-1 rounded-lg bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border text-xs transition"
                              >
                                Logs
                              </button>
                            )}
                            {isAdmin && ['queued', 'waiting_for_device'].includes(job.status) && (
                              <button
                                onClick={() => handleCancelJob(job.id)}
                                className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 text-xs transition"
                              >
                                Cancel
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* =========================================================================
            TAB 6: AUDIT LOG
            ========================================================================= */}
        {activeTab === 'audit' && (
          <div className="bg-surface-card border border-surface-border rounded-2xl overflow-hidden divide-y divide-surface-border/50">
            {auditLogs.map((log) => (
              <div key={log.id} className="p-3.5 text-xs hover:bg-surface-hover/30 transition">
                <div className="flex items-center justify-between text-slate-400">
                  <span className="font-semibold text-white">{log.username}</span>
                  <span className="font-mono text-[11px]">{new Date(log.created_at).toLocaleString()}</span>
                </div>
                <div className="mt-1 font-mono text-xs text-brand-300 font-semibold">{log.action}</div>
                {log.details_json && (
                  <pre className="mt-2 p-2.5 bg-surface/80 rounded-xl text-[11px] font-mono text-slate-300 overflow-x-auto max-h-40 border border-surface-border">
                    {JSON.stringify(JSON.parse(log.details_json), null, 2)}
                  </pre>
                )}
              </div>
            ))}
          </div>
        )}
      </main>

      {/* =========================================================================
          MODAL: RUN SCRIPT
          ========================================================================= */}
      {runningScript && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div>
                <h3 className="text-base font-bold text-white flex items-center gap-2">
                  <span>Run: {runningScript.name}</span>
                  <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-500/10 text-brand-300 border border-brand-500/20 font-mono uppercase">
                    {runningScript.script_type}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Executes under SYSTEM / root with parameters injected as environment variables.
                </p>
              </div>
              <button onClick={() => setRunningScript(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="space-y-4">
              {/* Target Devices Selection */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-2">
                  Target Devices ({targetDeviceIds.length} selected)
                </label>
                <div className="max-h-48 overflow-y-auto border border-surface-border rounded-xl p-2 bg-surface/50 space-y-1">
                  {agents.map((ag) => {
                    const isCompatible = runningScript.target_os === 'all' || ag.os === runningScript.target_os;
                    return (
                      <label
                        key={ag.deviceId}
                        className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer ${
                          isCompatible ? 'hover:bg-surface-hover' : 'opacity-40 cursor-not-allowed'
                        }`}
                      >
                        <input
                          type="checkbox"
                          disabled={!isCompatible}
                          checked={targetDeviceIds.includes(ag.deviceId)}
                          onChange={(e) => {
                            if (e.target.checked) setTargetDeviceIds([...targetDeviceIds, ag.deviceId]);
                            else setTargetDeviceIds(targetDeviceIds.filter((id) => id !== ag.deviceId));
                          }}
                          className="rounded border-surface-border bg-surface text-brand-500 focus:ring-0"
                        />
                        <div className="flex-1 text-xs">
                          <span className="font-semibold text-white">{ag.deviceName}</span>
                          <span className="text-slate-500 ml-1.5 font-mono">
                            ({ag.os}/{ag.arch})
                          </span>
                        </div>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full ${
                            ag.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-surface text-slate-500'
                          }`}
                        >
                          {ag.status}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>

              {/* Dynamic Parameter Inputs */}
              {runningScript.parameters_schema_json && (
                <div className="space-y-3">
                  <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Script Parameters
                  </label>
                  {(JSON.parse(runningScript.parameters_schema_json) as ScriptParameterDef[]).map((p) => (
                    <div key={p.name}>
                      <label className="block text-xs text-slate-300 mb-1">
                        {p.label || p.name} {p.required && <span className="text-red-400">*</span>}
                        {p.description && <span className="text-slate-500 text-[11px] block">{p.description}</span>}
                      </label>
                      <input
                        type="text"
                        value={runtimeParams[p.name] || ''}
                        onChange={(e) => setRuntimeParams({ ...runtimeParams, [p.name]: e.target.value })}
                        placeholder={p.defaultValue || ''}
                        className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Offline Expiry Option */}
              <div>
                <label className="block text-xs font-bold text-slate-300 uppercase tracking-wider mb-1">
                  Job Expiry if Device is Offline
                </label>
                <select
                  value={scriptExpiryOption}
                  onChange={(e) => setScriptExpiryOption(e.target.value)}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="none">No Expiry (Runs when device next comes online)</option>
                  <option value="1h">Expire after 1 hour</option>
                  <option value="24h">Expire after 24 hours</option>
                  <option value="7d">Expire after 7 days</option>
                </select>
              </div>
            </div>

            <div className="pt-3 border-t border-surface-border flex justify-end gap-2">
              <button
                onClick={() => setRunningScript(null)}
                className="px-3.5 py-1.5 bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteScript}
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Execute Script
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: CREATE / EDIT SCRIPT
          ========================================================================= */}
      {isScriptModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleSaveScript}
            className="bg-surface-card border border-surface-border rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <h3 className="text-base font-bold text-white">{editingScript ? 'Edit Script' : 'Create New Script'}</h3>
              <button type="button" onClick={() => setIsScriptModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Script Name *</label>
                <input
                  type="text"
                  required
                  value={scriptForm.name}
                  onChange={(e) => setScriptForm({ ...scriptForm, name: e.target.value })}
                  placeholder="e.g. Defender Onboarding"
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target OS</label>
                <select
                  value={scriptForm.target_os}
                  onChange={(e) => setScriptForm({ ...scriptForm, target_os: e.target.value as any })}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="all">All Operating Systems</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Script Type *</label>
                <select
                  value={scriptForm.script_type}
                  onChange={(e) => setScriptForm({ ...scriptForm, script_type: e.target.value as any })}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="powershell">PowerShell (.ps1)</option>
                  <option value="batch">Windows Command (.cmd / .bat)</option>
                  <option value="bash">Linux Bash (.sh)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Timeout (Seconds)</label>
                <input
                  type="number"
                  min="10"
                  max="7200"
                  value={scriptForm.timeout_seconds}
                  onChange={(e) => setScriptForm({ ...scriptForm, timeout_seconds: parseInt(e.target.value) || 600 })}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Description</label>
              <input
                type="text"
                value={scriptForm.description}
                onChange={(e) => setScriptForm({ ...scriptForm, description: e.target.value })}
                placeholder="Optional description of what this script accomplishes..."
                className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Script Code Content *</label>
              <textarea
                required
                rows={8}
                value={scriptForm.script_content}
                onChange={(e) => setScriptForm({ ...scriptForm, script_content: e.target.value })}
                placeholder="# Paste script content here..."
                className="w-full bg-surface border border-surface-border rounded-xl p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Version Notes</label>
              <input
                type="text"
                value={scriptForm.notes}
                onChange={(e) => setScriptForm({ ...scriptForm, notes: e.target.value })}
                placeholder="e.g. Added error handling"
                className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div className="pt-3 border-t border-surface-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsScriptModalOpen(false)}
                className="px-3.5 py-1.5 bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Save Script
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          MODAL: UPLOAD AGENT BUILD
          ========================================================================= */}
      {isUploadAgentModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <form
            onSubmit={handleUploadAgentBuild}
            className="bg-surface-card border border-surface-border rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4"
          >
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <h3 className="text-base font-bold text-white">Upload New Agent Build</h3>
              <button type="button" onClick={() => setIsUploadAgentModalOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Version String *</label>
                <input
                  type="text"
                  required
                  value={agentUploadForm.version}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, version: e.target.value })}
                  placeholder="1.1.1"
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target OS *</label>
                <select
                  value={agentUploadForm.target_os}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, target_os: e.target.value as any })}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target Architecture *</label>
                <select
                  value={agentUploadForm.target_arch}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, target_arch: e.target.value as any })}
                  className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
                >
                  <option value="amd64">AMD64 (x86_64)</option>
                  <option value="arm64">ARM64 (aarch64)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Binary Executable *</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setAgentUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-2 file:py-1.5 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-surface file:text-brand-300 hover:file:bg-surface-hover"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1">Release Notes</label>
              <input
                type="text"
                value={agentUploadForm.notes}
                onChange={(e) => setAgentUploadForm({ ...agentUploadForm, notes: e.target.value })}
                placeholder="e.g. Added rollback watchdog"
                className="w-full bg-surface border border-surface-border rounded-xl px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-brand-500"
              />
            </div>

            <div className="pt-3 border-t border-surface-border flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsUploadAgentModalOpen(false)}
                className="px-3.5 py-1.5 bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border rounded-xl text-xs font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-xl text-xs font-semibold shadow-sm transition"
              >
                Upload Build
              </button>
            </div>
          </form>
        </div>
      )}

      {/* =========================================================================
          MODAL: MANAGE AGENT BUILDS
          ========================================================================= */}
      {isBuildsDrawerOpen && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div>
                <h3 className="text-base font-bold text-white">Registered Agent Builds</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Uploaded binaries are isolated from install scripts until explicitly promoted to default.
                </p>
              </div>
              <button onClick={() => setIsBuildsDrawerOpen(false)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            {agentBuilds.length === 0 ? (
              <div className="p-8 text-center text-slate-400 text-xs">
                No custom agent builds uploaded yet. The server serves default precompiled binaries.
              </div>
            ) : (
              <div className="divide-y divide-surface-border/60">
                {agentBuilds.map((b) => (
                  <div key={b.id} className="py-3 flex items-center justify-between text-xs">
                    <div>
                      <div className="font-semibold text-white flex items-center gap-2">
                        <span>v{b.version}</span>
                        <span className="text-[10px] px-2 py-0.5 rounded bg-surface text-slate-400 uppercase font-mono">
                          {b.target_os}/{b.target_arch}
                        </span>
                        {b.is_install_default === 1 && (
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30 font-semibold">
                            ★ Install Default
                          </span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-500 font-mono mt-0.5">
                        SHA-256: {b.file_sha256.substring(0, 16)}... • {(b.file_size_bytes / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {b.is_install_default !== 1 && (
                        <button
                          onClick={() => handleSetDefaultBuild(b.id)}
                          className="px-2.5 py-1 bg-brand-500/20 hover:bg-brand-500/30 text-brand-300 border border-brand-500/30 rounded-lg text-xs font-medium transition"
                        >
                          Promote to Default
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBuild(b.id)}
                        className="px-2.5 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-xs font-medium transition"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =========================================================================
          MODAL: JOB STDOUT/STDERR LOGS
          ========================================================================= */}
      {selectedJobLogs && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-surface-card border border-surface-border rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div>
                <h3 className="text-base font-bold text-white font-mono flex items-center gap-2">
                  <span>Job: {selectedJobLogs.job_type}</span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full uppercase ${
                      selectedJobLogs.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                    }`}
                  >
                    {selectedJobLogs.status}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Device: {selectedJobLogs.device_name || selectedJobLogs.device_id}
                </p>
              </div>
              <button onClick={() => setSelectedJobLogs(null)} className="text-slate-400 hover:text-white">
                ✕
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs">
              {selectedJobLogs.stdout && (
                <div>
                  <div className="text-[11px] font-semibold text-emerald-400 uppercase tracking-wider mb-1">
                    Standard Output
                  </div>
                  <pre className="p-3.5 rounded-xl bg-surface text-slate-300 overflow-x-auto whitespace-pre-wrap border border-surface-border">
                    {selectedJobLogs.stdout}
                  </pre>
                </div>
              )}

              {selectedJobLogs.stderr && (
                <div>
                  <div className="text-[11px] font-semibold text-red-400 uppercase tracking-wider mb-1">
                    Standard Error
                  </div>
                  <pre className="p-3.5 rounded-xl bg-surface text-red-300 overflow-x-auto whitespace-pre-wrap border border-red-950">
                    {selectedJobLogs.stderr}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-surface-border flex justify-end">
              <button
                onClick={() => setSelectedJobLogs(null)}
                className="px-4 py-1.5 bg-surface hover:bg-surface-hover text-slate-300 border border-surface-border rounded-xl text-xs font-semibold transition"
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

export default Updates;
