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
IS_UPDATE=false
if [ -d "$INSTALL_DIR" ]; then
    if [ -f "$INSTALL_DIR/.env" ] && [ -f "$INSTALL_DIR/package.json" ]; then
        echo "✓ Existing LocalPing installation detected at $INSTALL_DIR"
        echo ""
        echo "What will be updated:"
        echo "  • Source code (latest version from $BRANCH branch)"
        echo "  • Dependencies (npm packages)"
        echo "  • Systemd service configuration"
        echo ""
        echo "What will be preserved:"
        echo "  • Database (data/localping.db)"
        echo "  • Configuration (.env file)"
        echo "  • Admin credentials"
        echo ""
        read -p "Continue with update? (y/n) " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            echo "❌ Update cancelled."
            exit 0
        fi
        IS_UPDATE=true
    else
        echo "⚠️  Directory exists at $INSTALL_DIR but is not a valid LocalPing installation"
        echo "❌ Please remove the directory or use a different path"
        exit 1
    fi
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

echo "📁 Creating data directory..."
mkdir -p "$INSTALL_DIR/data"

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

# Admin Credentials (set during first-time setup)
# ADMIN_PASSWORD=
# ADMIN_USERNAME=
EOF
    echo "✅ .env file created with secure values"
else
    if [ "$IS_UPDATE" = true ]; then
        echo "✓ Preserving existing .env file"
    else
        echo "⚠️  .env already exists, skipping creation"
    fi
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
ProtectHome=true
NoNewPrivileges=true
PrivateDevices=yes
ProtectKernelTunables=yes
ProtectKernelModules=yes
ProtectControlGroups=yes

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

# Reload systemd
systemctl daemon-reload

# Enable and start/restart the service
echo "🚀 Starting LocalPing service..."
systemctl enable "$SERVICE_NAME"
systemctl restart "$SERVICE_NAME"

# Wait for service to start
sleep 3

echo "✅ Systemd service configured"
echo ""

# Show status
echo "📊 Service Status:"
systemctl status "$SERVICE_NAME" --no-pager 2>&1 | head -n 20 || true

echo ""
if [ "$IS_UPDATE" = true ]; then
    echo "✅ Update complete!"
    echo ""
    echo "What was updated:"
    echo "  ✓ Source code to latest version"
    echo "  ✓ Dependencies (npm packages)"
    echo "  ✓ Systemd service configuration"
    echo ""
    echo "What was preserved:"
    echo "  ✓ Database (data/localping.db)"
    echo "  ✓ Configuration (.env file)"
    echo "  ✓ Admin credentials and monitors"
else
    echo "✅ Installation complete!"
    echo ""
fi

# Get the IPv4 address
IP_ADDR=$(hostname -I | awk '{print $1}')
if [ -z "$IP_ADDR" ]; then
    IP_ADDR="localhost"
fi

echo "📊 Access LocalPing:"
echo "   Public Page:  http://$IP_ADDR:8000"
echo "   API:          http://$IP_ADDR:8000/api"
echo ""

if [ "$IS_UPDATE" = false ]; then
    echo "🔧 First Time Setup:"
    echo "   1. Visit http://$IP_ADDR:8000/setup to complete configuration"
    echo "   2. Create admin credentials and configure gateway IP"
    echo "   3. You'll be redirected to login at http://$IP_ADDR:8000/admin/login"
    echo "   4. Login to access the admin panel"
    echo ""
else
    echo "🔄 Service has been restarted with the latest code"
    echo "   Login at http://$IP_ADDR:8000/admin/login"
    echo ""
fi
echo ""
echo "📖 Useful Commands:"
echo "   View logs:          journalctl -u $SERVICE_NAME -f"
echo "   Service status:     systemctl status $SERVICE_NAME"
echo "   Start service:      systemctl start $SERVICE_NAME"
echo "   Stop service:       systemctl stop $SERVICE_NAME"
echo "   Restart service:    systemctl restart $SERVICE_NAME"
echo "   Install directory:  $INSTALL_DIR"
echo ""
echo "ℹ️  The service will auto-start on system boot."
echo "ℹ️  Environment file located at: $INSTALL_DIR/.env"
echo ""
