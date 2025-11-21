# LocalPing - Homelab Dashboard & System Monitor

A simple, self-hosted uptime monitoring system for your homelab. Monitor TrueNAS, Jellyfin, qBittorrent, web services, and anything else with real-time dashboards and historical tracking.

## Quick Start (Ubuntu 22.04+)

### Automated Installation (Recommended)

One-liner deployment - sets up everything automatically including systemd service:

```bash
sudo apt update && sudo apt install -y curl && curl -fsSL https://raw.githubusercontent.com/zebratic/localping/main/install.sh | bash
```

This will:
- ✅ Install all dependencies (Node.js, npm, git, etc.)
- ✅ Clone the repository to `/opt/localping`
- ✅ Create and configure `.env` file with secure values
- ✅ Install npm dependencies
- ✅ Set up ICMP capabilities
- ✅ Create a systemd service for auto-start on boot
- ✅ Start the service immediately

**Custom installation path:**
```bash
curl -fsSL https://raw.githubusercontent.com/zebratic/localping/main/install.sh | sudo bash -s - https://github.com/zebratic/localping.git main /custom/path
```

### Manual Setup (for development)

```bash
# Install dependencies
sudo apt update && sudo apt install -y nodejs npm curl git libnotify-bin build-essential

# Clone and setup
git clone https://github.com/zebratic/localping.git && cd localping
npm install

# Create .env file
cp .env.example .env
# Edit .env if needed

# Set ICMP capabilities
sudo setcap cap_net_raw=ep $(which node)

# Start with PM2
npm run pm2:start

# Or run directly in development
npm run dev
```

## Features

- **Multi-Protocol Monitoring**: ICMP, TCP, UDP, HTTP/HTTPS
- **Real-Time Dashboards**: Admin panel + Public status page
- **Historical Data**: 90+ days of ping history stored locally
- **Local Database**: SQLite for offline access + MongoDB for advanced features
- **Desktop Notifications**: KDE Plasma & GNOME support
- **Service Groups**: Organize services by category
- **Quick Commands**: `/jellyfin` style shortcuts on public UI
- **PM2 Integration**: Auto-restart and process management

## Access Points

- **Admin Panel**: http://localhost:8000/admin
- **Public Dashboard**: http://localhost:8000
- **API**: http://localhost:8000/api

## Environment Variables

Copy `.env.example` to `.env` and configure:

```env
# Server
API_PORT=8000
NODE_ENV=production
SESSION_SECRET=your_random_secret_here

# Notifications
NOTIFICATION_ENABLED=true
NOTIFICATION_METHOD=dbus

# Monitoring
PING_INTERVAL=60
ALERT_COOLDOWN=300

# API Authentication
ADMIN_API_KEY=localping-admin-key-12345
```

All data is stored in a local SQLite database at `data/localping.db` - no external dependencies needed!

## Service Management

### Using Systemd (After Automated Install)

```bash
# Check service status
systemctl status localping

# Start the service
systemctl start localping

# Stop the service
systemctl stop localping

# Restart the service
systemctl restart localping

# View real-time logs
journalctl -u localping -f

# View recent logs
journalctl -u localping -n 100
```

### Using PM2 (Direct)

```bash
# Start with PM2 (from project directory)
npm run pm2:start

# Stop all PM2 processes
npm run pm2:stop

# View PM2 logs
npm run pm2:logs

# Restart PM2 processes
npm run pm2:restart

# Check PM2 process status
pm2 status
```

### Development Mode

```bash
# Run with auto-reload (requires ICMP capabilities)
sudo npm run dev

# Or set capabilities once, then run without sudo
sudo setcap cap_net_raw=ep $(which node)
npm run dev
```

## Configuration

1. Open http://localhost:8000/admin
2. Click "Add New Monitor"
3. Enter host, protocol, port, interval
4. (Optional) Add app URL and group name
5. Save and monitor in real-time

## Project Structure

```
localping/
├── src/
│   ├── app.js                    # Main app entry
│   ├── config/db.js              # Database config
│   ├── routes/                   # API endpoints
│   ├── services/                 # Monitoring logic
│   ├── public/js/                # Frontend code
│   └── views/                    # HTML templates
├── ecosystem.config.js           # PM2 config
├── package.json
└── data/localping.db             # SQLite database
```

## Troubleshooting

### Installation Issues

**Installation script fails with permission error:**
```bash
# Make sure you're using sudo
sudo bash install.sh
```

**Cloning repository fails:**
Ensure git is installed and you have internet connectivity:
```bash
sudo apt install git
```

**Node.js installation fails:**
Try manual installation:
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo bash -
sudo apt install nodejs
```

### Runtime Issues

**Service won't start:**
```bash
# Check systemd service status
systemctl status localping

# View systemd logs
journalctl -u localping -n 50

# Try starting manually to see errors
cd /opt/localping && npm run pm2:start
```

**ICMP (ping) not working:**
The installation script automatically sets ICMP capabilities. If it doesn't work:
```bash
# Check current capabilities
getcap $(which node)

# Manually set capabilities
sudo setcap cap_net_raw=ep $(which node)
```

**Port already in use (8000):**
Change `API_PORT` in `/opt/localping/.env`:
```bash
sudo nano /opt/localping/.env
# Change API_PORT=8000 to API_PORT=8001 (or another port)
sudo systemctl restart localping
```

**Notifications not working:**
```bash
# Ensure notification daemon is installed
sudo apt install notification-daemon libnotify-bin

# Restart the service
sudo systemctl restart localping
```

**Database issues:**
LocalPing uses SQLite stored at `data/localping.db`:
```bash
# Remove corrupted database to force recreate
rm /opt/localping/data/localping.db
sudo systemctl restart localping
```

### Database & Storage

**No External Database Needed!**
LocalPing uses SQLite for all storage - completely self-contained and offline-capable. The database file is stored at `data/localping.db`.

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/targets` | List all targets |
| POST | `/api/targets` | Create target |
| GET | `/api/targets/:id` | Get target details |
| PUT | `/api/targets/:id` | Update target |
| DELETE | `/api/targets/:id` | Delete target |
| GET | `/api/targets/:id/uptime` | Get uptime stats |
| POST | `/api/targets/:id/test` | Test ping target |

## Development

```bash
# Run in dev mode with auto-reload
npm run dev

# Run specific mode
node src/app.js --mode api
node src/app.js --mode admin
node src/app.js --mode public
```

## License

MIT
