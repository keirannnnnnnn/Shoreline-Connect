# 🌊 Shoreline Connect

**Shoreline Connect** is a self-hosted remote access and management portal designed to replace the Apache Guacamole web UI with a custom React frontend, proper multi-tenancy, strict per-user isolation, Active Directory domain authentication against `Shoreline.icu`, binary internal sharing, PIN-protected guest links, and native integration with the `guacd` proxy engine for RDP, VNC, and SSH sessions.

---

## 🚀 Key Features

- **Protocol Engine**: Communicates directly with `guacd` via WebSocket tunnel to broker FreeRDP (RDP), LibVNCServer (VNC), and libssh2 (SSH) remote sessions.
- **Strict Multi-User Isolation**: Every user only ever sees their own devices on their dashboard. Admins can provision devices on behalf of other users, which appear directly on that user's dashboard with full control and never leak onto the admin's personal inventory.
- **Active Directory Auth Only**: Authenticates domain users and admins against `Shoreline.icu` via LDAP/LDAPS. AD group membership dynamically maps to Admin vs. General User roles.
- **AES-256-GCM Encrypted Credentials**: Server-side encryption at rest ensures 1-click instant session launch with zero re-authentication prompts.
- **Dual Sharing Engine**:
  - **Internal User-to-User Sharing**: Binary full control access with instant revocation.
  - **External Guest Share Links**: Time-limited session links (15m, 1h, 4h, 24h, 7d) with optional PIN protection and auto-expiry state handling.
- **Session Audit Logging**: Complete records of who connected, to which target device, duration, client IP, connection method, and status.
- **Admin Self-Update Panel**: In-app interface to check for updates from Git, pull latest code, rebuild frontend/backend, and restart the service with 1 click.
- **Apple SF Symbols Only**: Entire visual design utilizes the 6,900+ Apple SF-Symbols from the local `Symbols/` directory with zero third-party icon libraries.

---

## 🛠️ Architecture Overview

```
                      ┌────────────────────────────────────────────────────────┐
                      │                   Shoreline Connect                    │
                      │                                                        │
                      │  ┌────────────────────┐      ┌──────────────────────┐  │
                      │  │ React SPA Frontend │◄────►│ Node.js/Express API  │  │
                      │  │  (Dark-theme UI,   │ WS   │  (AD Auth, Sessions, │  │
                      │  │   Guacamole Canvas │      │   Device Isolation)  │  │
                      │  └────────────────────┘      └──────────┬───────────┘  │
                      └─────────────────────────────────────────┼──────────────┘
                                                                │ Guacamole Protocol (TCP:4822)
                                                                ▼
                                                     ┌──────────────────────┐
                                                     │    guacd Daemon      │
                                                     └──────────┬───────────┘
                                                                │
                                   ┌────────────────────────────┼────────────────────────────┐
                                   ▼                            ▼                            ▼
                            ┌──────────────┐             ┌──────────────┐             ┌──────────────┐
                            │  RDP Server  │             │  SSH Server  │             │  VNC Server  │
                            │ (Port 3389)  │             │  (Port 22)   │             │ (Port 5900)  │
                            └──────────────┘             └──────────────┘             └──────────────┘
```

---

## 📦 Deployment Options

### Option 1: Docker Compose (Recommended)

1. Clone repository:
   ```bash
   git clone https://github.com/shoreline-connect/shoreline-connect.git /opt/shoreline-connect
   cd /opt/shoreline-connect
   ```

2. Configure environment variables in `.env` or `docker-compose.yml`:
   ```bash
   PORT=3001
   NODE_ENV=production
   JWT_SECRET=YOUR_RANDOM_SECRET_KEY_32_BYTES_MINIMUM
   ENCRYPTION_KEY=YOUR_32_BYTE_AES_MASTER_ENCRYPTION_KEY
   AD_URL=ldap://shoreline.icu:389
   AD_BASE_DN=DC=shoreline,DC=icu
   AD_DOMAIN=shoreline.icu
   AD_ADMIN_GROUP=Shoreline-Admins
   AD_USER_GROUP=Shoreline-Users
   GUACD_HOST=guacd
   GUACD_PORT=4822
   ```

3. Launch stack:
   ```bash
   docker compose up -d
   ```

### Option 2: Linux VM Bare-Metal / Systemd

1. Install `guacd` on host:
   ```bash
   sudo apt update
   sudo apt install -y guacd libguac-client-rdp0 libguac-client-ssh0 libguac-client-vnc0
   sudo systemctl enable --now guacd
   ```

2. Install Node.js 22+ or 24+:
   ```bash
   npm run build
   ```

3. Setup systemd service:
   ```bash
   sudo cp scripts/shoreline-connect.service /etc/systemd/system/
   sudo systemctl daemon-reload
   sudo systemctl enable --now shoreline-connect
   ```

---

## 🧪 Running Automated Tests

```bash
cd server
npm test
```
