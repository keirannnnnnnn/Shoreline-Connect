import React, { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.js';
import { SymbolIcon } from './SymbolIcon.js';

interface NavbarProps {
  onOpenSearch?: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({ onOpenSearch }) => {
  const { user, logout, isAdmin } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);

  const handleLogout = async () => {
    await logout();
    navigate('/login');
  };

  return (
    <header className="sticky top-0 z-40 w-full backdrop-blur-md bg-surface/80 border-b border-surface-border transition-all">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
        
        {/* Left: Brand Logo & Navigation */}
        <div className="flex items-center gap-6">
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-500 to-brand-700 flex items-center justify-center shadow-glow shadow-brand-500/20 group-hover:scale-105 transition-transform">
              <SymbolIcon name="server.rack" className="w-5 h-5 text-white" />
            </div>
            <div className="flex flex-col">
              <span className="font-bold text-lg tracking-tight text-white flex items-center gap-1.5">
                Shoreline <span className="text-brand-400 font-semibold">Connect</span>
              </span>
            </div>
          </Link>

          <nav className="hidden md:flex items-center gap-1 pl-4 border-l border-surface-border">
            <Link
              to="/"
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                location.pathname === '/' 
                  ? 'bg-surface-active text-white border border-surface-borderLight' 
                  : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
              }`}
            >
              <SymbolIcon name="square.grid.2x2" className="w-3.5 h-3.5" />
              <span>Dashboard</span>
            </Link>

            {(!user?.permissions || user.permissions.tabs?.devices?.canAccess) && (
              <Link
                to="/devices"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  location.pathname.startsWith('/devices') 
                    ? 'bg-surface-active text-white border border-surface-borderLight' 
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                <SymbolIcon name="macbook.and.iphone" className="w-3.5 h-3.5" />
                <span>Devices</span>
              </Link>
            )}

            {(!user?.permissions || user.permissions.tabs?.monitoring?.canAccess) && (
              <Link
                to="/monitoring"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  location.pathname.startsWith('/monitoring')
                    ? 'bg-surface-active text-white border border-surface-borderLight'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                <SymbolIcon name="waveform.path.ecg" className="w-3.5 h-3.5" />
                <span>Monitoring</span>
              </Link>
            )}

            {(!user?.permissions || user.permissions.tabs?.tracking?.canAccess) && (
              <Link
                to="/tracking"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  location.pathname.startsWith('/tracking')
                    ? 'bg-surface-active text-white border border-surface-borderLight'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                <SymbolIcon name="location.fill" className="w-3.5 h-3.5" />
                <span>Tracking</span>
              </Link>
            )}

            {(!user?.permissions || user.permissions.tabs?.cloud?.canAccess) && (
              <Link
                to="/cloud"
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold flex items-center gap-1.5 transition-all ${
                  location.pathname.startsWith('/cloud')
                    ? 'bg-surface-active text-white border border-surface-borderLight'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-surface-hover'
                }`}
              >
                <SymbolIcon name="cloud.fill" className="w-3.5 h-3.5" />
                <span>Cloud</span>
              </Link>
            )}
          </nav>
        </div>

        {/* Right: Search & Profile */}
        <div className="flex items-center gap-3">
          
          {/* Quick Search trigger */}
          {onOpenSearch && (
            <button
              onClick={onOpenSearch}
              className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-surface-card hover:bg-surface-hover border border-surface-border text-slate-300 text-xs transition-colors hidden sm:flex"
            >
              <SymbolIcon name="magnifyingglass" className="w-3.5 h-3.5 text-slate-400" />
              <span>Quick search...</span>
              <kbd className="px-1.5 py-0.5 text-[10px] font-mono bg-surface-active text-slate-400 rounded border border-surface-border">
                ⌘K
              </kbd>
            </button>
          )}

          {/* User Profile & Dropdown */}
          <div className="relative">
            <button
              onClick={() => setMenuOpen(!menuOpen)}
              className="flex items-center gap-2 p-1.5 rounded-xl hover:bg-surface-hover border border-transparent hover:border-surface-border transition-all"
            >
              <div className="w-8 h-8 rounded-lg bg-surface-active border border-surface-borderLight flex items-center justify-center text-sm font-semibold text-brand-300">
                {user?.display_name ? user.display_name.charAt(0).toUpperCase() : 'U'}
              </div>
              <div className="hidden lg:flex flex-col text-left">
                <span className="text-xs font-semibold text-slate-200 leading-tight">
                  {user?.display_name || user?.username}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  {user?.role === 'admin' ? 'Administrator' : 'Standard User'}
                </span>
              </div>
              <SymbolIcon name="chevron.down" className="w-3 h-3 text-slate-400 hidden lg:block" />
            </button>

            {/* Dropdown Menu */}
            {menuOpen && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setMenuOpen(false)}
                />
                <div className="absolute right-0 mt-2 w-56 rounded-2xl bg-surface-card border border-surface-border shadow-2xl p-1.5 z-50 text-sm animate-in fade-in zoom-in-95">
                  <div className="px-3 py-2 border-b border-surface-border mb-1">
                    <p className="font-semibold text-slate-200 text-sm truncate">{user?.display_name}</p>
                    <p className="text-xs text-slate-400 font-mono truncate">{user?.username}@shoreline.icu</p>
                    <div className="mt-1.5 flex items-center gap-1.5">
                      <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${
                        user?.role === 'admin' 
                          ? 'bg-purple-500/10 text-purple-400 border-purple-500/20' 
                          : 'bg-blue-500/10 text-blue-400 border-blue-500/20'
                      }`}>
                        {user?.role === 'admin' ? 'Administrator' : 'Standard User'}
                      </span>
                    </div>
                  </div>

                  <Link
                    to="/settings"
                    onClick={() => setMenuOpen(false)}
                    className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-surface-hover transition-colors"
                  >
                    <SymbolIcon name="person.crop.circle" className="w-4 h-4 text-slate-400" />
                    <span>My Profile & Settings</span>
                  </Link>

                  {isAdmin && (
                    <Link
                      to="/settings?tab=audit"
                      onClick={() => setMenuOpen(false)}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-xl text-slate-300 hover:text-white hover:bg-surface-hover transition-colors"
                    >
                      <SymbolIcon name="doc.text.magnifyingglass" className="w-4 h-4 text-slate-400" />
                      <span>Audit Logs</span>
                    </Link>
                  )}

                  <div className="my-1 border-t border-surface-border" />

                  <button
                    onClick={handleLogout}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-danger hover:bg-danger/10 transition-colors text-left"
                  >
                    <SymbolIcon name="rectangle.portrait.and.arrow.right" className="w-4 h-4" />
                    <span>Sign Out</span>
                  </button>
                </div>
              </>
            )}
          </div>

        </div>

      </div>
    </header>
  );
};
