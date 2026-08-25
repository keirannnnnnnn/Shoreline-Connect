import ldap from 'ldapjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import { config } from '../config/env.js';
import { db } from '../db/database.js';

export interface UserRecord {
  id: string;
  username: string;
  display_name: string;
  email: string | null;
  role: 'admin' | 'user';
  ad_dn: string | null;
  last_login_at: string | null;
  created_at: string;
}

export interface JwtPayload {
  userId: string;
  username: string;
  displayName: string;
  role: 'admin' | 'user';
}

export class AuthService {
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

    const adminGroupName = (adminGroupSetting?.value || config.ad.adminGroup).toLowerCase();
    const userGroupName = (userGroupSetting?.value || config.ad.userGroup).toLowerCase();
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

    // Determine role by AD group membership
    const userGroups = authenticatedUser.groups.map(g => g.toLowerCase());
    let role: 'admin' | 'user' = 'user';
    
    const isAdminMember = userGroups.some(g => g.includes(adminGroupName) || g === 'domain admins' || g === 'administrators');
    const isUserMember = userGroups.some(g => g.includes(userGroupName) || g === 'domain users') || isAdminMember;

    if (isAdminMember) {
      role = 'admin';
    } else if (isUserMember) {
      role = 'user';
    } else {
      // If user is not member of allowed groups
      if (!config.devAuthMode) {
        throw new Error(`Access denied. Account is not a member of authorized AD groups (${adminGroupName} or ${userGroupName}).`);
      }
    }

    // Upsert user in local SQLite database
    let user = (db.prepare('SELECT * FROM users WHERE username = ? COLLATE NOCASE').get(authenticatedUser.sAMAccountName) as unknown) as UserRecord | undefined;

    const now = new Date().toISOString();
    if (user) {
      db.prepare(`
        UPDATE users 
        SET display_name = ?, email = ?, role = ?, ad_dn = ?, last_login_at = ?
        WHERE id = ?
      `).run(authenticatedUser.displayName, authenticatedUser.email, role, authenticatedUser.dn, now, user.id);

      user = (db.prepare('SELECT * FROM users WHERE id = ?').get(user.id) as unknown) as UserRecord;
    } else {
      const newId = uuidv4();
      db.prepare(`
        INSERT INTO users (id, username, display_name, email, role, ad_dn, last_login_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(newId, authenticatedUser.sAMAccountName, authenticatedUser.displayName, authenticatedUser.email, role, authenticatedUser.dn, now, now);

      user = (db.prepare('SELECT * FROM users WHERE id = ?').get(newId) as unknown) as UserRecord;
    }

    const payload: JwtPayload = {
      userId: user.id,
      username: user.username,
      displayName: user.display_name,
      role: user.role,
    };

    const token = jwt.sign(payload, config.jwtSecret, { expiresIn: '7d' });

    return { token, user };
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

            const groups = memberOfVals.map((dnStr: string) => {
              // Extract CN from DN, e.g. "CN=Shoreline-Admins,OU=Groups,DC=shoreline,DC=icu" -> "Shoreline-Admins"
              const match = dnStr.match(/^CN=([^,]+)/i);
              return match ? match[1] : dnStr;
            });

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
   * Get user by ID
   */
  static getUserById(id: string): UserRecord | undefined {
    return (db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown) as UserRecord | undefined;
  }

  /**
   * Get all active users (for Admin directory & internal sharing user selection)
   */
  static getAllUsers(): UserRecord[] {
    return (db.prepare('SELECT id, username, display_name, email, role, last_login_at, created_at FROM users ORDER BY display_name ASC').all() as unknown) as UserRecord[];
  }
}
