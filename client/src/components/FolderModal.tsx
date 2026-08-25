import React, { useState } from 'react';
import { SymbolIcon } from './SymbolIcon.js';
import { api } from '../lib/api.js';

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

const AVAILABLE_ICONS = [
  'folder.fill',
  'server.rack',
  'desktopcomputer',
  'cpu',
  'network',
  'cloud.fill',
  'house.fill',
  'building.2.fill',
  'lock.fill',
  'shield.fill',
  'terminal.fill',
  'macbook',
];

const AVAILABLE_COLORS = [
  '#3b82f6', // blue
  '#10b981', // emerald
  '#f59e0b', // amber
  '#8b5cf6', // purple
  '#ec4899', // pink
  '#06b6d4', // cyan
  '#64748b', // slate
];

export const FolderModal: React.FC<FolderModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
}) => {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('folder.fill');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      await api.folders.create({
        name: name.trim(),
        icon: selectedIcon,
        color: selectedColor,
      });
      setName('');
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create folder');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-md rounded-3xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95">
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-brand-500/10 border border-brand-500/20 flex items-center justify-center text-brand-400">
              <SymbolIcon name={selectedIcon} className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Create Custom Folder</h2>
              <p className="text-xs text-slate-400">Organize your devices into custom groupings</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white">
            <SymbolIcon name="xmark" className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && (
            <div className="p-3 rounded-xl bg-danger/10 border border-danger/20 text-danger text-xs">
              {error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Folder Name
            </label>
            <input
              type="text"
              required
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Production VM Cluster, Home Lab, Bastions"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm focus:ring-1 focus:ring-brand-500 focus:outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Choose Icon
            </label>
            <div className="grid grid-cols-6 gap-2">
              {AVAILABLE_ICONS.map((icon) => (
                <button
                  key={icon}
                  type="button"
                  onClick={() => setSelectedIcon(icon)}
                  className={`p-2.5 rounded-xl border flex items-center justify-center transition-all ${
                    selectedIcon === icon
                      ? 'bg-brand-500/20 border-brand-500 text-brand-400'
                      : 'bg-surface hover:bg-surface-hover border-surface-border text-slate-400'
                  }`}
                >
                  <SymbolIcon name={icon} className="w-4 h-4" />
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              Choose Color Theme
            </label>
            <div className="flex items-center gap-2.5">
              {AVAILABLE_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => setSelectedColor(c)}
                  style={{ backgroundColor: c }}
                  className={`w-7 h-7 rounded-full transition-transform ${
                    selectedColor === c ? 'scale-125 ring-2 ring-white' : 'opacity-75 hover:opacity-100'
                  }`}
                />
              ))}
            </div>
          </div>

          <div className="pt-3 border-t border-surface-border flex justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 rounded-xl text-slate-400 hover:text-white text-xs font-semibold"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !name.trim()}
              className="px-5 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 text-white text-xs font-semibold shadow-glow shadow-brand-500/20 disabled:opacity-50"
            >
              Create Folder
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
