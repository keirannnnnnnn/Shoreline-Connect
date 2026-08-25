import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  jwtSecret: process.env.JWT_SECRET || 'shoreline_connect_jwt_default_secret_key_1234567890',
  encryptionKey: process.env.ENCRYPTION_KEY || 'shoreline_aes256_super_secure_master_key_32b!',
  ad: {
    url: process.env.AD_URL || 'ldap://shoreline.icu:389',
    baseDn: process.env.AD_BASE_DN || 'DC=shoreline,DC=icu',
    domain: process.env.AD_DOMAIN || 'shoreline.icu',
    bindDn: process.env.AD_BIND_DN || '',
    bindPassword: process.env.AD_BIND_PASSWORD || '',
    adminGroup: process.env.AD_ADMIN_GROUP || 'Shoreline-Admins',
    userGroup: process.env.AD_USER_GROUP || 'Shoreline-Users',
  },
  devAuthMode: process.env.DEV_AUTH_MODE === 'true' || process.env.NODE_ENV !== 'production',
  guacd: {
    host: process.env.GUACD_HOST || '127.0.0.1',
    port: parseInt(process.env.GUACD_PORT || '4822', 10),
  },
  git: {
    repoUrl: process.env.GIT_REPO_URL || '',
    branch: process.env.GIT_BRANCH || 'main',
  },
  symbolsDir: path.resolve(__dirname, '../../../Symbols'),
  dataDir: path.resolve(__dirname, '../../data'),
};
