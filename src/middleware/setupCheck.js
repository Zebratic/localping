/**
 * Setup Check Middleware
 * Checks if LocalPing has been configured (admin password set)
 * Redirects to setup wizard if not configured
 */

function isSetupComplete() {
  const adminPassword = process.env.ADMIN_PASSWORD;
  return !!(adminPassword && adminPassword.trim());
}

function setupCheckMiddleware(req, res, next) {
  // Allow access to setup routes without checking
  if (req.path.startsWith('/setup')) {
    return next();
  }

  // Allow static assets
  if (req.path.startsWith('/public') || req.path.match(/\.(css|js|png|jpg|gif|svg|ico)$/)) {
    return next();
  }

  // Check if setup is complete
  if (!isSetupComplete()) {
    // Allow public API access for status pages, but redirect web UI
    if (req.path.startsWith('/api/') && req.headers.accept !== 'text/html') {
      return next();
    }

    // Redirect web UI to setup
    if (req.headers.accept && req.headers.accept.includes('text/html')) {
      return res.redirect('/setup');
    }
  }

  next();
}

module.exports = {
  setupCheckMiddleware,
  isSetupComplete,
};
