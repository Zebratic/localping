# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

LocalPing is a self-hosted uptime monitoring system for homelabs. It monitors services using ICMP, TCP, UDP, HTTP/HTTPS protocols with real-time dashboards and historical tracking. Data is stored in PostgreSQL via Prisma ORM.

## Commands

```bash
# Development
npm run dev          # Start with nodemon (auto-reload)
npm start            # Start production server

# Database (Prisma)
npm run prisma:generate  # Generate Prisma client after schema changes
npm run prisma:push      # Push schema changes to database
npm run prisma:studio    # Open Prisma Studio GUI

# Testing
npm test             # Run all tests
npm run test:watch   # Run tests in watch mode
npm run test:coverage # Run tests with coverage
npm run test:backup  # Run backup service tests only

# Production (PM2)
npm run pm2:start    # Start with PM2
npm run pm2:stop     # Stop all PM2 processes
npm run pm2:restart  # Restart all PM2 processes
npm run pm2:logs     # View PM2 logs

# Other
npm run gui          # Launch Electron GUI
npm run web          # Start in web-only mode
npm run verify:ping  # Verify ping data integrity
```

### ICMP Capabilities (Linux)
```bash
sudo setcap cap_net_raw=ep $(which node)
```

## Architecture

### Entry Point & Server
- `src/app.js` - Express server with WebSocket support, session management, route loading, and graceful shutdown handling

### Database Layer (Prisma)
- `prisma/schema.prisma` - Database schema definition with 12 models
- `src/config/prisma.js` - Prisma client singleton and connection management
- `src/services/cacheService.js` - In-memory caching layer for database queries

### Core Services
- `src/services/monitorService.js` - Central monitoring orchestrator. Manages ping intervals, status tracking (in-memory Map), alert cooldowns, and retry logic
- `src/services/pingService.js` - Ping execution layer. Delegates to worker pool for multi-threaded pings
- `src/services/workers/workerPool.js` - Thread pool manager (size: 2-8 based on CPU cores)
- `src/services/workers/pingWorker.js` - Worker thread for executing individual pings

### Notification & Events
- `src/services/notificationService.js` - Discord webhook notifications for monitor status changes and incidents
- `src/services/eventDetectionService.js` - Rule-based event detection and auto-incident creation

### Routes
- `src/routes/api.js` - REST API endpoints (`/api/*`) - requires API key auth
- `src/routes/admin.js` - Admin panel routes (`/admin/*`) - requires session auth
- `src/routes/public.js` - Public status page routes (`/`)
- `src/routes/setup.js` - First-time setup wizard (`/setup`)

### Middleware
- `src/middleware/auth.js` - API key validation, rate limiting, input validation
- `src/middleware/setupCheck.js` - Redirects to setup wizard if not configured

### Views
- `src/views/*.ejs` - EJS templates for admin panel, public dashboard, and setup wizard

## Database Schema (Prisma)

Models defined in `prisma/schema.prisma`:
- `Target` - Monitor configurations (host, protocol, interval, etc.)
- `PingResult` - Individual ping results with timestamps
- `Statistic` - Daily aggregated statistics per target (unique on targetId + date)
- `Alert` - Status change alerts
- `Incident` - Manual/auto-created incidents
- `EventRule` - Event detection rules for auto-incidents
- `Action` - Target-specific actions
- `Favicon` - Cached favicons for apps
- `NotificationSettings` - Discord webhook configuration (singleton)
- `AdminSettings` - Session duration, data retention, debug logging (singleton)
- `PublicUISettings` - Public dashboard customization (singleton)
- `Post` - Blog posts

## Key Patterns

### Monitor Status Flow
1. `monitorService.startMonitoring()` loads enabled targets
2. Each target gets an interval timer calling `pingTarget()`
3. `pingService.ping()` delegates to worker pool
4. Results stored via `prisma.pingResult.create()`
5. Status changes trigger `notificationService` and `eventDetectionService`

### Database Query Pattern (Prisma)
```javascript
const { getPrisma } = require('../config/prisma');
const prisma = getPrisma();

// Find all enabled targets
const targets = await prisma.target.findMany({ where: { enabled: true } });

// Find by ID
const target = await prisma.target.findUnique({ where: { id: targetId } });

// Create
await prisma.pingResult.create({ data: { targetId, success: true, responseTime: 50 } });

// Update
await prisma.target.update({ where: { id }, data: { name: 'New Name' } });

// Delete
await prisma.target.delete({ where: { id } });

// Raw SQL (for complex queries)
const result = await prisma.$queryRaw`SELECT * FROM targets WHERE enabled = true`;
```

### Non-Blocking Design
- Initial pings run in background (`setImmediate`, `Promise.allSettled`)
- Database writes deferred with `setImmediate`
- Worker pool prevents ping operations from blocking main thread

## Environment Variables

```env
DATABASE_URL="postgresql://localping:localping@localhost:5432/localping"
API_PORT=8000           # Server port
SESSION_SECRET=...      # Express session secret
PING_INTERVAL=60        # Default ping interval (seconds)
ALERT_COOLDOWN=300      # Alert cooldown (seconds)
```

## Testing

Tests are in `__tests__/` directory using Jest:
- `__tests__/services/backupService.test.js` - Export/import functionality
- `__tests__/services/pingService.test.js` - Ping service tests

Run single test file:
```bash
npx jest __tests__/services/backupService.test.js
```

## Migration Note

This codebase was migrated from a custom MongoDB-style PostgreSQL wrapper (`pg` package with `db.collection()` API) to Prisma ORM. Some route files may still contain legacy patterns that need to be updated to use the Prisma client.

Legacy pattern (to be replaced):
```javascript
const db = getDB();
await db.collection('targets').find({}).toArray();
```

New Prisma pattern:
```javascript
const prisma = getPrisma();
await prisma.target.findMany();
```
