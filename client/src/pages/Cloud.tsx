import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { api } from '../lib/api.js';
import { CloudItem, CloudShare } from '../types/index.js';

const FOLDER_COLORS = [
  { name: 'Blue', hex: '#3b82f6' },
  { name: 'Cyan', hex: '#06b6d4' },
  { name: 'Emerald', hex: '#10b981' },
  { name: 'Teal', hex: '#14b8a6' },
  { name: 'Amber', hex: '#f59e0b' },
  { name: 'Orange', hex: '#f97316' },
  { name: 'Red', hex: '#ef4444' },
  { name: 'Purple', hex: '#8b5cf6' },
  { name: 'Pink', hex: '#ec4899' },
  { name: 'Slate', hex: '#64748b' },
];

export const Cloud: React.FC = () => {
  // Navigation & File list state
  const [currentPath, setCurrentPath] = useState<string>('');
  const [items, setItems] = useState<CloudItem[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Active Uploads progress (filename -> percent)
  const [uploadProgress, setUploadProgress] = useState<Record<string, number>>({});
  const [isDragOver, setIsDragOver] = useState<boolean>(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);

  // New Folder modal state
  const [isNewFolderOpen, setIsNewFolderOpen] = useState<boolean>(false);
  const [newFolderName, setNewFolderName] = useState<string>('');
  const [newFolderColor, setNewFolderColor] = useState<string>('#3b82f6');

  // Edit / Rename modal state
  const [editItemTarget, setEditItemTarget] = useState<CloudItem | null>(null);
  const [editNameValue, setEditNameValue] = useState<string>('');
  const [editColorValue, setEditColorValue] = useState<string>('#3b82f6');

  // Move modal state
  const [moveItemTarget, setMoveItemTarget] = useState<CloudItem | null>(null);
  const [moveDestination, setMoveDestination] = useState<string>('');
  const [availableFolders, setAvailableFolders] = useState<string[]>([]);

  // Permanent Share modal state
  const [shareItemTarget, setShareItemTarget] = useState<CloudItem | null>(null);
  const [shareExpiry, setShareExpiry] = useState<number | null>(null); // null = permanent
  const [sharePin, setSharePin] = useState<string>('');
  const [generatedPermanentLink, setGeneratedPermanentLink] = useState<string | null>(null);
  const [isGeneratingShare, setIsGeneratingShare] = useState<boolean>(false);

  // Active Shares list modal
  const [isSharesListOpen, setIsSharesListOpen] = useState<boolean>(false);
  const [activeShares, setActiveShares] = useState<CloudShare[]>([]);

  // Quick Link Modal State
  const [isQuickLinkOpen, setIsQuickLinkOpen] = useState<boolean>(false);
  const [quickLinkFile, setQuickLinkFile] = useState<File | null>(null);
  const [quickLinkProgress, setQuickLinkProgress] = useState<number>(0);
  const [quickLinkExpiry, setQuickLinkExpiry] = useState<number>(86400); // 24h default
  const [quickLinkPin, setQuickLinkPin] = useState<string>('');
  const [quickLinkResult, setQuickLinkResult] = useState<{ token: string; filename: string; expiresAt: number | null } | null>(null);
  const [quickLinkUploading, setQuickLinkUploading] = useState<boolean>(false);
  const [quickLinkCopied, setQuickLinkCopied] = useState<boolean>(false);
  const quickLinkInputRef = useRef<HTMLInputElement>(null);

  // Load directory items
  const loadFiles = useCallback(async (path: string = currentPath) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.cloud.getFiles(path);
      setItems(res.items);
      setCurrentPath(res.currentPath);
    } catch (err: any) {
      setError(err.message || 'Failed to load files');
    } finally {
      setLoading(false);
    }
  }, [currentPath]);

  useEffect(() => {
    loadFiles(currentPath);
  }, [currentPath, loadFiles]);

  // Load active shares
  const loadActiveShares = async () => {
    try {
      const res = await api.cloud.getShares();
      setActiveShares(res.shares);
    } catch (err) {
      console.error('Failed to load active shares', err);
    }
  };

  // Recursive Directory Scanner for Drag & Drop
  const scanDirectoryEntry = async (entry: any, basePath: string = ''): Promise<Array<{ file: File; relativePath: string }>> => {
    const results: Array<{ file: File; relativePath: string }> = [];

    if (entry.isFile) {
      const file: File = await new Promise((resolve, reject) => entry.file(resolve, reject));
      results.push({ file, relativePath: basePath ? `${basePath}/${entry.name}` : entry.name });
    } else if (entry.isDirectory) {
      const dirReader = entry.createReader();
      const readEntries = async (): Promise<any[]> => {
        return new Promise((resolve, reject) => {
          dirReader.readEntries(resolve, reject);
        });
      };

      let entries: any[] = [];
      let batch: any[] = await readEntries();
      while (batch.length > 0) {
        entries = entries.concat(batch);
        batch = await readEntries();
      }

      const nextBasePath = basePath ? `${basePath}/${entry.name}` : entry.name;
      for (const child of entries) {
        const nested = await scanDirectoryEntry(child, nextBasePath);
        results.push(...nested);
      }
    }

    return results;
  };

  // Upload batch of files (supporting relative paths for folders)
  const uploadFileList = async (fileEntries: Array<{ file: File; relativePath?: string }>) => {
    for (const item of fileEntries) {
      const displayName = item.relativePath || item.file.name;
      setUploadProgress((prev) => ({ ...prev, [displayName]: 0 }));
      try {
        await api.cloud.uploadFile(currentPath, item.file, (pct) => {
          setUploadProgress((prev) => ({ ...prev, [displayName]: pct }));
        }, item.relativePath);
      } catch (err: any) {
        alert(`Failed to upload ${displayName}: ${err.message}`);
      } finally {
        setUploadProgress((prev) => {
          const next = { ...prev };
          delete next[displayName];
          return next;
        });
      }
    }
    loadFiles(currentPath);
  };

  // Drag & drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      const fileEntries: Array<{ file: File; relativePath: string }> = [];
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        if (item.webkitGetAsEntry) {
          const entry = item.webkitGetAsEntry();
          if (entry) {
            const scanned = await scanDirectoryEntry(entry);
            fileEntries.push(...scanned);
          }
        } else {
          const file = item.getAsFile();
          if (file) fileEntries.push({ file, relativePath: file.name });
        }
      }
      if (fileEntries.length > 0) {
        await uploadFileList(fileEntries);
      }
    } else if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files).map((file) => ({ file, relativePath: file.name }));
      await uploadFileList(files);
    }
  };

  // File Input Change (Standard Files)
  const handleFileInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).map((file) => ({ file, relativePath: file.name }));
      await uploadFileList(files);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // Folder Input Change (Entire Directory Selection)
  const handleFolderInputChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      const files = Array.from(e.target.files).map((file) => ({
        file,
        relativePath: (file as any).webkitRelativePath || file.name,
      }));
      await uploadFileList(files);
      if (folderInputRef.current) folderInputRef.current.value = '';
    }
  };

  // Quick Link Upload handler
  const handleQuickLinkFileSelect = (file: File) => {
    setQuickLinkFile(file);
    setQuickLinkProgress(0);
    setQuickLinkResult(null);
    setQuickLinkUploading(true);

    api.cloud
      .uploadQuickLink(
        file,
        { expiresInSeconds: quickLinkExpiry, pin: quickLinkPin || undefined },
        (pct) => setQuickLinkProgress(pct)
      )
      .then((res) => {
        setQuickLinkResult({ token: res.token, filename: res.filename, expiresAt: res.expiresAt });
        setQuickLinkUploading(false);
      })
      .catch((err) => {
        alert(`Quick Link upload failed: ${err.message}`);
        setQuickLinkUploading(false);
        setQuickLinkFile(null);
      });
  };

  // Folder creation
  const handleCreateFolder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFolderName.trim()) return;
    const target = currentPath ? `${currentPath}/${newFolderName.trim()}` : newFolderName.trim();
    try {
      await api.cloud.createFolder(target, newFolderColor);
      setIsNewFolderOpen(false);
      setNewFolderName('');
      setNewFolderColor('#3b82f6');
      loadFiles(currentPath);
    } catch (err: any) {
      alert(`Error creating folder: ${err.message}`);
    }
  };

  // Edit / Rename / Color folder
  const handleSaveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editItemTarget || !editNameValue.trim()) return;
    try {
      const isFolder = editItemTarget.type === 'folder';
      await api.cloud.renameItem(
        editItemTarget.path,
        editNameValue.trim(),
        isFolder ? editColorValue : undefined
      );
      setEditItemTarget(null);
      loadFiles(currentPath);
    } catch (err: any) {
      alert(`Error saving changes: ${err.message}`);
    }
  };

  // Move
  const handleOpenMoveModal = async (item: CloudItem) => {
    setMoveItemTarget(item);
    setMoveDestination('');
    try {
      const rootRes = await api.cloud.getFiles('');
      const folderList: string[] = [''];
      rootRes.items.filter((i) => i.type === 'folder').forEach((f) => folderList.push(f.path));
      setAvailableFolders(folderList);
    } catch {
      setAvailableFolders(['']);
    }
  };

  const handleExecuteMove = async () => {
    if (!moveItemTarget) return;
    try {
      await api.cloud.moveItem(moveItemTarget.path, moveDestination);
      setMoveItemTarget(null);
      loadFiles(currentPath);
    } catch (err: any) {
      alert(`Error moving item: ${err.message}`);
    }
  };

  // Delete
  const handleDelete = async (item: CloudItem) => {
    if (!window.confirm(`Are you sure you want to delete "${item.name}"?`)) return;
    try {
      await api.cloud.deleteItem(item.path);
      loadFiles(currentPath);
    } catch (err: any) {
      alert(`Error deleting item: ${err.message}`);
    }
  };

  // Permanent Share Link generation
  const handleGeneratePermanentShare = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareItemTarget) return;
    setIsGeneratingShare(true);
    try {
      const res = await api.cloud.createPermanentShare(shareItemTarget.path, {
        pin: sharePin || undefined,
        expiresInSeconds: shareExpiry,
      });
      const fullUrl = `${window.location.origin}/share/cloud/${res.token}`;
      setGeneratedPermanentLink(fullUrl);
    } catch (err: any) {
      alert(`Error creating share link: ${err.message}`);
    } finally {
      setIsGeneratingShare(false);
    }
  };

  // Revoke Share
  const handleRevokeShare = async (shareId: string) => {
    if (!window.confirm('Revoke this share link? Temporary quick links will also have their file deleted.')) return;
    try {
      await api.cloud.revokeShare(shareId);
      loadActiveShares();
    } catch (err: any) {
      alert(`Error revoking share: ${err.message}`);
    }
  };

  // Helpers
  const formatBytes = (bytes: number | null): string => {
    if (bytes === null || bytes === undefined) return '—';
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
  };

  const getFileSymbol = (item: CloudItem): string => {
    if (item.type === 'folder') return 'folder.fill';
    const ext = item.name.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) return 'photo';
    if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'film';
    if (['mp3', 'wav', 'flac', 'aac'].includes(ext)) return 'music.note';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archivebox.fill';
    if (['pdf'].includes(ext)) return 'doc.richtext';
    if (['txt', 'md', 'json', 'csv', 'log', 'ts', 'js'].includes(ext)) return 'doc.text';
    return 'doc.fill';
  };

  // Filtered items
  const filteredItems = items.filter((item) =>
    item.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Breadcrumbs
  const pathSegments = currentPath ? currentPath.split('/') : [];

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      <Navbar />

      <main
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8 relative flex flex-col"
      >
        {/* Drag Overlay */}
        {isDragOver && (
          <div className="absolute inset-4 z-50 rounded-3xl bg-cyan-950/80 border-2 border-dashed border-cyan-400 backdrop-blur-md flex flex-col items-center justify-center pointer-events-none space-y-3">
            <SymbolIcon name="arrow.down.doc.fill" className="w-16 h-16 text-cyan-400 animate-bounce" />
            <h2 className="text-xl font-bold text-white">Drop files or folders to upload</h2>
            <p className="text-xs text-cyan-200">Everything will be uploaded directly to {currentPath || 'My Files'}</p>
          </div>
        )}

        {/* Hidden inputs */}
        <input ref={fileInputRef} type="file" multiple className="hidden" onChange={handleFileInputChange} />
        <input
          ref={folderInputRef}
          type="file"
          {...({ webkitdirectory: '', directory: '' } as any)}
          multiple
          className="hidden"
          onChange={handleFolderInputChange}
        />

        {/* Top Header Bar — Clean without subtitles */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-glow shadow-cyan-500/10">
              <SymbolIcon name="cloud.fill" className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-white tracking-tight">Cloud Drive</h1>
            </div>
          </div>

          {/* Action Bar */}
          <div className="flex items-center gap-2.5 flex-wrap">
            <button
              onClick={() => {
                loadActiveShares();
                setIsSharesListOpen(true);
              }}
              className="px-3 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-300 transition-all flex items-center gap-1.5"
            >
              <SymbolIcon name="link" className="w-3.5 h-3.5 text-slate-400" />
              <span>Active Shares</span>
            </button>

            <button
              onClick={() => {
                setNewFolderName('');
                setNewFolderColor('#3b82f6');
                setIsNewFolderOpen(true);
              }}
              className="px-3.5 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-200 transition-all flex items-center gap-1.5"
            >
              <SymbolIcon name="folder.badge.plus" className="w-4 h-4 text-cyan-400" />
              <span>New Folder</span>
            </button>

            {/* Upload File Button */}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl bg-surface-active hover:bg-surface-hover border border-cyan-500/30 text-xs font-semibold text-cyan-300 transition-all flex items-center gap-1.5 shadow-sm"
              title="Upload files"
            >
              <SymbolIcon name="arrow.up.doc.fill" className="w-4 h-4" />
              <span>Upload File</span>
            </button>

            {/* Upload Folder Button */}
            <button
              onClick={() => folderInputRef.current?.click()}
              className="px-3.5 py-2 rounded-xl bg-surface-active hover:bg-surface-hover border border-cyan-500/30 text-xs font-semibold text-cyan-300 transition-all flex items-center gap-1.5 shadow-sm"
              title="Upload an entire folder"
            >
              <SymbolIcon name="folder.fill" className="w-4 h-4" />
              <span>Upload Folder</span>
            </button>

            {/* Quick Link Button */}
            <button
              onClick={() => {
                setQuickLinkFile(null);
                setQuickLinkProgress(0);
                setQuickLinkResult(null);
                setQuickLinkPin('');
                setIsQuickLinkOpen(true);
              }}
              className="px-4 py-2 rounded-xl bg-gradient-to-r from-cyan-600 to-blue-600 hover:from-cyan-500 hover:to-blue-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-1.5"
            >
              <SymbolIcon name="bolt.fill" className="w-4 h-4 text-cyan-200" />
              <span>Quick Link</span>
            </button>
          </div>
        </div>

        {/* Upload Progress Drawer */}
        {Object.keys(uploadProgress).length > 0 && (
          <div className="mb-6 space-y-2 p-4 rounded-2xl bg-cyan-950/40 border border-cyan-500/30">
            <div className="text-xs font-bold text-cyan-300 flex items-center gap-2">
              <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-3.5 h-3.5 animate-spin" />
              <span>Uploading directly to disk...</span>
            </div>
            {Object.entries(uploadProgress).map(([fname, pct]) => (
              <div key={fname} className="space-y-1">
                <div className="flex justify-between text-[11px] text-slate-300">
                  <span className="truncate max-w-md">{fname}</span>
                  <span className="font-mono text-cyan-400">{pct}%</span>
                </div>
                <div className="w-full h-1.5 bg-black/40 rounded-full overflow-hidden">
                  <div className="h-full bg-cyan-500 transition-all duration-150" style={{ width: `${pct}%` }} />
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Navigation Breadcrumbs & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 mb-6 rounded-2xl bg-surface-card border border-surface-border">
          {/* Breadcrumb row */}
          <div className="flex items-center gap-1.5 text-xs overflow-x-auto py-0.5">
            <button
              onClick={() => setCurrentPath('')}
              className={`flex items-center gap-1 px-2.5 py-1 rounded-lg transition-all ${
                currentPath === ''
                  ? 'font-bold text-white bg-surface-active'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name="externaldrive.fill" className="w-3.5 h-3.5 text-cyan-400" />
              <span>My Files</span>
            </button>

            {pathSegments.map((segment, index) => {
              const segPath = pathSegments.slice(0, index + 1).join('/');
              const isLast = index === pathSegments.length - 1;
              return (
                <React.Fragment key={segPath}>
                  <span className="text-slate-600 font-mono">/</span>
                  <button
                    onClick={() => setCurrentPath(segPath)}
                    className={`px-2.5 py-1 rounded-lg transition-all ${
                      isLast
                        ? 'font-bold text-white bg-surface-active'
                        : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                    }`}
                  >
                    {segment}
                  </button>
                </React.Fragment>
              );
            })}
          </div>

          {/* Search & View Mode */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <SymbolIcon name="magnifyingglass" className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search files..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8 pr-3 py-1.5 rounded-xl bg-surface border border-surface-border text-xs text-white focus:outline-none focus:ring-1 focus:ring-cyan-500 w-36 sm:w-48 placeholder:text-slate-500"
              />
            </div>

            <div className="flex items-center p-0.5 rounded-xl bg-surface border border-surface-border">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'grid' ? 'bg-surface-active text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="Grid view"
              >
                <SymbolIcon name="square.grid.2x2.fill" className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-1.5 rounded-lg transition-all ${
                  viewMode === 'list' ? 'bg-surface-active text-white' : 'text-slate-400 hover:text-slate-200'
                }`}
                title="List view"
              >
                <SymbolIcon name="list.bullet" className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>

        {/* Content Explorer Canvas */}
        {loading ? (
          <div className="flex-1 flex flex-col items-center justify-center py-20 text-slate-400 space-y-3">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-cyan-400" />
            <p className="text-xs">Reading file catalog...</p>
          </div>
        ) : error ? (
          <div className="p-8 rounded-3xl bg-surface-card border border-surface-border text-center py-16 space-y-3">
            <SymbolIcon name="exclamationmark.triangle.fill" className="w-8 h-8 mx-auto text-amber-400" />
            <p className="text-sm font-semibold text-slate-200">{error}</p>
            <button
              onClick={() => loadFiles(currentPath)}
              className="px-4 py-2 bg-surface hover:bg-surface-hover text-xs font-semibold rounded-xl border border-surface-border text-slate-300"
            >
              Retry
            </button>
          </div>
        ) : filteredItems.length === 0 ? (
          /* Empty State */
          <div className="flex-1 rounded-3xl bg-surface-card/60 border border-surface-border/60 p-12 text-center flex flex-col items-center justify-center min-h-[350px] space-y-4">
            <div className="w-16 h-16 rounded-3xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400 shadow-inner">
              <SymbolIcon name="folder.fill" className="w-8 h-8" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-white">This folder is empty</h3>
              <p className="text-xs text-slate-400 mt-1 max-w-sm">
                Drag and drop files or entire folders here to upload.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white shadow-lg shadow-cyan-500/20 transition-all flex items-center gap-1.5"
              >
                <SymbolIcon name="arrow.up.doc.fill" className="w-3.5 h-3.5" />
                <span>Upload File</span>
              </button>
              <button
                onClick={() => folderInputRef.current?.click()}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover border border-surface-border text-xs font-semibold text-slate-200 transition-all flex items-center gap-1.5"
              >
                <SymbolIcon name="folder.fill" className="w-3.5 h-3.5 text-cyan-400" />
                <span>Upload Folder</span>
              </button>
            </div>
          </div>
        ) : viewMode === 'grid' ? (
          /* Grid View */
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-3.5">
            {filteredItems.map((item) => {
              const isFolder = item.type === 'folder';
              const folderColor = item.color || '#3b82f6';
              return (
                <div
                  key={item.path}
                  onDoubleClick={() => {
                    if (isFolder) setCurrentPath(item.path);
                  }}
                  className="group relative p-4 rounded-2xl bg-surface-card hover:bg-surface-hover border border-surface-border hover:border-cyan-500/40 transition-all flex flex-col justify-between cursor-pointer select-none"
                >
                  <div className="space-y-3">
                    <div className="flex items-start justify-between">
                      <div
                        onClick={() => {
                          if (isFolder) setCurrentPath(item.path);
                        }}
                        style={isFolder ? { backgroundColor: `${folderColor}18`, borderColor: `${folderColor}40`, color: folderColor } : undefined}
                        className={`w-12 h-12 rounded-2xl flex items-center justify-center border transition-all ${
                          isFolder
                            ? 'group-hover:scale-105 shadow-sm'
                            : 'bg-cyan-500/10 text-cyan-400 border-cyan-500/20 group-hover:scale-105'
                        }`}
                      >
                        <SymbolIcon name={getFileSymbol(item)} className="w-6 h-6" />
                      </div>

                      {/* Item Actions Hover Buttons */}
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1">
                        {!isFolder && (
                          <>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                api.cloud.downloadFile(item.path);
                              }}
                              title="Download"
                              className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-white"
                            >
                              <SymbolIcon name="arrow.down.circle.fill" className="w-3.5 h-3.5" />
                            </button>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                setShareItemTarget(item);
                                setShareExpiry(null);
                                setSharePin('');
                                setGeneratedPermanentLink(null);
                              }}
                              title="Share Link"
                              className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-cyan-400"
                            >
                              <SymbolIcon name="link" className="w-3.5 h-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setEditItemTarget(item);
                            setEditNameValue(item.name);
                            setEditColorValue(item.color || '#3b82f6');
                          }}
                          title={isFolder ? 'Edit Folder & Color' : 'Rename File'}
                          className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-white"
                        >
                          <SymbolIcon name="pencil" className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleOpenMoveModal(item);
                          }}
                          title="Move"
                          className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-white"
                        >
                          <SymbolIcon name="folder.fill" className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(item);
                          }}
                          title="Delete"
                          className="p-1.5 rounded-lg bg-surface hover:bg-surface-active text-slate-300 hover:text-red-400"
                        >
                          <SymbolIcon name="trash.fill" className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>

                    <div
                      onClick={() => {
                        if (isFolder) setCurrentPath(item.path);
                      }}
                    >
                      <p className="text-xs font-bold text-white truncate" title={item.name}>
                        {item.name}
                      </p>
                      <p className="text-[10px] text-slate-400 mt-0.5">
                        {isFolder ? 'Folder' : formatBytes(item.size_bytes)}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* List View */
          <div className="rounded-2xl bg-surface-card border border-surface-border overflow-hidden">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-surface-border bg-surface/60 text-slate-400">
                  <th className="text-left px-4 py-2.5 font-semibold">Name</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Size</th>
                  <th className="text-left px-4 py-2.5 font-semibold">Modified</th>
                  <th className="text-right px-4 py-2.5 font-semibold">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const isFolder = item.type === 'folder';
                  const folderColor = item.color || '#3b82f6';
                  return (
                    <tr
                      key={item.path}
                      onDoubleClick={() => {
                        if (isFolder) setCurrentPath(item.path);
                      }}
                      className="border-b border-surface-border/40 hover:bg-surface-hover/60 transition-colors group cursor-pointer"
                    >
                      <td
                        onClick={() => {
                          if (isFolder) setCurrentPath(item.path);
                        }}
                        className="px-4 py-3 font-semibold text-white flex items-center gap-2.5 max-w-md truncate"
                      >
                        <div
                          style={isFolder ? { color: folderColor } : undefined}
                          className={isFolder ? '' : 'text-cyan-400'}
                        >
                          <SymbolIcon name={getFileSymbol(item)} className="w-4 h-4" />
                        </div>
                        <span className="truncate" title={item.name}>
                          {item.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-slate-400">{isFolder ? '—' : formatBytes(item.size_bytes)}</td>
                      <td className="px-4 py-3 text-slate-400">{new Date(item.modified_at).toLocaleDateString()}</td>
                      <td className="px-4 py-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                          {!isFolder && (
                            <>
                              <button
                                onClick={() => api.cloud.downloadFile(item.path)}
                                title="Download"
                                className="p-1 rounded bg-surface text-slate-300 hover:text-white"
                              >
                                <SymbolIcon name="arrow.down.circle.fill" className="w-3.5 h-3.5" />
                              </button>
                              <button
                                onClick={() => {
                                  setShareItemTarget(item);
                                  setShareExpiry(null);
                                  setSharePin('');
                                  setGeneratedPermanentLink(null);
                                }}
                                title="Share Link"
                                className="p-1 rounded bg-surface text-slate-300 hover:text-cyan-400"
                              >
                                <SymbolIcon name="link" className="w-3.5 h-3.5" />
                              </button>
                            </>
                          )}
                          <button
                            onClick={() => {
                              setEditItemTarget(item);
                              setEditNameValue(item.name);
                              setEditColorValue(item.color || '#3b82f6');
                            }}
                            title={isFolder ? 'Edit Folder & Color' : 'Rename'}
                            className="p-1 rounded bg-surface text-slate-300 hover:text-white"
                          >
                            <SymbolIcon name="pencil" className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleOpenMoveModal(item)}
                            title="Move"
                            className="p-1 rounded bg-surface text-slate-300 hover:text-white"
                          >
                            <SymbolIcon name="folder.fill" className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(item)}
                            title="Delete"
                            className="p-1 rounded bg-surface text-slate-300 hover:text-red-400"
                          >
                            <SymbolIcon name="trash.fill" className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </main>

      {/* QUICK LINK MODAL */}
      {isQuickLinkOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-lg bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-6">
            <div className="flex items-center justify-between border-b border-surface-border pb-4">
              <div className="flex items-center gap-2.5">
                <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-cyan-500 to-blue-500 text-white flex items-center justify-center shadow-md shadow-cyan-500/20">
                  <SymbolIcon name="bolt.fill" className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-white">Create Quick Link</h3>
                  <p className="text-[11px] text-slate-400">Temporary instant upload & share</p>
                </div>
              </div>
              <button
                onClick={() => setIsQuickLinkOpen(false)}
                className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <input
              ref={quickLinkInputRef}
              type="file"
              className="hidden"
              onChange={(e) => {
                if (e.target.files && e.target.files[0]) {
                  handleQuickLinkFileSelect(e.target.files[0]);
                }
              }}
            />

            {!quickLinkFile ? (
              /* Drop zone */
              <div
                onClick={() => quickLinkInputRef.current?.click()}
                className="border-2 border-dashed border-cyan-500/40 hover:border-cyan-400 rounded-2xl p-8 text-center cursor-pointer bg-cyan-950/10 hover:bg-cyan-950/20 transition-all space-y-3"
              >
                <div className="w-12 h-12 rounded-2xl bg-cyan-500/10 text-cyan-400 flex items-center justify-center mx-auto">
                  <SymbolIcon name="arrow.up.circle.fill" className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-xs font-bold text-white">Click or drag file here</p>
                  <p className="text-[11px] text-slate-400 mt-0.5">Upload begins immediately upon file selection</p>
                </div>
              </div>
            ) : (
              /* File selected / Upload in progress */
              <div className="space-y-4">
                <div className="p-3.5 rounded-2xl bg-surface border border-surface-border space-y-2">
                  <div className="flex justify-between text-xs text-white">
                    <span className="font-semibold truncate max-w-xs">{quickLinkFile.name}</span>
                    <span className="font-mono text-cyan-400">{quickLinkProgress}%</span>
                  </div>
                  <div className="w-full h-2 bg-black/40 rounded-full overflow-hidden">
                    <div className="h-full bg-cyan-500 transition-all duration-150" style={{ width: `${quickLinkProgress}%` }} />
                  </div>
                  <p className="text-[10px] text-slate-400">
                    {quickLinkUploading ? 'Streaming file to disk...' : 'Upload complete!'}
                  </p>
                </div>

                {/* Expiry Presets */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Link Expiry</label>
                  <div className="grid grid-cols-4 gap-2">
                    {[
                      { label: '15 Mins', val: 900 },
                      { label: '1 Hour', val: 3600 },
                      { label: '24 Hours', val: 86400 },
                      { label: '7 Days', val: 604800 },
                    ].map((opt) => (
                      <button
                        key={opt.val}
                        type="button"
                        onClick={() => setQuickLinkExpiry(opt.val)}
                        className={`py-2 px-2.5 rounded-xl text-xs font-semibold border transition-all ${
                          quickLinkExpiry === opt.val
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40 shadow-sm'
                            : 'bg-surface text-slate-400 border-surface-border hover:bg-surface-hover'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Optional PIN */}
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                    Optional PIN Protection
                  </label>
                  <input
                    type="password"
                    placeholder="Leave empty for public link"
                    value={quickLinkPin}
                    onChange={(e) => setQuickLinkPin(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs font-mono focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder:text-slate-600"
                  />
                </div>

                {/* Generated Link Field */}
                {quickLinkResult && (
                  <div className="p-3 rounded-2xl bg-black/50 border border-cyan-500/30 space-y-2">
                    <label className="block text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                      Shareable URL
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        readOnly
                        value={`${window.location.origin}/share/cloud/${quickLinkResult.token}`}
                        className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-surface-border text-xs font-mono text-cyan-300 focus:outline-none select-all"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          navigator.clipboard.writeText(
                            `${window.location.origin}/share/cloud/${quickLinkResult.token}`
                          );
                          setQuickLinkCopied(true);
                          setTimeout(() => setQuickLinkCopied(false), 2000);
                        }}
                        className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold transition-all"
                      >
                        {quickLinkCopied ? 'Copied!' : 'Copy'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setIsQuickLinkOpen(false)}
                className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Close
              </button>
              {quickLinkResult && (
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(
                      `${window.location.origin}/share/cloud/${quickLinkResult.token}`
                    );
                    setIsQuickLinkOpen(false);
                  }}
                  className="px-5 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
                >
                  Copy Link & Done
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SHARE PERMANENT FILE MODAL */}
      {shareItemTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <div className="flex items-center gap-2">
                <SymbolIcon name="link" className="w-4 h-4 text-cyan-400" />
                <h3 className="text-sm font-bold text-white">Share File</h3>
              </div>
              <button
                onClick={() => setShareItemTarget(null)}
                className="p-1 rounded-lg bg-surface text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-surface border border-surface-border text-xs">
              <div className="font-semibold text-white truncate">{shareItemTarget.name}</div>
              <div className="text-[11px] text-slate-400 mt-0.5">{formatBytes(shareItemTarget.size_bytes)}</div>
            </div>

            {!generatedPermanentLink ? (
              <form onSubmit={handleGeneratePermanentShare} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Expiry Preset</label>
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Permanent', val: null },
                      { label: '24 Hours', val: 86400 },
                      { label: '7 Days', val: 604800 },
                    ].map((opt) => (
                      <button
                        key={String(opt.val)}
                        type="button"
                        onClick={() => setShareExpiry(opt.val)}
                        className={`py-2 px-2 rounded-xl text-xs font-semibold border transition-all ${
                          shareExpiry === opt.val
                            ? 'bg-cyan-500/20 text-cyan-300 border-cyan-500/40'
                            : 'bg-surface text-slate-400 border-surface-border hover:bg-surface-hover'
                        }`}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-300 mb-1.5">Optional PIN Password</label>
                  <input
                    type="password"
                    placeholder="None"
                    value={sharePin}
                    onChange={(e) => setSharePin(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs font-mono focus:ring-1 focus:ring-cyan-500 focus:outline-none"
                  />
                </div>

                <div className="pt-2 flex justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setShareItemTarget(null)}
                    className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-slate-300 border border-surface-border"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isGeneratingShare}
                    className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold shadow-lg shadow-cyan-500/20"
                  >
                    {isGeneratingShare ? 'Generating...' : 'Generate Share Link'}
                  </button>
                </div>
              </form>
            ) : (
              <div className="space-y-4">
                <div className="p-3 rounded-2xl bg-black/50 border border-cyan-500/30 space-y-2">
                  <label className="block text-[11px] font-bold uppercase tracking-wider text-cyan-400">
                    Public Share Link
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      readOnly
                      value={generatedPermanentLink}
                      className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-surface-border text-xs font-mono text-cyan-300 focus:outline-none select-all"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        navigator.clipboard.writeText(generatedPermanentLink);
                        alert('Link copied to clipboard!');
                      }}
                      className="px-3 py-1.5 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-bold"
                    >
                      Copy
                    </button>
                  </div>
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setShareItemTarget(null)}
                    className="px-4 py-2 rounded-xl bg-surface hover:bg-surface-hover text-xs font-semibold text-white border border-surface-border"
                  >
                    Done
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ACTIVE SHARES DRAWER MODAL */}
      {isSharesListOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-2xl bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-5 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between border-b border-surface-border pb-4">
              <div className="flex items-center gap-2.5">
                <SymbolIcon name="link" className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">Active Share Links</h3>
              </div>
              <button
                onClick={() => setIsSharesListOpen(false)}
                className="p-1.5 rounded-lg bg-surface hover:bg-surface-hover text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-2">
              {activeShares.length === 0 ? (
                <p className="text-center py-12 text-xs text-slate-500">No active share links.</p>
              ) : (
                activeShares.map((share) => (
                  <div
                    key={share.id}
                    className="p-3.5 rounded-2xl bg-surface border border-surface-border flex items-center justify-between gap-3"
                  >
                    <div className="space-y-1 max-w-md">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-white truncate">{share.original_filename}</span>
                        <span
                          className={`px-2 py-0.2 rounded text-[10px] font-semibold ${
                            share.share_type === 'quick_link'
                              ? 'bg-amber-500/15 text-amber-300'
                              : 'bg-cyan-500/15 text-cyan-300'
                          }`}
                        >
                          {share.share_type === 'quick_link' ? 'Quick Link' : 'Permanent'}
                        </span>
                      </div>
                      <div className="text-[11px] text-slate-400">
                        Downloads: <span className="text-slate-200">{share.download_count}</span> • Expires:{' '}
                        {share.expires_at ? new Date(share.expires_at * 1000).toLocaleString() : 'Never'}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => {
                          const url = `${window.location.origin}/share/cloud/${share.token}`;
                          navigator.clipboard.writeText(url);
                          alert('Share link copied!');
                        }}
                        className="px-2.5 py-1.5 rounded-xl bg-surface-active hover:bg-surface-hover text-xs font-semibold text-cyan-300 border border-surface-border"
                      >
                        Copy
                      </button>
                      <button
                        onClick={() => handleRevokeShare(share.id)}
                        className="px-2.5 py-1.5 rounded-xl bg-red-500/10 hover:bg-red-500/20 text-xs font-semibold text-red-400 border border-red-500/20"
                      >
                        Revoke
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* NEW FOLDER MODAL (WITH COLOR PICKER) */}
      {isNewFolderOpen && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleCreateFolder} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <SymbolIcon name="folder.badge.plus" className="w-4 h-4 text-cyan-400" />
                <span>Create New Folder</span>
              </h3>
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="p-1 rounded-lg bg-surface text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Folder Name</label>
              <input
                type="text"
                placeholder="e.g. Invoices, Project Assets..."
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            {/* Color Swatches */}
            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Folder Color</label>
              <div className="flex items-center gap-2 flex-wrap">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c.hex}
                    type="button"
                    onClick={() => setNewFolderColor(c.hex)}
                    style={{ backgroundColor: c.hex }}
                    className={`w-7 h-7 rounded-full transition-transform ${
                      newFolderColor === c.hex ? 'ring-2 ring-white scale-110 shadow-lg' : 'hover:scale-105 opacity-85 hover:opacity-100'
                    }`}
                    title={c.name}
                  />
                ))}
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setIsNewFolderOpen(false)}
                className="px-4 py-2 rounded-xl bg-surface text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white">
                Create Folder
              </button>
            </div>
          </form>
        </div>
      )}

      {/* EDIT / RENAME / COLOR CODE MODAL */}
      {editItemTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <form onSubmit={handleSaveEdit} className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-surface-border pb-3">
              <h3 className="text-sm font-bold text-white flex items-center gap-2">
                <SymbolIcon name={editItemTarget.type === 'folder' ? 'folder.fill' : 'pencil'} className="w-4 h-4 text-cyan-400" />
                <span>{editItemTarget.type === 'folder' ? 'Edit Folder & Color' : 'Rename File'}</span>
              </h3>
              <button
                type="button"
                onClick={() => setEditItemTarget(null)}
                className="p-1 rounded-lg bg-surface text-slate-400 hover:text-white"
              >
                <SymbolIcon name="xmark" className="w-4 h-4" />
              </button>
            </div>

            <div>
              <label className="block text-xs font-semibold text-slate-300 mb-1.5">Name</label>
              <input
                type="text"
                value={editNameValue}
                onChange={(e) => setEditNameValue(e.target.value)}
                autoFocus
                className="w-full px-3.5 py-2.5 rounded-xl bg-surface border border-surface-border text-white text-xs focus:ring-1 focus:ring-cyan-500 focus:outline-none"
              />
            </div>

            {/* Folder Color Picker in Edit menu */}
            {editItemTarget.type === 'folder' && (
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">Folder Color</label>
                <div className="flex items-center gap-2 flex-wrap">
                  {FOLDER_COLORS.map((c) => (
                    <button
                      key={c.hex}
                      type="button"
                      onClick={() => setEditColorValue(c.hex)}
                      style={{ backgroundColor: c.hex }}
                      className={`w-7 h-7 rounded-full transition-transform ${
                        editColorValue === c.hex ? 'ring-2 ring-white scale-110 shadow-lg' : 'hover:scale-105 opacity-85 hover:opacity-100'
                      }`}
                      title={c.name}
                    />
                  ))}
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditItemTarget(null)}
                className="px-4 py-2 rounded-xl bg-surface text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Cancel
              </button>
              <button type="submit" className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white">
                Save Changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* MOVE MODAL */}
      {moveItemTarget && (
        <div className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
            <h3 className="text-sm font-bold text-white">Move &ldquo;{moveItemTarget.name}&rdquo;</h3>
            <p className="text-xs text-slate-400">Select destination folder:</p>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-surface-border rounded-xl p-2 bg-surface">
              {availableFolders.map((f) => (
                <label
                  key={f}
                  className={`flex items-center gap-2 p-2 rounded-lg cursor-pointer text-xs ${
                    moveDestination === f ? 'bg-cyan-500/20 text-cyan-300 font-bold' : 'hover:bg-surface-hover text-slate-300'
                  }`}
                >
                  <input
                    type="radio"
                    name="moveDest"
                    checked={moveDestination === f}
                    onChange={() => setMoveDestination(f)}
                    className="accent-cyan-500"
                  />
                  <span>{f === '' ? '📁 [Root: My Files]' : `📁 ${f}`}</span>
                </label>
              ))}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setMoveItemTarget(null)}
                className="px-4 py-2 rounded-xl bg-surface text-xs font-semibold text-slate-300 border border-surface-border"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleExecuteMove}
                className="px-4 py-2 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-xs font-bold text-white"
              >
                Move Here
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
