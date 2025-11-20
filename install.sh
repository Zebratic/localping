#!/bin/bash

set -e

echo "🚀 LocalPing Installation Script"
echo "=================================="

# Check if running with sudo
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run with sudo"
   exit 1
fi

echo "📦 Installing dependencies..."
apt update
apt install -y \
    nodejs \
    npm \
    curl \
    libnotify-bin \
    notification-daemon

echo "📁 Cloning LocalPing repository..."
cd /opt || mkdir -p /opt && cd /opt

if [ -d "localping" ]; then
    echo "⚠️  localping directory already exists, updating..."
    cd localping
    git pull origin main
else
    git clone https://github.com/yourusername/localping.git
    cd localping
fi

echo "📥 Installing npm dependencies..."
npm install

echo "🔧 Setting up environment..."
if [ ! -f ".env" ]; then
    cp .env.example .env 2>/dev/null || cat > .env << 'EOF'
API_PORT=8000
NODE_ENV=production
SESSION_SECRET=$(openssl rand -base64 32)
NOTIFICATION_ENABLED=true
NOTIFICATION_METHOD=dbus
PING_INTERVAL=60
ALERT_COOLDOWN=300
EOF
fi

echo "🔐 Setting ICMP capabilities..."
setcap cap_net_raw=ep $(which node) 2>/dev/null || true

echo "🎯 Starting with PM2..."
npm run pm2:start

echo ""
echo "✅ Installation complete!"
echo ""
echo "📊 Access LocalPing:"
echo "   Admin Panel:  http://localhost:8000/admin"
echo "   Public Page:  http://localhost:8000"
echo ""
echo "📖 Commands:"
echo "   View logs:    npm run pm2:logs"
echo "   Stop:         npm run pm2:stop"
echo "   Restart:      npm run pm2:restart"
echo ""
