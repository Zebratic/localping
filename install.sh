#!/bin/bash

set -e

echo "🚀 LocalPing Installation Script"
echo "=================================="

# Check if running with sudo
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run with sudo"
   exit 1
fi

INSTALL_DIR="${1:-}"

# Auto-detect LocalPing directory if not provided
if [ -z "$INSTALL_DIR" ]; then
    if [ -d "/opt/localping" ] && [ -f "/opt/localping/.env.example" ]; then
        INSTALL_DIR="/opt/localping"
    elif [ -d "$HOME/localping" ] && [ -f "$HOME/localping/.env.example" ]; then
        INSTALL_DIR="$HOME/localping"
    elif [ -f ".env.example" ]; then
        INSTALL_DIR="$(pwd)"
    else
        echo "❌ LocalPing directory not found!"
        echo ""
        echo "Usage: sudo bash install.sh [/path/to/localping]"
        echo "Example: sudo bash install.sh /opt/localping"
        exit 1
    fi
fi

echo "📦 Installing system dependencies..."
apt-get update -qq
apt-get install -y -qq \
    curl \
    git \
    build-essential \
    python3 \
    libnotify-bin

# Check if Node.js/npm is installed
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js and npm..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    apt-get install -y -qq nodejs
fi

echo "📁 Setting up LocalPing at: $INSTALL_DIR"
cd "$INSTALL_DIR" || {
    echo "❌ Failed to enter directory: $INSTALL_DIR"
    exit 1
}

# Validate required files exist
if [ ! -f ".env.example" ]; then
    echo "❌ .env.example not found at $INSTALL_DIR"
    exit 1
fi

echo "📥 Installing npm dependencies..."
npm install --silent

echo "🔧 Creating .env file..."
if [ ! -f ".env" ]; then
    # Generate secure random strings
    SESSION_SECRET=$(openssl rand -base64 32)
    ADMIN_API_KEY=$(openssl rand -hex 16)

    cat > .env << EOF
# Server Configuration
API_PORT=8000
NODE_ENV=production
SESSION_SECRET=$SESSION_SECRET

# Notification Settings
NOTIFICATION_ENABLED=true
NOTIFICATION_METHOD=dbus

# Monitoring
PING_INTERVAL=60
ALERT_COOLDOWN=300

# API Authentication
ADMIN_API_KEY=$ADMIN_API_KEY
EOF
    echo "✅ .env file created with secure values"
else
    echo "⚠️  .env already exists, skipping"
fi

echo "🔐 Setting ICMP capabilities for Node.js..."
setcap cap_net_raw=ep "$(which node)" 2>/dev/null || true

echo "📥 Installing PM2 globally..."
npm install -g pm2 --silent
pm2 install pm2-auto-pull 2>/dev/null || true

INSTALL_PATH=$(cd "$INSTALL_DIR" && pwd)
SERVICE_USER="${SUDO_USER:-root}"
SERVICE_NAME="localping"

echo "🛠️  Creating systemd service..."

# Create systemd service file
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << EOF
[Unit]
Description=LocalPing - System Uptime Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
User=$SERVICE_USER
WorkingDirectory=$INSTALL_PATH
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="NODE_ENV=production"

# Start the service
ExecStart=/usr/local/bin/pm2 start ecosystem.config.js --name $SERVICE_NAME

# Restart automatically
Restart=always
RestartSec=10

# Grant ICMP permissions
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW

# Security settings
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true

# Logs
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
EOF

# Create stop script that properly cleans up PM2
cat > "/etc/systemd/system/${SERVICE_NAME}-stop.service" << EOF
[Unit]
Description=LocalPing Stop Handler
Before=$SERVICE_NAME.service

[Service]
Type=oneshot
User=$SERVICE_USER
WorkingDirectory=$INSTALL_PATH
ExecStart=/usr/local/bin/pm2 kill

[Install]
WantedBy=$SERVICE_NAME.service
EOF

# Reload systemd and enable the service
systemctl daemon-reload
systemctl enable "$SERVICE_NAME" --now

echo "✅ Systemd service created and enabled"

echo "📊 Service Status:"
systemctl status "$SERVICE_NAME" --no-pager || true

echo ""
echo "✅ Installation complete!"
echo ""
echo "📊 Access LocalPing:"
echo "   Admin Panel:  http://localhost:8000/admin"
echo "   Public Page:  http://localhost:8000"
echo ""
echo "📖 Available Commands:"
echo "   View logs:        journalctl -u $SERVICE_NAME -f"
echo "   Service status:   systemctl status $SERVICE_NAME"
echo "   Start service:    systemctl start $SERVICE_NAME"
echo "   Stop service:     systemctl stop $SERVICE_NAME"
echo "   Restart service:  systemctl restart $SERVICE_NAME"
echo "   PM2 logs:         pm2 logs"
echo "   PM2 status:       pm2 status"
echo ""
echo "ℹ️  The service will auto-start on system boot."
echo ""
