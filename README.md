# LocalPing

A comprehensive local system uptime monitor for your homelab. Monitor your TrueNAS, Jellyfin, qBittorrent, and other services with multi-protocol support, beautiful dashboards, and instant alerts.

## Features

### Core Monitoring
- **Multi-Protocol Support**: ICMP, TCP, UDP, HTTP/HTTPS ping
- **Smart Gateway Detection**: Automatically detects your network gateway (10.0.0.1, etc.)
- **Real-time Status Tracking**: Monitor service availability in real-time
- **Historical Data**: Track uptime statistics over 30+ days

### Notifications
- **Desktop Notifications**: Native KDE Plasma, GNOME, and cross-platform support via DBus
- **Alert Management**: Configurable alert thresholds and cooldown periods
- **Multiple Severity Levels**: Low, normal, and critical alert levels

### Web Dashboards
- **Admin Panel** (localhost:3001): Full control - add targets, configure quick-fix actions, view real-time stats
- **Public Status Page** (localhost:3002): Read-only public-facing status page with uptime graphs
- **Dark Mode Default**: Beautiful TailwindCSS interface with dark theme

### Quick-Fix Actions
- **Command Execution**: Run shell commands on failures
- **SSH Remote Commands**: Execute commands on remote servers
- **HTTP Requests**: Trigger webhooks or API calls
- **Script Execution**: Run custom scripts automatically

### CLI Tool
- **Interactive CLI**: Configure targets, test pings, view status
- **Terminal Monitor**: Compact display for .zshrc integration
- **Service Testing**: Quick multi-protocol testing of any host

### PM2 Integration
- **Process Management**: Run API, Admin, and Public servers as PM2 processes
- **Auto-restart**: Services automatically restart on failure
- **Log Management**: Centralized logging for all services

## Installation

### Prerequisites
- Node.js 16+ (tested with Node 23.11.1)
- MongoDB (local or remote)
- Linux (KDE Plasma or GNOME for desktop notifications)

### Setup

```bash
# Clone/navigate to project
cd localping

# Install dependencies
npm install

# Copy environment variables
cp .env.example .env

# Edit .env with your MongoDB URI if needed
nano .env

# Install globally (optional)
npm link

# Start MongoDB (if local)
mongod

# Start with PM2
npm run pm2:start

# Or run development server
npm run dev
```

## Usage

### Web Admin Panel
Access the admin dashboard at **http://localhost:3001**

1. Add targets (IP address, domain, port, protocol)
2. Set monitoring intervals
3. Create quick-fix actions
4. View real-time status and alerts
5. Execute quick-fix actions on demand

### Public Status Page
Share **http://localhost:3002** publicly to show service status

- Real-time service status
- 30-day uptime graphs per service
- Read-only interface (cannot modify)
- Clean, professional design

### CLI Commands

```bash
# Global usage (if installed with npm link)
localping status      # Show system status and recent alerts
localping test <host> # Multi-protocol test of a host
localping config      # Interactive target configuration
localping list        # List all configured targets
localping notify      # Send test notification
localping gateway     # Show detected network gateway
localping monitor     # Start interactive terminal monitor

# Or from project root
npm run cli -- status
npm run cli -- test example.com
```

### PM2 Management

```bash
# Start all services
npm run pm2:start

# Stop all services
npm run pm2:stop

# Restart all services
npm run pm2:restart

# View logs
npm run pm2:logs
npm run pm2:logs -- --lines 100
npm run pm2:logs -- localping-api

# Manual PM2 commands
pm2 status
pm2 describe localping-api
```

### Terminal Integration (.zshrc)

Add to your `.zshrc` for a compact status display on terminal open:

```bash
# Show localping status on shell startup
localping status
```

Or for a more compact inline status:

```bash
# Show quick status summary
echo "$(localping status 2>/dev/null | head -3)"
```

## API Endpoints

### Admin/API Server (localhost:3000)

#### Targets
- `GET /api/targets` - List all targets
- `GET /api/targets/:id` - Get specific target
- `POST /api/targets` - Create target
- `PUT /api/targets/:id` - Update target
- `DELETE /api/targets/:id` - Delete target
- `POST /api/targets/:id/test` - Test ping a target

#### Statistics
- `GET /api/targets/:id/results` - Get ping results
- `GET /api/targets/:id/statistics` - Get uptime statistics

#### System
- `GET /api/gateway` - Get detected gateway info
- `GET /api/status` - Get overall system status
- `GET /api/alerts` - Get recent alerts

#### Quick-Fix Actions
- `POST /api/actions/:id/execute` - Execute action

### Admin Panel (localhost:3001)
- `GET /admin` - Admin dashboard
- `GET /admin/api/dashboard` - Dashboard data
- `GET/POST/PUT/DELETE /admin/api/actions` - Manage quick-fix actions

### Public Status (localhost:3002)
- `GET /` - Public status page
- `GET /api/status` - Overall status (JSON)
- `GET /api/targets` - List enabled targets
- `GET /api/targets/:id/statistics` - Target uptime stats
- `GET /api/targets/:id/uptime` - Target uptime summary

## Configuration

### .env Variables

```env
# MongoDB
MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=localping

# Server Ports
API_PORT=3000
ADMIN_PORT=3001
PUBLIC_PORT=3002
GUI_PORT=3003

# Notifications
NOTIFICATION_ENABLED=true
NOTIFICATION_METHOD=dbus

# Monitoring
PING_INTERVAL=60           # Default interval in seconds
SLOW_PING_INTERVAL=300     # Slower fallback interval
ALERT_THRESHOLD=3          # Failed pings before alert
ALERT_COOLDOWN=300         # Alert cooldown in seconds
```

## Target Configuration

When adding a target, you'll need:

- **Name**: Display name (e.g., "NAS Server", "Jellyfin")
- **Host**: IP address or domain
- **Protocol**: ICMP, TCP, UDP, HTTP, or HTTPS
- **Port**: (Optional) Custom port for TCP/UDP/HTTP(S)
- **Interval**: Ping frequency in seconds (default: 60)

### Protocol Notes
- **ICMP**: Requires root/sudo on some systems
- **TCP**: Checks if port is open/listening
- **UDP**: Sends UDP packet (DNS is common on port 53)
- **HTTP/HTTPS**: Checks if web service responds

## Project Structure

```
localping/
├── bin/
│   └── localping              # CLI executable
├── src/
│   ├── app.js                 # Main Express application
│   ├── config/
│   │   └── db.js              # MongoDB connection
│   ├── public/
│   │   └── js/
│   │       ├── admin.js       # Admin dashboard JS
│   │       └── public.js      # Public status JS
│   ├── routes/
│   │   ├── api.js             # API endpoints
│   │   ├── admin.js           # Admin routes
│   │   └── public.js          # Public routes
│   ├── services/
│   │   ├── pingService.js     # Multi-protocol pinging
│   │   ├── notificationService.js  # Desktop notifications
│   │   ├── actionService.js   # Quick-fix actions
│   │   ├── monitorService.js  # Main monitoring loop
│   │   └── gatewayService.js  # Gateway detection
│   ├── cli/
│   │   └── localping.js       # CLI tool
│   ├── electron/
│   │   ├── main.js            # Electron main process
│   │   └── preload.js         # Electron preload
│   └── views/
│       ├── admin/
│       │   └── index.ejs      # Admin dashboard HTML
│       └── public/
│           └── index.ejs      # Public status HTML
├── ecosystem.config.js         # PM2 configuration
├── package.json               # Dependencies
├── .env                       # Environment variables
└── logs/                      # PM2 logs
```

## Monitoring Flow

1. **Database**: MongoDB stores targets, ping results, statistics, alerts
2. **Monitor Service**: Runs continuous ping loop for all enabled targets
3. **Ping Service**: Executes multi-protocol pings
4. **Notification Service**: Sends desktop notifications on state changes
5. **API Server**: Exposes data to web dashboards
6. **Web UI**: Displays real-time status and historical data

## Troubleshooting

### MongoDB Connection Failed
```bash
# Check MongoDB is running
mongod --version

# Start MongoDB
mongod

# Or connect to remote MongoDB
MONGODB_URI=mongodb://user:pass@host:27017 npm run dev
```

### ICMP Ping Not Working
```bash
# ICMP requires elevated privileges
sudo npm run dev

# Or grant capabilities
sudo setcap cap_net_raw=ep /usr/bin/node
```

### Notifications Not Working
```bash
# Check notify-send is installed
which notify-send

# Install if missing (Arch Linux)
sudo pacman -S libnotify

# Test notification
notify-send "Test" "This is a test"
```

### Port Already in Use
```bash
# Find and kill process on port
lsof -i :3000
kill -9 <PID>

# Or change port in .env
API_PORT=3010
```

## Development

### Run in Development Mode
```bash
npm run dev

# This runs with nodemon for auto-reload
```

### Run Specific Services
```bash
# API server only
node src/app.js --mode api

# Admin panel only
node src/app.js --mode admin

# Public status only
node src/app.js --mode public

# All (default)
node src/app.js --mode all
```

## Future Roadmap

- [ ] Electron GUI (currently WIP)
- [ ] Terminal UI with Ink for .zshrc integration
- [ ] Webhooks and custom notifications
- [ ] Metrics export (Prometheus, InfluxDB)
- [ ] Mobile app support
- [ ] Service auto-discovery
- [ ] Advanced alerting rules
- [ ] Custom status pages per service group

## License

MIT

## Contributing

Contributions welcome! Feel free to open issues or PRs.

## Support

For issues and questions:
1. Check the troubleshooting section
2. Review MongoDB connection settings
3. Check PM2 logs: `npm run pm2:logs`
4. Verify ports are not in use: `lsof -i :3000`
