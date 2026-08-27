import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Login } from './pages/Login.js';
import { Dashboard } from './pages/Dashboard.js';
import { SessionViewer } from './pages/SessionViewer.js';
import { GuestJoin } from './pages/GuestJoin.js';
import { Settings } from './pages/Settings.js';
import { Monitoring } from './pages/Monitoring.js';
import { MonitoringDetail } from './pages/MonitoringDetail.js';
import { SymbolIcon } from './components/SymbolIcon.js';

const ProtectedRoute: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center text-slate-400">
        <SymbolIcon name="arrow.trianglehead.2.clockwise" className="w-8 h-8 animate-spin text-brand-500 mb-3" />
        <p className="text-xs">Authenticating session...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <Dashboard />
              </ProtectedRoute>
            }
          />
          <Route
            path="/monitoring"
            element={
              <ProtectedRoute>
                <Monitoring />
              </ProtectedRoute>
            }
          />
          <Route
            path="/monitoring/:id"
            element={
              <ProtectedRoute>
                <MonitoringDetail />
              </ProtectedRoute>
            }
          />
          <Route
            path="/session/:id"
            element={
              <ProtectedRoute>
                <SessionViewer />
              </ProtectedRoute>
            }
          />
          <Route path="/session/guest" element={<SessionViewer />} />
          <Route path="/guest/:token" element={<GuestJoin />} />
          <Route
            path="/settings"
            element={
              <ProtectedRoute>
                <Settings />
              </ProtectedRoute>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
};

export default App;
