import React, { useState, useEffect } from 'react';
import { Device, Folder } from '../types/index.js';
import { SymbolIcon } from './SymbolIcon.js';
import { api } from '../lib/api.js';

interface FolderModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
  folder?: Folder | null;
  devices: Device[];
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
  folder,
  devices,
}) => {
  const [name, setName] = useState('');
  const [selectedIcon, setSelectedIcon] = useState('folder.fill');
  const [selectedColor, setSelectedColor] = useState('#3b82f6');
  const [selectedDeviceIds, setSelectedDeviceIds] = useState<Set<string>>(new Set());
  const [deviceSearch, setDeviceSearch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Filter out shared devices (only own devices can be assigned to folders)
  const ownDevices = devices.filter((d) => !d.is_shared);

  useEffect(() => {
    if (folder) {
      setName(folder.name);
      setSelectedIcon(folder.icon || 'folder.fill');
      setSelectedColor(folder.color || '#3b82f6');
      const inFolder = new Set(
        devices.filter((d) => d.folder_id === folder.id).map((d) => d.id)
      );
      setSelectedDeviceIds(inFolder);
    } else {
      setName('');
      setSelectedIcon('folder.fill');
      setSelectedColor('#3b82f6');
      setSelectedDeviceIds(new Set());
    }
    setDeviceSearch('');
    setError(null);
  }, [folder, isOpen, devices]);

  const toggleDevice = (devId: string) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      if (next.has(devId)) {
        next.delete(devId);
      } else {
        next.add(devId);
      }
      return next;
    });
  };

  const handleSelectAllFiltered = (filteredIds: string[]) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      filteredIds.forEach((id) => next.add(id));
      return next;
    });
  };

  const handleDeselectAllFiltered = (filteredIds: string[]) => {
    setSelectedDeviceIds((prev) => {
      const next = new Set(prev);
      filteredIds.forEach((id) => next.delete(id));
      return next;
    });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;

    setLoading(true);
    setError(null);
    try {
      if (folder) {
        // Update device assignments for existing folder
        await api.folders.updateDevices(folder.id, Array.from(selectedDeviceIds));
      } else {
        // Create new folder with selected existing devices
        await api.folders.create({
          name: name.trim(),
          icon: selectedIcon,
          color: selectedColor,
          deviceIds: Array.from(selectedDeviceIds),
        });
      }
      onSuccess();
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to save folder');
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  const filteredOwnDevices = ownDevices.filter(
    (d) =>
      d.name.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.host.toLowerCase().includes(deviceSearch.toLowerCase()) ||
      d.protocol.toLowerCase().includes(deviceSearch.toLowerCase())
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="fixed inset-0 bg-black/75 backdrop-blur-sm" onClick={onClose} />

      <div className="relative w-full max-w-lg rounded-3xl bg-surface-card border border-surface-border shadow-2xl overflow-hidden z-10 animate-in fade-in zoom-in-95 flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="px-6 py-5 border-b border-surface-border flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <div
              className="w-10 h-10 rounded-xl flex items-center justify-center border"
              style={{
                backgroundColor: `${selectedColor}15`,
                borderColor: `${selectedColor}30`,
                color: selectedColor,
              }}
            >
              <SymbolIcon name={selectedIcon} className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">
                {folder ? `Manage Folder: ${folder.name}` : 'Create Custom Folder'}
              </h2>
              <p className="text-xs text-slate-400">
                Organize and assign your existing devices
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-xl text-slate-400 hover:text-white">
            <SymbolIcon name="xmark" className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit} className="p-6 space-y-4 overflow-y-auto flex-1">
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
              placeholder="e.g. Production VM Cluster, Bastions, Raspberry Pis"
              className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-sm focus:ring-1 focus:ring-brand-500 focus:outline-none"
            />
          </div>

          {!folder && (
            <>
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
            </>
          )}

          {/* Device Selection Checklist */}
          <div className="pt-2">
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs font-semibold text-slate-300">
                Select Existing Devices ({selectedDeviceIds.size} selected)
              </label>
              {filteredOwnDevices.length > 0 && (
                <div className="flex items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => handleSelectAllFiltered(filteredOwnDevices.map((d) => d.id))}
                    className="text-brand-400 hover:text-brand-300 font-medium"
                  >
                    Select All
                  </button>
                  <span className="text-slate-600">•</span>
                  <button
                    type="button"
                    onClick={() => handleDeselectAllFiltered(filteredOwnDevices.map((d) => d.id))}
                    className="text-slate-400 hover:text-slate-300 font-medium"
                  >
                    Clear
                  </button>
                </div>
              )}
            </div>

            {/* Quick search inside device list */}
            {ownDevices.length > 4 && (
              <div className="mb-2">
                <input
                  type="text"
                  value={deviceSearch}
                  onChange={(e) => setDeviceSearch(e.target.value)}
                  placeholder="Filter existing devices..."
                  className="w-full px-3 py-1.5 rounded-xl bg-surface border border-surface-border text-white text-xs placeholder-slate-500 focus:outline-none focus:border-brand-500"
                />
              </div>
            )}

            <div className="max-h-48 overflow-y-auto rounded-2xl bg-surface border border-surface-border p-2 space-y-1">
              {ownDevices.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  No devices available to add yet.
                </p>
              ) : filteredOwnDevices.length === 0 ? (
                <p className="text-xs text-slate-500 text-center py-4">
                  No devices matching filter.
                </p>
              ) : (
                filteredOwnDevices.map((dev) => {
                  const isChecked = selectedDeviceIds.has(dev.id);
                  return (
                    <label
                      key={dev.id}
                      onClick={() => toggleDevice(dev.id)}
                      className={`flex items-center justify-between p-2.5 rounded-xl cursor-pointer transition-colors ${
                        isChecked
                          ? 'bg-brand-500/10 border border-brand-500/30'
                          : 'hover:bg-surface-hover border border-transparent'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div
                          className={`w-4 h-4 rounded flex items-center justify-center border transition-colors ${
                            isChecked
                              ? 'bg-brand-500 border-brand-500 text-white'
                              : 'border-slate-600 bg-surface'
                          }`}
                        >
                          {isChecked && <SymbolIcon name="checkmark" className="w-3 h-3" />}
                        </div>
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-white truncate">{dev.name}</p>
                          <p className="text-[10px] text-slate-400 font-mono truncate">{dev.host}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        <span className="uppercase text-[9px] font-mono px-1.5 py-0.5 rounded bg-black/20 text-slate-400">
                          {dev.protocol}
                        </span>
                        {dev.folder_name && dev.folder_id !== folder?.id && (
                          <span className="text-[9px] text-slate-500 truncate max-w-[80px]">
                            (in {dev.folder_name})
                          </span>
                        )}
                      </div>
                    </label>
                  );
                })
              )}
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
              {folder ? 'Save Changes' : 'Create Folder'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
