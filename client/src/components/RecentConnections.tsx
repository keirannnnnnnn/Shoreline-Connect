import React from 'react';
import { useNavigate } from 'react-router-dom';
import { SymbolIcon } from './SymbolIcon.js';

interface RecentItem {
  device_id: string;
  device_name: string;
  protocol: string;
  last_connected_at: string;
  host: string;
  port: number;
  folder_name?: string;
  is_favorite?: number;
}

interface RecentConnectionsProps {
  recents: RecentItem[];
}

export const RecentConnections: React.FC<RecentConnectionsProps> = ({ recents }) => {
  const navigate = useNavigate();

  if (!recents || recents.length === 0) {
    return null;
  }

  const formatTimeAgo = (dateStr: string) => {
    const diffMs = Date.now() - new Date(dateStr).getTime();
    const diffMins = Math.floor(diffMs / (60 * 1000));
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
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

  return (
    <div className="mb-8">
      <div className="flex items-center gap-2 mb-3.5">
        <SymbolIcon name="clock.arrow.circlepath" className="w-4 h-4 text-brand-400" />
        <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-300">
          Recent Connections
        </h2>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3.5">
        {recents.map((item) => (
          <div
            key={item.device_id}
            onClick={() => navigate(`/session/${item.device_id}`)}
            className="group rounded-xl bg-surface-card/90 hover:bg-surface-hover border border-surface-border hover:border-surface-borderLight p-3.5 transition-all duration-150 cursor-pointer shadow-sm flex items-center justify-between gap-3"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center border flex-shrink-0 ${getColorForProto(item.protocol)}`}>
                <SymbolIcon name={getIconForProto(item.protocol)} className="w-4 h-4" />
              </div>
              <div className="min-w-0">
                <p className="font-semibold text-sm text-slate-200 group-hover:text-white truncate">
                  {item.device_name}
                </p>
                <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                  <span className="uppercase font-mono font-medium text-[10px] text-slate-500">{item.protocol}</span>
                  <span>•</span>
                  <span>{formatTimeAgo(item.last_connected_at)}</span>
                </div>
              </div>
            </div>

            <div className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg bg-surface-active text-slate-300 flex-shrink-0">
              <SymbolIcon name="arrow.up.right" className="w-3.5 h-3.5" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};
