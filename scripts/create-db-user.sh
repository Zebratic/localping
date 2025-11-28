#!/bin/bash

# Create PostgreSQL user and database for localping

echo "🔧 Creating PostgreSQL user and database..."

# Check if PostgreSQL is running
if ! pg_isready > /dev/null 2>&1; then
    echo "❌ PostgreSQL is not running. Start it with: sudo systemctl start postgresql"
    exit 1
fi

# Create user if it doesn't exist
echo "👤 Creating user 'localping'..."
sudo -u postgres psql -c "SELECT 1 FROM pg_roles WHERE rolname='localping';" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE USER localping WITH PASSWORD 'localping';"

if [ $? -eq 0 ]; then
    echo "✅ User 'localping' created or already exists"
else
    echo "⚠️  User creation may have failed (might already exist)"
fi

# Create database if it doesn't exist
echo "🗄️  Creating database 'localping'..."
sudo -u postgres psql -c "SELECT 1 FROM pg_database WHERE datname='localping';" | grep -q 1 || \
    sudo -u postgres psql -c "CREATE DATABASE localping OWNER localping;"

if [ $? -eq 0 ]; then
    echo "✅ Database 'localping' created or already exists"
else
    echo "⚠️  Database creation may have failed (might already exist)"
fi

# Grant privileges
echo "🔐 Granting privileges..."
sudo -u postgres psql -c "GRANT ALL PRIVILEGES ON DATABASE localping TO localping;"

echo ""
echo "✅ Setup complete! The app should now be able to connect."
echo ""
echo "💡 If you want to use a different password, update your .env file:"
echo "   DB_PASSWORD=your_password_here"
echo ""
echo "   Then run this script again with the new password in the CREATE USER command."

