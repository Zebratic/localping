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
 * Connect to the database
 */
const connectDB = async () => {
  try {
    const client = getPrisma();
    await client.$connect();
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
};
