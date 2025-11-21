const chalk = require('../utils/colors');

/**
 * API Key Authentication Middleware
 * Checks for valid API key in Authorization header or X-API-Key header
 */
function apiKeyAuth(req, res, next) {
  const apiKey = process.env.ADMIN_API_KEY;

  // If no API key is configured, skip authentication (unsafe - only for local dev)
  if (!apiKey) {
    console.warn(chalk.yellow('⚠ No ADMIN_API_KEY configured - authentication disabled'));
    return next();
  }

  // Check for API key in headers
  const authHeader = req.headers.authorization || '';
  const xApiKey = req.headers['x-api-key'] || '';

  // Support both "Bearer <token>" and direct key
  const providedKey = authHeader.replace('Bearer ', '') || xApiKey;

  if (!providedKey || providedKey !== apiKey) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Invalid or missing API key',
    });
  }

  next();
}

/**
 * Admin Page Authentication Middleware
 * Checks for admin password in session or cookie
 */
function adminPageAuth(req, res, next) {
  const adminPassword = process.env.ADMIN_PASSWORD;

  // If no admin password is configured, skip authentication (shouldn't happen after setup)
  if (!adminPassword || !adminPassword.trim()) {
    console.warn(chalk.yellow('⚠ No ADMIN_PASSWORD configured - admin page authentication disabled'));
    return next();
  }

  // Allow login page and login POST endpoint without authentication
  if (req.path === '/login' || (req.method === 'POST' && req.path === '/login')) {
    return next();
  }

  // Check if user has valid admin session
  if (req.session && req.session.adminAuthenticated) {
    return next();
  }

  // Not authenticated - redirect to login
  if (req.headers.accept && req.headers.accept.includes('application/json')) {
    return res.status(401).json({
      success: false,
      error: 'Unauthorized: Admin authentication required',
    });
  }

  // For page requests, redirect to login
  res.redirect('/login');
}

/**
 * Rate Limiting Middleware
 * Prevents brute force attacks on API endpoints
 */
function createRateLimiter(windowMs = 15 * 60 * 1000, maxRequests = 100) {
  const requests = new Map();

  return (req, res, next) => {
    const ip = req.ip || req.connection.remoteAddress;
    const now = Date.now();

    // Clean old entries
    if (!requests.has(ip)) {
      requests.set(ip, []);
    }

    const userRequests = requests.get(ip);

    // Remove requests outside the window
    const recentRequests = userRequests.filter((time) => now - time < windowMs);
    requests.set(ip, recentRequests);

    // Check if over limit
    if (recentRequests.length >= maxRequests) {
      return res.status(429).json({
        success: false,
        error: 'Too many requests, please try again later',
      });
    }

    // Record this request
    recentRequests.push(now);
    next();
  };
}

/**
 * Input Validation Middleware
 * Validates that required fields are present and valid
 * For PUT requests, allows partial updates (only validates provided fields)
 */
function validateTargetInput(req, res, next) {
  const { name, host, protocol, port, interval } = req.body;
  const isUpdate = req.method === 'PUT';

  const errors = [];

  // For PUT requests, only validate fields that are provided
  // For POST requests, validate all required fields
  if (!isUpdate) {
    // Validate name (required for POST)
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      errors.push('Target name is required and must be a non-empty string');
    }

    // Validate host (required for POST)
    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      errors.push('Host is required and must be a non-empty string');
    }

    // Validate protocol (required for POST)
    const validProtocols = ['ICMP', 'TCP', 'UDP', 'HTTP', 'HTTPS'];
    if (!protocol || !validProtocols.includes(protocol.toUpperCase())) {
      errors.push(`Protocol must be one of: ${validProtocols.join(', ')}`);
    }
  } else {
    // For PUT requests, only validate provided fields
    // Validate name if provided
    if (name !== undefined) {
      if (typeof name !== 'string' || name.trim().length === 0) {
        errors.push('Target name must be a non-empty string');
      }
    }

    // Validate host if provided
    if (host !== undefined) {
      if (typeof host !== 'string' || host.trim().length === 0) {
        errors.push('Host must be a non-empty string');
      }
    }

    // Validate protocol if provided
    if (protocol !== undefined) {
      const validProtocols = ['ICMP', 'TCP', 'UDP', 'HTTP', 'HTTPS'];
      if (!validProtocols.includes(protocol.toUpperCase())) {
        errors.push(`Protocol must be one of: ${validProtocols.join(', ')}`);
      }
    }
  }

  // Validate port if provided (null means no custom port, which is valid)
  if (port !== undefined && port !== null) {
    const portNum = parseInt(port, 10);
    if (isNaN(portNum) || portNum < 1 || portNum > 65535) {
      errors.push('Port must be a number between 1 and 65535');
    }
  }

  // Validate interval if provided (null means use default, which is valid)
  if (interval !== undefined && interval !== null) {
    const intervalNum = parseInt(interval, 10);
    if (isNaN(intervalNum) || intervalNum < 5 || intervalNum > 3600) {
      errors.push('Interval must be a number between 5 and 3600 seconds');
    }
  }

  // If there are errors, return them
  if (errors.length > 0) {
    return res.status(400).json({
      success: false,
      errors: errors,
    });
  }

  next();
}

module.exports = {
  apiKeyAuth,
  adminPageAuth,
  createRateLimiter,
  validateTargetInput,
};
