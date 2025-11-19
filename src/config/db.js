require('dotenv').config();
const { MongoClient, Db } = require('mongodb');
const chalk = require('../utils/colors');

let db = null;
let client = null;

const connectDB = async () => {
  try {
    const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
    const dbName = process.env.MONGODB_DB || 'localping';

    client = new MongoClient(uri);
    await client.connect();

    db = client.db(dbName);

    // Verify connection
    await db.admin().ping();
    console.log(chalk.green('✓ MongoDB connected successfully'));

    // Initialize collections and indexes
    await initializeCollections();

    return db;
  } catch (error) {
    console.error(chalk.red('✗ MongoDB connection failed:'), error.message);
    process.exit(1);
  }
};

const initializeCollections = async () => {
  try {
    // Targets collection
    await db.createCollection('targets').catch(() => {});
    await db.collection('targets').createIndex({ name: 1 }, { unique: true }).catch(() => {});
    await db.collection('targets').createIndex({ type: 1 });
    await db.collection('targets').createIndex({ enabled: 1 });

    // Ping Results collection
    await db.createCollection('pingResults').catch(() => {});
    await db.collection('pingResults').createIndex({ targetId: 1, timestamp: -1 });
    await db.collection('pingResults').createIndex({ timestamp: 1 }, { expireAfterSeconds: 2592000 }); // 30 days TTL

    // Alerts collection
    await db.createCollection('alerts').catch(() => {});
    await db.collection('alerts').createIndex({ targetId: 1, timestamp: -1 });
    await db.collection('alerts').createIndex({ timestamp: 1 }, { expireAfterSeconds: 604800 }); // 7 days TTL

    // Quick-fix Actions collection
    await db.createCollection('actions').catch(() => {});
    await db.collection('actions').createIndex({ targetId: 1 });
    await db.collection('actions').createIndex({ name: 1 });

    // Statistics collection
    await db.createCollection('statistics').catch(() => {});
    await db.collection('statistics').createIndex({ targetId: 1, date: -1 });
    await db.collection('statistics').createIndex({ date: 1 }, { expireAfterSeconds: 7776000 }); // 90 days TTL

    console.log(chalk.green('✓ Database collections initialized'));
  } catch (error) {
    console.error(chalk.yellow('⚠ Warning initializing collections:'), error.message);
  }
};

const getDB = () => {
  if (!db) {
    throw new Error('Database not connected. Call connectDB() first.');
  }
  return db;
};

const closeDB = async () => {
  if (client) {
    await client.close();
    console.log(chalk.yellow('✓ MongoDB connection closed'));
  }
};

module.exports = {
  connectDB,
  getDB,
  closeDB,
};
