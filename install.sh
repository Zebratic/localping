#!/bin/bash

set -e

echo "🚀 LocalPing Installation Script"
echo "=================================="

# Check if running with sudo
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run with sudo"
   exit 1
fi

# Parse arguments
REPO_URL="${1:-https://github.com/zebratic/localping.git}"
BRANCH="${2:-main}"
INSTALL_DIR="${3:-/opt/localping}"

echo "📋 Installation Configuration:"
echo "   Repository: $REPO_URL"
echo "   Branch: $BRANCH"
echo "   Install Path: $INSTALL_DIR"
echo ""

# Detect if already installed
if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.env" ]; then
    echo "⚠️  LocalPing already installed at $INSTALL_DIR"
    read -p "Do you want to update it? (y/n) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        echo "Aborting installation."
        exit 0
    fi
    IS_UPDATE=true
else
    IS_UPDATE=false
fi

echo "📦 Installing system dependencies..."
apt-get update -qq 2>/dev/null || apt-get update

# Install minimal dependencies
apt-get install -y -qq \
    curl \
    git \
    build-essential \
    python3 \
    libnotify-bin \
    2>/dev/null || apt-get install -y \
    curl \
    git \
    build-essential \
    python3 \
    libnotify-bin

# Install Node.js if not present
if ! command -v node &> /dev/null; then
    echo "📦 Installing Node.js v20..."
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - 2>/dev/null
    apt-get install -y -qq nodejs 2>/dev/null || apt-get install -y nodejs
fi

# Install git if not present (shouldn't happen but just in case)
if ! command -v git &> /dev/null; then
    echo "📦 Installing git..."
    apt-get install -y -qq git 2>/dev/null || apt-get install -y git
fi

echo "✅ System dependencies installed"

# Clone or update repository
if [ "$IS_UPDATE" = false ]; then
    echo "📥 Cloning LocalPing repository..."
    mkdir -p "$(dirname "$INSTALL_DIR")"
    git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
else
    echo "🔄 Updating LocalPing repository..."
    cd "$INSTALL_DIR"
    git fetch origin
    git checkout "$BRANCH"
    git pull origin "$BRANCH"
fi

cd "$INSTALL_DIR"

# Validate required files exist
if [ ! -f ".env.example" ]; then
    echo "❌ .env.example not found at $INSTALL_DIR"
    echo "The repository may be corrupted. Please try again."
    exit 1
fi

echo "📥 Installing npm dependencies..."
npm install --silent 2>/dev/null || npm install

echo "🔧 Setting up environment file..."
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
NODE_PATH=$(which node)
setcap cap_net_raw=ep "$NODE_PATH" 2>/dev/null || true

# Get the user who ran sudo
SERVICE_USER="${SUDO_USER:-root}"
SERVICE_NAME="localping"

echo "🛠️  Creating systemd service..."

# Get Node.js path
NODE_BIN=$(which node)

# Create systemd service file to run Node.js directly (production-optimized)
cat > "/etc/systemd/system/${SERVICE_NAME}.service" << SYSTEMD_EOF
[Unit]
Description=LocalPing - System Uptime Monitor
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$SERVICE_USER
WorkingDirectory=$INSTALL_DIR
Environment="PATH=/usr/local/bin:/usr/bin:/bin"
Environment="NODE_ENV=production"

# Start Node.js app directly
ExecStart=$NODE_BIN $INSTALL_DIR/src/app.js

# Restart automatically on failure
Restart=on-failure
RestartSec=10

# Grant ICMP permissions for ping functionality
AmbientCapabilities=CAP_NET_RAW
CapabilityBoundingSet=CAP_NET_RAW

# Security settings
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
PrivateTmp=true
ProtectRuntimeDirectory=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes
ReadWritePaths=$INSTALL_DIR/data

# Process management
StandardOutput=journal
StandardError=journal
SyslogIdentifier=$SERVICE_NAME

[Install]
WantedBy=multi-user.target
SYSTEMD_EOF

# Set permissions
chown root:root "/etc/systemd/system/${SERVICE_NAME}.service"
chmod 644 "/etc/systemd/system/${SERVICE_NAME}.service"

echo "📥 Installing PM2 globally (optional, for development)..."
npm install -g pm2 --silent 2>/dev/null || npm install -g pm2 || true

# Reload systemd
systemctl daemon-reload

# Enable and start the service
echo "🚀 Starting LocalPing service..."
systemctl enable "$SERVICE_NAME"
systemctl start "$SERVICE_NAME"

# Wait for service to start
sleep 2

echo "✅ Systemd service created and enabled"
echo ""

# Show status
echo "📊 Service Status:"
systemctl status "$SERVICE_NAME" --no-pager 2>&1 | head -n 20 || true

echo ""
echo "✅ Installation complete!"
echo ""
echo "📊 Access LocalPing:"
echo "   Admin Panel:  http://localhost:8000/admin"
echo "   Public Page:  http://localhost:8000"
echo "   API:          http://localhost:8000/api"
echo ""
echo "📖 Useful Commands:"
echo "   View logs:          journalctl -u $SERVICE_NAME -f"
echo "   Service status:     systemctl status $SERVICE_NAME"
echo "   Start service:      systemctl start $SERVICE_NAME"
echo "   Stop service:       systemctl stop $SERVICE_NAME"
echo "   Restart service:    systemctl restart $SERVICE_NAME"
echo "   View PM2 logs:      pm2 logs"
echo "   Check PM2 status:   pm2 status"
echo "   Install directory:  $INSTALL_DIR"
echo ""
echo "ℹ️  The service will auto-start on system boot."
echo "ℹ️  Environment file located at: $INSTALL_DIR/.env"
echo ""
