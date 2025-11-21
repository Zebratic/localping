const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const chalk = require('../utils/colors');
const Database = require('better-sqlite3');
const { isSetupComplete } = require('../middleware/setupCheck');

const router = express.Router();

// Get database instance
function getDatabase() {
  const dbPath = path.join(process.cwd(), 'data', 'localping.db');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  return db;
}

// Get gateway IP using default-gateway package
async function detectGateway() {
  try {
    const { getDefaultGateway } = require('default-gateway');
    const gateway = await getDefaultGateway();

    if (gateway && gateway.gateway) {
      console.log(chalk.cyan(`Detected gateway: ${gateway.gateway}`));
      return gateway.gateway;
    }

    console.warn(chalk.yellow('Could not detect gateway, no gateway found'));
    return null;
  } catch (err) {
    console.warn(chalk.yellow(`Gateway detection error: ${err.message}`));
    return null;
  }
}

// GET setup page
router.get('/', async (req, res) => {
  // If already set up, redirect to admin
  if (isSetupComplete()) {
    return res.redirect('/admin/login');
  }

  try {
    const detectedGateway = await detectGateway();
    res.render('setup/wizard', {
      detectedGateway: detectedGateway || null,
      error: null,
    });
  } catch (err) {
    console.error(chalk.red('Setup page error:'), err.message);
    res.render('setup/wizard', {
      detectedGateway: null,
      error: 'Failed to load setup page',
    });
  }
});

// POST setup form
router.post('/', async (req, res) => {
  try {
    // If already set up, redirect to admin
    if (isSetupComplete()) {
      return res.redirect('/admin/login');
    }

    const { adminUsername, adminPassword, passwordConfirm, gatewayIp } = req.body;

    // Validation
    const errors = [];

    if (!adminUsername || adminUsername.trim().length === 0) {
      errors.push('Admin username is required');
    }

    if (!adminPassword || adminPassword.length < 6) {
      errors.push('Password must be at least 6 characters');
    }

    if (adminPassword !== passwordConfirm) {
      errors.push('Passwords do not match');
    }

    if (!gatewayIp || gatewayIp.trim().length === 0) {
      errors.push('Gateway IP is required');
    }

    // Validate IP format
    const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
    if (gatewayIp && !ipRegex.test(gatewayIp)) {
      errors.push('Invalid IP address format');
    }

    if (errors.length > 0) {
      const detectedGateway = await detectGateway();
      return res.status(400).render('setup/wizard', {
        detectedGateway: detectedGateway || '192.168.1.1',
        error: errors[0],
        formData: { adminUsername, gatewayIp },
      });
    }

    // Update .env file
    const envPath = path.join(process.cwd(), '.env');
    let envContent = '';

    if (fs.existsSync(envPath)) {
      envContent = fs.readFileSync(envPath, 'utf8');
    }

    // Add admin credentials - handle both commented and uncommented lines
    if (!envContent.includes('ADMIN_PASSWORD') || envContent.includes('# ADMIN_PASSWORD')) {
      // Either no ADMIN_PASSWORD at all, or it's commented out - replace commented line or add new line
      if (envContent.includes('# ADMIN_PASSWORD')) {
        // Replace commented line with uncommented one
        envContent = envContent.replace(/# ADMIN_PASSWORD=.*/g, `ADMIN_PASSWORD=${adminPassword}`);
        envContent = envContent.replace(/# ADMIN_USERNAME=.*/g, `ADMIN_USERNAME=${adminUsername}`);
      } else {
        // Add new lines
        envContent += `\n# Admin Credentials (set during setup)\nADMIN_PASSWORD=${adminPassword}\nADMIN_USERNAME=${adminUsername}\n`;
      }
    } else {
      // Update existing uncommented lines
      envContent = envContent.replace(/ADMIN_PASSWORD=.*/g, `ADMIN_PASSWORD=${adminPassword}`);
      envContent = envContent.replace(/ADMIN_USERNAME=.*/g, `ADMIN_USERNAME=${adminUsername}`);
    }

    fs.writeFileSync(envPath, envContent);

    // Update in-memory environment variables so isSetupComplete() works
    process.env.ADMIN_PASSWORD = adminPassword;
    process.env.ADMIN_USERNAME = adminUsername;

    // Create default monitors in database
    const db = getDatabase();

    try {
      // Create default targets
      const targets = [
        {
          name: 'Gateway',
          host: gatewayIp,
          protocol: 'ICMP',
          group: 'Network',
          position: 0,
        },
        {
          name: 'Cloudflare DNS',
          host: '1.1.1.1',
          protocol: 'ICMP',
          group: 'Network',
          position: 1,
        },
      ];

      const stmt = db.prepare(`
        INSERT INTO targets (
          _id, name, host, protocol, port, enabled, interval,
          timeout, "group", position, createdAt, updatedAt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
      `);

      targets.forEach((target) => {
        try {
          stmt.run(
            uuidv4(),
            target.name,
            target.host,
            target.protocol,
            null, // port
            1, // enabled
            60, // interval
            30, // timeout
            target.group,
            target.position
          );
        } catch (err) {
          // Ignore duplicate key errors
          if (!err.message.includes('UNIQUE constraint failed')) {
            console.error(chalk.yellow(`Warning creating ${target.name}:`), err.message);
          }
        }
      });

      db.close();
    } catch (err) {
      console.error(chalk.red('Database error during setup:'), err.message);
      db.close();
    }

    console.log(chalk.green('✓ Setup completed successfully'));

    // Automatically log the user in after setup
    req.session.adminAuthenticated = true;

    // Redirect to admin dashboard - middleware will set cookie automatically
    res.redirect('/admin');
  } catch (err) {
    console.error(chalk.red('Setup error:'), err.message);
    const detectedGateway = await detectGateway();
    res.status(500).render('setup/wizard', {
      detectedGateway: detectedGateway || '192.168.1.1',
      error: 'An error occurred during setup. Please try again.',
    });
  }
});

module.exports = router;
