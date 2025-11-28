#!/bin/bash

# Initialize PostgreSQL database cluster for Arch Linux

echo "🗄️  Initializing PostgreSQL database cluster..."

# Check if PostgreSQL is installed
if ! command -v psql &> /dev/null; then
    echo "❌ PostgreSQL is not installed. Please install it first:"
    echo "   sudo pacman -S postgresql"
    exit 1
fi

# Check if data directory exists and is empty
DATA_DIR="/var/lib/postgres/data"

if [ -d "$DATA_DIR" ] && [ "$(ls -A $DATA_DIR 2>/dev/null)" ]; then
    echo "✓ PostgreSQL data directory already exists and is not empty"
    echo "  If you want to reinitialize, remove it first: sudo rm -rf $DATA_DIR"
else
    echo "📦 Initializing PostgreSQL data directory..."
    sudo -u postgres initdb --locale=C.UTF-8 --encoding=UTF8 -D "$DATA_DIR"
    
    if [ $? -eq 0 ]; then
        echo "✅ PostgreSQL database cluster initialized"
    else
        echo "❌ Failed to initialize PostgreSQL"
        exit 1
    fi
fi

# Start PostgreSQL service
echo "🚀 Starting PostgreSQL service..."
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Wait for PostgreSQL to be ready
echo "⏳ Waiting for PostgreSQL to be ready..."
sleep 2

# Check if PostgreSQL is running
if pg_isready > /dev/null 2>&1; then
    echo "✅ PostgreSQL is running"
else
    echo "❌ PostgreSQL failed to start. Check logs with: sudo journalctl -u postgresql"
    exit 1
fi

# Create database and user if they don't exist
DB_NAME="localping"
DB_USER="localping"

echo "🔧 Creating database and user..."

# Generate secure password if .env doesn't exist or DB_PASSWORD is not set
if [ ! -f .env ] || ! grep -q "DB_PASSWORD" .env; then
    DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
    echo "📝 Generated database password: $DB_PASSWORD"
    echo "   Add this to your .env file: DB_PASSWORD=$DB_PASSWORD"
else
    # Extract password from .env file
    DB_PASSWORD=$(grep "DB_PASSWORD" .env | cut -d '=' -f2 | tr -d '"' | tr -d "'")
    if [ -z "$DB_PASSWORD" ]; then
        DB_PASSWORD=$(openssl rand -base64 24 | tr -d "=+/" | cut -c1-24)
        echo "📝 Generated database password: $DB_PASSWORD"
    fi
fi

# Create user if it doesn't exist
sudo -u postgres psql -c "SELECT 1 FROM pg_roles WHERE rolname='$DB_USER'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER $DB_USER WITH PASSWORD '$DB_PASSWORD';"

# Create database if it doesn't exist
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='$DB_NAME'" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE $DB_NAME OWNER $DB_USER;"

# Grant privileges
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE $DB_NAME TO $DB_USER;"

echo "✅ PostgreSQL setup complete!"
echo ""
echo "📋 Database connection info:"
echo "   Host: localhost"
echo "   Port: 5432"
echo "   Database: $DB_NAME"
echo "   User: $DB_USER"
echo "   Password: $DB_PASSWORD"
echo ""
echo "💡 Make sure your .env file contains:"
echo "   DB_HOST=localhost"
echo "   DB_PORT=5432"
echo "   DB_NAME=$DB_NAME"
echo "   DB_USER=$DB_USER"
echo "   DB_PASSWORD=$DB_PASSWORD"

