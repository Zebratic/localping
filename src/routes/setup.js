const express = require('express');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const chalk = require('../utils/colors');
const { getPrisma } = require('../config/prisma');
const { isSetupComplete } = require('../middleware/setupCheck');

const router = express.Router();

// Get gateway IP using default-gateway package
async function detectGateway() {
  try {
    const defaultGateway = require('default-gateway');
    // The package exports gateway4 and gateway6 for IPv4/IPv6
    const result = await defaultGateway.gateway4async();

    if (result && result.gateway) {
      console.log(chalk.cyan(`Detected gateway: ${result.gateway}`));
      return result.gateway;
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

    // Create default monitors in database using Prisma
    try {
      const prisma = getPrisma();

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

      for (const target of targets) {
        try {
          await prisma.target.create({
            data: {
              name: target.name,
              host: target.host,
              protocol: target.protocol,
              group: target.group,
              position: target.position,
              enabled: true,
              interval: 60,
              timeout: 30,
            },
          });
        } catch (err) {
          // Ignore duplicate key errors (P2002 is Prisma's unique constraint error)
          if (err.code !== 'P2002') {
            console.error(chalk.yellow(`Warning creating ${target.name}:`), err.message);
          }
        }
      }
    } catch (err) {
      console.error(chalk.red('Database error during setup:'), err.message);
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
