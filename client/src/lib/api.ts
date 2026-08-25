import { User, Device, Folder, DeviceShare, GuestShare, SessionLog, SystemSettings, UpdateStatus } from '../types/index.js';

const API_BASE = '/api';

async function fetchJson<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem('token');
  const headers = new Headers(options.headers || {});
  
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  if (options.body && typeof options.body === 'string' && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(`${API_BASE}${endpoint}`, {
    ...options,
    headers,
    credentials: 'include',
  });

  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401 && !endpoint.includes('/auth/login') && !endpoint.includes('/shares/guest/public')) {
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      if (window.location.pathname !== '/login' && !window.location.pathname.startsWith('/guest/')) {
        window.location.href = '/login';
      }
    }
    throw new Error(data.error || data.message || `Request failed with status ${response.status}`);
  }

  return data as T;
}

export const api = {
  auth: {
    login: (username: string, password: string) =>
      fetchJson<{ token: string; user: User }>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password }),
      }),
    logout: () => fetchJson<{ success: boolean }>('/auth/logout', { method: 'POST' }),
    getMe: () => fetchJson<{ user: User }>('/auth/me'),
    getUsers: () => fetchJson<{ users: User[] }>('/auth/users'),
  },

  devices: {
    getAll: () => fetchJson<{ devices: Device[] }>('/devices'),
    getRecents: () => fetchJson<{ recents: any[] }>('/devices/recents'),
    getById: (id: string) => fetchJson<{ device: Device; canManage: boolean }>('/devices/' + id),
    create: (data: any) =>
      fetchJson<{ device: Device }>('/devices', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: any) =>
      fetchJson<{ device: Device }>('/devices/' + id, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetchJson<{ success: boolean }>('/devices/' + id, { method: 'DELETE' }),
    toggleFavorite: (id: string) => fetchJson<{ isFavorite: boolean }>('/devices/' + id + '/favorite', { method: 'POST' }),
    getConnectToken: (id: string) =>
      fetchJson<{ token: string; device: { id: string; name: string; protocol: string } }>('/devices/' + id + '/connect-token', {
        method: 'POST',
      }),
  },

  folders: {
    getAll: () => fetchJson<{ folders: Folder[] }>('/devices/folders/all'),
    create: (data: { name: string; icon?: string; color?: string }) =>
      fetchJson<{ folder: Folder }>('/devices/folders/create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) => fetchJson<{ success: boolean }>('/devices/folders/' + id, { method: 'DELETE' }),
  },

  shares: {
    shareWithUser: (deviceId: string, targetUserId: string) =>
      fetchJson<{ share: DeviceShare }>('/shares/user', {
        method: 'POST',
        body: JSON.stringify({ deviceId, targetUserId }),
      }),
    revokeUserShare: (shareId: string) =>
      fetchJson<{ success: boolean }>('/shares/user/' + shareId, { method: 'DELETE' }),
    getDeviceShares: (deviceId: string) =>
      fetchJson<{ shares: DeviceShare[] }>('/shares/device/' + deviceId),
    
    createGuestShare: (data: { deviceId: string; durationMinutes: number; durationLabel: string; pin?: string; maxUses?: number }) =>
      fetchJson<{ share: GuestShare & { rawPin?: string } }>('/shares/guest', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    revokeGuestShare: (shareId: string) =>
      fetchJson<{ success: boolean }>('/shares/guest/' + shareId, { method: 'DELETE' }),
    getMyGuestShares: () =>
      fetchJson<{ guestShares: GuestShare[] }>('/shares/guest/my'),

    getPublicGuestShare: (token: string) =>
      fetchJson<{ valid: boolean; reason?: string; share?: any }>('/shares/guest/public/' + token),
    verifyGuestPinAndConnect: (token: string, pin?: string) =>
      fetchJson<{ token: string; device: { id: string; name: string; protocol: string } }>('/shares/guest/public/' + token + '/verify', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }),
  },

  admin: {
    getSettings: () => fetchJson<{ settings: SystemSettings }>('/admin/settings'),
    updateSettings: (settings: Partial<SystemSettings>) =>
      fetchJson<{ success: boolean }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
    getUsers: () => fetchJson<{ users: User[] }>('/admin/users'),
    getUserDevices: (targetUserId: string) =>
      fetchJson<{ devices: Device[] }>('/admin/users/' + targetUserId + '/devices'),
    getSessionLogs: (params?: any) => {
      const query = new URLSearchParams(params).toString();
      return fetchJson<{ logs: SessionLog[]; total: number }>('/admin/sessions' + (query ? '?' + query : ''));
    },
    getUpdateStatus: () => fetchJson<{ status: UpdateStatus }>('/admin/update/status'),
    checkForUpdates: () => fetchJson<{ hasUpdates: boolean; currentCommit: string; remoteCommit?: string; message: string }>('/admin/update/check', { method: 'POST' }),
    applyUpdate: (data?: { repoUrl?: string; branch?: string }) =>
      fetchJson<{ success: boolean; message: string; output: string }>('/admin/update/apply', {
        method: 'POST',
        body: JSON.stringify(data || {}),
      }),
  },

  symbols: {
    search: (q: string, limit = 60) =>
      fetchJson<{ symbols: string[]; total: number }>(`/symbols/search?q=${encodeURIComponent(q)}&limit=${limit}`),
  }
};
