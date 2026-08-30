import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './context/AuthContext.js';
import { Login } from './pages/Login.js';
import { DashboardHome } from './pages/DashboardHome.js';
import { Dashboard } from './pages/Dashboard.js';
import { SessionViewer } from './pages/SessionViewer.js';
import { GuestJoin } from './pages/GuestJoin.js';
import { Settings } from './pages/Settings.js';
import { Monitoring } from './pages/Monitoring.js';
import { MonitoringDetail } from './pages/MonitoringDetail.js';
import { Tracking } from './pages/Tracking.js';
import { Cloud } from './pages/Cloud.js';
import { PublicCloudShare } from './pages/PublicCloudShare.js';
import { AccessDenied } from './components/AccessDenied.js';
import { SymbolIcon } from './components/SymbolIcon.js';

const ProtectedRoute: React.FC<{
  children: React.ReactNode;
  requiredTab?: 'devices' | 'monitoring' | 'tracking' | 'cloud';
}> = ({ children, requiredTab }) => {
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

  if (requiredTab && user.permissions?.tabs && user.permissions.tabs[requiredTab] && !user.permissions.tabs[requiredTab].canAccess) {
    return <AccessDenied tabName={requiredTab} />;
  }

  return <>{children}</>;
};

export const App: React.FC = () => {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<Login />} />
          
          {/* 1. Modular Widget Dashboard Home */}
          <Route
            path="/"
            element={
              <ProtectedRoute>
                <DashboardHome />
              </ProtectedRoute>
            }
          />

          {/* 2. Devices Inventory & Management */}
          <Route
            path="/devices"
            element={
              <ProtectedRoute requiredTab="devices">
                <Dashboard />
              </ProtectedRoute>
            }
          />

          {/* 3. Monitoring Fleet & Metrics */}
          <Route
            path="/monitoring"
            element={
              <ProtectedRoute requiredTab="monitoring">
                <Monitoring />
              </ProtectedRoute>
            }
          />
          <Route
            path="/monitoring/:id"
            element={
              <ProtectedRoute requiredTab="monitoring">
                <MonitoringDetail />
              </ProtectedRoute>
            }
          />

          {/* 4. Tracking Hub Scaffold */}
          <Route
            path="/tracking"
            element={
              <ProtectedRoute requiredTab="tracking">
                <Tracking />
              </ProtectedRoute>
            }
          />

          {/* 5. Cloud Storage Vault Scaffold */}
          <Route
            path="/cloud"
            element={
              <ProtectedRoute requiredTab="cloud">
                <Cloud />
              </ProtectedRoute>
            }
          />

          {/* 6. Remote Sessions */}
          <Route
            path="/session/:id"
            element={
              <ProtectedRoute requiredTab="devices">
                <SessionViewer />
              </ProtectedRoute>
            }
          />
          <Route path="/session/guest" element={<SessionViewer />} />
          <Route path="/guest/:token" element={<GuestJoin />} />
          <Route path="/share/cloud/:token" element={<PublicCloudShare />} />

          {/* 7. Settings & Administration */}
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
