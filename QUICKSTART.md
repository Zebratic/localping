# LocalPing - Quick Start Guide

## What Was Built

A complete local network monitoring system for your homelab with:

- **API Server** (localhost:3000): REST API for all operations
- **Admin Panel** (localhost:3001): Web UI for configuration & management
- **Public Status Page** (localhost:3002): Shareable uptime dashboard
- **CLI Tool** (`localping`): Terminal commands for management
- **Desktop Notifications**: Alerts via KDE Plasma/GNOME
- **PM2 Integration**: Process management & auto-restart

## 5-Minute Setup

### 1. Install & Configure
```bash
cd localping

# Install dependencies (already done)
npm install

# Make sure MongoDB is running
mongod

# Copy .env (already exists with defaults)
# Edit if you need custom MongoDB URI
nano .env
```

### 2. Start the Application
```bash
# Option A: PM2 (recommended for production)
npm run pm2:start

# Option B: Development mode (auto-reload on changes)
npm run dev

# Option C: Individual servers
node src/app.js --mode all
```

### 3. Access the Dashboards

- **Admin Panel**: http://localhost:3001
  - Add targets (services to monitor)
  - Create quick-fix actions
  - View real-time status

- **Public Status**: http://localhost:3002
  - Share this with others
  - Read-only uptime information

- **API**: http://localhost:3000/api
  - Raw API access (documented in README)

### 4. Add Your First Target

#### Via Web Admin Panel
1. Go to http://localhost:3001
2. Click "Add Target"
3. Enter:
   - Name: "My NAS"
   - Host: "192.168.1.100" (or your NAS IP)
   - Protocol: "TCP" (ICMP needs root)
   - Port: 8080 (or whatever your service uses)
   - Interval: 60 (seconds)
4. Click Add

#### Via CLI
```bash
# Interactive configuration
npm run cli -- config

# List targets
npm run cli -- list

# Test a host with all protocols
npm run cli -- test 192.168.1.100
```

## What Each Component Does

### Multi-Protocol Pinging
- **ICMP**: Traditional ping (needs root: `sudo npm run dev`)
- **TCP**: Checks if port is open (no root needed)
- **UDP**: Sends UDP packet (for DNS, NTP, etc.)
- **HTTP/HTTPS**: Checks web services

### Monitoring Flow
1. You add a target (IP + protocol + port)
2. Monitor service pings every 60 seconds (configurable)
3. Each result stored in MongoDB
4. When status changes → desktop notification
5. Statistics calculated daily for uptime tracking

### Quick-Fix Actions
Automatically execute commands when a service goes down:

**Types:**
- **Command**: Shell scripts (`systemctl restart jellyfin`)
- **SSH**: Remote commands (`ssh root@nas "reboot"`)
- **HTTP**: Call webhooks/APIs
- **Script**: Execute scripts

**Example**: Create action to restart Jellyfin if it goes down

### Desktop Notifications
Native notifications via DBus (KDE Plasma/GNOME):
```
[notify icon] MyApp is DOWN
           "Jellyfin has stopped responding"
```

## Common Tasks

### View System Status
```bash
npm run cli -- status
```

### Add to .zshrc for Auto-Status
```bash
# Add to ~/.zshrc
localping status | head -3
```

### Test Multiple Hosts at Once
```bash
npm run cli -- test router.local
npm run cli -- test nas.local
npm run cli -- test jellyfin.local
```

### Monitor Service Logs
```bash
npm run pm2:logs
npm run pm2:logs -- --lines 50
npm run pm2:logs -- localping-admin  # Just admin panel
```

### Stop/Restart Services
```bash
npm run pm2:stop      # Stop all
npm run pm2:restart   # Restart all
npm run pm2:start     # Start again
```

## Troubleshooting

### MongoDB Not Found
```bash
# Start MongoDB
mongod

# Check it's running
mongo
```

### Ports Already in Use
```bash
# Change ports in .env
API_PORT=3010
ADMIN_PORT=3011
PUBLIC_PORT=3012

# Or find what's using the port
lsof -i :3000
kill -9 <PID>
```

### ICMP Ping Needs Root
```bash
# Option 1: Run with sudo
sudo npm run dev

# Option 2: Grant capabilities (one-time)
sudo setcap cap_net_raw=ep /usr/bin/node

# Option 3: Use TCP instead (port 22, 80, 443, etc)
```

### Notifications Not Showing
```bash
# Check notify-send is installed
which notify-send

# Install it (Arch Linux)
sudo pacman -S libnotify

# Test it manually
notify-send "Test" "Hello from LocalPing"
```

## Next Steps

1. **Add your services** to monitor (NAS, Jellyfin, qBittorrent, etc.)
2. **Create quick-fix actions** for auto-recovery
3. **Share public status page** (localhost:3002)
4. **Add to .zshrc** for terminal status display
5. **Set up PM2 auto-start** (see README for systemd/cron)

## API Examples

```bash
# List all targets
curl http://localhost:3000/api/targets

# Get system status
curl http://localhost:3000/api/status

# Test ping a target
curl -X POST http://localhost:3000/api/targets/{targetId}/test

# Get alerts
curl http://localhost:3000/api/alerts?limit=10

# Get uptime for last 30 days
curl http://localhost:3000/api/targets/{targetId}/statistics?days=30
```

## File Structure Reference

```
src/
├── app.js                 # Main server
├── config/db.js          # MongoDB setup
├── services/
│   ├── pingService.js    # Multi-protocol ping
│   ├── monitorService.js # Main monitoring loop
│   ├── notificationService.js  # Desktop alerts
│   ├── actionService.js  # Execute fixes
│   └── gatewayService.js # Auto-detect gateway
├── routes/
│   ├── api.js            # REST endpoints
│   ├── admin.js          # Admin panel
│   └── public.js         # Public status
└── public/js/
    ├── admin.js          # Admin UI logic
    └── public.js         # Public UI logic
```

## Support

- Check **README.md** for detailed documentation
- Run `npm run cli -- --help` for CLI options
- Check **logs/** directory for PM2 logs

## Key Commands Summary

```bash
npm install              # Install deps
npm run dev              # Start (with auto-reload)
npm run pm2:start        # Start via PM2
npm run pm2:stop         # Stop all
npm run pm2:logs         # View logs
npm run cli -- status    # CLI status
npm run cli -- config    # Add targets
npm run cli -- test <ip> # Test host
npm run cli -- notify    # Test notification
```

---

**You're all set!** Start with the admin panel and enjoy monitoring your homelab! 🚀
