require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const session = require('express-session');
const cors = require('cors');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('./utils/colors');

const { connectDB, closeDB } = require('./config/db');
const monitorService = require('./services/monitorService');
const gatewayService = require('./services/gatewayService');
const sqliteService = require('./services/sqliteService');
const { apiKeyAuth, createRateLimiter, validateTargetInput } = require('./middleware/auth');
const { setupCheckMiddleware, isSetupComplete } = require('./middleware/setupCheck');

// Parse command line arguments
const argv = yargs(hideBin(process.argv))
  .option('mode', {
    describe: 'Application mode',
    choices: ['api', 'admin', 'public', 'all'],
    default: 'all',
  })
  .parse();

const app = express();
expressWs(app);

// Middleware
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cors());

// Session middleware for admin authentication
const sessionMiddleware = session({
  secret: process.env.SESSION_SECRET || 'localping-dev-secret',
  resave: false,
  saveUninitialized: true,
  cookie: {
    secure: false, // Allow HTTP cookies for development - can be set via SECURE_COOKIES env var
    httpOnly: true,
    sameSite: 'lax', // Use 'lax' instead of 'strict' to allow cross-site requests with cookies
    maxAge: 24 * 60 * 60 * 1000 // 24 hours
  }
});

app.use(sessionMiddleware);

// Rate limiting middleware (skip for localhost development)
const apiRateLimiter = (req, res, next) => {
  const isLocalhost = req.ip === '127.0.0.1' || req.ip === '::1' || req.ip === '::ffff:127.0.0.1';
  if (isLocalhost && process.env.NODE_ENV !== 'production') {
    // Skip rate limiting for localhost in development
    return next();
  }
  // Apply rate limiter for production or remote IPs
  createRateLimiter(15 * 60 * 1000, 100)(req, res, next);
};
app.use('/api/', apiRateLimiter);

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Health check endpoint (must be before setup check middleware)
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date(),
    uptime: process.uptime(),
    mode: argv.mode,
  });
});

// Setup routes - must be registered BEFORE setup check middleware
const setupRoutes = require('./routes/setup');
app.use('/setup', setupRoutes);
console.log(chalk.cyan('✓ Setup routes loaded'));

// Setup check middleware - redirect to setup if not configured
// This checks after setup routes are registered
app.use(setupCheckMiddleware);

// Initialize database
let db = null;

const startServer = async () => {
  try {
    // Initialize SQLite database
    sqliteService.initializeDatabase();

    // Connect to SQLite database
    db = await connectDB();
    console.log(chalk.green('✓ Connected to database'));

    // Detect gateway
    await gatewayService.detectAllGateways();

    // Set up periodic cleanup of old SQLite data
    setInterval(() => {
      sqliteService.cleanupOldData();
    }, 24 * 60 * 60 * 1000); // Run daily

    // Check if setup is needed
    if (!isSetupComplete()) {
      console.log(chalk.yellow('\n⚠️  LocalPing setup incomplete!'));
      console.log(chalk.yellow('   Visit http://localhost:8000/setup to complete setup\n'));
    }

    // Public routes - load FIRST so they don't get caught by authenticated API routes
    if (argv.mode === 'public' || argv.mode === 'all') {
      const publicRoutes = require('./routes/public');
      app.use('/', publicRoutes);
      console.log(chalk.cyan('✓ Public routes loaded'));
    }

    // Admin routes - must be before authenticated API routes
    if (argv.mode === 'admin' || argv.mode === 'all') {
      const adminRoutes = require('./routes/admin');
      app.use('/admin', adminRoutes);
      console.log(chalk.cyan('✓ Admin routes loaded'));
    }

    // Authenticated API routes - load LAST so public routes are matched first
    if (argv.mode === 'api' || argv.mode === 'all') {
      const apiRoutes = require('./routes/api');
      // Apply API key authentication to API routes
      app.use('/api', apiKeyAuth, apiRoutes);
      console.log(chalk.cyan('✓ API routes loaded with authentication'));
    }

    // Start monitoring
    await monitorService.startMonitoring();

    // Listen on port
    const port = process.env.API_PORT || 3000;
    app.listen(port, () => {
      console.log(chalk.green(`✓ Server running on http://localhost:${port}`));
      console.log(chalk.cyan(`   Mode: ${argv.mode}`));
    });
  } catch (error) {
    console.error(chalk.red('Failed to start server:'), error.message);
    process.exit(1);
  }
};

// Graceful shutdown
const shutdown = async (signal) => {
  console.log(chalk.yellow(`\n✓ Received ${signal}, shutting down gracefully...`));

  try {
    monitorService.stopAllMonitoring();
    await closeDB();
    sqliteService.closeDatabase();
    console.log(chalk.green('✓ Server shut down successfully'));
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('Error during shutdown:'), error.message);
    process.exit(1);
  }
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

// Start server
startServer();

module.exports = app;
