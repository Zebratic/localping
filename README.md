# LocalPing

<img src="src/public/ms-icon-310x310.png" alt="LocalPing Logo" width="200" style="border-radius: 20px;">

A simple, self-hosted uptime monitoring system for your homelab. Monitor TrueNAS, Jellyfin, qBittorrent, web services, and anything else with real-time dashboards and historical tracking.

## Quick Install

One-liner deployment (Ubuntu 22.04+):

```bash
sudo apt update && sudo apt install -y curl && curl -fsSL https://raw.githubusercontent.com/zebratic/localping/main/install.sh | bash
```

This automatically:
- Installs Node.js, dependencies, and systemd service
- Configures secure environment variables
- Sets up ICMP capabilities for ping
- Enables auto-start on boot

## First-Time Setup

1. Visit `http://<your-ip>:8000/setup`
2. Create admin username and password
3. Configure gateway IP (auto-detected)
4. Complete setup and login at `http://<your-ip>:8000/admin/login`

## Features

- **Multi-Protocol**: ICMP, TCP, UDP, HTTP/HTTPS monitoring
- **Real-Time Dashboards**: Admin panel + public status page
- **Historical Data**: 90+ days stored locally in SQLite
- **Desktop Notifications**: Browser notifications for status changes
- **Service Groups**: Organize monitors by category
- **Quick Commands**: `/jellyfin` style shortcuts on public UI

## Access Points

- **Public Dashboard**: `http://localhost:8000`
- **Admin Panel**: `http://localhost:8000/admin`
- **API**: `http://localhost:8000/api`

## Service Management

```bash
# Check status
systemctl status localping

# View logs
journalctl -u localping -f

# Restart
sudo systemctl restart localping

# Stop/Start
sudo systemctl stop localping
sudo systemctl start localping
```

## Configuration

All settings are in `/opt/localping/.env`:

```env
API_PORT=8000
PING_INTERVAL=60
ALERT_COOLDOWN=300
```

Admin credentials are set during the setup wizard. The database is stored at `data/localping.db` (SQLite - no external database needed).

## Development

```bash
# Clone and install
git clone https://github.com/zebratic/localping.git
cd localping
npm install

# Set ICMP capabilities
sudo setcap cap_net_raw=ep $(which node)

# Run in dev mode
npm run dev
```

## License

MIT
