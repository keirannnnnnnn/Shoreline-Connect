import assert from 'assert';
import { CryptoService } from './services/crypto.service.js';
import { initDatabase, db } from './db/database.js';
import { DeviceService } from './services/device.service.js';
import { SharingService } from './services/sharing.service.js';
import { AuditService } from './services/audit.service.js';
import { AuthService } from './services/auth.service.js';
import { GuacdService } from './services/guacd.service.js';

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
  const expiredLink = await SharingService.createGuestShareLink({
    deviceId: userDevice.id,
    currentUserId: userId,
    durationMinutes: -5, // Expired 5 minutes ago
    durationLabel: 'Expired test',
  });
  const expiredCheck = SharingService.getGuestShareByToken(expiredLink.token);
  assert(!expiredCheck.valid && expiredCheck.reason === 'expired', 'Expired link must cleanly return reason: expired');
  console.log('  ✅ Guest share link creation, PIN protection, and auto-expiry passed.\n');

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
  console.log('  ✅ Audit logging passed.\n');

  console.log('🎉 ALL BACKEND TESTS PASSED SUCCESSFULLY!\n');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
