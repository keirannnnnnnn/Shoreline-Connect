export interface TabPermission {
  canAccess: boolean;
  isAdmin: boolean;
  group: string;
}

export interface UserPermissions {
  tabs: {
    devices: TabPermission;
    monitoring: TabPermission;
    tracking: TabPermission;
    cloud: TabPermission;
    [key: string]: TabPermission;
  };
  isGlobalAdmin: boolean;
}

export interface User {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'user';
  ad_dn?: string | null;
  last_login_at?: string | null;
  created_at?: string;
  permissions?: UserPermissions;
}

export interface DeviceParameters {
  width?: number;
  height?: number;
  dpi?: number;
  colorDepth?: number;
  audio?: boolean;
  driveRedirect?: boolean;
  domain?: string;
  security?: 'any' | 'nla' | 'tls' | 'rdp';
  ignoreCert?: boolean;
  keyboardLayout?: string;
  timezone?: string;
  fontSize?: number;
  cursorStyle?: string;
  [key: string]: any;
}

export interface Device {
  id: string;
  name: string;
  protocol: 'rdp' | 'vnc' | 'ssh';
  host: string;
  port: number;
  parameters: string | DeviceParameters;
  folder_id: string | null;
  folder_name?: string | null;
  is_favorite: number | boolean;
  owner_id: string;
  owner_username?: string;
  owner_display_name?: string;
  created_by_admin_id: string | null;
  created_at: string;
  updated_at: string;
  is_shared?: boolean;
  shared_by_user?: string;
}

export interface Folder {
  id: string;
  name: string;
  user_id: string;
  icon: string;
  color: string;
  created_at: string;
  device_count?: number;
}

export interface DeviceShare {
  id: string;
  device_id: string;
  device_name?: string;
  shared_with_user_id: string;
  shared_with_username?: string;
  shared_with_display_name?: string;
  created_by_user_id: string;
  created_at: string;
}

export interface GuestShare {
  id: string;
  token: string;
  device_id: string;
  device_name?: string;
  protocol?: string;
  created_by_user_id: string;
  has_pin: boolean;
  duration_label: string;
  expires_at: string;
  max_uses: number | null;
  use_count: number;
  revoked_at: string | null;
  created_at: string;
  is_expired?: boolean;
}

export interface SessionLog {
  id: string;
  session_id: string;
  user_id: string | null;
  user_display_name?: string | null;
  user_username?: string | null;
  guest_share_id: string | null;
  device_id: string;
  device_name: string;
  protocol: string;
  connection_method: 'owner' | 'shared_user' | 'guest_link';
  client_ip: string | null;
  user_agent: string | null;
  started_at: string;
  ended_at: string | null;
  duration_seconds?: number | null;
  status: 'active' | 'closed' | 'failed';
  error_message: string | null;
}

export interface SystemSettings {
  ad_domain: string;
  ad_url: string;
  ad_base_dn: string;
  ad_admin_group: string;
  ad_user_group: string;
  git_repo_url: string;
  git_branch: string;
  monitoring_hub_url?: string;
  [key: string]: string | undefined;
}

export interface UpdateStatus {
  currentCommit: string;
  commitDate: string;
  commitMessage: string;
  branch: string;
  repoUrl: string;
  hasUpdates: boolean;
  latestRemoteCommit?: string;
  error?: string;
}

export interface WidgetCatalogItem {
  id: string;
  type: string;
  title: string;
  description: string;
  category: 'monitoring' | 'devices' | 'system' | 'shortcuts';
  requiredTab?: string;
  icon: string;
  defaultSize: { w: number; h: number };
}

export interface DashboardWidgetConfig {
  instanceId: string;
  type: string;
  title: string;
  w?: number;
  order: number;
  enabled?: boolean;
}

export interface BackupSummary {
  devicesRestored: number;
  foldersRestored: number;
  settingsRestored: number;
  dashboardLayoutRestored: boolean;
}

export interface TrackedItem {
  id: string;
  name: string;
  category: 'Vehicles' | 'Devices';
  user_id: string;
  movement_threshold_meters: number;
  min_speed_kmh: number;
  stationary_dwell_seconds: number;
  last_lat: number | null;
  last_lng: number | null;
  last_speed: number | null;
  last_heading: number | null;
  last_accuracy: number | null;
  last_battery: number | null;
  status: 'moving' | 'stationary' | 'offline';
  last_seen_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface TrackingJourney {
  id: string;
  item_id: string;
  start_time: number;
  end_time: number | null;
  start_lat: number | null;
  start_lng: number | null;
  end_lat: number | null;
  end_lng: number | null;
  distance_km: number;
  duration_seconds: number;
  avg_speed_kmh: number;
  max_speed_kmh: number;
  points_count: number;
  has_speeding: number;
  status: 'in_progress' | 'completed';
  created_at: string;
}

export interface JourneyPoint {
  id: string;
  latitude: number;
  longitude: number;
  speed: number | null;
  heading: number | null;
  accuracy: number | null;
  battery_level: number | null;
  speed_limit: number | null;
  road_name: string | null;
  is_speeding: number;
  timestamp: number;
}

export interface TrackingSettings {
  mapProvider: 'leaflet' | 'google';
  googleMapsApiKey: string;
  hasGoogleMapsKey: boolean;
}
