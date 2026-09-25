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

## 📦 Updates & Software Management Subsystem (Build 4)

Shoreline Connect features a native software management subsystem powered by the lightweight Go monitoring agent:

- **Strict Software-Only Scope**: Windows OS Updates, KBs, feature updates, and drivers are strictly excluded. Focus is solely on software inventory (WinGet, MSI, EXE, Deb, Snap, Flatpak) and custom execution.
- **Bi-Directional Command Channel**: The agent sends health metrics every 15s (`POST /api/monitoring/report`). The backend piggybacks pending jobs (`{ next_job }`) directly in the HTTP 200 response, eliminating the need for open inbound ports, WinRM, SSH, or remoting.
- **Access Control & RBAC**:
  - Gated by Active Directory group: `Shoreline Connect Updates Users` (configurable in **Settings** &rarr; `tab_group_updates`).
  - Standard users can explore software inventory, view pending/active jobs, and review history.
  - Install, uninstall, upgrade, script execution, and agent self-update actions strictly require membership in `Shoreline Connect Administrators`.
- **Zero-Dependency Go Agent (v1.1.0)**:
  - Supports Windows Registry discovery (`Uninstall` + `WOW6432Node` + user hives) with silent uninstaller extraction and MSI GUID detection.
  - Supports Linux package discovery (`dpkg`, `snap`, `flatpak`).
  - Integrated with WinGet (`--scope machine --source winget`).
  - Includes a background job worker and self-update engine with automated rollback watchdog.

### 🌐 Nginx Proxy Manager (NPM) Configuration
For package uploads (e.g. large `.exe`, `.msi`, `.deb` installers up to 500MB), add the following directive to the **Advanced** tab of your Shoreline Connect proxy host in Nginx Proxy Manager:

```nginx
client_max_body_size 500M;
```

### 🔄 Agent Upgrade / Reinstallation (v1.1.0)
To enable software discovery and the command channel across your fleet, update the agent on each device once:

#### Windows (PowerShell as Administrator)
```powershell
Stop-Service -Name "ShorelineAgent" -ErrorAction SilentlyContinue
# Download or copy new agent binary to C:\Program Files\ShorelineAgent\shoreline-agent.exe
Start-Service -Name "ShorelineAgent"
```

#### Linux (systemd)
```bash
sudo systemctl stop shoreline-agent
# Download or copy new agent binary to /usr/local/bin/shoreline-agent
sudo systemctl start shoreline-agent
```
*(Subsequent agent updates can be triggered directly from the Shoreline Connect UI using the built-in self-update feature).*
