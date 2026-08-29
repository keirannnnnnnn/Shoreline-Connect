import { User, Device, Folder, DeviceShare, GuestShare, SessionLog, SystemSettings, UpdateStatus, TrackedItem, TrackingJourney, JourneyPoint, TrackingSettings } from '../types/index.js';

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
    create: (data: { name: string; icon?: string; color?: string; deviceIds?: string[] }) =>
      fetchJson<{ folder: Folder }>('/devices/folders/create', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateDevices: (folderId: string, deviceIds: string[]) =>
      fetchJson<{ success: boolean }>('/devices/folders/' + folderId + '/devices', {
        method: 'POST',
        body: JSON.stringify({ deviceIds }),
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
      fetchJson<{ valid: boolean; reason?: string; message?: string; share?: any }>('/shares/guest/public/' + token),
    verifyGuestPinAndConnect: (token: string, pin?: string) =>
      fetchJson<{ token: string; device: { id: string; name: string; protocol: string } }>('/shares/guest/public/' + token + '/verify', {
        method: 'POST',
        body: JSON.stringify({ pin }),
      }),
  },

  admin: {
    getSettings: () => fetchJson<{ settings: SystemSettings }>('/admin/settings'),
    updateSettings: (settings: Partial<SystemSettings>) =>
      fetchJson<{ success: boolean; message: string }>('/admin/settings', {
        method: 'PUT',
        body: JSON.stringify({ settings }),
      }),
    getUsers: () => fetchJson<{ users: User[] }>('/admin/users'),
    updateUserRole: (userId: string, role: 'admin' | 'user') =>
      fetchJson<{ success: boolean; message: string }>('/admin/users/' + userId + '/role', {
        method: 'PATCH',
        body: JSON.stringify({ role }),
      }),
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
  },

  monitoring: {
    getDevices: () =>
      fetchJson<{ devices: MonitoredDevice[] }>('/monitoring/devices'),
    getDeviceAgentStatus: (deviceId: string) =>
      fetchJson<{ info: MonitoringAgentInfo | null }>('/monitoring/devices/' + deviceId),
    enable: (deviceId: string) =>
      fetchJson<{ agent: any; rawToken: string; installLinux: string; installWindows: string }>('/monitoring/devices/' + deviceId + '/enable', {
        method: 'POST',
      }),
    regenerateToken: (deviceId: string) =>
      fetchJson<{ agent: any; rawToken: string; installLinux: string; installWindows: string }>('/monitoring/devices/' + deviceId + '/regenerate-token', {
        method: 'POST',
      }),
    disable: (deviceId: string) =>
      fetchJson<{ success: boolean }>('/monitoring/devices/' + deviceId + '/disable', {
        method: 'POST',
      }),
    getMetrics: (deviceId: string, range: '1h' | '6h' | '24h' | '7d' | '30d' | '120d' = '1h') =>
      fetchJson<{ range: string; resolution: string; points: MetricPoint[] }>('/monitoring/devices/' + deviceId + '/metrics?range=' + range),
  },

  dashboard: {
    getLayout: () => fetchJson<{ layout: any[] }>('/dashboard/layout'),
    saveLayout: (layout: any[]) =>
      fetchJson<{ success: boolean; message: string }>('/dashboard/layout', {
        method: 'POST',
        body: JSON.stringify({ layout }),
      }),
    getWidgets: () => fetchJson<{ widgets: any[] }>('/dashboard/widgets'),
  },

  tracking: {
    getItems: () => fetchJson<{ items: TrackedItem[] }>('/tracking/items'),
    getItem: (id: string) => fetchJson<{ item: TrackedItem }>('/tracking/items/' + id),
    createItem: (data: {
      name: string;
      category: 'Vehicles' | 'Devices';
      movement_threshold_meters?: number;
      min_speed_kmh?: number;
      stationary_dwell_seconds?: number;
    }) =>
      fetchJson<{ item: TrackedItem; rawToken: string; ingestUrl: string; sampleCurl: string }>('/tracking/items', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateItem: (id: string, data: Partial<TrackedItem>) =>
      fetchJson<{ item: TrackedItem }>('/tracking/items/' + id, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteItem: (id: string) =>
      fetchJson<{ success: boolean; message: string }>('/tracking/items/' + id, {
        method: 'DELETE',
      }),
    regenerateToken: (id: string) =>
      fetchJson<{ rawToken: string }>('/tracking/items/' + id + '/regenerate-token', {
        method: 'POST',
      }),
    getJourneys: (itemId: string) =>
      fetchJson<{ journeys: TrackingJourney[] }>('/tracking/items/' + itemId + '/journeys'),
    getJourneyPoints: (journeyId: string) =>
      fetchJson<{ points: JourneyPoint[] }>('/tracking/journeys/' + journeyId + '/points'),
    getSettings: () =>
      fetchJson<TrackingSettings>('/tracking/settings'),
    saveSettings: (settings: { mapProvider?: 'leaflet' | 'google'; googleMapsApiKey?: string }) =>
      fetchJson<{ success: boolean; message: string }>('/tracking/settings', {
        method: 'PUT',
        body: JSON.stringify(settings),
      }),
  },

  cloud: {
    getStatus: () => fetchJson<{ enabled: boolean; feature: string; scaffold: boolean; message: string }>('/cloud/status'),
    getFiles: () => fetchJson<{ files: any[]; storageUsedBytes: number; storageQuotaBytes: number }>('/cloud/files'),
  },

  backup: {
    exportUrl: '/api/backup/export',
    import: (backupData: any) =>
      fetchJson<{ success: boolean; message: string; summary: any }>('/backup/import', {
        method: 'POST',
        body: JSON.stringify(backupData),
      }),
  },
};

export interface MonitoredDevice {
  id: string;
  device_id: string;
  device_name: string;
  protocol: 'rdp' | 'vnc' | 'ssh';
  host: string;
  is_shared: boolean;
  shared_by_user?: string;
  status: 'pending' | 'online' | 'offline';
  last_seen_at: string | null;
  system_info: {
    hostname: string;
    os: string;
    platform: string;
    platform_version: string;
    kernel: string;
    arch: string;
    cpu_model: string;
    cpu_cores: number;
    total_ram: number;
    total_disk: number;
    agent_version: string;
    disks?: Array<{
      mount_point: string;
      device: string;
      fs_type: string;
      total_bytes: number;
      used_bytes: number;
      free_bytes: number;
      used_pct: number;
    }>;
  } | null;
  current_metrics: {
    cpu_usage: number;
    ram_percent: number;
    ram_used: number;
    ram_total: number;
    disk_percent: number;
    net_rx_bytes_sec: number;
    net_tx_bytes_sec: number;
    cpu_temp: number | null;
    uptime: number;
  } | null;
}

export interface MonitoringAgentInfo {
  agent: {
    id: string;
    device_id: string;
    token_preview: string;
    status: 'pending' | 'online' | 'offline';
    last_seen_at: string | null;
    system_info: any | null;
    created_at: string;
    updated_at: string;
  };
  rawToken: string;
  installLinux: string;
  installWindows: string;
}

export interface MetricPoint {
  timestamp: number;
  cpu_usage: number;
  cpu_usage_max?: number;
  cpu_per_core?: number[] | null;
  ram_used?: number;
  ram_total?: number;
  ram_percent: number;
  swap_used?: number;
  swap_total?: number;
  swap_percent?: number;
  disk_read_bytes_sec?: number;
  disk_write_bytes_sec?: number;
  net_rx_bytes_sec?: number;
  net_tx_bytes_sec?: number;
  cpu_temp?: number | null;
  load_1?: number | null;
  load_5?: number | null;
  load_15?: number | null;
  uptime?: number;
  disks?: Array<{
    mount_point: string;
    device: string;
    fs_type: string;
    total_bytes: number;
    used_bytes: number;
    free_bytes: number;
    used_pct: number;
  }> | null;
}

