#!/bin/bash

set -e

echo "🚀 LocalPing Installation Script"
echo "=================================="

# Check for the privileges required to install packages and manage systemd.
if [[ $EUID -ne 0 ]]; then
   echo "❌ This script must be run as root"
   exit 1
fi

# Parse arguments
REPO_URL="${1:-https://github.com/zebratic/localping.git}"
BRANCH="${2:-main}"
INSTALL_DIR="${3:-/opt/localping}"
SKIP_UPDATE="${4:-false}"

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
        echo "  • PostgreSQL database"
        echo "  • Configuration (.env file)"
        echo "  • Admin credentials"
        echo ""

        # Only ask for confirmation if running in interactive terminal and not skipping confirmation
        if [ "$SKIP_UPDATE" != "true" ] && [ -t 0 ]; then
            read -p "Continue with update? (y/n) " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                echo "❌ Update cancelled."
                exit 0
            fi
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
    # Fetch the requested branch and make the working tree exactly match it.
    # `checkout -B` only changes tracked files, so the installation's .env,
    # data, and logs remain untouched.
    git fetch --prune origin "$BRANCH"
    git checkout -B "$BRANCH" "origin/$BRANCH"
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

echo "🗄️  Setting up PostgreSQL..."
# Install PostgreSQL if not present
if ! command -v psql &> /dev/null; then
    echo "📦 Installing PostgreSQL..."
    apt-get install -y -qq postgresql postgresql-contrib 2>/dev/null || apt-get install -y postgresql postgresql-contrib
    systemctl enable postgresql
    systemctl start postgresql
    echo "✅ PostgreSQL installed"
else
    echo "✓ PostgreSQL already installed"
    # Ensure PostgreSQL is running
    systemctl start postgresql 2>/dev/null || true
fi

# Wait for PostgreSQL to be ready
sleep 2

# Reuse database settings from an existing installation. This prevents an
# update from generating a new password that does not match the existing
# PostgreSQL role.
EXISTING_DATABASE_URL=""
if [ -f ".env" ]; then
    # .env is the installation's own configuration file and is needed here so
    # Prisma and the service use the same credentials as the database setup.
    set -a
    # shellcheck disable=SC1091
    . ./.env
    set +a
    EXISTING_DATABASE_URL="${DATABASE_URL:-}"
fi

DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-localping}"
DB_USER="${DB_USER:-localping}"
GENERATED_DB_PASSWORD=false
if [ -z "${DB_PASSWORD:-}" ]; then
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
    GENERATED_DB_PASSWORD=true
fi

case "$DB_NAME" in
    ""|*[!A-Za-z0-9_]* ) echo "❌ DB_NAME may only contain letters, numbers, and underscores"; exit 1 ;;
esac
case "$DB_USER" in
    ""|*[!A-Za-z0-9_]* ) echo "❌ DB_USER may only contain letters, numbers, and underscores"; exit 1 ;;
esac

run_as_postgres() {
    if ! command -v runuser >/dev/null 2>&1; then
        echo "❌ runuser is required to configure PostgreSQL as the postgres user"
        exit 1
    fi
    runuser -u postgres -- "$@"
}

# Create database and user if they don't exist
echo "🔧 Configuring PostgreSQL database..."
if ! run_as_postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q '^1$'; then
    run_as_postgres psql -v ON_ERROR_STOP=1 -v db_password="$DB_PASSWORD" -c "CREATE USER \"$DB_USER\" WITH PASSWORD :'db_password';"
elif [ "$GENERATED_DB_PASSWORD" = true ] && [ -z "$EXISTING_DATABASE_URL" ]; then
    # A partially completed installation may have a role but no saved
    # connection URL. Make the generated credentials usable before saving them.
    run_as_postgres psql -v ON_ERROR_STOP=1 -v db_password="$DB_PASSWORD" -c "ALTER ROLE \"$DB_USER\" WITH PASSWORD :'db_password';"
fi

if ! run_as_postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q '^1$'; then
    run_as_postgres psql -v ON_ERROR_STOP=1 -c "CREATE DATABASE \"$DB_NAME\" OWNER \"$DB_USER\";"
fi
run_as_postgres psql -v ON_ERROR_STOP=1 -c "GRANT ALL PRIVILEGES ON DATABASE \"$DB_NAME\" TO \"$DB_USER\";"

# Configure PostgreSQL for local-only access (security)
PG_MAJOR_VERSION=$(run_as_postgres psql -tAc "SHOW server_version;" | xargs | cut -d. -f1)
PG_HBA_FILE="/etc/postgresql/$PG_MAJOR_VERSION/main/pg_hba.conf"

if [ -f "$PG_HBA_FILE" ]; then
    # Ensure local connections use md5 (password) authentication
    if ! grep -q "^local.*$DB_NAME.*$DB_USER.*md5" "$PG_HBA_FILE"; then
        # Add local connection rule if it doesn't exist
        printf 'local   %s    %s    md5\n' "$DB_NAME" "$DB_USER" >> "$PG_HBA_FILE"
    fi
    # Ensure host connections are restricted to localhost only
    if ! grep -q "^host.*$DB_NAME.*$DB_USER.*127.0.0.1/32.*md5" "$PG_HBA_FILE"; then
        printf 'host    %s    %s    127.0.0.1/32    md5\n' "$DB_NAME" "$DB_USER" >> "$PG_HBA_FILE"
    fi
    # Reload PostgreSQL configuration
    systemctl reload postgresql 2>/dev/null || run_as_postgres pg_ctl reload -D "/var/lib/postgresql/$PG_MAJOR_VERSION/main" 2>/dev/null || true
fi

echo "✅ PostgreSQL database configured"

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

# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=$DB_NAME
DB_USER=$DB_USER
DB_PASSWORD=$DB_PASSWORD
DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME

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
        # Add database settings required by Prisma to older installations
        # without replacing any existing application configuration.
        if ! grep -q "^DB_HOST=" .env; then
            {
                echo ""
                echo "# Database Configuration"
                echo "DB_HOST=$DB_HOST"
                echo "DB_PORT=$DB_PORT"
                echo "DB_NAME=$DB_NAME"
                echo "DB_USER=$DB_USER"
                echo "DB_PASSWORD=$DB_PASSWORD"
            } >> .env
            echo "✅ Added database configuration to .env"
        else
            grep -q "^DB_PORT=" .env || echo "DB_PORT=$DB_PORT" >> .env
            grep -q "^DB_NAME=" .env || echo "DB_NAME=$DB_NAME" >> .env
            grep -q "^DB_USER=" .env || echo "DB_USER=$DB_USER" >> .env
            grep -q "^DB_PASSWORD=" .env || echo "DB_PASSWORD=$DB_PASSWORD" >> .env
        fi
        if [ -z "$EXISTING_DATABASE_URL" ] && ! grep -q "^DATABASE_URL=" .env; then
            echo "DATABASE_URL=postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME" >> .env
            echo "✅ Added DATABASE_URL for Prisma to .env"
        fi
    else
        echo "⚠️  .env already exists, skipping creation"
    fi
fi

echo "🔄 Syncing database schema with Prisma..."
npx prisma generate
npx prisma db push --skip-generate

echo "🔐 Setting ICMP capabilities for Node.js..."
NODE_PATH=$(which node)
setcap cap_net_raw=ep "$NODE_PATH" 2>/dev/null || true

# Run the service as the invoking user when available; root is the fallback.
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
EnvironmentFile=-$INSTALL_DIR/.env

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

if ! systemctl is-active --quiet "$SERVICE_NAME"; then
    echo "❌ LocalPing failed to start after the update"
    systemctl status "$SERVICE_NAME" --no-pager 2>&1 | head -n 40 || true
    exit 1
fi

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
    echo "  ✓ PostgreSQL database"
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
