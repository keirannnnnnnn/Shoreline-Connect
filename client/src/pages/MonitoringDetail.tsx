import React, { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { api, MetricPoint, MonitoringAgentInfo } from '../lib/api.js';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { MetricChart, ChartSeries } from '../components/MetricChart.js';

export const MonitoringDetail: React.FC = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();

  const [agentInfo, setAgentInfo] = useState<MonitoringAgentInfo | null>(null);
  const [metrics, setMetrics] = useState<MetricPoint[]>([]);
  const [range, setRange] = useState<'1h' | '6h' | '24h' | '7d' | '30d' | '120d'>('1h');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isInstallModalOpen, setIsInstallModalOpen] = useState(false);
  const [activeInstallTab, setActiveInstallTab] = useState<'linux' | 'windows'>('linux');
  const [copied, setCopied] = useState(false);

  const fetchMetrics = async (isInitial = false) => {
    if (!id) return;
    try {
      if (isInitial) setLoading(true);
      const [agentRes, metricsRes] = await Promise.all([
        api.monitoring.getDeviceAgentStatus(id),
        api.monitoring.getMetrics(id, range),
      ]);
      setAgentInfo(agentRes.info);
      setMetrics(metricsRes.points);
    } catch (err: any) {
      console.error('Failed to load metrics:', err);
      setError(err.message || 'Failed to load device metrics');
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    fetchMetrics(true);
    const interval = setInterval(() => {
      if (range === '1h' || range === '6h') {
        fetchMetrics(false);
      }
    }, 10000);
    return () => clearInterval(interval);
  }, [id, range]);

  const latest = useMemo(() => {
    if (metrics.length === 0) return null;
    return metrics[metrics.length - 1];
  }, [metrics]);

  const sysInfo = agentInfo?.agent?.system_info;

  const formatBytes = (bytes?: number): string => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const formatNetMBs = (bytesSec: number): string => {
    const mb = bytesSec / (1024 * 1024);
    if (mb < 0.1) {
      const kb = bytesSec / 1024;
      return `${kb.toFixed(1)} KB/s`;
    }
    return `${mb.toFixed(2)} MB/s`;
  };

  const formatUptime = (seconds?: number): string => {
    if (!seconds || seconds <= 0) return 'Just started';
    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const mins = Math.floor((seconds % 3600) / 60);

    if (days > 0) return `${days}d ${hours}h ${mins}m`;
    if (hours > 0) return `${hours}h ${mins}m`;
    return `${mins}m`;
  };

  const handleCopyInstallCommand = (cmd: string) => {
    navigator.clipboard.writeText(cmd);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const handleRegenerateToken = async () => {
    if (!id || !confirm('Are you sure you want to regenerate the agent token? The existing agent service will stop reporting until reconfigured.')) return;
    try {
      const res = await api.monitoring.regenerateToken(id);
      setAgentInfo({
        agent: res.agent,
        rawToken: res.rawToken,
        installLinux: res.installLinux,
        installWindows: res.installWindows,
      });
    } catch (err: any) {
      alert(`Failed to regenerate token: ${err.message}`);
    }
  };

  // Prepare chart series
  const cpuSeries: ChartSeries[] = [
    {
      name: 'Overall CPU',
      color: '#3b82f6', // Brand blue
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: p.cpu_usage })),
    },
  ];

  const memSeries: ChartSeries[] = [
    {
      name: 'RAM %',
      color: '#8b5cf6', // Purple
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: p.ram_percent })),
    },
  ];

  if (metrics.some((p) => p.swap_percent !== undefined && (p.swap_percent || 0) > 0)) {
    memSeries.push({
      name: 'Swap %',
      color: '#ec4899', // Pink
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: p.swap_percent || 0 })),
    });
  }

  const diskIOSeries: ChartSeries[] = [
    {
      name: 'Read',
      color: '#10b981', // Emerald
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: (p.disk_read_bytes_sec || 0) / (1024 * 1024) })),
    },
    {
      name: 'Write',
      color: '#f59e0b', // Amber
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: (p.disk_write_bytes_sec || 0) / (1024 * 1024) })),
    },
  ];

  const netSeries: ChartSeries[] = [
    {
      name: 'Download (RX)',
      color: '#06b6d4', // Cyan
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: (p.net_rx_bytes_sec || 0) / (1024 * 1024) })),
    },
    {
      name: 'Upload (TX)',
      color: '#3b82f6', // Blue
      data: metrics.map((p) => ({ timestamp: p.timestamp, value: (p.net_tx_bytes_sec || 0) / (1024 * 1024) })),
    },
  ];

  const hasTemp = metrics.some((p) => p.cpu_temp !== null && p.cpu_temp !== undefined);
  const tempSeries: ChartSeries[] = hasTemp
    ? [
        {
          name: 'CPU Temp',
          color: '#f97316', // Orange
          data: metrics
            .filter((p) => p.cpu_temp !== null && p.cpu_temp !== undefined)
            .map((p) => ({ timestamp: p.timestamp, value: p.cpu_temp! })),
        },
      ]
    : [];

  const hasLoad = metrics.some((p) => p.load_1 !== null && p.load_1 !== undefined);
  const loadSeries: ChartSeries[] = hasLoad
    ? [
        {
          name: '1m Load',
          color: '#60a5fa',
          data: metrics
            .filter((p) => p.load_1 !== null && p.load_1 !== undefined)
            .map((p) => ({ timestamp: p.timestamp, value: p.load_1! })),
        },
        {
          name: '5m Load',
          color: '#a78bfa',
          data: metrics
            .filter((p) => p.load_5 !== null && p.load_5 !== undefined)
            .map((p) => ({ timestamp: p.timestamp, value: p.load_5! })),
        },
        {
          name: '15m Load',
          color: '#f472b6',
          data: metrics
            .filter((p) => p.load_15 !== null && p.load_15 !== undefined)
            .map((p) => ({ timestamp: p.timestamp, value: p.load_15! })),
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        
        {/* Navigation Breadcrumb & Actions */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/monitoring"
              className="p-2 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-slate-400 hover:text-white transition-colors"
              title="Back to Monitoring Overview"
            >
              <SymbolIcon name="chevron.left" className="w-4 h-4" />
            </Link>

            <div>
              <div className="flex items-center gap-2.5">
                <h1 className="text-xl font-bold text-white">
                  {sysInfo?.hostname || 'Device Telemetry'}
                </h1>
                <span
                  className={`flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium border ${
                    agentInfo?.agent?.status === 'online'
                      ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20'
                      : agentInfo?.agent?.status === 'pending'
                      ? 'bg-amber-500/10 text-amber-400 border-amber-500/20'
                      : 'bg-red-500/10 text-red-400 border-red-500/20'
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      agentInfo?.agent?.status === 'online'
                        ? 'bg-emerald-400 animate-pulse'
                        : agentInfo?.agent?.status === 'pending'
                        ? 'bg-amber-400'
                        : 'bg-red-400'
                    }`}
                  />
                  <span className="capitalize">{agentInfo?.agent?.status || 'Unknown'}</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 font-mono mt-0.5">
                {sysInfo?.os ? `${sysInfo.os} ${sysInfo.platform_version}` : 'Waiting for agent metadata...'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => setIsInstallModalOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-slate-300 hover:text-white text-xs font-medium transition-colors flex items-center gap-1.5"
            >
              <SymbolIcon name="terminal.fill" className="w-3.5 h-3.5 text-slate-400" />
              <span>Install Command</span>
            </button>

            {id && (
              <button
                onClick={() => navigate(`/session/${id}`)}
                className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow transition-all flex items-center gap-1.5"
              >
                <SymbolIcon name="play.fill" className="w-3.5 h-3.5" />
                <span>Connect Remote Session</span>
              </button>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 rounded-2xl bg-danger/10 border border-danger/20 text-danger text-xs flex items-center gap-2">
            <SymbolIcon name="exclamationmark.triangle.fill" className="w-4 h-4 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* System Specs Banner */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="cpu" className="w-3 h-3 text-brand-400" />
              <span>CPU Processor</span>
            </p>
            <p className="text-xs font-bold text-white truncate" title={sysInfo?.cpu_model || '—'}>
              {sysInfo?.cpu_model || '—'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {sysInfo?.cpu_cores ? `${sysInfo.cpu_cores} Cores` : '—'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="memorychip" className="w-3 h-3 text-purple-400" />
              <span>Total Memory</span>
            </p>
            <p className="text-xs font-bold text-white font-mono">
              {sysInfo?.total_ram ? formatBytes(sysInfo.total_ram) : '—'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {latest ? `Used: ${latest.ram_percent.toFixed(0)}%` : '—'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="internaldrive.fill" className="w-3 h-3 text-emerald-400" />
              <span>Total Storage</span>
            </p>
            <p className="text-xs font-bold text-white font-mono">
              {sysInfo?.total_disk ? formatBytes(sysInfo.total_disk) : '—'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {sysInfo?.disks ? `${sysInfo.disks.length} Volumes` : '—'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="clock.arrow.circlepath" className="w-3 h-3 text-amber-400" />
              <span>System Uptime</span>
            </p>
            <p className="text-xs font-bold text-white">
              {formatUptime(latest?.uptime)}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {sysInfo?.kernel ? `Kernel ${sysInfo.kernel.split('-')[0]}` : '—'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="network" className="w-3 h-3 text-cyan-400" />
              <span>Network Throughput</span>
            </p>
            <p className="text-xs font-bold text-white font-mono">
              ↓ {latest ? formatNetMBs(latest.net_rx_bytes_sec || 0) : '0 MB/s'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              ↑ {latest ? formatNetMBs(latest.net_tx_bytes_sec || 0) : '0 MB/s'}
            </p>
          </div>

          <div className="p-3.5 rounded-2xl bg-surface-card border border-surface-border">
            <p className="text-[10px] text-slate-400 uppercase tracking-wider mb-1 flex items-center gap-1">
              <SymbolIcon name="gearshape.fill" className="w-3 h-3 text-slate-400" />
              <span>Agent Version</span>
            </p>
            <p className="text-xs font-bold text-white font-mono">
              v{sysInfo?.agent_version || '1.0.0'}
            </p>
            <p className="text-[10px] text-slate-500 font-mono mt-0.5">
              {sysInfo?.arch ? `${sysInfo.arch}` : '—'}
            </p>
          </div>
        </div>

        {/* Time Range Selector Bar */}
        <div className="flex items-center justify-between gap-3 p-2 rounded-2xl bg-surface border border-surface-border">
          <div className="flex items-center gap-1.5 text-xs text-slate-400 font-medium pl-2">
            <SymbolIcon name="chart.xyaxis.line" className="w-4 h-4 text-brand-400" />
            <span>Time Range:</span>
          </div>

          <div className="flex items-center gap-1 overflow-x-auto">
            {(['1h', '6h', '24h', '7d', '30d', '120d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1 rounded-lg text-xs font-mono font-medium transition-colors ${
                  range === r
                    ? 'bg-brand-500/20 text-brand-300 border border-brand-500/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                {r}
              </button>
            ))}
          </div>
        </div>

        {/* Interactive Charts Grid */}
        {loading ? (
          <div className="py-20 flex flex-col items-center justify-center text-slate-400">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-brand-500 mb-3" />
            <p className="text-xs">Loading time-series metrics...</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
            
            {/* 1. CPU Usage Chart */}
            <MetricChart
              title="CPU Utilization"
              unit="%"
              series={cpuSeries}
              maxY={100}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
            />

            {/* 2. Memory & Swap Chart */}
            <MetricChart
              title="Memory & Swap Utilization"
              unit="%"
              series={memSeries}
              maxY={100}
              valueFormatter={(v) => `${v.toFixed(1)}%`}
            />

            {/* 3. Disk I/O Rate Chart */}
            <MetricChart
              title="Disk Read / Write I/O Rate"
              unit="MB/s"
              series={diskIOSeries}
              valueFormatter={(v) => `${v.toFixed(2)} MB/s`}
            />

            {/* 4. Network Throughput Chart */}
            <MetricChart
              title="Network Throughput"
              unit="MB/s"
              series={netSeries}
              valueFormatter={(v) => `${v.toFixed(2)} MB/s`}
            />

            {/* 5. CPU Temperature Chart (If available) */}
            {hasTemp && (
              <MetricChart
                title="CPU Temperature"
                unit="°C"
                series={tempSeries}
                maxY={100}
                valueFormatter={(v) => `${v.toFixed(0)}°C`}
              />
            )}

            {/* 6. System Load Average (If available) */}
            {hasLoad && (
              <MetricChart
                title="System Load Average"
                unit=""
                series={loadSeries}
                valueFormatter={(v) => v.toFixed(2)}
              />
            )}

          </div>
        )}

        {/* Mounted Disk Volumes Breakdown */}
        {latest?.disks && latest.disks.length > 0 && (
          <div className="p-5 rounded-3xl bg-surface-card border border-surface-border space-y-4">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <SymbolIcon name="internaldrive.fill" className="w-4 h-4 text-emerald-400" />
              <span>Mounted Storage Volumes</span>
            </h3>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {latest.disks.map((d, idx) => (
                <div key={idx} className="p-3.5 rounded-2xl bg-surface border border-surface-border space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-white truncate">{d.mount_point}</p>
                      <p className="text-[10px] text-slate-500 font-mono truncate">{d.device} ({d.fs_type})</p>
                    </div>
                    <span className="text-xs font-bold text-slate-200 font-mono">
                      {d.used_pct.toFixed(0)}%
                    </span>
                  </div>

                  <div className="w-full h-2 rounded-full bg-surface-card overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        d.used_pct >= 90
                          ? 'bg-danger'
                          : d.used_pct >= 75
                          ? 'bg-amber-400'
                          : 'bg-emerald-500'
                      }`}
                      style={{ width: `${Math.min(d.used_pct, 100)}%` }}
                    />
                  </div>

                  <div className="flex justify-between text-[10px] text-slate-400 font-mono">
                    <span>Used: {formatBytes(d.used_bytes)}</span>
                    <span>Free: {formatBytes(d.free_bytes)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>

      {/* Install Command & Token Modal */}
      {isInstallModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75 backdrop-blur-sm">
          <div className="w-full max-w-xl rounded-3xl bg-surface-card border border-surface-border shadow-2xl p-6 space-y-5 animate-in fade-in zoom-in-95">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <SymbolIcon name="terminal.fill" className="w-5 h-5 text-brand-400" />
                <span>Monitoring Agent Setup</span>
              </h3>
              <button onClick={() => setIsInstallModalOpen(false)} className="text-slate-400 hover:text-white">
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-slate-400">
              Run this single command on the target host to automatically download, install, and register the Shoreline monitoring service with boot persistence.
            </p>

            {/* Platform Selector Tabs */}
            <div className="flex rounded-xl bg-surface p-1 border border-surface-border">
              <button
                onClick={() => setActiveInstallTab('linux')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeInstallTab === 'linux'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Linux (x86_64 / ARM / Raspberry Pi)
              </button>
              <button
                onClick={() => setActiveInstallTab('windows')}
                className={`flex-1 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                  activeInstallTab === 'windows'
                    ? 'bg-brand-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                Windows (PowerShell)
              </button>
            </div>

            {/* Command Box */}
            <div className="relative">
              <pre className="p-3.5 rounded-2xl bg-surface border border-surface-border text-xs font-mono text-emerald-400 overflow-x-auto whitespace-pre-wrap break-all select-all">
                {activeInstallTab === 'linux' ? agentInfo?.installLinux : agentInfo?.installWindows}
              </pre>
            </div>

            <div className="flex items-center justify-between pt-2">
              <button
                onClick={handleRegenerateToken}
                className="text-[11px] text-danger hover:underline font-medium flex items-center gap-1"
              >
                <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3 h-3" />
                <span>Regenerate Token</span>
              </button>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => setIsInstallModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-xl text-slate-400 hover:text-white text-xs"
                >
                  Close
                </button>
                <button
                  onClick={() =>
                    handleCopyInstallCommand(
                      activeInstallTab === 'linux' ? agentInfo?.installLinux || '' : agentInfo?.installWindows || ''
                    )
                  }
                  className="px-4 py-1.5 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow flex items-center gap-1.5"
                >
                  <SymbolIcon name={copied ? 'checkmark' : 'doc.on.clipboard'} className="w-3.5 h-3.5" />
                  <span>{copied ? 'Copied!' : 'Copy Command'}</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
};
