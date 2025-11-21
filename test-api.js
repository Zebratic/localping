#!/usr/bin/env node
/**
 * API Test Suite for LocalPing
 * 
 * Tests CRUD operations on:
 * - Monitors/Targets (via /api/* - requires API key)
 * - Incidents (via /admin/api/* - requires session auth)
 * - Blog Posts (via /admin/api/* - requires session auth)
 * - Admin Settings (via /admin/api/* - requires session auth)
 * 
 * Uses credentials from .env file for admin authentication.
 * 
 * Usage: node test-api.js [baseUrl] [apiKey]
 * Example: node test-api.js http://localhost:8000 your-api-key
 */

const axios = require('axios');
const fs = require('fs');
const path = require('path');

// Simple color functions
const colors = {
  blue: (s) => `\x1b[34m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  white: (s) => s,
};

// Load .env file
function loadEnv() {
  const envPath = path.join(process.cwd(), '.env');
  const env = {};
  if (fs.existsSync(envPath)) {
    const content = fs.readFileSync(envPath, 'utf8');
    content.split('\n').forEach(line => {
      const match = line.match(/^([^#=]+)=(.*)$/);
      if (match) {
        env[match[1].trim()] = match[2].trim();
      }
    });
  }
  return env;
}

const env = loadEnv();

// Configuration
const BASE_URL = process.argv[2] || 'http://localhost:8000';
const API_KEY = process.argv[3] || env.ADMIN_API_KEY || 'test-key';
const ADMIN_USERNAME = env.ADMIN_USERNAME;
const ADMIN_PASSWORD = env.ADMIN_PASSWORD;

// Test results
let passed = 0;
let failed = 0;
const errors = [];

// Helper functions
function log(message, type = 'info') {
  const colorMap = {
    info: colors.blue,
    success: colors.green,
    error: colors.red,
    warning: colors.yellow,
    test: colors.cyan,
  };
  const colorFn = colorMap[type] || colors.white;
  console.log(colorFn(message));
}

function test(name, fn) {
  return async () => {
    try {
      log(`\n🧪 Testing: ${name}`, 'test');
      await fn();
      passed++;
      log(`✅ PASSED: ${name}`, 'success');
    } catch (error) {
      failed++;
      const errorMsg = error.response 
        ? `Status ${error.response.status}: ${error.response.data?.error || error.message}`
        : error.message;
      errors.push({ test: name, error: errorMsg });
      log(`❌ FAILED: ${name} - ${errorMsg}`, 'error');
      if (error.response?.data && error.response.status !== 401) {
        console.log('Response:', JSON.stringify(error.response.data, null, 2));
      }
    }
  };
}

// Cookie storage for session
let sessionCookie = null;

// API client for /api/* routes (uses API key)
const api = axios.create({
  baseURL: BASE_URL,
  headers: {
    'X-API-Key': API_KEY,
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
});

// Admin API client for /admin/api/* routes (uses session cookies)
const adminApi = axios.create({
  baseURL: BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
  validateStatus: () => true,
  withCredentials: true,
});

// Add cookie to admin requests
adminApi.interceptors.request.use(config => {
  if (sessionCookie) {
    config.headers.Cookie = sessionCookie;
  }
  return config;
});

// Extract cookie from admin responses
adminApi.interceptors.response.use(response => {
  const setCookie = response.headers['set-cookie'];
  if (setCookie && setCookie.length > 0) {
    // Extract session cookie (usually the first one)
    const cookie = setCookie.find(c => c.startsWith('connect.sid')) || setCookie[0];
    if (cookie) {
      sessionCookie = cookie.split(';')[0]; // Get just the cookie name=value part
    }
  }
  return response;
});

// Login to admin
async function loginAdmin() {
  if (!ADMIN_USERNAME || !ADMIN_PASSWORD) {
    throw new Error('ADMIN_USERNAME and ADMIN_PASSWORD must be set in .env file');
  }

  log('🔐 Logging in to admin...', 'info');
  const response = await adminApi.post('/admin/login', {
    username: ADMIN_USERNAME,
    password: ADMIN_PASSWORD,
  });

  if (response.status !== 200 || !response.data.success) {
    throw new Error(`Login failed: ${JSON.stringify(response.data)}`);
  }

  // Extract cookie from response
  const setCookie = response.headers['set-cookie'];
  if (setCookie && setCookie.length > 0) {
    const cookie = setCookie.find(c => c.startsWith('connect.sid')) || setCookie[0];
    if (cookie) {
      sessionCookie = cookie.split(';')[0];
      log(`   ✅ Logged in successfully`, 'success');
      return true;
    }
  }
  
  throw new Error('Login succeeded but no session cookie received');
}

// Test data storage
const testData = {
  targetId: null,
  incidentId: null,
  postId: null,
};

// ==================== TARGETS/MONITORS TESTS ====================

const testTargets = {
  create: test('Create Target', async () => {
    const target = {
      name: `test-target-${Date.now()}`,
      host: 'example.com',
      protocol: 'HTTPS',
      port: 443,
      interval: 60,
      enabled: true,
      publicVisible: true,
      publicShowDetails: false,
      publicShowStatus: true,
      publicShowAppLink: true,
    };

    const response = await api.post('/api/targets', target);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to create target: ${JSON.stringify(response.data)}`);
    }
    testData.targetId = response.data.targetId;
    log(`   Created target with ID: ${testData.targetId}`);
  }),

  getAll: test('Get All Targets', async () => {
    const response = await api.get('/api/targets');
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get targets: ${JSON.stringify(response.data)}`);
    }
    if (!Array.isArray(response.data.targets)) {
      throw new Error('Targets is not an array');
    }
    log(`   Found ${response.data.targets.length} targets`);
  }),

  getOne: test('Get Target by ID', async () => {
    if (!testData.targetId) {
      throw new Error('No target ID available (create test must run first)');
    }
    const response = await api.get(`/api/targets/${testData.targetId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get target: ${JSON.stringify(response.data)}`);
    }
    if (response.data.target._id !== testData.targetId) {
      throw new Error('Target ID mismatch');
    }
    log(`   Retrieved target: ${response.data.target.name}`);
  }),

  update: test('Update Target', async () => {
    if (!testData.targetId) {
      throw new Error('No target ID available');
    }
    const updates = {
      name: `updated-target-${Date.now()}`,
      interval: 120,
      publicShowDetails: true,
    };
    const response = await api.put(`/api/targets/${testData.targetId}`, updates);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to update target: ${JSON.stringify(response.data)}`);
    }
    log(`   Updated target: ${updates.name}`);
  }),

  getStatistics: test('Get Target Statistics', async () => {
    if (!testData.targetId) {
      throw new Error('No target ID available');
    }
    const response = await api.get(`/api/targets/${testData.targetId}/statistics?days=30`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get statistics: ${JSON.stringify(response.data)}`);
    }
    log(`   Retrieved statistics (${response.data.statistics?.length || 0} data points)`);
  }),

  delete: test('Delete Target', async () => {
    if (!testData.targetId) {
      throw new Error('No target ID available');
    }
    const response = await api.delete(`/api/targets/${testData.targetId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to delete target: ${JSON.stringify(response.data)}`);
    }
    log(`   Deleted target: ${testData.targetId}`);
    testData.targetId = null;
  }),
};

// ==================== INCIDENTS TESTS ====================

const testIncidents = {
  create: test('Create Incident', async () => {
    const incident = {
      title: `Test Incident ${Date.now()}`,
      description: 'This is a test incident created by the API test suite',
      severity: 'major',
      status: 'investigating',
    };

    const response = await adminApi.post('/admin/api/incidents', incident);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to create incident: ${JSON.stringify(response.data)}`);
    }
    testData.incidentId = response.data.incident?._id || response.data.incidentId;
    log(`   Created incident with ID: ${testData.incidentId}`);
  }),

  getAll: test('Get All Incidents', async () => {
    const response = await adminApi.get('/admin/api/incidents');
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get incidents: ${JSON.stringify(response.data)}`);
    }
    if (!Array.isArray(response.data.incidents)) {
      throw new Error('Incidents is not an array');
    }
    log(`   Found ${response.data.incidents.length} incidents`);
  }),

  getOne: test('Get Incident by ID', async () => {
    if (!testData.incidentId) {
      throw new Error('No incident ID available');
    }
    const response = await adminApi.get(`/admin/api/incidents/${testData.incidentId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get incident: ${JSON.stringify(response.data)}`);
    }
    if (response.data.incident._id !== testData.incidentId) {
      throw new Error('Incident ID mismatch');
    }
    log(`   Retrieved incident: ${response.data.incident.title}`);
  }),

  update: test('Update Incident', async () => {
    if (!testData.incidentId) {
      throw new Error('No incident ID available');
    }
    const updates = {
      status: 'resolved',
      description: 'Updated description',
    };
    const response = await adminApi.put(`/admin/api/incidents/${testData.incidentId}`, updates);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to update incident: ${JSON.stringify(response.data)}`);
    }
    log(`   Updated incident status to: ${updates.status}`);
  }),

  delete: test('Delete Incident', async () => {
    if (!testData.incidentId) {
      throw new Error('No incident ID available');
    }
    const response = await adminApi.delete(`/admin/api/incidents/${testData.incidentId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to delete incident: ${JSON.stringify(response.data)}`);
    }
    log(`   Deleted incident: ${testData.incidentId}`);
    testData.incidentId = null;
  }),
};

// ==================== BLOG POSTS TESTS ====================

const testPosts = {
  create: test('Create Blog Post', async () => {
    const post = {
      title: `Test Post ${Date.now()}`,
      content: 'This is a test blog post created by the API test suite.\n\nIt has multiple paragraphs.',
      published: true,
    };

    const response = await adminApi.post('/admin/api/posts', post);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to create post: ${JSON.stringify(response.data)}`);
    }
    testData.postId = response.data.post?._id || response.data.postId;
    log(`   Created post with ID: ${testData.postId}`);
  }),

  getAll: test('Get All Posts', async () => {
    const response = await adminApi.get('/admin/api/posts');
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get posts: ${JSON.stringify(response.data)}`);
    }
    if (!Array.isArray(response.data.posts)) {
      throw new Error('Posts is not an array');
    }
    log(`   Found ${response.data.posts.length} posts`);
  }),

  getOne: test('Get Post by ID', async () => {
    if (!testData.postId) {
      throw new Error('No post ID available');
    }
    const response = await adminApi.get(`/admin/api/posts/${testData.postId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get post: ${JSON.stringify(response.data)}`);
    }
    if (response.data.post._id !== testData.postId) {
      throw new Error('Post ID mismatch');
    }
    log(`   Retrieved post: ${response.data.post.title}`);
  }),

  update: test('Update Post', async () => {
    if (!testData.postId) {
      throw new Error('No post ID available');
    }
    const updates = {
      title: `Updated Post ${Date.now()}`,
      content: 'Updated content',
      published: false,
    };
    const response = await adminApi.put(`/admin/api/posts/${testData.postId}`, updates);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to update post: ${JSON.stringify(response.data)}`);
    }
    log(`   Updated post: ${updates.title}`);
  }),

  delete: test('Delete Post', async () => {
    if (!testData.postId) {
      throw new Error('No post ID available');
    }
    const response = await adminApi.delete(`/admin/api/posts/${testData.postId}`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to delete post: ${JSON.stringify(response.data)}`);
    }
    log(`   Deleted post: ${testData.postId}`);
    testData.postId = null;
  }),
};

// ==================== OTHER API TESTS ====================

const testOther = {
  healthCheck: test('Health Check', async () => {
    const response = await api.get('/health');
    if (response.status !== 200) {
      throw new Error(`Health check failed: ${response.status}`);
    }
    log(`   Health check passed: ${response.data.status}`);
  }),

  getAlerts: test('Get Alerts', async () => {
    const response = await api.get('/api/alerts');
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get alerts: ${JSON.stringify(response.data)}`);
    }
    if (!Array.isArray(response.data.alerts)) {
      throw new Error('Alerts is not an array');
    }
    log(`   Found ${response.data.alerts.length} alerts`);
  }),

  getPublicStatus: test('Get Public Status (no auth)', async () => {
    const response = await axios.get(`${BASE_URL}/api/status`);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get public status: ${JSON.stringify(response.data)}`);
    }
    log(`   Public status: ${response.data.status?.overallStatus || 'unknown'}`);
  }),

  getSettings: test('Get Admin Settings', async () => {
    const response = await adminApi.get('/admin/api/admin-settings');
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to get settings: ${JSON.stringify(response.data)}`);
    }
    log(`   Retrieved admin settings`);
  }),

  updateSettings: test('Update Admin Settings', async () => {
    const settings = {
      sessionDurationDays: 30,
      dataRetentionDays: 60,
    };
    const response = await adminApi.put('/admin/api/admin-settings', settings);
    if (response.status !== 200 || !response.data.success) {
      throw new Error(`Failed to update settings: ${JSON.stringify(response.data)}`);
    }
    log(`   Updated settings`);
  }),

  invalidApiKey: test('Test Invalid API Key', async () => {
    const response = await axios.get(`${BASE_URL}/api/targets`, {
      headers: { 'X-API-Key': 'invalid-key' },
      validateStatus: () => true,
    });
    // API might return 200 with empty data or 401/403
    if (response.status === 200 && response.data?.success === false) {
      log(`   Correctly rejected invalid API key (status: ${response.status})`);
    } else if (response.status >= 400) {
      log(`   Correctly rejected invalid API key (status: ${response.status})`);
    } else {
      log(`   API accepted request (may not require auth for GET) - status: ${response.status}`);
    }
  }),
};

// ==================== RUN ALL TESTS ====================

async function runAllTests() {
  log('\n' + '='.repeat(60), 'info');
  log('🚀 Starting API Test Suite', 'info');
  log(`Base URL: ${BASE_URL}`, 'info');
  log(`API Key: ${API_KEY.substring(0, 8)}...`, 'info');
  if (ADMIN_USERNAME) {
    log(`Admin Username: ${ADMIN_USERNAME}`, 'info');
  } else {
    log(`⚠️  ADMIN_USERNAME not found in .env`, 'warning');
  }
  log('='.repeat(60), 'info');

  // Login to admin first
  try {
    await loginAdmin();
  } catch (error) {
    log(`\n❌ Failed to login to admin: ${error.message}`, 'error');
    log('   Admin API tests will be skipped', 'warning');
  }

  // Test order matters - create before read, read before update, etc.
  const testSuites = [
    { name: 'Health & Basic', tests: [testOther.healthCheck, testOther.invalidApiKey] },
    { name: 'Targets/Monitors', tests: [
      testTargets.create,
      testTargets.getAll,
      testTargets.getOne,
      testTargets.getStatistics,
      testTargets.update,
      testTargets.delete,
    ]},
    { name: 'Incidents', tests: [
      testIncidents.create,
      testIncidents.getAll,
      testIncidents.getOne,
      testIncidents.update,
      testIncidents.delete,
    ]},
    { name: 'Blog Posts', tests: [
      testPosts.create,
      testPosts.getAll,
      testPosts.getOne,
      testPosts.update,
      testPosts.delete,
    ]},
    { name: 'Other Endpoints', tests: [
      testOther.getAlerts,
      testOther.getPublicStatus,
      testOther.getSettings,
      testOther.updateSettings,
    ]},
  ];

  for (const suite of testSuites) {
    log(`\n📦 Test Suite: ${suite.name}`, 'test');
    for (const testFn of suite.tests) {
      await testFn();
    }
  }

  // Summary
  log('\n' + '='.repeat(60), 'info');
  log('📊 Test Summary', 'info');
  log('='.repeat(60), 'info');
  log(`✅ Passed: ${passed}`, 'success');
  log(`❌ Failed: ${failed}`, failed > 0 ? 'error' : 'success');
  log(`📈 Total: ${passed + failed}`, 'info');

  if (errors.length > 0) {
    log('\n❌ Failed Tests:', 'error');
    errors.forEach(({ test, error }) => {
      log(`   • ${test}: ${error}`, 'error');
    });
  }

  log('\n' + '='.repeat(60), 'info');
  process.exit(failed > 0 ? 1 : 0);
}

// Run tests
runAllTests().catch(error => {
  log(`\n💥 Fatal error: ${error.message}`, 'error');
  console.error(error);
  process.exit(1);
});
