import React from 'react';
import { Link } from 'react-router-dom';
import { Navbar } from './Navbar.js';
import { SymbolIcon } from './SymbolIcon.js';

interface AccessDeniedProps {
  tabName?: string;
}

export const AccessDenied: React.FC<AccessDeniedProps> = ({ tabName }) => {
  return (
    <div className="min-h-screen bg-background text-slate-100 flex flex-col">
      <Navbar />

      <main className="flex-1 max-w-2xl mx-auto px-4 py-16 flex flex-col items-center justify-center text-center">
        <div className="w-16 h-16 rounded-2xl bg-danger/10 border border-danger/20 flex items-center justify-center text-danger mb-6 shadow-glow shadow-danger/20">
          <SymbolIcon name="lock.fill" className="w-8 h-8" />
        </div>

        <h1 className="text-2xl font-bold text-white tracking-tight mb-2">
          Access Restricted
        </h1>

        <p className="text-sm text-slate-400 max-w-md mb-6 leading-relaxed">
          {tabName ? (
            <>
              You do not have permission to access the <span className="text-white font-semibold capitalize">{tabName}</span> tab. Access is governed by Active Directory security group policies.
            </>
          ) : (
            'You do not have permission to view this resource under your current Active Directory account groups.'
          )}
        </p>

        <div className="p-4 rounded-2xl bg-surface-card border border-surface-border text-xs text-slate-400 mb-8 max-w-md w-full text-left">
          <div className="flex items-center gap-2 text-slate-300 font-semibold mb-1">
            <SymbolIcon name="info.circle" className="w-4 h-4 text-brand-400" />
            <span>Need access?</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Contact your Shoreline Connect administrator or IT team to be added to the authorized Active Directory group for this module.
          </p>
        </div>

        <Link
          to="/"
          className="px-5 py-2.5 rounded-xl bg-surface-active hover:bg-surface-hover border border-surface-border text-slate-200 text-xs font-semibold flex items-center gap-2 transition-all"
        >
          <SymbolIcon name="arrow.left" className="w-3.5 h-3.5" />
          <span>Return to Dashboard</span>
        </Link>
      </main>
    </div>
  );
};
