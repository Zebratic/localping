# LocalPing - Homelab Dashboard & System Monitor

A simple, self-hosted uptime monitoring system for your homelab. Monitor TrueNAS, Jellyfin, qBittorrent, web services, and anything else with real-time dashboards and historical tracking.

## Quick Start (Ubuntu 24.04 LXC)

One-liner deployment:

```bash
sudo apt update && sudo apt install -y curl && curl -fsSL https://raw.githubusercontent.com/zebratic/localping/main/install.sh | bash
```

Or manual setup:

```bash
# Install dependencies
sudo apt update && sudo apt install -y nodejs npm curl libnotify-bin

# Clone and setup
git clone https://github.com/zebratic/localping.git && cd localping
npm install

# Start with PM2
npm run pm2:start
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

## Commands

```bash
# Start services
npm run pm2:start

# Stop services
npm run pm2:stop

# View logs
npm run pm2:logs

# Restart
npm run pm2:restart

# Development mode (with auto-reload)
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

### No External Database Needed!
LocalPing uses SQLite for all storage - completely self-contained and offline-capable. The database file is stored at `data/localping.db`.

### ICMP requires sudo
```bash
sudo setcap cap_net_raw=ep $(which node)
npm run dev
```

### Port already in use
Change `API_PORT` in `.env`

### Notifications not working
```bash
# Install notify-daemon
sudo apt install libnotify-bin notification-daemon
```

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
