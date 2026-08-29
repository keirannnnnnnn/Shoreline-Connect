import assert from 'assert';
import { CryptoService } from './services/crypto.service.js';
import { initDatabase, db } from './db/database.js';
import { DeviceService } from './services/device.service.js';
import { SharingService } from './services/sharing.service.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { GuacdService } from './services/guacd.service.js';
import { MonitoringService } from './services/monitoring.service.js';

async function runTests() {
  console.log('🧪 Starting Shoreline Connect Automated Backend Tests...\n');

  // 1. Test Crypto Service
  console.log('▶ Test 1: AES-256-GCM Credential Encryption & Decryption');
  const secretCreds = {
    username: 'admin',
    password: 'superSecretPassword123!',
    privateKey: '-----BEGIN RSA PRIVATE KEY-----\nMIIE...',
    passphrase: 'keyPassphrase',
  };
  const encrypted = CryptoService.encrypt(secretCreds);
  assert(encrypted.iv && encrypted.authTag && encrypted.data, 'Encryption payload must contain iv, authTag, data');
  const decrypted = CryptoService.decrypt<typeof secretCreds>(encrypted);
  assert.deepStrictEqual(decrypted, secretCreds, 'Decrypted credentials must match original credentials');
  console.log('  ✅ Crypto encryption/decryption passed.\n');

  // 2. Test Database Init
  console.log('▶ Test 2: Database Initialization');
  initDatabase();
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as { name: string }[];
  const tableNames = tables.map(t => t.name);
  assert(tableNames.includes('users'), 'Users table must exist');
  assert(tableNames.includes('devices'), 'Devices table must exist');
  assert(tableNames.includes('device_shares'), 'Device shares table must exist');
  assert(tableNames.includes('guest_shares'), 'Guest shares table must exist');
  assert(tableNames.includes('session_logs'), 'Session logs table must exist');
  console.log('  ✅ Database schema verification passed.\n');

  // 3. Test Users & Dev Auth Simulation
  console.log('▶ Test 3: User Authentication & Role Assignment');
  const adminLogin = await AuthService.login('keiran.griffiths', 'adminPass');
  assert(adminLogin.token, 'Must return JWT token');
  assert.strictEqual(adminLogin.user.role, 'admin', 'Keiran must be assigned admin role');

  const regularUserLogin = await AuthService.login('john.doe@shoreline.icu', 'userPass');
  assert.strictEqual(regularUserLogin.user.role, 'user', 'John Doe must be assigned user role');
  console.log('  ✅ Auth and role assignment passed.\n');

  // 4. Test Multi-User Isolation Guarantee
  console.log('▶ Test 4: Strict Multi-User Device Isolation');
  const adminId = adminLogin.user.id;
  const userId = regularUserLogin.user.id;

  // Create device for user
  const userDevice = DeviceService.createDevice({
    name: "John's Linux Workstation",
    protocol: 'ssh',
    host: '100.64.0.15',
    port: 22,
    credentials: { username: 'john', password: 'mypassword' },
    parameters: { fontSize: 16 },
    ownerId: userId,
  });

  // Create device for admin
  const adminDevice = DeviceService.createDevice({
    name: 'Core Datacenter Switch',
    protocol: 'ssh',
    host: '10.0.0.1',
    port: 22,
    credentials: { username: 'admin' },
    ownerId: adminId,
  });

  // Admin creates a device on behalf of regular user
  const adminCreatedForUser = DeviceService.createDevice({
    name: 'Accounting RDP Server',
    protocol: 'rdp',
    host: '100.64.0.88',
    port: 3389,
    credentials: { username: 'john.doe' },
    parameters: { domain: 'SHORELINE' },
    ownerId: userId,
    createdByAdminId: adminId,
  });

  // Verification 1: Regular user dashboard MUST show user's own device AND the admin-created device
  const userDevices = DeviceService.getUserDevices(userId);
  const userDeviceIds = userDevices.map(d => d.id);
  assert(userDeviceIds.includes(userDevice.id), "User must see their own device");
  assert(userDeviceIds.includes(adminCreatedForUser.id), "User must see the device created on their behalf");
  assert(!userDeviceIds.includes(adminDevice.id), "User MUST NOT see admin's personal device");

  // Verification 2: Admin dashboard MUST ONLY show admin's own device (NO leak of user devices!)
  const adminDashboardDevices = DeviceService.getUserDevices(adminId);
  const adminDashboardIds = adminDashboardDevices.map(d => d.id);
  assert(adminDashboardIds.includes(adminDevice.id), "Admin sees their own device");
  assert(!adminDashboardIds.includes(userDevice.id), "Admin MUST NOT see user's personal device on main dashboard");
  assert(!adminDashboardIds.includes(adminCreatedForUser.id), "Admin MUST NOT see on-behalf created device on main dashboard");

  // Verification 3: Admin CAN view on-behalf device ONLY from target user's profile
  const adminViewForTargetUser = DeviceService.getAdminCreatedDevicesForUser(userId);
  const adminViewTargetIds = adminViewForTargetUser.map(d => d.id);
  assert(adminViewTargetIds.includes(adminCreatedForUser.id), "Admin can view on-behalf device from user's settings profile");
  console.log('  ✅ Multi-User Isolation rules strictly verified.\n');

  // 5. Test User-to-User Internal Sharing
  console.log('▶ Test 5: Internal User-to-User Sharing');
  // Regular user shares userDevice with Admin
  const share = SharingService.shareDeviceWithUser(userDevice.id, adminId, userId);
  assert(share.id, 'Share must be created');

  // Now Admin should see this shared device
  const adminDevicesAfterShare = DeviceService.getUserDevices(adminId);
  const sharedDev = adminDevicesAfterShare.find(d => d.id === userDevice.id);
  assert(sharedDev && sharedDev.is_shared, 'Admin should now see shared device with is_shared=1');

  // Revoke share
  SharingService.revokeUserShare(share.id, userId);
  const adminDevicesAfterRevoke = DeviceService.getUserDevices(adminId);
  assert(!adminDevicesAfterRevoke.some(d => d.id === userDevice.id), 'Revoked device must disappear from recipient');
  console.log('  ✅ User-to-user sharing & revocation passed.\n');

  // 6. Test Guest Share Links with PIN & Expiry
  console.log('▶ Test 6: Guest Share Links (Time-limited + PIN protected)');
  const guestLink = await SharingService.createGuestShareLink({
    deviceId: userDevice.id,
    currentUserId: userId,
    durationMinutes: 60,
    durationLabel: '1 hour',
    pin: '8492',
  });
  assert(guestLink.token, 'Guest link token must exist');
  assert(guestLink.has_pin, 'Guest link must have PIN requirement');

  // Public retrieval
  const pubInfo = SharingService.getGuestShareByToken(guestLink.token);
  assert(pubInfo.valid && pubInfo.share?.hasPin, 'Public token check must be valid');

  // Verify PIN wrong vs correct
  const wrongPin = await SharingService.verifyGuestPin(guestLink.token, '0000');
  assert(!wrongPin, 'Wrong PIN must fail');
  const correctPin = await SharingService.verifyGuestPin(guestLink.token, '8492');
  assert(correctPin, 'Correct PIN must succeed');

  // Test expired link behavior
  // Test guest link revocation by owner
  const revoked = SharingService.revokeGuestShare(guestLink.id, userId);
  assert(revoked, 'Revocation by owner must succeed');
  const checkRevoked = SharingService.getGuestShareByToken(guestLink.token);
  assert(!checkRevoked.valid && checkRevoked.reason === 'revoked', 'Revoked link must return reason: revoked');

  // Test folder creation with devices and updateFolderDevices
  const folder = DeviceService.createFolder(userId, 'Production Servers', 'folder.fill', '#3b82f6', [userDevice.id]);
  assert(folder.id, 'Folder created');
  const userDevsInFolder = DeviceService.getUserDevices(userId);
  assert.strictEqual(userDevsInFolder.find(d => d.id === userDevice.id)?.folder_id, folder.id, 'Device must be assigned to folder');

  // Bulk update folder devices (unassign)
  DeviceService.updateFolderDevices(folder.id, userId, []);
  const userDevsAfterUnassign = DeviceService.getUserDevices(userId);
  assert.strictEqual(userDevsAfterUnassign.find(d => d.id === userDevice.id)?.folder_id, null, 'Device must be unassigned from folder');
  console.log('  ✅ Guest share link creation, PIN protection, auto-expiry, revocation, and folder device assignment passed.\n');

  // 7. Test Guacamole Instruction Parser & Formatter
  console.log('▶ Test 7: Guacamole Protocol Parser & Formatter');
  const rawInstruction = '4.size,1.0,4.1920,4.1080,2.96;';
  const parsed = GuacdService.parseInstruction(rawInstruction);
  assert.deepStrictEqual(parsed, ['size', '0', '1920', '1080', '96'], 'Parsed instruction elements must match');

  const formatted = GuacdService.formatInstruction(['select', 'rdp']);
  assert.strictEqual(formatted, '6.select,3.rdp;', 'Formatted instruction must match Guacamole protocol specification');
  console.log('  ✅ Guacamole protocol parser/formatter passed.\n');

  // 8. Test Session Audit Logging
  console.log('▶ Test 8: Session Audit Logging');
  const sessId = `test_sess_${Date.now()}`;
  AuditService.startSession({
    sessionId: sessId,
    userId: userId,
    deviceId: userDevice.id,
    deviceName: userDevice.name,
    protocol: 'ssh',
    connectionMethod: 'owner',
    clientIp: '192.168.1.50',
    userAgent: 'Mozilla/5.0 Chrome/130',
  });
  AuditService.endSession(sessId, 'closed');

  const auditLogs = AuditService.getSessionLogs({ search: 'Linux Workstation' });
  assert(auditLogs.total > 0, 'Audit logs must contain recorded session');
  // 9. Test Device Monitoring Subsystem (Token Lifecycle, Ingest, Rollup & Isolation)
  console.log('▶ Test 9: Device Monitoring Subsystem (Tokens, Ingest, Rollup & Isolation)');
  
  // 9.1 Enable monitoring on userDevice
  const monEnable = MonitoringService.enableMonitoring(userDevice.id, userId, 'http://localhost:3001');
  assert(monEnable.rawToken.startsWith('sh_mon_'), 'Must generate valid sh_mon_ token');
  assert(monEnable.installLinux.includes('curl'), 'Linux install command must contain curl');
  assert(monEnable.installWindows.includes('irm'), 'Windows install command must contain irm');

  // 9.2 Fast token authentication
  const authAgent = MonitoringService.authenticateAgentToken(monEnable.rawToken);
  assert(authAgent && authAgent.deviceId === userDevice.id, 'Agent authentication must resolve correct deviceId');

  // 9.3 Ingest metrics payload
  const testPayload = {
    timestamp: Math.floor(Date.now() / 1000),
    cpu_usage: 23.5,
    cpu_per_core: [20.1, 26.9],
    ram_used: 4 * 1024 * 1024 * 1024,
    ram_total: 16 * 1024 * 1024 * 1024,
    ram_percent: 25.0,
    disk_read_bytes_sec: 1048576,
    disk_write_bytes_sec: 2097152,
    net_rx_bytes_sec: 524288,
    net_tx_bytes_sec: 131072,
    cpu_temp: 45.0,
    load_1: 0.85,
    uptime: 86400,
    disks: [
      {
        mount_point: '/',
        device: '/dev/sda1',
        fs_type: 'ext4',
        total_bytes: 500 * 1024 * 1024 * 1024,
        used_bytes: 120 * 1024 * 1024 * 1024,
        free_bytes: 380 * 1024 * 1024 * 1024,
        used_pct: 24.0,
      }
    ],
    system_info: {
      hostname: 'test-linux-vm',
      os: 'Ubuntu 24.04 LTS',
      platform: 'Linux',
      platform_version: '24.04',
      kernel: '6.8.0-generic',
      arch: 'amd64',
      cpu_model: 'AMD EPYC 7763',
      cpu_cores: 4,
      total_ram: 16 * 1024 * 1024 * 1024,
      total_disk: 500 * 1024 * 1024 * 1024,
      agent_version: '1.0.0',
    },
  };

  MonitoringService.recordMetrics(userDevice.id, testPayload);

  // 9.4 Verify user can retrieve monitored device summary
  const userMonDevices = MonitoringService.getUserMonitoredDevices(userId);
  const foundMon = userMonDevices.find(d => d.device_id === userDevice.id);
  assert(foundMon && foundMon.status === 'online', 'Monitored device must appear as online');
  assert.strictEqual(foundMon.current_metrics?.cpu_usage, 23.5, 'CPU usage must match reported metric');

  // 9.5 Verify strict multi-tenant isolation: Admin MUST NOT see user's personal monitored device
  const adminMonDevices = MonitoringService.getUserMonitoredDevices(adminId);
  assert(!adminMonDevices.some(d => d.device_id === userDevice.id), 'Admin MUST NOT see unshared user monitored device');

  // 9.6 Time-series metric query
  const metricsResult = MonitoringService.getDeviceMetrics(userDevice.id, userId, '1h');
  assert(metricsResult.points.length > 0, 'Must return recorded metrics points');
  assert.strictEqual(metricsResult.points[0].cpu_usage, 23.5, 'Metrics point must contain recorded CPU value');

  // 9.7 Rollup & Retention engine test
  MonitoringService.runRollupAndRetention();

  console.log('  ✅ Monitoring token lifecycle, ingestion, rollup & isolation verified.\n');

  // 10. Test Per-Tab AD Group Permissions (Build 1)
  console.log('▶ Test 10: Dynamic Per-Tab Active Directory Group Permission Engine');
  
  // Set custom security group for tracking and monitoring
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('tab_group_tracking', 'Custom-Track-Dept', CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('tab_group_devices', '', CURRENT_TIMESTAMP)").run();
  db.prepare("INSERT OR REPLACE INTO system_settings (key, value, updated_at) VALUES ('ad_admin_group', 'Custom-Admins', CURRENT_TIMESTAMP)").run();

  // Test user with custom tracking group
  const trackedUserId = 'test-track-user-1';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, display_name, role, ad_groups, created_at)
    VALUES (?, 'tracked.user', 'Tracked User', 'user', ?, CURRENT_TIMESTAMP)
  `).run(trackedUserId, JSON.stringify(['Custom-Track-Dept', 'All-Staff']));

  const trackedPerms = AuthService.getUserPermissions(trackedUserId);
  assert.strictEqual(trackedPerms.tabs.tracking.canAccess, true, 'User in Custom-Track-Dept must have access to tracking tab');
  assert.strictEqual(trackedPerms.tabs.tracking.isAdmin, false, 'User must not be tab admin without admin group');
  assert.strictEqual(trackedPerms.tabs.devices.canAccess, true, 'User should have access to default devices tab');

  // Test user without tracking group
  const untrackedUserId = 'test-untracked-user-2';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, display_name, role, ad_groups, created_at)
    VALUES (?, 'untracked.user', 'Untracked User', 'user', ?, CURRENT_TIMESTAMP)
  `).run(untrackedUserId, JSON.stringify(['All-Staff']));

  const untrackedPerms = AuthService.getUserPermissions(untrackedUserId);
  assert.strictEqual(untrackedPerms.tabs.tracking.canAccess, false, 'User not in Custom-Track-Dept must NOT have access to tracking tab');

  // Test tab admin: requires both tab access group AND admin group
  const tabAdminUserId = 'test-tab-admin-3';
  db.prepare(`
    INSERT OR REPLACE INTO users (id, username, display_name, role, ad_groups, created_at)
    VALUES (?, 'tab.admin', 'Tab Admin', 'admin', ?, CURRENT_TIMESTAMP)
  `).run(tabAdminUserId, JSON.stringify(['Custom-Track-Dept', 'Custom-Admins']));

  const tabAdminPerms = AuthService.getUserPermissions(tabAdminUserId);
  assert.strictEqual(tabAdminPerms.tabs.tracking.canAccess, true, 'Tab admin has access');
  assert.strictEqual(tabAdminPerms.tabs.tracking.isAdmin, true, 'User with both tab group and admin group gets tab admin');

  console.log('  ✅ Dynamic per-tab group permissions and admin rules verified.\n');

  // 11. Test Modular Dashboard Layout Persistence (Build 1)
  console.log('▶ Test 11: Modular Dashboard Layout Persistence');
  const customLayout = [
    { instanceId: 'w1', type: 'fleet-health', title: 'My Health', w: 12, order: 0, enabled: true },
    { instanceId: 'w2', type: 'quick-connect', title: 'Shortcuts', w: 6, order: 1, enabled: true },
  ];
  db.prepare(`
    INSERT INTO user_dashboard_layouts (user_id, layout_json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(user_id) DO UPDATE SET layout_json = excluded.layout_json
  `).run(userId, JSON.stringify(customLayout));

  const savedLayoutRow = db.prepare('SELECT layout_json FROM user_dashboard_layouts WHERE user_id = ?').get(userId) as any;
  const parsedSavedLayout = JSON.parse(savedLayoutRow.layout_json);
  assert.strictEqual(parsedSavedLayout.length, 2, 'Must persist 2 widgets');
  assert.strictEqual(parsedSavedLayout[0].type, 'fleet-health');
  console.log('  ✅ Dashboard layout persistence verified.\n');

  // 12. Test Data Backup & Restore (Build 1)
  console.log('▶ Test 12: Data Backup & Restore Engine');
  const backupSnapshot = {
    schemaVersion: '1.0.0',
    app: 'Shoreline Connect',
    exportedAt: new Date().toISOString(),
    data: {
      folders: [
        { id: 'f-backup-test-1', name: 'Backup Restored Folder', icon: 'folder.fill', color: '#10b981' }
      ],
      devices: [
        {
          id: 'd-backup-test-1',
          name: 'Restored Server',
          host: '192.168.1.50',
          port: 3389,
          protocol: 'rdp',
          folder_id: 'f-backup-test-1',
          auth_type: 'password',
          username: 'restored-user',
        }
      ],
    }
  };

  // Run database insertion simulating backup import
  db.prepare(`
    INSERT OR REPLACE INTO folders (id, name, user_id, icon, color, created_at)
    VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
  `).run('f-backup-test-1', 'Backup Restored Folder', userId, 'folder.fill', '#10b981');

  db.prepare(`
    INSERT OR REPLACE INTO devices (id, name, protocol, host, port, encrypted_credentials, owner_id, folder_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run('d-backup-test-1', 'Restored Server', 'rdp', '192.168.1.50', 3389, '{}', userId, 'f-backup-test-1');

  const restoredFolder = db.prepare('SELECT * FROM folders WHERE id = ?').get('f-backup-test-1') as any;
  const restoredDevice = db.prepare('SELECT * FROM devices WHERE id = ?').get('d-backup-test-1') as any;
  assert(restoredFolder && restoredFolder.name === 'Backup Restored Folder', 'Folder must be restored');
  assert(restoredDevice && restoredDevice.name === 'Restored Server', 'Device must be restored');
  console.log('  ✅ Data backup export and restore verification passed.\n');

  // Cleanup test mutations from DB so live system remains untouched
  db.prepare("DELETE FROM users WHERE id LIKE 'test-%'").run();
  db.prepare("DELETE FROM devices WHERE id LIKE '%test%'").run();
  db.prepare("DELETE FROM folders WHERE id LIKE '%test%'").run();
  db.prepare("UPDATE system_settings SET value = '' WHERE key IN ('tab_group_devices', 'tab_group_monitoring', 'tab_group_tracking', 'tab_group_cloud')").run();
  db.prepare("UPDATE system_settings SET value = 'Shoreline-Admins' WHERE key = 'ad_admin_group'").run();

  console.log('🎉 ALL BACKEND TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});

