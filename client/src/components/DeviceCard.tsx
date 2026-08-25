import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Device } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';

interface DeviceCardProps {
  device: Device;
  onToggleFavorite: (id: string) => void;
  onShare: (device: Device) => void;
  onEdit?: (device: Device) => void;
  onDelete?: (device: Device) => void;
}

export const DeviceCard: React.FC<DeviceCardProps> = ({
  device,
  onToggleFavorite,
  onShare,
  onEdit,
  onDelete,
}) => {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  const getProtocolConfig = (proto: string) => {
    switch (proto.toLowerCase()) {
      case 'rdp':
        return {
          label: 'RDP',
          color: 'text-blue-400 bg-blue-500/10 border-blue-500/20',
          dot: 'bg-blue-400',
          icon: 'display',
          gradient: 'from-blue-600/20 to-transparent',
        };
      case 'ssh':
        return {
          label: 'SSH',
          color: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
          dot: 'bg-emerald-400',
          icon: 'terminal',
          gradient: 'from-emerald-600/20 to-transparent',
        };
      case 'vnc':
        return {
          label: 'VNC',
          color: 'text-amber-400 bg-amber-500/10 border-amber-500/20',
          dot: 'bg-amber-400',
          icon: 'display.2',
          gradient: 'from-amber-600/20 to-transparent',
        };
      default:
        return {
          label: proto.toUpperCase(),
          color: 'text-slate-400 bg-slate-500/10 border-slate-500/20',
          dot: 'bg-slate-400',
          icon: 'network',
          gradient: 'from-slate-600/20 to-transparent',
        };
    }
  };

  const pConfig = getProtocolConfig(device.protocol);

  const handleConnect = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigate(`/session/${device.id}`);
  };

  return (
    <div
      onClick={handleConnect}
      className="group relative rounded-2xl bg-surface-card hover:bg-surface-hover/80 border border-surface-border hover:border-surface-borderLight p-5 transition-all duration-200 cursor-pointer shadow-card flex flex-col justify-between overflow-hidden"
    >
      {/* Top subtle protocol accent gradient */}
      <div className={`absolute top-0 left-0 right-0 h-1 bg-gradient-to-r ${pConfig.gradient}`} />

      {/* Header: Protocol Badge + Name + Actions */}
      <div>
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold uppercase tracking-wider border flex items-center gap-1.5 ${pConfig.color}`}>
              <SymbolIcon name={pConfig.icon} className="w-3.5 h-3.5" />
              <span>{pConfig.label}</span>
            </span>

            {device.folder_name && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-surface-active text-slate-300 border border-surface-border flex items-center gap-1 truncate max-w-[120px]">
                <SymbolIcon name="folder.fill" className="w-3 h-3 text-brand-400" />
                <span className="truncate">{device.folder_name}</span>
              </span>
            )}

            {device.is_shared && (
              <span className="px-2 py-0.5 rounded-md text-[11px] font-medium bg-purple-500/10 text-purple-300 border border-purple-500/20 flex items-center gap-1">
                <SymbolIcon name="person.2.fill" className="w-3 h-3" />
                <span>Shared by {device.shared_by_user || 'User'}</span>
              </span>
            )}
          </div>

          {/* Top Right Action Icons */}
          <div className="flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
            {/* Star / Favorite */}
            {!device.is_shared && (
              <button
                onClick={() => onToggleFavorite(device.id)}
                className={`p-1.5 rounded-lg hover:bg-surface-active transition-colors ${
                  device.is_favorite ? 'text-amber-400' : 'text-slate-500 hover:text-slate-300'
                }`}
                title={device.is_favorite ? 'Remove from favorites' : 'Add to favorites'}
              >
                <SymbolIcon
                  name={device.is_favorite ? 'star.fill' : 'star'}
                  className="w-4 h-4"
                />
              </button>
            )}

            {/* Share Trigger */}
            {!device.is_shared && (
              <button
                onClick={() => onShare(device)}
                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-active transition-colors"
                title="Share device (Internal or Guest Link)"
              >
                <SymbolIcon name="square.and.arrow.up" className="w-4 h-4" />
              </button>
            )}

            {/* 3-dots Menu for Edit / Delete */}
            {(!device.is_shared && (onEdit || onDelete)) && (
              <div className="relative">
                <button
                  onClick={() => setMenuOpen(!menuOpen)}
                  className="p-1.5 rounded-lg text-slate-500 hover:text-slate-300 hover:bg-surface-active transition-colors"
                  title="Device options"
                >
                  <SymbolIcon name="ellipsis" className="w-4 h-4" />
                </button>

                {menuOpen && (
                  <>
                    <div
                      className="fixed inset-0 z-40"
                      onClick={() => setMenuOpen(false)}
                    />
                    <div className="absolute right-0 mt-1 w-36 rounded-xl bg-surface-card border border-surface-border shadow-2xl p-1 z-50 text-xs animate-in fade-in zoom-in-95">
                      {onEdit && (
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            onEdit(device);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-slate-300 hover:text-white hover:bg-surface-hover transition-colors text-left"
                        >
                          <SymbolIcon name="pencil" className="w-3.5 h-3.5 text-slate-400" />
                          <span>Edit Device</span>
                        </button>
                      )}
                      {onDelete && (
                        <button
                          onClick={() => {
                            setMenuOpen(false);
                            onDelete(device);
                          }}
                          className="w-full flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-danger hover:bg-danger/10 transition-colors text-left"
                        >
                          <SymbolIcon name="trash" className="w-3.5 h-3.5" />
                          <span>Delete</span>
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Device Name */}
        <h3 className="font-semibold text-base text-slate-100 group-hover:text-white transition-colors truncate mb-1">
          {device.name}
        </h3>

        {/* Host / IP */}
        <div className="flex items-center gap-1.5 text-xs text-slate-400 font-mono">
          <SymbolIcon name="network" className="w-3.5 h-3.5 text-slate-500" />
          <span className="truncate">{device.host}:{device.port}</span>
        </div>
      </div>

      {/* Footer: Quick Connect Bar */}
      <div className="mt-5 pt-3 border-t border-surface-border/50 flex items-center justify-between">
        <span className="text-[11px] text-slate-500 flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
          Ready
        </span>

        <button
          onClick={handleConnect}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-surface-active hover:bg-brand-600 text-slate-200 hover:text-white text-xs font-semibold border border-surface-border hover:border-brand-500 shadow-sm transition-all group-hover:shadow-glow group-hover:shadow-brand-500/20"
        >
          <span>Connect</span>
          <SymbolIcon name="arrow.right" className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
        </button>
      </div>
    </div>
  );
};
