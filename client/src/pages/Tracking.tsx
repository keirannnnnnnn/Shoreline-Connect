import React, { useEffect } from 'react';
import { Navbar } from '../components/Navbar.js';
import { SymbolIcon } from '../components/SymbolIcon.js';
import { api } from '../lib/api.js';

export const Tracking: React.FC = () => {
  useEffect(() => {
    api.tracking.getStatus().catch((err) => console.error(err));
  }, []);

  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        
        {/* Header Banner */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
          <div>
            <div className="flex items-center gap-3 mb-1.5">
              <div className="w-10 h-10 rounded-xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 shadow-glow shadow-amber-500/10">
                <SymbolIcon name="location.fill" className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-2xl font-bold text-white tracking-tight flex items-center gap-2.5">
                  <span>Tracking Hub</span>
                  <span className="px-2.5 py-0.5 rounded-full bg-amber-500/10 border border-amber-500/30 text-amber-300 font-mono text-[10px] font-semibold">
                    Build 1 Scaffold
                  </span>
                </h1>
                <p className="text-xs text-slate-400">
                  Real-time device geolocation, geofencing, and mobile telemetry tracking.
                </p>
              </div>
            </div>
          </div>
        </div>

        {/* Scaffold Placeholder Canvas */}
        <div className="rounded-3xl bg-surface-card border border-surface-border p-8 text-center flex flex-col items-center justify-center min-h-[400px] relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-amber-500/5 via-transparent to-transparent pointer-events-none" />
          
          <div className="w-16 h-16 rounded-2xl bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400 mb-5">
            <SymbolIcon name="location.circle.fill" className="w-8 h-8" />
          </div>

          <h2 className="text-lg font-bold text-white mb-2">
            Device Tracking Subsystem Initialized
          </h2>
          
          <p className="text-xs text-slate-400 max-w-md mb-8 leading-relaxed">
            The Active Directory permission gate and API route scaffolding are active. Device location mapping and companion telemetry hooks will be integrated in Build 2.
          </p>

          {/* Planned Features Grid */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl w-full text-left">
            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <SymbolIcon name="map.fill" className="w-4 h-4" />
                <span>Live GPS Map</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Real-time multi-device mapping powered by OpenStreetMap tiles and lightweight coordinates reporting.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <SymbolIcon name="bell.badge.fill" className="w-4 h-4" />
                <span>Geofencing & Alerts</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Configurable safe zones and automated notifications when devices enter or leave designated zones.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-surface border border-surface-border space-y-1.5">
              <div className="flex items-center gap-2 text-amber-400 text-xs font-semibold">
                <SymbolIcon name="battery.100percent.bolt" className="w-4 h-4" />
                <span>Mobile Telemetry</span>
              </div>
              <p className="text-[11px] text-slate-400 leading-relaxed">
                Battery levels, Wi-Fi SSID connectivity, and speed metrics streamed alongside location.
              </p>
            </div>
          </div>
        </div>

      </main>
    </div>
  );
};
