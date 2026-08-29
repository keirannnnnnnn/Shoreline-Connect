import ldap from 'ldapjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { db } from '../db/database.js';

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

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'user';
  ad_dn: string | null;
  ad_groups?: string | null;
  last_login_at: string | null;
  created_at: string;
  permissions?: UserPermissions;
}

export interface JwtPayload {
  userId: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export class AuthService {
  /**
   * Exact match or CN match helper for Active Directory group strings
   */
  static checkGroupMatch(userGroupStr: string, targetGroupName: string): boolean {
    if (!userGroupStr || !targetGroupName) return false;
    const ug = userGroupStr.toLowerCase().trim();
    const target = targetGroupName.toLowerCase().trim();
    if (!ug || !target) return false;
    if (ug === target) return true;
    if (ug === `cn=${target}`) return true;
    if (ug.startsWith(`cn=${target},`)) return true;
    return false;
  }

  /**
   * Calculate live per-tab permissions for a user
   */
  static getUserPermissions(userId: string): UserPermissions {
    const userRow = db.prepare('SELECT id, username, role, ad_dn, ad_groups FROM users WHERE id = ?').get(userId) as { id: string; username: string; role: string; ad_dn: string | null; ad_groups: string | null } | undefined;
    if (!userRow) {
      return {
        tabs: {
          devices: { canAccess: false, isAdmin: false, group: '' },
          monitoring: { canAccess: false, isAdmin: false, group: '' },
          tracking: { canAccess: false, isAdmin: false, group: '' },
          cloud: { canAccess: false, isAdmin: false, group: '' },
        },
        isGlobalAdmin: false,
      };
    }

    let userGroups: string[] = [];
    if (userRow.ad_groups) {
      try {
        userGroups = JSON.parse(userRow.ad_groups);
      } catch {}
    }

    const isGlobalAdmin = userRow.role === 'admin';

    // Retrieve active AD group settings from system_settings
    const adminGroupSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_admin_group'").get() as { value: string } | undefined;
    const userGroupSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_user_group'").get() as { value: string } | undefined;

    const adminGroups = (adminGroupSetting?.value || config.ad.adminGroup || '')
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);

    const defaultUserGroupSetting = userGroupSetting?.value !== undefined ? userGroupSetting.value.trim() : (config.ad.userGroup || '');
    const defaultUserGroups = defaultUserGroupSetting
      .split(/[,;]/)
      .map(s => s.trim())
      .filter(Boolean);

    const isUserAdminGroupMember = isGlobalAdmin || userGroups.some(g =>
      adminGroups.some(ag => this.checkGroupMatch(g, ag))
    );

    const tabKeys = ['devices', 'monitoring', 'tracking', 'cloud'];
    const tabs: Record<string, TabPermission> = {};

    for (const tab of tabKeys) {
      const tabSetting = db.prepare("SELECT value FROM system_settings WHERE key = ?").get(`tab_group_${tab}`) as { value: string } | undefined;
      const configuredGroup = (tabSetting?.value || '').trim();

      let canAccess = false;

      if (!configuredGroup) {
        // If no specific group is configured for this tab, all authenticated users have access
        canAccess = true;
      } else {
        const requiredGroups = configuredGroup.split(/[,;]/).map(s => s.trim()).filter(Boolean);
        canAccess = isGlobalAdmin || userGroups.some(g =>
          requiredGroups.some(rg => this.checkGroupMatch(g, rg))
        );
      }

      // Per-tab Admin: User must have tab access AND be in the Shoreline Administrators group
      const isTabAdmin = canAccess && isUserAdminGroupMember;

      tabs[tab] = {
        canAccess,
        isAdmin: isTabAdmin,
        group: configuredGroup,
      };
    }

    return {
      tabs: tabs as any,
      isGlobalAdmin,
    };
  }

  /**
   * Authenticate user with Active Directory (Shoreline.icu)
   */
  static async login(usernameInput: string, passwordInput: string): Promise<{ token: string; user: UserRecord }> {
    if (!usernameInput || !passwordInput) {
      throw new Error('Username and password are required');
    }

    const cleanUsername = usernameInput.trim();
    // Support either 'user' or 'user@shoreline.icu' or 'SHORELINE\\user'
    let sAMAccountName = cleanUsername;
    let upn = cleanUsername;
    if (cleanUsername.includes('@')) {
      sAMAccountName = cleanUsername.split('@')[0];
    } else if (cleanUsername.includes('\\')) {
      sAMAccountName = cleanUsername.split('\\')[1];
    } else {
      upn = `${cleanUsername}@${config.ad.domain}`;
    }

    // Retrieve active AD settings from database
    const adminGroupSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_admin_group'").get() as { value: string } | undefined;
    const userGroupSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_user_group'").get() as { value: string } | undefined;
    const adUrlSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_url'").get() as { value: string } | undefined;
    const adBaseDnSetting = db.prepare("SELECT value FROM system_settings WHERE key = 'ad_base_dn'").get() as { value: string } | undefined;

    const adminGroupName = (adminGroupSetting?.value || config.ad.adminGroup).toLowerCase().trim();
    const userGroupName = (userGroupSetting?.value || config.ad.userGroup).toLowerCase().trim();
    const adUrl = adUrlSetting?.value || config.ad.url;
    const adBaseDn = adBaseDnSetting?.value || config.ad.baseDn;

    let authenticatedUser: {
      sAMAccountName: string;
      displayName: string;
      email: string | null;
      groups: string[];
      dn: string;
    } | null = null;

    try {
      authenticatedUser = await this.authenticateWithLdap(adUrl, adBaseDn, upn, sAMAccountName, passwordInput);
    } catch (ldapErr: any) {
      console.warn('LDAP authentication attempt notice:', ldapErr.message);

      // In dev mode, if live AD domain controller is unreachable, allow dev credentials
      if (config.devAuthMode) {
        console.log(`[DevAuthMode] Simulating AD login for '${cleanUsername}'`);
        const isAdmin = sAMAccountName.toLowerCase().includes('admin') || sAMAccountName.toLowerCase() === 'keiran.griffiths';
        authenticatedUser = {
          sAMAccountName,
          displayName: cleanUsername.split('@')[0].split('.').map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(' '),
          email: `${sAMAccountName}@${config.ad.domain}`,
          groups: isAdmin ? [adminGroupName, userGroupName] : [userGroupName],
          dn: `CN=${sAMAccountName},OU=Users,${adBaseDn}`
        };
      } else {
        throw new Error('Invalid Active Directory credentials or account disabled');
      }
    }

    if (!authenticatedUser) {
      throw new Error('Authentication failed');
    }

    // Determine role by AD group membership (checked fresh on EVERY login)
    const userGroups = authenticatedUser.groups.map(g => g.toLowerCase().trim());
    const adminGroups = (adminGroupSetting?.value || config.ad.adminGroup)
      .split(/[,;]/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    const userGroupsAllowed = (userGroupSetting?.value || config.ad.userGroup)
      .split(/[,;]/)
      .map(s => s.trim().toLowerCase())
      .filter(Boolean);

    const isAdminMember = userGroups.some(g => 
      adminGroups.some(ag => this.checkGroupMatch(g, ag))
    );

    const isUserMember = userGroups.some(g => 
      userGroupsAllowed.some(ug => this.checkGroupMatch(g, ug))
    ) || (userGroupsAllowed.length === 0);

    let role: 'admin' | 'user';

    if (isAdminMember) {
      role = 'admin';
    } else if (isUserMember) {
      role = 'user';
    } else {
      throw new Error(`Access denied. Account '${authenticatedUser.sAMAccountName}' is not a member of authorized AD groups (${adminGroups.join(', ')} or ${userGroupsAllowed.join(', ')}).`);
    }

    console.log(`[AuthService] User '${authenticatedUser.sAMAccountName}' resolved: isAdmin=${isAdminMember}, isUser=${isUserMember} -> role='${role}' (AD groups: [${authenticatedUser.groups.join(', ')}])`);

    // Upsert user in local SQLite database with ad_groups JSON array
    let user = (db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(authenticatedUser.sAMAccountName) as unknown) as UserRecord | undefined;

    const now = new Date().toISOString();
    const groupsJson = JSON.stringify(authenticatedUser.groups);

    if (user) {
      db.prepare(`
        UPDATE users 
        SET display_name = ?, email = ?, role = ?, ad_dn = ?, ad_groups = ?, last_login_at = ?
        WHERE id = ?
      `).run(authenticatedUser.displayName, authenticatedUser.email, role, authenticatedUser.dn, groupsJson, now, user.id);

      user = (db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown) as UserRecord;
    } else {
      const newId = uuidv4();
      db.prepare(`
        INSERT INTO users (id, username, display_name, email, role, ad_dn, ad_groups, last_login_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, authenticatedUser.sAMAccountName, authenticatedUser.displayName, authenticatedUser.email, role, authenticatedUser.dn, groupsJson, now, now);

      user = (db.prepare('SELECT * FROM users WHERE id = ?').get(newId) as unknown) as UserRecord;
    }

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });
    const permissions = this.getUserPermissions(user.id);

    return { token, user: { ...user, permissions } };
  }

  /**
   * Internal LDAP bind and search against Active Directory
   */
  private static authenticateWithLdap(
    adUrl: string,
    adBaseDn: string,
    upn: string,
    sAMAccountName: string,
    password: string
  ): Promise<{ sAMAccountName: string; displayName: string; email: string | null; groups: string[]; dn: string }> {
    return new Promise((resolve, reject) => {
      const client = ldap.createClient({
        url: adUrl,
        timeout: 5000,
        connectTimeout: 5000,
      });

      client.on('error', (err) => {
        reject(err);
      });

      // Bind with user's UPN (e.g. user@shoreline.icu)
      client.bind(upn, password, (bindErr) => {
        if (bindErr) {
          client.unbind();
          return reject(bindErr);
        }

        // Search for user's details and group memberships
        const searchOpts: ldap.SearchOptions = {
          scope: 'sub',
          filter: `(|(sAMAccountName=${sAMAccountName})(userPrincipalName=${upn}))`,
          attributes: ['dn', 'sAMAccountName', 'displayName', 'mail', 'memberOf'],
        };

        client.search(adBaseDn, searchOpts, (searchErr, res) => {
          if (searchErr) {
            client.unbind();
            return reject(searchErr);
          }

          let found = false;
          let entryData: any = null;

          res.on('searchEntry', (entry) => {
            found = true;
            entryData = entry.pojo;
          });

          res.on('error', (err) => {
            client.unbind();
            reject(err);
          });

          res.on('end', () => {
            client.unbind();
            if (!found || !entryData) {
              return reject(new Error('User not found in Active Directory tree'));
            }

            const attributes = entryData.attributes || [];
            const getAttr = (name: string) => {
              const attr = attributes.find((a: any) => a.type.toLowerCase() === name.toLowerCase());
              return attr ? (Array.isArray(attr.values) ? attr.values : [attr.values]) : [];
            };

            const displayNameVals = getAttr('displayName');
            const mailVals = getAttr('mail');
            const memberOfVals = getAttr('memberOf');

            const groups: string[] = [];
            for (const dnStr of memberOfVals) {
              groups.push(dnStr);
              // Extract CN from DN, e.g. "CN=Shoreline-Admins,OU=Groups,DC=shoreline,DC=icu" -> "Shoreline-Admins"
              const match = dnStr.match(/^CN=([^,]+)/i);
              if (match) {
                groups.push(match[1]);
              }
            }

            resolve({
              sAMAccountName: sAMAccountName,
              displayName: displayNameVals[0] || sAMAccountName,
              email: mailVals[0] || null,
              groups,
              dn: entryData.objectName || '',
            });
          });
        });
      });
    });
  }

  /**
   * Verify JWT Token
   */
  static verifyToken(token: string): JwtPayload {
    return jwt.verify(token, config.jwtSecret) as JwtPayload;
  }

  /**
   * Get user by ID with live per-tab permissions
   */
  static getUserById(id: string): UserRecord | undefined {
    const user = (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown) as UserRecord | undefined;
    if (!user) return undefined;
    const permissions = this.getUserPermissions(user.id);
    return { ...user, permissions };
  }

  /**
   * Get all active users (for Admin directory & internal sharing user selection)
   */
  static getAllUsers(): UserRecord[] {
    const users = (db.prepare('SELECT id, username, display_name, email, role, last_login_at, created_at FROM users ORDER BY display_name ASC').all() as unknown) as UserRecord[];
    return users.map(u => ({ ...u, permissions: this.getUserPermissions(u.id) }));
  }
}
