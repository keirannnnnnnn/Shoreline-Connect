import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Device, Folder } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';

interface SearchModalProps {
  isOpen: boolean;
  onClose: () => void;
  devices: Device[];
  folders: Folder[];
}

export const SearchModal: React.FC<SearchModalProps> = ({
  isOpen,
  onClose,
  devices,
  folders,
}) => {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        // Toggle search
      }
      if (e.key === 'Escape' && isOpen) {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const folderMap = new Map(folders.map((f) => [f.id, f]));
  const lowerQuery = query.toLowerCase().trim();

  // Find matching folders
  const matchingFolderIds = new Set(
    folders
      .filter((f) => f.name.toLowerCase().includes(lowerQuery))
      .map((f) => f.id)
  );

  const filteredDevices = devices.filter((d) => {
    if (!lowerQuery) return true;
    const nameMatch = d.name.toLowerCase().includes(lowerQuery);
    const hostMatch = d.host.toLowerCase().includes(lowerQuery);
    const protoMatch = d.protocol.toLowerCase().includes(lowerQuery);
    const folderNameMatch = (d.folder_name && d.folder_name.toLowerCase().includes(lowerQuery)) || (d.folder_id && matchingFolderIds.has(d.folder_id));
    return nameMatch || hostMatch || protoMatch || folderNameMatch;
  });

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-20 p-4">
      <div className="fixed inset-0 bg-black/80 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-xl rounded-3xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95">
        <div className="p-4 border-b border-surface-border flex items-center gap-3">
          <SymbolIcon name="magnifyingglass" className="w-5 h-5 text-slate-400" />
          <input
            autoFocus
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search devices by name, IP, protocol, or folder..."
            className="w-full bg-transparent text-white placeholder-slate-500 text-sm focus:outline-none"
          />
          <kbd className="px-2 py-0.5 text-[10px] font-mono bg-surface text-slate-400 border border-surface-border rounded">
            ESC
          </kbd>
        </div>

        <div className="max-h-80 overflow-y-auto p-2 space-y-1">
          {filteredDevices.length === 0 ? (
            <div className="p-8 text-center text-xs text-slate-500">
              No matching devices found for "{query}"
            </div>
          ) : (
            filteredDevices.map((d) => {
              const matchedFolder = d.folder_id ? folderMap.get(d.folder_id) : null;
              return (
                <div
                  key={d.id}
                  onClick={() => {
                    onClose();
                    navigate(`/session/${d.id}`);
                  }}
                  className="flex items-center justify-between p-3 rounded-2xl hover:bg-surface-hover cursor-pointer transition-colors group"
                >
                  <div className="flex items-center gap-3">
                    <div className={`w-8 h-8 rounded-xl flex items-center justify-center text-xs font-bold ${
                      d.protocol === 'rdp' ? 'bg-blue-500/10 text-blue-400' :
                      d.protocol === 'ssh' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-amber-500/10 text-amber-400'
                    }`}>
                      <SymbolIcon
                        name={d.protocol === 'rdp' ? 'display' : d.protocol === 'ssh' ? 'terminal' : 'display.2'}
                        className="w-4 h-4"
                      />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-slate-200 group-hover:text-white">{d.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{d.host}:{d.port}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {matchedFolder ? (
                      <span
                        className="px-2 py-0.5 text-[10px] rounded-md border flex items-center gap-1 font-medium"
                        style={{
                          backgroundColor: `${matchedFolder.color}15`,
                          borderColor: `${matchedFolder.color}30`,
                          color: matchedFolder.color,
                        }}
                      >
                        <SymbolIcon name={matchedFolder.icon || 'folder.fill'} className="w-2.5 h-2.5" />
                        <span>{matchedFolder.name}</span>
                      </span>
                    ) : d.folder_name ? (
                      <span className="px-2 py-0.5 text-[10px] rounded-md bg-surface text-slate-400 border border-surface-border">
                        {d.folder_name}
                      </span>
                    ) : null}
                    <span className="text-xs text-brand-400 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 font-semibold">
                      Connect <SymbolIcon name="arrow.right" className="w-3 h-3" />
                    </span>
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
};
