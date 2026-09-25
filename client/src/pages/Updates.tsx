import React, { useState, useEffect } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../context/AuthContext';
import {
  UpdatesOverview,
  SoftwareGroup,
  UpdateJob,
  UpdateAuditLog,
  AgentItem,
  AgentBuildItem,
  ScriptItem,
  ScriptParameterDef,
} from '../types';

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

  // Agent Modals
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
      const [ov, inv, ags, blds, scrs, jbs, aud] = await Promise.all([
        api.updates.getOverview().catch(() => null),
        api.updates.getFleetInventory(searchQuery).catch(() => []),
        api.updates.getAgents().catch(() => []),
        api.updates.getAgentBuilds().catch(() => []),
        api.updates.getScripts().catch(() => []),
        api.updates.getJobs(100).catch(() => []),
        api.updates.getAuditLogs(200).catch(() => []),
      ]);
      setOverview(ov);
      setInventory(inv);
      setAgents(ags);
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
      // Auto-refresh jobs and agents
      api.updates.getJobs(100).then(setJobs).catch(() => {});
      api.updates.getAgents().then(setAgents).catch(() => {});
      api.updates.getOverview().then(setOverview).catch(() => {});
    }, 15000);
    return () => clearInterval(interval);
  }, []);

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

    // Filter compatible online devices by default
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

  return (
    <div className="space-y-6">
      {/* Toast alert message */}
      {actionMessage && (
        <div
          className={`p-4 rounded-xl flex items-center justify-between shadow-lg backdrop-blur-md border ${
            actionMessage.type === 'success'
              ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              : 'bg-red-500/10 border-red-500/30 text-red-300'
          }`}
        >
          <div className="flex items-center space-x-3">
            <span className="text-xl">{actionMessage.type === 'success' ? '✅' : '❌'}</span>
            <span className="font-medium text-sm">{actionMessage.text}</span>
          </div>
          <button onClick={() => setActionMessage(null)} className="text-xs opacity-60 hover:opacity-100">
            Dismiss
          </button>
        </div>
      )}

      {/* Header & Subnav */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-800 pb-4">
        <div>
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
              <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Updates & Fleet Management</h1>
              <p className="text-sm text-slate-400">Software discovery, agent updates, and remote script automation</p>
            </div>
          </div>
        </div>

        {/* Action button bar */}
        <div className="flex items-center space-x-3">
          {isAdmin && (
            <>
              <button
                onClick={handleRescanAll}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-sm font-medium flex items-center space-x-2 transition"
                title="Queue inventory discovery scan across all monitored devices"
              >
                <svg className="w-4 h-4 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                </svg>
                <span>Rescan All</span>
              </button>

              <button
                onClick={() => handleOpenScriptModal()}
                className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium flex items-center space-x-2 shadow-lg shadow-cyan-600/20 transition"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                <span>New Script</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Tabs Bar */}
      <div className="flex items-center space-x-2 border-b border-slate-800/80 overflow-x-auto pb-1 text-sm font-medium">
        {[
          { key: 'overview', label: 'Overview', icon: '📊' },
          { key: 'inventory', label: 'Software Inventory', icon: '📦', count: inventory.length },
          { key: 'scripts', label: 'Script Library', icon: '⚡', count: scripts.length },
          { key: 'agents', label: 'Agents', icon: '🤖', count: agents.length },
          { key: 'jobs', label: 'Jobs Queue', icon: '⏳', count: jobs.filter(j => ['queued', 'waiting_for_device', 'running'].includes(j.status)).length || undefined },
          { key: 'audit', label: 'Audit Log', icon: '🛡️' },
        ].map((tab) => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key as any)}
            className={`px-4 py-2.5 rounded-xl flex items-center space-x-2 whitespace-nowrap transition ${
              activeTab === tab.key
                ? 'bg-cyan-500/15 text-cyan-400 border border-cyan-500/30'
                : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
            }`}
          >
            <span>{tab.icon}</span>
            <span>{tab.label}</span>
            {tab.count !== undefined && tab.count > 0 && (
              <span className={`text-xs px-2 py-0.5 rounded-full ${activeTab === tab.key ? 'bg-cyan-400/20 text-cyan-300' : 'bg-slate-800 text-slate-400'}`}>
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
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-sm">
                <span>Fleet Software Records</span>
                <span className="text-xl">📦</span>
              </div>
              <div className="text-3xl font-bold text-white mt-2">{overview?.totalTrackedSoftware ?? 0}</div>
              <div className="text-xs text-slate-500 mt-1">Discovered across all devices</div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-sm">
                <span>Monitored Agents</span>
                <span className="text-xl">🤖</span>
              </div>
              <div className="text-3xl font-bold text-cyan-400 mt-2">
                {overview?.agentsOnline ?? 0} <span className="text-lg font-normal text-slate-500">/ {overview?.totalMonitoredAgents ?? agents.length} online</span>
              </div>
              <div className="text-xs text-emerald-400 mt-1">15s reporting interval</div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-sm">
                <span>Pending Reboots</span>
                <span className="text-xl">🔄</span>
              </div>
              <div className={`text-3xl font-bold mt-2 ${(overview?.devicesPendingReboot ?? 0) > 0 ? 'text-amber-400' : 'text-slate-400'}`}>
                {overview?.devicesPendingReboot ?? 0}
              </div>
              <div className="text-xs text-slate-500 mt-1">Registry/system flags</div>
            </div>

            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 backdrop-blur-sm">
              <div className="flex items-center justify-between text-slate-400 text-sm">
                <span>Failed Jobs (7d)</span>
                <span className="text-xl">⚠️</span>
              </div>
              <div className={`text-3xl font-bold mt-2 ${(overview?.failedJobsLast7Days ?? 0) > 0 ? 'text-red-400' : 'text-slate-400'}`}>
                {overview?.failedJobsLast7Days ?? 0}
              </div>
              <div className="text-xs text-slate-500 mt-1">Requires admin review</div>
            </div>
          </div>

          {/* Quick Actions Grid */}
          <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-6">
            <h2 className="text-lg font-semibold text-white mb-4">Quick Management Actions</h2>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <button
                onClick={() => setActiveTab('inventory')}
                className="p-4 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-left transition flex items-start space-x-3"
              >
                <span className="text-2xl">🔍</span>
                <div>
                  <div className="font-medium text-slate-200">Explore Software Inventory</div>
                  <div className="text-xs text-slate-400 mt-1">Search packages, verify versions, inspect silent uninstall strings</div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('scripts')}
                className="p-4 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-left transition flex items-start space-x-3"
              >
                <span className="text-2xl">⚡</span>
                <div>
                  <div className="font-medium text-slate-200">Run Remote Script</div>
                  <div className="text-xs text-slate-400 mt-1">Execute PowerShell, batch, or bash scripts across devices</div>
                </div>
              </button>

              <button
                onClick={() => setActiveTab('agents')}
                className="p-4 rounded-xl bg-slate-800/60 hover:bg-slate-800 border border-slate-700/50 text-left transition flex items-start space-x-3"
              >
                <span className="text-2xl">🤖</span>
                <div>
                  <div className="font-medium text-slate-200">Manage Agent Versions</div>
                  <div className="text-xs text-slate-400 mt-1">Upload new builds, promote defaults, and dispatch self-updates</div>
                </div>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* =========================================================================
          TAB 2: SOFTWARE INVENTORY
          ========================================================================= */}
      {activeTab === 'inventory' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full">
              <input
                type="text"
                placeholder="Search software name, publisher, or version across fleet..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && loadData()}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 pl-10 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <span className="absolute left-3.5 top-3 text-slate-500">🔍</span>
            </div>
            {isAdmin && (
              <button
                onClick={handleRescanAll}
                className="px-4 py-2.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 rounded-xl text-sm font-medium flex items-center space-x-2 shrink-0 transition"
              >
                <span>🔄</span>
                <span>Rescan All Fleet</span>
              </button>
            )}
          </div>

          {inventory.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
              <div className="text-3xl mb-2">📦</div>
              <div>No software inventory records found.</div>
              <div className="text-xs text-slate-600 mt-1">Agents periodically scan every 6 hours, or click "Rescan All" to trigger now.</div>
            </div>
          ) : (
            <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/60">
              {inventory.map((group, idx) => (
                <div key={idx} className="p-4 hover:bg-slate-800/30 transition">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                        <span>{group.name}</span>
                        {group.publisher && <span className="text-xs font-normal text-slate-400">({group.publisher})</span>}
                      </h3>
                      <div className="text-xs text-slate-500 mt-1">Installed on {group.installs.length} device{group.installs.length === 1 ? '' : 's'}</div>
                    </div>
                  </div>

                  {/* Installs Chips */}
                  <div className="mt-3 flex flex-wrap gap-2">
                    {group.installs.map((inst) => (
                      <div
                        key={inst.id}
                        className="px-3 py-1.5 rounded-lg bg-slate-800/80 border border-slate-700/60 text-xs text-slate-300 flex items-center space-x-2"
                      >
                        <span className="font-medium text-cyan-400">{inst.deviceName}</span>
                        <span className="text-slate-400">v{inst.version || 'unknown'}</span>
                        {inst.source && <span className="px-1.5 py-0.2 bg-slate-900 rounded text-[10px] text-slate-400 uppercase">{inst.source}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* =========================================================================
          TAB 3: SCRIPT LIBRARY (PHASE 2)
          ========================================================================= */}
      {activeTab === 'scripts' && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative flex-1 w-full">
              <input
                type="text"
                placeholder="Search scripts by name or description..."
                value={scriptSearch}
                onChange={(e) => setScriptSearch(e.target.value)}
                className="w-full bg-slate-900 border border-slate-800 rounded-xl px-4 py-2.5 pl-10 text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500"
              />
              <span className="absolute left-3.5 top-3 text-slate-500">🔍</span>
            </div>
            {isAdmin && (
              <button
                onClick={() => handleOpenScriptModal()}
                className="px-4 py-2.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium flex items-center space-x-2 shrink-0 shadow-lg shadow-cyan-600/20 transition"
              >
                <span>➕</span>
                <span>New Script</span>
              </button>
            )}
          </div>

          {scripts.length === 0 ? (
            <div className="bg-slate-900/40 border border-slate-800 rounded-2xl p-12 text-center text-slate-500">
              <div className="text-3xl mb-2">⚡</div>
              <div>No scripts saved in library.</div>
              <div className="text-xs text-slate-600 mt-1">Create PowerShell, batch, or bash scripts with runtime parameters.</div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {scripts
                .filter((s) => s.name.toLowerCase().includes(scriptSearch.toLowerCase()) || s.description?.toLowerCase().includes(scriptSearch.toLowerCase()))
                .map((scr) => (
                  <div key={scr.id} className="bg-slate-900/60 border border-slate-800 rounded-2xl p-5 flex flex-col justify-between hover:border-slate-700 transition">
                    <div>
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-base font-semibold text-white flex items-center space-x-2">
                            <span>{scr.name}</span>
                            <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 uppercase font-mono">
                              {scr.script_type}
                            </span>
                          </h3>
                          {scr.description && <p className="text-sm text-slate-400 mt-1">{scr.description}</p>}
                        </div>
                        <span className="text-xs px-2 py-0.5 rounded-md bg-slate-800 text-slate-400 border border-slate-700">
                          v{scr.latest_version || 1}
                        </span>
                      </div>

                      <div className="mt-4 flex items-center space-x-4 text-xs text-slate-500">
                        <span>Target OS: <strong className="text-slate-300 capitalize">{scr.target_os}</strong></span>
                        <span>Timeout: <strong className="text-slate-300">{scr.timeout_seconds}s</strong></span>
                      </div>
                    </div>

                    <div className="mt-6 pt-4 border-t border-slate-800 flex items-center justify-between">
                      {isAdmin && (
                        <div className="flex items-center space-x-2">
                          <button
                            onClick={() => handleOpenScriptModal(scr)}
                            className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg text-xs font-medium transition"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => handleDeleteScript(scr.id)}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition"
                          >
                            Delete
                          </button>
                        </div>
                      )}

                      {isAdmin && (
                        <button
                          onClick={() => handleOpenRunScriptModal(scr)}
                          className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-xs font-medium flex items-center space-x-1.5 transition ml-auto"
                        >
                          <span>▶</span>
                          <span>Run on Devices</span>
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-2 text-sm text-slate-400">
              <span>{agents.length} monitored devices</span>
              <span>•</span>
              <span className="text-emerald-400 font-medium">{agents.filter(a => a.status === 'online').length} online</span>
            </div>

            {isAdmin && (
              <div className="flex items-center space-x-3">
                <button
                  onClick={() => setIsBuildsDrawerOpen(true)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium transition"
                >
                  Manage Builds ({agentBuilds.length})
                </button>
                <button
                  onClick={() => setIsUploadAgentModalOpen(true)}
                  className="px-3.5 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 rounded-xl text-xs font-medium flex items-center space-x-1.5 transition"
                >
                  <span>⬆️</span>
                  <span>Upload Build</span>
                </button>
                {agentBuilds.length > 0 && selectedAgentIds.length > 0 && (
                  <select
                    value={bulkTargetBuildId}
                    onChange={(e) => setBulkTargetBuildId(e.target.value)}
                    className="px-3 py-2 rounded-xl bg-slate-800 border border-slate-700 text-xs text-slate-200 focus:ring-1 focus:ring-cyan-500"
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
                  onClick={handleBulkAgentUpdate}
                  disabled={selectedAgentIds.length === 0}
                  className={`px-4 py-2 rounded-xl text-xs font-medium transition ${
                    selectedAgentIds.length > 0
                      ? 'bg-cyan-600 hover:bg-cyan-500 text-white shadow-lg shadow-cyan-600/20'
                      : 'bg-slate-800 text-slate-500 cursor-not-allowed'
                  }`}
                >
                  Update Selected ({selectedAgentIds.length})
                </button>
              </div>
            )}
          </div>

          {/* Agents Table */}
          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-900/80">
                  {isAdmin && (
                    <th className="p-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedAgentIds.length === agents.length && agents.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedAgentIds(agents.map(a => a.deviceId));
                          else setSelectedAgentIds([]);
                        }}
                        className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                      />
                    </th>
                  )}
                  <th className="p-4">Device</th>
                  <th className="p-4">Platform</th>
                  <th className="p-4">Agent Version</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Last Seen</th>
                  {isAdmin && <th className="p-4 text-right">Actions</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-sm">
                {agents.map((ag) => {
                  const isSelected = selectedAgentIds.includes(ag.deviceId);
                  return (
                    <tr key={ag.deviceId} className="hover:bg-slate-800/30 transition">
                      {isAdmin && (
                        <td className="p-4">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={(e) => {
                              if (e.target.checked) setSelectedAgentIds([...selectedAgentIds, ag.deviceId]);
                              else setSelectedAgentIds(selectedAgentIds.filter(id => id !== ag.deviceId));
                            }}
                            className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                          />
                        </td>
                      )}
                      <td className="p-4">
                        <div className="font-medium text-white">{ag.deviceName}</div>
                        <div className="text-xs text-slate-500 font-mono">{ag.host}</div>
                      </td>
                      <td className="p-4 text-slate-400 capitalize">
                        {ag.platform}
                      </td>
                      <td className="p-4">
                        <span className="px-2.5 py-1 rounded-full text-xs font-mono font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                          v{ag.agentVersion}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
                          ag.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-400'
                        }`}>
                          <span className={`w-1.5 h-1.5 rounded-full mr-1.5 ${ag.status === 'online' ? 'bg-emerald-400' : 'bg-slate-500'}`} />
                          {ag.status}
                        </span>
                      </td>
                      <td className="p-4 text-xs text-slate-400">
                        {ag.lastSeenAt ? new Date(ag.lastSeenAt).toLocaleTimeString() : 'Never'}
                      </td>
                      {isAdmin && (
                        <td className="p-4 text-right space-x-2">
                          <button
                            onClick={() => handleRescanDevice(ag.deviceId)}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                            title="Rescan software inventory"
                          >
                            Rescan
                          </button>
                          <button
                            onClick={() => handleSingleAgentUpdate(ag.deviceId)}
                            className="px-2.5 py-1 rounded-lg bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition"
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
          <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="flex items-center space-x-2">
              {['all', 'waiting_for_device', 'queued', 'running', 'succeeded', 'failed'].map((st) => (
                <button
                  key={st}
                  onClick={() => setJobStatusFilter(st)}
                  className={`px-3 py-1.5 rounded-xl text-xs font-medium capitalize transition ${
                    jobStatusFilter === st
                      ? 'bg-slate-800 text-cyan-400 border border-slate-700'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {st.replace(/_/g, ' ')}
                </button>
              ))}
            </div>

            {isAdmin && selectedJobIds.length > 0 && (
              <button
                onClick={handleBulkCancelJobs}
                className="px-3.5 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/30 rounded-xl text-xs font-medium transition"
              >
                Cancel Selected ({selectedJobIds.length})
              </button>
            )}
          </div>

          <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-800 text-xs font-semibold text-slate-400 uppercase tracking-wider bg-slate-900/80">
                  {isAdmin && (
                    <th className="p-4 w-10">
                      <input
                        type="checkbox"
                        checked={selectedJobIds.length === jobs.filter(j => ['queued', 'waiting_for_device'].includes(j.status)).length && selectedJobIds.length > 0}
                        onChange={(e) => {
                          if (e.target.checked) setSelectedJobIds(jobs.filter(j => ['queued', 'waiting_for_device'].includes(j.status)).map(j => j.id));
                          else setSelectedJobIds([]);
                        }}
                        className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                      />
                    </th>
                  )}
                  <th className="p-4">Type</th>
                  <th className="p-4">Device</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Created</th>
                  <th className="p-4">By</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/50 text-sm">
                {jobs
                  .filter((j) => jobStatusFilter === 'all' || j.status === jobStatusFilter)
                  .map((job) => {
                    const isSelectable = ['queued', 'waiting_for_device'].includes(job.status);
                    return (
                      <tr key={job.id} className="hover:bg-slate-800/30 transition">
                        {isAdmin && (
                          <td className="p-4">
                            {isSelectable && (
                              <input
                                type="checkbox"
                                checked={selectedJobIds.includes(job.id)}
                                onChange={(e) => {
                                  if (e.target.checked) setSelectedJobIds([...selectedJobIds, job.id]);
                                  else setSelectedJobIds(selectedJobIds.filter(id => id !== job.id));
                                }}
                                className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                              />
                            )}
                          </td>
                        )}
                        <td className="p-4 font-mono text-xs text-white uppercase">
                          {job.job_type.replace(/_/g, ' ')}
                        </td>
                        <td className="p-4 text-slate-300">
                          {job.device_name || 'Unknown'}
                        </td>
                        <td className="p-4">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${
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
                              : 'bg-slate-800 text-slate-400'
                          }`}>
                            {job.status === 'waiting_for_device' && <span className="mr-1">⏳</span>}
                            {job.status.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="p-4 text-xs text-slate-400">
                          {new Date(job.created_at).toLocaleTimeString()}
                        </td>
                        <td className="p-4 text-xs text-slate-400">
                          {job.created_by_username}
                        </td>
                        <td className="p-4 text-right space-x-2">
                          {(job.stdout || job.stderr) && (
                            <button
                              onClick={() => setSelectedJobLogs(job)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition"
                            >
                              Logs
                            </button>
                          )}
                          {isAdmin && ['queued', 'waiting_for_device'].includes(job.status) && (
                            <button
                              onClick={() => handleCancelJob(job.id)}
                              className="px-2.5 py-1 rounded-lg bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs font-medium transition"
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
        <div className="bg-slate-900/60 border border-slate-800 rounded-2xl overflow-hidden divide-y divide-slate-800/50">
          {auditLogs.map((log) => (
            <div key={log.id} className="p-4 text-sm hover:bg-slate-800/20 transition">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span className="font-semibold text-slate-200">{log.username}</span>
                <span>{new Date(log.created_at).toLocaleString()}</span>
              </div>
              <div className="mt-1 font-mono text-xs text-cyan-400 font-medium">
                {log.action}
              </div>
              {log.details_json && (
                <pre className="mt-2 p-3 bg-slate-950/80 rounded-xl text-xs font-mono text-slate-400 overflow-x-auto max-h-40 border border-slate-800/50">
                  {JSON.stringify(JSON.parse(log.details_json), null, 2)}
                </pre>
              )}
            </div>
          ))}
        </div>
      )}

      {/* =========================================================================
          MODAL: RUN SCRIPT
          ========================================================================= */}
      {runningScript && (
        <div className="fixed inset-0 z-50 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-4">
              <div>
                <h3 className="text-lg font-bold text-white flex items-center space-x-2">
                  <span>Run: {runningScript.name}</span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono uppercase">
                    {runningScript.script_type}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">Executes under SYSTEM / root with parameters injected as environment variables.</p>
              </div>
              <button onClick={() => setRunningScript(null)} className="text-slate-400 hover:text-white text-lg">✕</button>
            </div>

            <div className="mt-4 space-y-4">
              {/* Target Devices Selection */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-2">Target Devices ({targetDeviceIds.length} selected)</label>
                <div className="max-h-48 overflow-y-auto border border-slate-800 rounded-xl p-3 bg-slate-950/50 space-y-2">
                  {agents.map((ag) => {
                    const isCompatible = runningScript.target_os === 'all' || ag.os === runningScript.target_os;
                    return (
                      <label key={ag.deviceId} className={`flex items-center space-x-3 p-2 rounded-lg cursor-pointer ${isCompatible ? 'hover:bg-slate-800/40' : 'opacity-40 cursor-not-allowed'}`}>
                        <input
                          type="checkbox"
                          disabled={!isCompatible}
                          checked={targetDeviceIds.includes(ag.deviceId)}
                          onChange={(e) => {
                            if (e.target.checked) setTargetDeviceIds([...targetDeviceIds, ag.deviceId]);
                            else setTargetDeviceIds(targetDeviceIds.filter(id => id !== ag.deviceId));
                          }}
                          className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                        />
                        <div className="flex-1 text-sm">
                          <span className="font-medium text-white">{ag.deviceName}</span>
                          <span className="text-xs text-slate-500 ml-2">({ag.os}/{ag.arch})</span>
                        </div>
                        <span className={`text-xs px-2 py-0.5 rounded-full ${ag.status === 'online' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-slate-800 text-slate-500'}`}>
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
                  <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider">Script Parameters</label>
                  {(JSON.parse(runningScript.parameters_schema_json) as ScriptParameterDef[]).map((p) => (
                    <div key={p.name}>
                      <label className="block text-xs text-slate-400 mb-1">
                        {p.label || p.name} {p.required && <span className="text-red-400">*</span>}
                        {p.description && <span className="text-slate-500 text-[11px] block">{p.description}</span>}
                      </label>
                      <input
                        type="text"
                        value={runtimeParams[p.name] || ''}
                        onChange={(e) => setRuntimeParams({ ...runtimeParams, [p.name]: e.target.value })}
                        placeholder={p.defaultValue || ''}
                        className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                      />
                    </div>
                  ))}
                </div>
              )}

              {/* Offline Expiry Option */}
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase tracking-wider mb-1">Job Expiry if Device is Offline</label>
                <select
                  value={scriptExpiryOption}
                  onChange={(e) => setScriptExpiryOption(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="none">No Expiry (Runs when device next comes online)</option>
                  <option value="1h">Expire after 1 hour</option>
                  <option value="24h">Expire after 24 hours</option>
                  <option value="7d">Expire after 7 days</option>
                </select>
              </div>
            </div>

            <div className="mt-6 pt-4 border-t border-slate-800 flex justify-end space-x-3">
              <button
                onClick={() => setRunningScript(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                onClick={handleExecuteScript}
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-cyan-600/20 transition"
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
          <form onSubmit={handleSaveScript} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full max-h-[90vh] overflow-y-auto p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">{editingScript ? 'Edit Script' : 'Create New Script'}</h3>
              <button type="button" onClick={() => setIsScriptModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Script Name *</label>
                <input
                  type="text"
                  required
                  value={scriptForm.name}
                  onChange={(e) => setScriptForm({ ...scriptForm, name: e.target.value })}
                  placeholder="e.g. Defender Onboarding"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Target OS</label>
                <select
                  value={scriptForm.target_os}
                  onChange={(e) => setScriptForm({ ...scriptForm, target_os: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="all">All Operating Systems</option>
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Script Type *</label>
                <select
                  value={scriptForm.script_type}
                  onChange={(e) => setScriptForm({ ...scriptForm, script_type: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="powershell">PowerShell (.ps1)</option>
                  <option value="batch">Windows Command (.cmd / .bat)</option>
                  <option value="bash">Linux Bash (.sh)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Timeout (Seconds)</label>
                <input
                  type="number"
                  min="10"
                  max="7200"
                  value={scriptForm.timeout_seconds}
                  onChange={(e) => setScriptForm({ ...scriptForm, timeout_seconds: parseInt(e.target.value) || 600 })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Description</label>
              <input
                type="text"
                value={scriptForm.description}
                onChange={(e) => setScriptForm({ ...scriptForm, description: e.target.value })}
                placeholder="Optional description of what this script accomplishes..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Script Code Content *</label>
              <textarea
                required
                rows={10}
                value={scriptForm.script_content}
                onChange={(e) => setScriptForm({ ...scriptForm, script_content: e.target.value })}
                placeholder="# Paste script content here..."
                className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3.5 text-xs font-mono text-emerald-400 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Version Notes</label>
              <input
                type="text"
                value={scriptForm.notes}
                onChange={(e) => setScriptForm({ ...scriptForm, notes: e.target.value })}
                placeholder="e.g. Added error handling"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsScriptModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-cyan-600/20 transition"
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
          <form onSubmit={handleUploadAgentBuild} className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="text-lg font-bold text-white">Upload New Agent Build</h3>
              <button type="button" onClick={() => setIsUploadAgentModalOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Version String *</label>
                <input
                  type="text"
                  required
                  value={agentUploadForm.version}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, version: e.target.value })}
                  placeholder="1.1.1"
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Target OS *</label>
                <select
                  value={agentUploadForm.target_os}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, target_os: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="windows">Windows</option>
                  <option value="linux">Linux</option>
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Target Architecture *</label>
                <select
                  value={agentUploadForm.target_arch}
                  onChange={(e) => setAgentUploadForm({ ...agentUploadForm, target_arch: e.target.value as any })}
                  className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
                >
                  <option value="amd64">AMD64 (x86_64)</option>
                  <option value="arm64">ARM64 (aarch64)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Binary Executable *</label>
                <input
                  type="file"
                  required
                  onChange={(e) => setAgentUploadFile(e.target.files?.[0] || null)}
                  className="w-full text-xs text-slate-400 file:mr-2 file:py-2 file:px-3 file:rounded-xl file:border-0 file:text-xs file:font-medium file:bg-slate-800 file:text-cyan-400 hover:file:bg-slate-700"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 uppercase mb-1">Release Notes</label>
              <input
                type="text"
                value={agentUploadForm.notes}
                onChange={(e) => setAgentUploadForm({ ...agentUploadForm, notes: e.target.value })}
                placeholder="e.g. Added rollback watchdog"
                className="w-full bg-slate-950 border border-slate-800 rounded-xl px-3.5 py-2 text-sm text-slate-200 focus:outline-none focus:border-cyan-500"
              />
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end space-x-3">
              <button
                type="button"
                onClick={() => setIsUploadAgentModalOpen(false)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-5 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-xl text-sm font-medium shadow-lg shadow-cyan-600/20 transition"
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-3xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white">Registered Agent Builds</h3>
                <p className="text-xs text-slate-400 mt-0.5">Uploaded binaries are isolated from install scripts until promoted to default.</p>
              </div>
              <button onClick={() => setIsBuildsDrawerOpen(false)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            {agentBuilds.length === 0 ? (
              <div className="p-8 text-center text-slate-500 text-sm">
                No custom agent builds uploaded yet. The server serves default binaries from its built repository.
              </div>
            ) : (
              <div className="divide-y divide-slate-800/60">
                {agentBuilds.map((b) => (
                  <div key={b.id} className="py-3.5 flex items-center justify-between text-sm">
                    <div>
                      <div className="font-semibold text-white flex items-center space-x-2">
                        <span>v{b.version}</span>
                        <span className="text-xs px-2 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-mono">
                          {b.target_os}/{b.target_arch}
                        </span>
                        {b.is_install_default === 1 && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            ★ Install Default
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-slate-500 font-mono mt-1">
                        SHA-256: {b.file_sha256.substring(0, 16)}... • {(b.file_size_bytes / (1024 * 1024)).toFixed(2)} MB
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      {b.is_install_default !== 1 && (
                        <button
                          onClick={() => handleSetDefaultBuild(b.id)}
                          className="px-3 py-1 bg-cyan-600/20 hover:bg-cyan-600/30 text-cyan-300 border border-cyan-500/30 rounded-lg text-xs font-medium transition"
                        >
                          Promote to Default
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteBuild(b.id)}
                        className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-lg text-xs font-medium transition"
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
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full p-6 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div>
                <h3 className="text-lg font-bold text-white font-mono flex items-center space-x-2">
                  <span>Job: {selectedJobLogs.job_type}</span>
                  <span className={`text-xs px-2.5 py-0.5 rounded-full uppercase ${
                    selectedJobLogs.status === 'succeeded' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400'
                  }`}>
                    {selectedJobLogs.status}
                  </span>
                </h3>
                <p className="text-xs text-slate-400 mt-1">Device: {selectedJobLogs.device_name || selectedJobLogs.device_id}</p>
              </div>
              <button onClick={() => setSelectedJobLogs(null)} className="text-slate-400 hover:text-white">✕</button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 font-mono text-xs">
              {selectedJobLogs.stdout && (
                <div>
                  <div className="text-xs font-semibold text-emerald-400 uppercase tracking-wider mb-1">Standard Output</div>
                  <pre className="p-4 rounded-xl bg-slate-950 text-slate-300 overflow-x-auto whitespace-pre-wrap border border-slate-800">
                    {selectedJobLogs.stdout}
                  </pre>
                </div>
              )}

              {selectedJobLogs.stderr && (
                <div>
                  <div className="text-xs font-semibold text-red-400 uppercase tracking-wider mb-1">Standard Error</div>
                  <pre className="p-4 rounded-xl bg-slate-950 text-red-300 overflow-x-auto whitespace-pre-wrap border border-red-950">
                    {selectedJobLogs.stderr}
                  </pre>
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-800 flex justify-end">
              <button
                onClick={() => setSelectedJobLogs(null)}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-xl text-sm font-medium transition"
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
