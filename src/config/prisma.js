const { PrismaClient } = require('@prisma/client');
const chalk = require('../utils/colors');

// Singleton pattern for Prisma client
let prisma = null;

/**
 * Get or create the Prisma client instance
 */
const getPrisma = () => {
  if (!prisma) {
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development'
        ? ['warn', 'error']
        : ['error'],
    });
  }
  return prisma;
};

/**
 * Keep existing installations compatible with additive schema changes. The
 * application is commonly upgraded in place, so relying only on a fresh
 * `prisma db push` would leave the notification settings endpoint unusable on
 * older databases.
 */
const ensureRuntimeSchema = async (client) => {
  try {
    await client.$executeRawUnsafe(
      'ALTER TABLE "notificationSettings" ADD COLUMN IF NOT EXISTS "monitorDownDelayMinutes" INTEGER NOT NULL DEFAULT 5',
    );
  } catch (error) {
    // A first-run database may not have been pushed yet. Prisma's normal
    // schema deployment remains responsible for creating missing tables.
    console.warn(chalk.yellow('⚠ Could not apply notification delay migration:'), error.message);
  }
};

/**
 * Connect to the database
 */
const connectDB = async () => {
  try {
    const client = getPrisma();
    await client.$connect();
    await ensureRuntimeSchema(client);
    console.log(chalk.green('✓ PostgreSQL database connected via Prisma'));
    return client;
  } catch (error) {
    console.error(chalk.red('✗ PostgreSQL connection failed:'), error.message);
    process.exit(1);
  }
};

/**
 * Disconnect from the database
 */
const disconnectDB = async () => {
  if (prisma) {
    await prisma.$disconnect();
    console.log(chalk.green('✓ PostgreSQL connection closed'));
    prisma = null;
  }
};

/**
 * Execute raw SQL query
 * @param {string} sql - SQL query with $1, $2, etc. placeholders
 * @param {Array} params - Query parameters
 */
const executeRawQuery = async (sql, params = []) => {
  const client = getPrisma();
  // Convert $1, $2 style to Prisma.sql template
  // For now, use $queryRawUnsafe but be careful with SQL injection
  const result = await client.$queryRawUnsafe(sql, ...params);
  return { rows: result };
};

module.exports = {
  getPrisma,
  connectDB,
  disconnectDB,
  executeRawQuery,
  ensureRuntimeSchema,
};
