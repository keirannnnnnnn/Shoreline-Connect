import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { SymbolIcon } from '../components/SymbolIcon.js';

interface PublicShareInfo {
  token: string;
  filename: string;
  fileSizeBytes: number;
  mimeType: string;
  shareType: 'permanent' | 'quick_link';
  hasPin: boolean;
  expiresAt: number | null;
  createdAt: number;
}

export const PublicCloudShare: React.FC = () => {
  const { token } = useParams<{ token: string }>();

  const [shareInfo, setShareInfo] = useState<PublicShareInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [pin, setPin] = useState('');
  const [isPinVerified, setIsPinVerified] = useState(false);
  const [pinError, setPinError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    if (!token) return;
    loadShare();
  }, [token]);

  const loadShare = async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const data = await api.cloud.getPublicShareInfo(token);
      setShareInfo(data);
      if (!data.hasPin) {
        setIsPinVerified(true);
      }
    } catch (err: any) {
      setError(err.message || 'Share link is invalid, expired, or revoked.');
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyPin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || !pin) return;
    setVerifying(true);
    setPinError(null);
    try {
      await api.cloud.verifyPublicPin(token, pin);
      setIsPinVerified(true);
    } catch (err: any) {
      setPinError(err.message || 'Incorrect PIN password.');
    } finally {
      setVerifying(false);
    }
  };

  const handleDownload = () => {
    if (!token) return;
    const url = api.cloud.getPublicDownloadUrl(token, isPinVerified && shareInfo?.hasPin ? pin : undefined);
    window.location.href = url;
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${sizes[i]}`;
  };

  const getFileSymbol = (filename: string): string => {
    const ext = filename.split('.').pop()?.toLowerCase() || '';
    if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext)) return 'photo.fill';
    if (['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext)) return 'film.fill';
    if (['mp3', 'wav', 'flac', 'aac', 'm4a'].includes(ext)) return 'music.note';
    if (['zip', 'tar', 'gz', '7z', 'rar'].includes(ext)) return 'archivebox.fill';
    if (['txt', 'md', 'json', 'csv', 'log', 'ts', 'js', 'html', 'css', 'py', 'sh', 'yml', 'yaml'].includes(ext)) return 'text.document.fill';
    return 'document.fill';
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center justify-center p-4 selection:bg-cyan-500 selection:text-white">
      {/* Background radial highlight */}
      <div className="fixed inset-0 bg-gradient-to-tr from-cyan-950/20 via-transparent to-purple-950/20 pointer-events-none" />

      {/* Main Container */}
      <div className="relative w-full max-w-md bg-slate-900/90 border border-slate-800 backdrop-blur-xl rounded-3xl p-8 shadow-2xl space-y-6 text-center">
        {/* Brand Header */}
        <div className="flex items-center justify-center gap-2.5">
          <div className="w-10 h-10 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-glow shadow-cyan-500/10">
            <SymbolIcon name="cloud.fill" className="w-5 h-5" />
          </div>
          <span className="text-sm font-bold tracking-tight text-white">Shoreline Connect Cloud</span>
        </div>

        {loading ? (
          <div className="py-12 space-y-3">
            <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 mx-auto text-cyan-400 animate-spin" />
            <p className="text-xs text-slate-400">Loading shared file...</p>
          </div>
        ) : error ? (
          <div className="py-8 space-y-4">
            <div className="w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 flex items-center justify-center mx-auto">
              <SymbolIcon name="exclamationmark.triangle.fill" className="w-7 h-7" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white">Link Unavailable</h2>
              <p className="text-xs text-slate-400 mt-1.5 leading-relaxed">{error}</p>
            </div>
          </div>
        ) : shareInfo ? (
          <div className="space-y-6">
            {/* File Icon & Info */}
            <div className="space-y-3">
              <div className="w-20 h-20 rounded-3xl bg-cyan-500/10 border border-cyan-500/30 text-cyan-400 flex items-center justify-center mx-auto shadow-xl shadow-cyan-500/5">
                <SymbolIcon name={getFileSymbol(shareInfo.filename)} className="w-10 h-10" />
              </div>
              <div>
                <h1 className="text-base font-bold text-white max-w-sm truncate mx-auto" title={shareInfo.filename}>
                  {shareInfo.filename}
                </h1>
                <p className="text-xs text-slate-400 mt-1">
                  {formatBytes(shareInfo.fileSizeBytes)}
                  {shareInfo.expiresAt && (
                    <span className="ml-2 text-amber-400/80">
                      • Expires {new Date(shareInfo.expiresAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  )}
                </p>
              </div>
            </div>

            {/* PIN Protection Gate */}
            {shareInfo.hasPin && !isPinVerified ? (
              <form onSubmit={handleVerifyPin} className="space-y-4 text-left">
                <div className="p-3.5 rounded-2xl bg-surface border border-surface-border space-y-2">
                  <div className="flex items-center gap-2 text-xs font-semibold text-amber-300">
                    <SymbolIcon name="lock.fill" className="w-4 h-4" />
                    <span>PIN Protected File</span>
                  </div>
                  <p className="text-[11px] text-slate-400">
                    The sender has protected this file with a PIN password. Enter it below to access the download.
                  </p>
                  <input
                    type="password"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                    placeholder="Enter PIN..."
                    autoFocus
                    className="w-full px-3.5 py-2.5 rounded-xl bg-black/40 border border-slate-700 text-white text-sm font-mono tracking-widest text-center focus:ring-1 focus:ring-cyan-500 focus:outline-none placeholder:tracking-normal placeholder:text-slate-600"
                  />
                  {pinError && <p className="text-[11px] text-red-400 font-semibold">{pinError}</p>}
                </div>

                <button
                  type="submit"
                  disabled={verifying || !pin}
                  className="w-full py-3 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 disabled:opacity-50 text-white text-xs font-bold shadow-lg shadow-cyan-500/20 transition-all flex items-center justify-center gap-2"
                >
                  {verifying ? (
                    <>
                      <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-4 h-4 animate-spin" />
                      <span>Verifying PIN...</span>
                    </>
                  ) : (
                    <>
                      <SymbolIcon name="lock.open.fill" className="w-4 h-4" />
                      <span>Unlock File</span>
                    </>
                  )}
                </button>
              </form>
            ) : (
              /* Download Action */
              <div className="space-y-3">
                <button
                  onClick={handleDownload}
                  className="w-full py-3.5 px-5 rounded-2xl bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-bold shadow-xl shadow-cyan-500/25 transition-all flex items-center justify-center gap-2 transform active:scale-95"
                >
                  <SymbolIcon name="arrow.down.circle.fill" className="w-5 h-5" />
                  <span>Download File ({formatBytes(shareInfo.fileSizeBytes)})</span>
                </button>
                <p className="text-[10px] text-slate-500">Secure end-to-end download provided by Shoreline Connect</p>
              </div>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
};
