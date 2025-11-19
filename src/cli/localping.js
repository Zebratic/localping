#!/usr/bin/env node

require('dotenv').config();
const chalk = require('../utils/colors');
const yargs = require('yargs/yargs');
const { hideBin } = require('yargs/helpers');
const inquirer = require('inquirer');
const { connectDB, getDB, closeDB } = require('../config/db');
const pingService = require('../services/pingService');
const notificationService = require('../services/notificationService');
const gatewayService = require('../services/gatewayService');

const argv = yargs(hideBin(process.argv))
  .command('status', 'Show system status')
  .command('test <host>', 'Test ping a host')
  .command('config', 'Configure targets')
  .command('list', 'List all targets')
  .command('notify', 'Send test notification')
  .command('gateway', 'Show detected gateway')
  .command('monitor', 'Start interactive monitor (for terminal)')
  .help()
  .alias('h', 'help')
  .version()
  .alias('v', 'version')
  .parse();

const command = argv._[0];

async function main() {
  try {
    switch (command) {
      case 'status':
        await showStatus();
        break;
      case 'test':
        await testHost(argv.host);
        break;
      case 'config':
        await configureTargets();
        break;
      case 'list':
        await listTargets();
        break;
      case 'notify':
        await sendTestNotification();
        break;
      case 'gateway':
        await showGateway();
        break;
      case 'monitor':
        await interactiveMonitor();
        break;
      default:
        showHelp();
    }
  } catch (error) {
    console.error(chalk.red('Error:'), error.message);
    process.exit(1);
  } finally {
    await closeDB();
  }
}

async function showStatus() {
  const db = await connectDB();

  const targets = await db.collection('targets').find({}).toArray();
  const upTargets = targets.filter((t) => t.enabled).length;

  console.log(chalk.cyan('\n📊 LocalPing Status\n'));
  console.log(`Total Targets: ${chalk.bold(targets.length)}`);
  console.log(`Enabled Targets: ${chalk.bold(upTargets)}`);
  console.log();

  if (targets.length === 0) {
    console.log(chalk.yellow('No targets configured. Use "localping config" to add targets.'));
  } else {
    console.log(chalk.cyan('\nRecent Alerts:'));
    const alerts = await db.collection('alerts').find({}).sort({ timestamp: -1 }).limit(5).toArray();

    if (alerts.length === 0) {
      console.log(chalk.green('✓ No alerts'));
    } else {
      alerts.forEach((alert) => {
        const icon = alert.type === 'down' ? '✗' : '✓';
        const color = alert.type === 'down' ? chalk.red : chalk.green;
        console.log(color(`${icon} ${alert.message}`));
      });
    }
  }

  console.log();
}

async function testHost(host) {
  console.log(chalk.cyan(`\n🔍 Testing ${host}...\n`));

  const tests = [
    { protocol: 'ICMP', host },
    { protocol: 'TCP', host, port: 80 },
    { protocol: 'UDP', host, port: 53 },
    { protocol: 'HTTP', host, port: 80, path: '/' },
    { protocol: 'HTTPS', host, port: 443, path: '/' },
  ];

  for (const test of tests) {
    const result = await pingService.ping(test);
    const status = result.success ? chalk.green('✓ UP') : chalk.red('✗ DOWN');
    const time = result.responseTime ? ` (${result.responseTime}ms)` : '';
    console.log(`${test.protocol.padEnd(8)} ${status}${time}`);
  }

  console.log();
}

async function configureTargets() {
  const db = await connectDB();

  const answers = await inquirer.prompt([
    {
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Add target', value: 'add' },
        { name: 'Edit target', value: 'edit' },
        { name: 'Delete target', value: 'delete' },
        { name: 'Back', value: 'back' },
      ],
    },
  ]);

  if (answers.action === 'add') {
    const target = await inquirer.prompt([
      { type: 'input', name: 'name', message: 'Target name:' },
      { type: 'input', name: 'host', message: 'Host/IP:' },
      {
        type: 'list',
        name: 'protocol',
        message: 'Protocol:',
        choices: ['ICMP', 'TCP', 'UDP', 'HTTP', 'HTTPS'],
      },
      { type: 'input', name: 'port', message: 'Port (optional):', default: '' },
      { type: 'input', name: 'interval', message: 'Ping interval (seconds):', default: '60' },
    ]);

    await db.collection('targets').insertOne({
      ...target,
      port: target.port ? parseInt(target.port) : null,
      interval: parseInt(target.interval),
      enabled: true,
      createdAt: new Date(),
    });

    console.log(chalk.green('✓ Target added successfully!'));
  }
}

async function listTargets() {
  const db = await connectDB();

  const targets = await db.collection('targets').find({}).toArray();

  console.log(chalk.cyan('\n📋 Configured Targets\n'));

  if (targets.length === 0) {
    console.log(chalk.yellow('No targets configured.'));
  } else {
    targets.forEach((target, i) => {
      console.log(`${i + 1}. ${target.name}`);
      console.log(`   Host: ${target.host}${target.port ? ':' + target.port : ''}`);
      console.log(`   Protocol: ${target.protocol}`);
      console.log(`   Interval: ${target.interval}s`);
      console.log(`   Status: ${target.enabled ? chalk.green('Enabled') : chalk.yellow('Disabled')}\n`);
    });
  }
}

async function sendTestNotification() {
  console.log(chalk.cyan('\n📢 Sending test notification...\n'));
  await notificationService.sendTest();
  console.log(chalk.green('✓ Notification sent!'));
  console.log();
}

async function showGateway() {
  await gatewayService.detectAllGateways();

  console.log(chalk.cyan('\n🌐 Gateway Information\n'));

  const gateways = gatewayService.getAllGateways();

  if (gateways.length === 0) {
    console.log(chalk.yellow('No gateway detected.'));
  } else {
    gateways.forEach((gw) => {
      console.log(`IPv${gw.version}: ${gw.ip} (${gw.interface})`);
    });
  }

  console.log();
}

async function interactiveMonitor() {
  const db = await connectDB();

  console.log(chalk.cyan('\n📡 LocalPing Interactive Monitor\n'));
  console.log(chalk.gray('Press Ctrl+C to exit\n'));

  // Placeholder for terminal UI implementation
  console.log(chalk.yellow('⚠ Terminal UI not yet implemented.'));
  console.log('Use the web admin panel instead: http://localhost:3001\n');
}

function showHelp() {
  console.log(chalk.cyan('\nLocalPing CLI - Local System Uptime Monitor\n'));
  console.log('Commands:');
  console.log('  localping status    - Show system status');
  console.log('  localping test      - Test ping a host');
  console.log('  localping config    - Configure targets');
  console.log('  localping list      - List all targets');
  console.log('  localping notify    - Send test notification');
  console.log('  localping gateway   - Show detected gateway');
  console.log('  localping monitor   - Start interactive monitor');
  console.log();
}

// Run CLI
main();
