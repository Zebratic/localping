require('dotenv').config();
const express = require('express');
const expressWs = require('express-ws');
const cors = require('cors');
const path = require('path');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const chalk = require('./utils/colors');

const { connectDB, closeDB } = require('./config/db');
const monitorService = require('./services/monitorService');
const gatewayService = require('./services/gatewayService');

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

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Initialize database
let db = null;

const startServer = async () => {
  try {
    // Connect to database
    db = await connectDB();
    console.log(chalk.green('✓ Connected to database'));

    // Detect gateway
    await gatewayService.detectAllGateways();

    // Import routes based on mode
    if (argv.mode === 'api' || argv.mode === 'all') {
      const apiRoutes = require('./routes/api');
      app.use('/api', apiRoutes);
      console.log(chalk.cyan('✓ API routes loaded'));
    }

    if (argv.mode === 'admin' || argv.mode === 'all') {
      const adminRoutes = require('./routes/admin');
      app.use('/admin', adminRoutes);
      console.log(chalk.cyan('✓ Admin routes loaded'));
    }

    // Health check endpoint
    app.get('/health', (req, res) => {
      res.json({
        status: 'ok',
        timestamp: new Date(),
        uptime: process.uptime(),
        mode: argv.mode,
      });
    });

    // Public routes - serves from root (must be last to not override specific routes)
    if (argv.mode === 'public' || argv.mode === 'all') {
      const publicRoutes = require('./routes/public');
      app.use('/', publicRoutes);
      console.log(chalk.cyan('✓ Public routes loaded'));
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
