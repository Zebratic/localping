#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const chalk = require('./utils/colors');
const { v4: uuidv4 } = require('uuid');
const Database = require('better-sqlite3');

/**
 * Setup wizard for first-time LocalPing installation
 * Creates admin credentials and default monitors
 */

const db = new Database(path.join(process.cwd(), 'data', 'localping.db'));
db.pragma('foreign_keys = ON');

console.log('\n' + chalk.cyan('═══════════════════════════════════════'));
console.log(chalk.cyan('  LocalPing Setup Wizard'));
console.log(chalk.cyan('═══════════════════════════════════════\n'));

// Read .env file
const envPath = path.join(process.cwd(), '.env');
let envContent = '';

if (fs.existsSync(envPath)) {
  envContent = fs.readFileSync(envPath, 'utf8');
}

// Check if already set up
const hasAdminPassword = envContent.includes('ADMIN_PASSWORD=');

if (hasAdminPassword) {
  console.log(chalk.yellow('⚠️  LocalPing is already set up!'));
  console.log(chalk.yellow('   Admin credentials already exist in .env\n'));
  process.exit(0);
}

// Helper function to get user input (synchronous)
function promptSync(question) {
  const stdin = process.stdin;
  const stdout = process.stdout;

  stdout.write(question);
  stdin.setRawMode(false);
  stdin.resume();

  return new Promise((resolve) => {
    let input = '';

    stdin.on('data', (char) => {
      const c = char.toString();

      if (c === '\n') {
        stdin.removeAllListeners('data');
        stdin.pause();
        stdin.setRawMode(true);
        resolve(input.trim());
      } else if (c === '\u0003') {
        process.exit();
      } else {
        input += c;
        // Show asterisks for password input
        if (question.toLowerCase().includes('password')) {
          stdout.write('*');
        }
      }
    });
  });
}

// Setup wizard flow
async function runSetup() {
  try {
    // Get admin username
    console.log(chalk.blue('Step 1: Admin Credentials\n'));
    const adminUsername = await promptSync(
      chalk.white('Enter admin username (default: admin): ')
    );
    const username = adminUsername.trim() || 'admin';

    // Get admin password
    let adminPassword = '';
    let passwordConfirm = '';

    do {
      adminPassword = await promptSync(
        chalk.white('\nEnter admin password: ')
      );

      if (adminPassword.length < 6) {
        console.log(
          chalk.red('\n✗ Password must be at least 6 characters long')
        );
        continue;
      }

      passwordConfirm = await promptSync(
        chalk.white('\nConfirm admin password: ')
      );

      if (adminPassword !== passwordConfirm) {
        console.log(chalk.red('\n✗ Passwords do not match. Try again.\n'));
      }
    } while (adminPassword !== passwordConfirm || adminPassword.length < 6);

    console.log(chalk.green('\n✓ Admin credentials set!\n'));

    // Detect gateway
    console.log(chalk.blue('Step 2: Network Configuration\n'));
    console.log(chalk.white('Detecting gateway...'));

    let gatewayIp = null;
    try {
      const { getDefaultGateway } = require('default-gateway');
      const gateway = await getDefaultGateway();
      gatewayIp = gateway.gateway;
      console.log(chalk.green(`✓ Gateway detected: ${gatewayIp}\n`));
    } catch (err) {
      console.log(chalk.yellow('⚠ Could not auto-detect gateway'));
      gatewayIp = await promptSync(
        chalk.white('Enter gateway IP (e.g., 192.168.1.1): ')
      );
    }

    // Create default monitors
    console.log(chalk.blue('\nStep 3: Creating Default Monitors\n'));

    const targets = [
      {
        name: 'Gateway',
        host: gatewayIp,
        protocol: 'ICMP',
        port: null,
        group: 'Network',
      },
      {
        name: 'Cloudflare DNS',
        host: '1.1.1.1',
        protocol: 'ICMP',
        port: null,
        group: 'Network',
      },
    ];

    // Insert targets
    const stmt = db.prepare(`
      INSERT INTO targets (
        _id, name, host, protocol, port, enabled, interval,
        timeout, "group", position, createdAt, updatedAt
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))
    `);

    targets.forEach((target, index) => {
      try {
        stmt.run(
          uuidv4(),
          target.name,
          target.host,
          target.protocol,
          target.port,
          1, // enabled
          60, // interval
          30, // timeout
          target.group,
          index // position
        );
        console.log(chalk.green(`✓ Created monitor: ${target.name}`));
      } catch (err) {
        if (!err.message.includes('UNIQUE constraint failed')) {
          console.log(
            chalk.yellow(`⚠ Could not create ${target.name}: ${err.message}`)
          );
        }
      }
    });

    // Update .env with admin password
    console.log(chalk.blue('\nStep 4: Saving Configuration\n'));

    let newEnv = envContent;

    if (!newEnv.includes('ADMIN_PASSWORD=')) {
      newEnv += `\n# Admin Credentials\nADMIN_PASSWORD=${adminPassword}\nADMIN_USERNAME=${username}\n`;
    }

    fs.writeFileSync(envPath, newEnv);
    console.log(chalk.green('✓ Configuration saved to .env'));

    // Summary
    console.log('\n' + chalk.cyan('═══════════════════════════════════════'));
    console.log(chalk.green('  Setup Complete! 🎉'));
    console.log(chalk.cyan('═══════════════════════════════════════\n'));

    console.log(chalk.white('Admin Credentials:'));
    console.log(`  Username: ${chalk.cyan(username)}`);
    console.log(
      `  Password: ${chalk.cyan('*'.repeat(adminPassword.length))}\n`
    );

    console.log(chalk.white('Default Monitors Created:'));
    targets.forEach((target) => {
      console.log(`  • ${chalk.cyan(target.name)} (${target.host})`);
    });

    console.log('\n' + chalk.white('Next Steps:'));
    console.log(chalk.white('  1. Access the admin panel: http://localhost:8000/admin'));
    console.log(chalk.white('  2. Log in with your credentials'));
    console.log(chalk.white('  3. Configure additional monitors as needed'));
    console.log('\n');

    db.close();
    process.exit(0);
  } catch (error) {
    console.error(chalk.red('\n✗ Setup error:'), error.message);
    db.close();
    process.exit(1);
  }
}

// Run setup
runSetup();
