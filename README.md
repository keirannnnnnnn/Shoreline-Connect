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

