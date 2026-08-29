import React, { useEffect } from 'react';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { api } from '../lib/api.js';

export const Cloud: React.FC = () => {
  useEffect(() => {
    api.cloud.getStatus().catch((err) => console.error(err));
  }, []);

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 shadow-glow shadow-cyan-500/10">
                <SymbolIcon name="cloud.fill" className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                  <span>Cloud Vault</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-cyan-500/10 border border-cyan-500/30 text-cyan-300 font-mono text-[10px] font-semibold">
                    Build 1 Scaffold
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  Self-hosted private cloud storage and secure encrypted file exchange.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Scaffold Placeholder Canvas */}
        <div className="rounded-3xl bg-surface-card border border-surface-border p-8 text-center flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-cyan-500/5 via-transparent to-transparent pointer-events-none" />
          
          <div className="w-16 h-16 rounded-2xl bg-cyan-500/10 border border-cyan-500/30 flex items-center justify-center text-cyan-400 mb-5">
            <SymbolIcon name="cloud.circle.fill" className="w-8 h-8" />
          </div>

          <h2 className="text-lg font-bold text-white mb-2">
            Cloud Vault Subsystem Initialized
          </h2>
          
          <p className="text-xs text-slate-400 max-w-md mb-8 leading-relaxed">
            The Active Directory permission gate and API route scaffolding are active. File storage, direct uploads, and secure sharing will be integrated in Build 2.
          </p>

          {/* Planned Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full text-left">
            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
                <SymbolIcon name="lock.shield.fill" className="w-4 h-4" />
                <span>AES-256 File Vault</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Zero-knowledge client and server side storage encryption ensuring files remain private.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
                <SymbolIcon name="link" className="w-4 h-4" />
                <span>Expiring Share Links</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Share files externally with time-limited links, download quotas, and PIN password protection.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-cyan-400 text-xs font-semibold">
                <SymbolIcon name="arrow.down.circle.fill" className="w-4 h-4" />
                <span>Fast Chunked Uploads</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                High-speed resumable uploads for large ISOs, disk images, and backups.
              </p>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};
