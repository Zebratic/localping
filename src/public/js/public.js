let allTargets = [];
let expandedServiceId = null;
let charts = {};
let chartPeriods = {}; // Track current period for each chart
let targetUptimeCache = {};
let faviconCache = {}; // Cache for favicons in localStorage
let previousIncidents = new Map(); // Track previous incidents for change detection
let statisticsCache = null; // Cache for statistics data
let statisticsCacheTime = null; // Timestamp of when cache was created
const STATISTICS_CACHE_DURATION = 60 * 60 * 1000; // 60 minutes in milliseconds

// Load previous incidents from localStorage on page load
function loadPreviousIncidents() {
  try {
    const stored = localStorage.getItem('previousIncidents');
    if (stored) {
      const data = JSON.parse(stored);
      previousIncidents = new Map(Object.entries(data));
    }
  } catch (error) {
    console.error('Error loading previous incidents from localStorage:', error);
    previousIncidents = new Map();
  }
}

// Save previous incidents to localStorage
function savePreviousIncidents() {
  try {
    const data = Object.fromEntries(previousIncidents);
    localStorage.setItem('previousIncidents', JSON.stringify(data));
  } catch (error) {
    console.error('Error saving previous incidents to localStorage:', error);
  }
}

// Initialize previous incidents from localStorage
loadPreviousIncidents();

// Load on page load
loadData();

// Auto-refresh every 10 seconds
setInterval(loadData, 10000);

async function loadBlogPosts() {
  try {
    const response = await axios.get('/api/posts');
    const { posts } = response.data;

    const blogContainer = document.getElementById('blog-posts');
    if (!blogContainer) return;

    if (posts.length === 0) {
      blogContainer.innerHTML = '<div class="text-center text-slate-400 py-12">No posts yet. Check back soon!</div>';
      return;
    }

    // Configure marked.js if available
    if (typeof marked !== 'undefined') {
      marked.setOptions({
        breaks: true,
        gfm: true,
      });
    }

    blogContainer.innerHTML = posts.map(post => {
      const date = new Date(post.createdAt);
      const formattedDate = date.toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });

      // Render markdown if available, otherwise fallback to simple conversion
      let contentHtml;
      if (typeof marked !== 'undefined') {
        contentHtml = marked.parse(post.content);
      } else {
        // Fallback: simple line break conversion
        contentHtml = post.content
          .replace(/\n\n/g, '</p><p class="text-slate-300 mb-3">')
          .replace(/\n/g, '<br>');
        contentHtml = `<p class="text-slate-300 mb-3">${contentHtml}</p>`;
      }

      return `
        <div class="bg-slate-900/50 backdrop-blur rounded-lg border border-slate-700/30 p-6 hover:border-cyan-500/50 transition-colors">
          <div class="flex justify-between items-start mb-3">
            <h3 class="text-xl font-bold text-white">${post.title}</h3>
            <span class="text-slate-500 text-sm whitespace-nowrap ml-4">${formattedDate}</span>
          </div>
          <div class="prose prose-invert max-w-none text-slate-300">
            ${contentHtml}
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading blog posts:', error);
    const blogContainer = document.getElementById('blog-posts');
    if (blogContainer) {
      blogContainer.innerHTML = '<div class="text-center text-red-400 py-12">Error loading posts</div>';
    }
  }
}

async function loadData() {
  try {
    const now = Date.now();
    const shouldRefreshStats = !statisticsCache || !statisticsCacheTime || (now - statisticsCacheTime) > STATISTICS_CACHE_DURATION;

    // Load incidents (always fresh)
    const incidentsRes = await axios.get('/api/incidents');
    const { incidents } = incidentsRes.data;

    // Load targets and statistics (use cache if available and not expired)
    let statusRes;
    if (shouldRefreshStats) {
      // Use consolidated endpoint for fresh data
      statusRes = await axios.get('/api/public/all');
      statisticsCache = statusRes.data;
      statisticsCacheTime = now;
    } else {
      // Use cached statistics but get fresh status
      if (statisticsCache) {
        // Get fresh status only
        const statusOnlyRes = await axios.get('/api/status');
        // Merge fresh status with cached statistics
        statusRes = {
          data: {
            status: statusOnlyRes.data.status,
            targets: statisticsCache.targets.map(cachedTarget => {
              const freshTarget = statusOnlyRes.data.targets.find(t => t._id === cachedTarget._id);
              if (freshTarget) {
                // Merge fresh status with cached statistics
                return {
                  ...cachedTarget,
                  currentStatus: freshTarget.currentStatus,
                  isUp: freshTarget.isUp,
                };
              }
              return cachedTarget;
            }),
          },
        };
      } else {
        // No cache, fetch everything
        statusRes = await axios.get('/api/public/all');
        statisticsCache = statusRes.data;
        statisticsCacheTime = now;
      }
    }

    const { status, targets } = statusRes.data;

    // Check for status changes and send notifications
    if (window.notificationManager && window.notificationManager.isEnabled()) {
      targets.forEach((target) => {
        const status = target.isUp ? 'up' : 'down';
        window.notificationManager.updateTargetStatus(target._id, target.name, status);
      });
    }

    allTargets = targets;

    // Update header status
    updateHeaderStatus(status);

    // Check for new/updated incidents and send notifications
    if (window.notificationManager && window.notificationManager.isEnabled()) {
      incidents.forEach((incident) => {
        const prevIncident = previousIncidents.get(incident._id);
        
        if (!prevIncident) {
          // New incident
          window.notificationManager.notifyIncident(incident);
        } else if (prevIncident.status !== incident.status) {
          // Status changed
          window.notificationManager.notifyIncidentUpdate(incident);
        }
        
        // Update stored incident
        previousIncidents.set(incident._id, { ...incident });
      });
      
      // Save to localStorage after processing all incidents
      savePreviousIncidents();
    }

    // Display incidents
    displayIncidents(incidents);
    displayIncidentHistory(incidents);
    displayHomeIncidents(incidents);

    // Update both pages
    displayApps(targets);
    updateServicesList(targets);
  } catch (error) {
    console.error('Error loading data:', error);
  }
}

function updateHeaderStatus(status) {
  const statusEl = document.getElementById('status-text');
  const statusIndicator = document.getElementById('status-indicator');
  const statusMessage = document.getElementById('overall-status-message');
  const timeEl = document.getElementById('status-time');

  let statusText = '';
  let statusClass = '';
  let message = '';

  if (status.overallStatus === 'operational') {
    statusText = '✓ All Systems Operational';
    statusClass = 'operational';
    message = 'All systems are operational. No incidents reported.';
  } else if (status.overallStatus === 'degraded') {
    statusText = '⚠ Degraded Performance';
    statusClass = 'degraded';
    message = `${status.downTargets} system(s) experiencing issues.`;
  } else {
    statusText = '✗ System Down';
    statusClass = 'down';
    message = `${status.downTargets} system(s) down.`;
  }

  statusEl.textContent = statusText;
  statusEl.className = `text-lg font-semibold ${
    statusClass === 'operational' ? 'text-green-400' :
    statusClass === 'degraded' ? 'text-yellow-400' :
    'text-red-400'
  }`;

  statusIndicator.className = `status-indicator ${statusClass}`;
  statusMessage.textContent = message;
  timeEl.textContent = `Last updated: ${new Date().toLocaleTimeString()}`;
}

// Format date for scheduled maintenance display
function formatScheduledTime(dateString) {
  if (!dateString) return '';
  const date = new Date(dateString);
  return date.toLocaleString([], { 
    year: 'numeric',
    month: 'short', 
    day: 'numeric',
    hour: '2-digit', 
    minute: '2-digit',
    hour12: true
  });
}

// Display active incidents on home page - Mobile Optimized
function displayHomeIncidents(incidents) {
  const homeIncidentsContainer = document.getElementById('home-incidents');
  if (!homeIncidentsContainer) return;

  // Filter for active incidents (investigating, identified, monitoring, scheduled)
  const activeIncidents = incidents.filter(i => i.status !== 'resolved');

  if (activeIncidents.length === 0) {
    homeIncidentsContainer.innerHTML = '';
    return;
  }

  const statusIcons = {
    'investigating': '🔍',
    'identified': '⚠️',
    'monitoring': '👁️',
    'scheduled': '📅'
  };

  const statusLabels = {
    'investigating': 'Investigating',
    'identified': 'Identified',
    'monitoring': 'Monitoring',
    'scheduled': 'Scheduled'
  };

  homeIncidentsContainer.innerHTML = `
    <div class="mb-4">
      <div class="flex items-center gap-2 mb-3">
        <h2 class="text-lg font-bold text-white">Ongoing Incidents</h2>
        <span class="text-xs px-2 py-1 rounded-full bg-red-500/20 text-red-400 font-semibold">${activeIncidents.length}</span>
      </div>
      ${activeIncidents.map(incident => {
        const severityClass = incident.severity || 'minor';
        const statusIcon = statusIcons[incident.status] || '⚠️';
        const statusLabel = statusLabels[incident.status] || incident.status;
        
        const statusBadgeColors = {
          'investigating': 'bg-blue-500/20 text-blue-300',
          'identified': 'bg-yellow-500/20 text-yellow-300',
          'monitoring': 'bg-orange-500/20 text-orange-300',
          'scheduled': 'bg-purple-500/20 text-purple-300'
        };

        const severityBadgeColors = {
          'critical': 'bg-red-500/20 text-red-300',
          'major': 'bg-orange-500/20 text-orange-300',
          'minor': 'bg-yellow-500/20 text-yellow-300'
        };

        const isScheduled = incident.isScheduled && (incident.scheduledStart || incident.scheduledEnd);
        let scheduledTimeHtml = '';
        
        if (isScheduled) {
          if (incident.scheduledStart && incident.scheduledEnd) {
            scheduledTimeHtml = `
              <div class="mt-2 pt-2 border-t border-slate-600/30">
                <p class="text-slate-400 text-xs flex items-center gap-1">
                  <i class="fas fa-calendar-alt"></i>
                  <span>${formatScheduledTime(incident.scheduledStart)} - ${formatScheduledTime(incident.scheduledEnd)}</span>
                </p>
              </div>
            `;
          } else if (incident.scheduledStart) {
            scheduledTimeHtml = `
              <div class="mt-2 pt-2 border-t border-slate-600/30">
                <p class="text-slate-400 text-xs flex items-center gap-1">
                  <i class="fas fa-calendar-alt"></i>
                  <span>Starts: ${formatScheduledTime(incident.scheduledStart)}</span>
                </p>
              </div>
            `;
          }
        }

        const timeAgo = getTimeAgo(new Date(incident.createdAt));

        return `
          <div class="incident-card ${severityClass}">
            <div class="incident-header">
              <h3 class="incident-title">${incident.title}</h3>
              <span class="incident-status-badge ${statusBadgeColors[incident.status] || 'bg-slate-700/50 text-slate-300'}">
                ${statusIcon} ${statusLabel}
              </span>
            </div>
            <p class="incident-description">${incident.description}</p>
            ${scheduledTimeHtml}
            <div class="incident-meta">
              <span class="incident-severity-badge ${severityBadgeColors[severityClass] || 'bg-slate-700/50 text-slate-300'}">
                ${severityClass.toUpperCase()}
              </span>
              <span class="text-slate-500">•</span>
              <span>${timeAgo}</span>
            </div>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Helper function to get time ago
function getTimeAgo(date) {
  const now = new Date();
  const diffMs = now - date;
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return 'Just now';
  if (diffMins < 60) return `${diffMins}m ago`;
  if (diffHours < 24) return `${diffHours}h ago`;
  if (diffDays < 7) return `${diffDays}d ago`;
  return date.toLocaleDateString();
}

// Display active incidents at the top of status page
function displayIncidents(incidents) {
  const incidentsContainer = document.getElementById('incidents-container');
  if (!incidentsContainer) return;

  // Filter for active incidents (investigating, identified, monitoring, scheduled)
  const activeIncidents = incidents.filter(i => i.status !== 'resolved');

  if (activeIncidents.length === 0) {
    incidentsContainer.innerHTML = '';
    incidentsContainer.style.display = 'none';
    return;
  }

  incidentsContainer.style.display = 'block';

  incidentsContainer.innerHTML = `
    <div class="mb-6">
      <h3 class="text-lg font-semibold text-white mb-3">Active Incidents</h3>
      ${activeIncidents.map(incident => {
        const severityColors = {
          'minor': 'bg-yellow-900/30 border-yellow-700 text-yellow-300',
          'major': 'bg-orange-900/30 border-orange-700 text-orange-300',
          'critical': 'bg-red-900/30 border-red-700 text-red-300'
        };

        const statusColors = {
          'investigating': 'bg-blue-900/30 text-blue-300',
          'identified': 'bg-yellow-900/30 text-yellow-300',
          'monitoring': 'bg-orange-900/30 text-orange-300',
          'scheduled': 'bg-purple-900/30 text-purple-300'
        };

        const isScheduled = incident.isScheduled && (incident.scheduledStart || incident.scheduledEnd);
        let scheduledTimeHtml = '';
        
        if (isScheduled) {
          if (incident.scheduledStart && incident.scheduledEnd) {
            scheduledTimeHtml = `
              <div class="mt-2 pt-2 border-t border-slate-600/50">
                <p class="text-slate-300 text-xs">
                  <i class="fas fa-calendar-alt mr-1"></i>
                  <strong>Scheduled:</strong> ${formatScheduledTime(incident.scheduledStart)} - ${formatScheduledTime(incident.scheduledEnd)}
                </p>
              </div>
            `;
          } else if (incident.scheduledStart) {
            scheduledTimeHtml = `
              <div class="mt-2 pt-2 border-t border-slate-600/50">
                <p class="text-slate-300 text-xs">
                  <i class="fas fa-calendar-alt mr-1"></i>
                  <strong>Starts:</strong> ${formatScheduledTime(incident.scheduledStart)}
                </p>
              </div>
            `;
          }
        }

        return `
          <div class="border border-slate-700 rounded-lg p-4 mb-3 ${severityColors[incident.severity] || 'bg-slate-900/30 border-slate-700'}">
            <div class="flex justify-between items-start mb-2">
              <h4 class="font-semibold text-white">${incident.title}</h4>
              <span class="text-xs px-2 py-1 rounded ${statusColors[incident.status] || 'bg-slate-700'}">${incident.status.toUpperCase()}</span>
            </div>
            <p class="text-slate-300 text-sm mb-2">${incident.description}</p>
            ${scheduledTimeHtml}
            <p class="text-slate-500 text-xs mt-2">Reported: ${new Date(incident.createdAt).toLocaleString()}</p>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Display incident history (all incidents)
function displayIncidentHistory(incidents) {
  const historyContainer = document.getElementById('incident-history');
  if (!historyContainer) return;

  // Sort by creation date (newest first)
  const sortedIncidents = [...incidents].sort((a, b) =>
    new Date(b.createdAt) - new Date(a.createdAt)
  );

  if (sortedIncidents.length === 0) {
    historyContainer.innerHTML = '<div class="text-center text-slate-400 py-8">No incidents have been reported</div>';
    return;
  }

  historyContainer.innerHTML = `
    <div class="space-y-3">
      ${sortedIncidents.map(incident => {
        const severityColors = {
          'minor': 'bg-yellow-900/20 border-yellow-700',
          'major': 'bg-orange-900/20 border-orange-700',
          'critical': 'bg-red-900/20 border-red-700'
        };

        const statusIcons = {
          'investigating': '🔍',
          'identified': '⚠️',
          'monitoring': '👁️',
          'resolved': '✅',
          'scheduled': '📅'
        };

        const isResolved = incident.status === 'resolved';
        const isScheduled = incident.isScheduled && (incident.scheduledStart || incident.scheduledEnd);
        let scheduledTimeHtml = '';
        
        if (isScheduled) {
          if (incident.scheduledStart && incident.scheduledEnd) {
            scheduledTimeHtml = `
              <p class="text-slate-400 text-xs ml-6 mt-1">
                <i class="fas fa-calendar-alt mr-1"></i>
                <strong>Scheduled:</strong> ${formatScheduledTime(incident.scheduledStart)} - ${formatScheduledTime(incident.scheduledEnd)}
              </p>
            `;
          } else if (incident.scheduledStart) {
            scheduledTimeHtml = `
              <p class="text-slate-400 text-xs ml-6 mt-1">
                <i class="fas fa-calendar-alt mr-1"></i>
                <strong>Starts:</strong> ${formatScheduledTime(incident.scheduledStart)}
              </p>
            `;
          }
        }

        return `
          <div class="border ${severityColors[incident.severity] || 'border-slate-700'} rounded-lg p-3 ${isResolved ? 'opacity-70' : ''}">
            <div class="flex justify-between items-start mb-1">
              <div class="flex items-center gap-2">
                <span class="text-lg">${statusIcons[incident.status] || '•'}</span>
                <h4 class="font-semibold text-white text-sm">${incident.title}</h4>
              </div>
              <div class="flex gap-2 items-center">
                <span class="text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300">${incident.severity.toUpperCase()}</span>
                <span class="text-xs px-2 py-1 rounded bg-slate-700/50 text-slate-300">${incident.status.toUpperCase()}</span>
              </div>
            </div>
            <p class="text-slate-400 text-xs ml-6">${incident.description}</p>
            ${scheduledTimeHtml}
            <p class="text-slate-500 text-xs ml-6 mt-1">Reported: ${new Date(incident.createdAt).toLocaleString()}</p>
          </div>
        `;
      }).join('')}
    </div>
  `;
}

// Page switching
function switchPage(page) {
  // Hide all pages
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t => t.classList.remove('active'));

  // Show selected page
  document.getElementById(`page-${page}`).classList.add('active');
  document.getElementById(`tab-${page}`).classList.add('active');

  // Load blog posts if switching to blog page
  if (page === 'blog') {
    loadBlogPosts();
  }
}

// ==================== APPS PAGE ====================

function displayApps(targets) {
  const pageHome = document.getElementById('page-home');

  // Check if there are ANY targets at all
  if (targets.length === 0) {
    pageHome.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Welcome to LocalPing</h2>
        <p id="app-count" class="text-slate-400 text-sm">Get started by adding monitors</p>
      </div>
      <div class="flex items-center justify-center min-h-[500px]">
        <div class="max-w-md w-full bg-slate-900/50 backdrop-blur rounded-lg border border-slate-700/30 p-8 text-center">
          <div class="mb-6">
            <svg class="w-16 h-16 mx-auto text-cyan-400 opacity-80" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M13 10V3L4 14h7v7l9-11h-7z"/>
            </svg>
          </div>
          <h3 class="text-xl font-semibold text-white mb-3">No Monitors Yet</h3>
          <p class="text-slate-400 text-sm mb-6">
            Start monitoring your homelab services and apps. Add monitors to track the status, uptime, and performance of your infrastructure.
          </p>
          <div class="space-y-3">
            <p class="text-slate-400 text-sm">
              <span class="text-cyan-400 font-semibold">Step 1:</span> Go to the admin panel
            </p>
            <a href="/admin" class="inline-flex items-center justify-center w-full bg-cyan-600 hover:bg-cyan-700 text-white font-semibold py-3 px-4 rounded-lg transition-colors">
              <i class="fas fa-cog mr-2"></i>
              Open Admin Panel
            </a>
            <p class="text-slate-500 text-xs mt-4">
              <i class="fas fa-info-circle mr-1"></i>
              You'll be able to add monitors and configure their settings there.
            </p>
          </div>
        </div>
      </div>
    `;
    return;
  }

  // Separate targets into apps and services
  // Only show apps if publicShowAppLink is true (default true)
  const apps = targets.filter(t => (t.appUrl || t.appIcon) && (t.publicShowAppLink !== false));
  const appCount = apps.length;

  if (appCount === 0) {
    pageHome.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Apps</h2>
        <p id="app-count" class="text-slate-400 text-sm">(0 apps)</p>
      </div>
      <div class="text-center text-slate-400 py-12 col-span-full">
        <p>No apps configured with icons. You have ${targets.length} monitor${targets.length !== 1 ? 's' : ''} on the <strong>Status & Uptime</strong> tab.</p>
      </div>
    `;
    return;
  }

  // Sort apps by position, then by name
  const sortedApps = [...apps].sort((a, b) => {
    const posA = a.position || 0;
    const posB = b.position || 0;
    if (posA !== posB) return posA - posB;
    return a.name.localeCompare(b.name);
  });

  // Group apps by category
  const groupedApps = {};
  const ungroupedApps = [];

  sortedApps.forEach(app => {
    if (app.group) {
      if (!groupedApps[app.group]) {
        groupedApps[app.group] = [];
      }
      groupedApps[app.group].push(app);
    } else {
      ungroupedApps.push(app);
    }
  });

  // Build the UI with search bar and grouped apps
  let html = `
    <div class="mb-6">
      <h2 class="text-2xl font-bold text-white mb-2">Apps</h2>
      <p id="app-count" class="text-slate-400 text-sm">(${appCount} app${appCount !== 1 ? 's' : ''})</p>
    </div>

    <!-- Search Bar -->
    <div class="mb-8">
      <input type="text" id="search-input" placeholder="Search or use /commands (e.g., /jellyfin)"
             class="w-full bg-slate-700 border border-slate-600 rounded-lg px-4 py-3 text-white placeholder-slate-400 focus:outline-none focus:border-cyan-500" />
      <p class="text-slate-500 text-xs mt-2">
        Type a service name to filter, or use / commands. Example: /jellyfin opens Jellyfin instantly.
      </p>
    </div>
  `;

  // Display ungrouped apps first
  if (ungroupedApps.length > 0) {
    html += '<div id="apps-grid" class="flex flex-col gap-3 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 mb-8">';
    html += ungroupedApps.map(app => buildAppCard(app)).join('');
    html += '</div>';
  }

  // Display grouped apps
  Object.entries(groupedApps).forEach(([group, appsInGroup]) => {
    html += `
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-white mb-4">${group}</h3>
        <div class="flex flex-col gap-3 sm:grid sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
          ${appsInGroup.map(app => buildAppCard(app)).join('')}
        </div>
      </div>
    `;
  });

  pageHome.innerHTML = html;

  // Attach event listeners
  setupAppCardListeners();
  setupSearchAndCommands(sortedApps);
}

function buildAppCard(app) {
  const isDown = !app.isUp;
  const statusClass = isDown ? 'down' : 'up';
  const statusText = isDown ? 'Down' : 'Up';

  // Determine icon - prioritize appIcon (manually configured), then cached favicon, then API favicon, then fallback icon
  let iconHTML = '';
  
  if (app.appIcon) {
    // Use manually configured app icon - proxy it
    const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(app.appIcon)}`;
    iconHTML = `<img src="${proxyUrl}" alt="${app.name}" class="app-favicon" onerror="handleIconError(this, '${app.name}')" />`;
  } else {
    const cachedFavicon = faviconCache[app.appUrl];
    
    if (cachedFavicon) {
      // If favicon is a data URL (base64), use it directly, otherwise proxy it
      if (cachedFavicon.startsWith('data:')) {
        iconHTML = `<img src="${cachedFavicon}" alt="${app.name}" class="app-favicon" onerror="handleIconError(this, '${app.name}')" />`;
      } else {
        const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(cachedFavicon)}`;
        iconHTML = `<img src="${proxyUrl}" alt="${app.name}" class="app-favicon" onerror="handleIconError(this, '${app.name}')" />`;
      }
    } else if (app.favicon) {
      faviconCache[app.appUrl] = app.favicon;
      // If favicon is a data URL (base64), use it directly, otherwise proxy it
      if (app.favicon.startsWith('data:')) {
        iconHTML = `<img src="${app.favicon}" alt="${app.name}" class="app-favicon" onerror="handleIconError(this, '${app.name}')" />`;
      } else {
        const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(app.favicon)}`;
        iconHTML = `<img src="${proxyUrl}" alt="${app.name}" class="app-favicon" onerror="handleIconError(this, '${app.name}')" />`;
      }
    } else {
      // Fallback to Font Awesome icon
      const fallbackIcon = getIconForApp(app.name);
      iconHTML = `<i class="fas ${fallbackIcon}"></i>`;
    }
  }

  return `
    <div class="app-card" data-app-url="${app.appUrl || ''}" data-app-id="${app._id}" data-app-name="${app.name.toLowerCase()}" data-quick-commands="${(app.quickCommands || []).map(c => c.toLowerCase()).join('|')}" data-is-down="${isDown}">
      <div class="app-icon">
        ${iconHTML}
      </div>
      <div class="app-name">${app.name}</div>
      <div class="app-status ${statusClass}">${statusText}</div>
    </div>
  `;
}

// Handle icon loading errors
function handleIconError(img, appName) {
  // Replace failed image with fallback icon
  const fallbackIcon = getIconForApp(appName);
  img.outerHTML = `<i class="fas ${fallbackIcon}"></i>`;
}

// Get icon HTML for a service/monitor
function getServiceIconHTML(target) {
  let iconHTML = '';
  
  if (target.appIcon) {
    // Use manually configured app icon - proxy it
    const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(target.appIcon)}`;
    iconHTML = `<img src="${proxyUrl}" alt="${target.name}" class="service-favicon" onerror="handleServiceIconError(this, '${target.name}')" />`;
  } else if (target.appUrl) {
    const cachedFavicon = faviconCache[target.appUrl];
    
    if (cachedFavicon) {
      // If favicon is a data URL (base64), use it directly, otherwise proxy it
      if (cachedFavicon.startsWith('data:')) {
        iconHTML = `<img src="${cachedFavicon}" alt="${target.name}" class="service-favicon" onerror="handleServiceIconError(this, '${target.name}')" />`;
      } else {
        const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(cachedFavicon)}`;
        iconHTML = `<img src="${proxyUrl}" alt="${target.name}" class="service-favicon" onerror="handleServiceIconError(this, '${target.name}')" />`;
      }
    } else if (target.favicon) {
      faviconCache[target.appUrl] = target.favicon;
      // If favicon is a data URL (base64), use it directly, otherwise proxy it
      if (target.favicon.startsWith('data:')) {
        iconHTML = `<img src="${target.favicon}" alt="${target.name}" class="service-favicon" onerror="handleServiceIconError(this, '${target.name}')" />`;
      } else {
        const proxyUrl = `/api/proxy-icon?url=${encodeURIComponent(target.favicon)}`;
        iconHTML = `<img src="${proxyUrl}" alt="${target.name}" class="service-favicon" onerror="handleServiceIconError(this, '${target.name}')" />`;
      }
    } else {
      // Fallback to Font Awesome icon
      const fallbackIcon = getIconForApp(target.name);
      iconHTML = `<i class="fas ${fallbackIcon}"></i>`;
    }
  } else {
    // Fallback to Font Awesome icon
    const fallbackIcon = getIconForApp(target.name);
    iconHTML = `<i class="fas ${fallbackIcon}"></i>`;
  }
  
  return iconHTML;
}

// Handle service icon loading errors
function handleServiceIconError(img, serviceName) {
  // Replace failed image with fallback icon
  const fallbackIcon = getIconForApp(serviceName);
  img.outerHTML = `<i class="fas ${fallbackIcon}"></i>`;
}

function setupAppCardListeners() {
  // Add event listeners for left-click and middle-click
  document.querySelectorAll('.app-card[data-app-url]').forEach(card => {
    card.style.cursor = 'pointer';

    card.addEventListener('mousedown', (e) => {
      const url = card.getAttribute('data-app-url');

      if (e.button === 0) {
        // Left click - will be handled by click event
      } else if (e.button === 1) {
        // Middle click - open in background tab without focus
        e.preventDefault();
        window.open(url, '_blank');
      } else if (e.button === 2) {
        // Right click - let context menu handle it
        e.preventDefault();
        window.open(url, '_blank');
      }
    });

    card.addEventListener('click', (e) => {
      // Handle left click
      if (e.button === 0) {
        const url = card.getAttribute('data-app-url');
        window.open(url, '_blank');
      }
    });
  });
}

function setupSearchAndCommands(allApps) {
  const searchInput = document.getElementById('search-input');
  if (!searchInput) return;

  let suggestedCommand = null;

  searchInput.addEventListener('keyup', (e) => {
    const query = e.target.value.toLowerCase().trim();

    // Handle quick commands (starting with /)
    if (query.startsWith('/')) {
      const command = query.substring(1);

      // Find matching command
      const matchingApp = findAppByCommand(command, allApps);

      // If exact match found, suggest it
      if (matchingApp && e.key !== 'Enter') {
        suggestedCommand = matchingApp;
        showCommandSuggestion(matchingApp, command);
      } else {
        hideCommandSuggestion();
      }

      // Show all apps when typing a command
      const allCards = document.querySelectorAll('.app-card');
      allCards.forEach(card => {
        card.style.display = '';
      });
      return;
    }

    hideCommandSuggestion();

    // Filter apps based on search query (only for non-command searches)
    if (query.length === 0) {
      const allCards = document.querySelectorAll('.app-card');
      allCards.forEach(card => {
        card.style.display = '';
      });
    } else {
      const allCards = document.querySelectorAll('.app-card');
      allCards.forEach(card => {
        const appName = card.getAttribute('data-app-name') || '';
        const quickCommands = card.getAttribute('data-quick-commands') || '';
        const matches = appName.includes(query) || quickCommands.includes(query);
        card.style.display = matches ? '' : 'none';
      });
    }
  });

  searchInput.addEventListener('keydown', (e) => {
    const query = e.target.value.toLowerCase().trim();

    // Tab completion for commands
    if (e.key === 'Tab') {
      e.preventDefault();

      if (query.startsWith('/')) {
        const command = query.substring(1);
        const matchingApp = findAppByCommand(command, allApps);

        if (matchingApp) {
          // Use the first quick command or the app name
          const fullCommand = matchingApp.quickCommands?.[0] || matchingApp.name.toLowerCase();
          searchInput.value = `/${fullCommand}`;
          suggestedCommand = null;
          hideCommandSuggestion();
        }
      }
      return;
    }

    // Enter key handling
    if (e.key === 'Enter') {
      const query = e.target.value.toLowerCase().trim();

      if (query.startsWith('/')) {
        e.preventDefault();
        const command = query.substring(1);
        handleQuickCommand(command, allApps);
        e.target.value = '';
        hideCommandSuggestion();
      } else {
        // DuckDuckGo search
        e.preventDefault();
        window.open(`https://duckduckgo.com/?q=${encodeURIComponent(query)}`, '_blank');
        e.target.value = '';
      }
    }
  });
}

function findAppByCommand(command, allApps) {
  const lowerCommand = command.toLowerCase();

  // First try exact match with quick commands
  for (const app of allApps) {
    const quickCommands = (app.quickCommands || []).map(c => c.toLowerCase());
    if (quickCommands.some(c => c.startsWith(lowerCommand))) {
      return app;
    }
  }

  // Then try partial match with app names
  for (const app of allApps) {
    const appName = app.name.toLowerCase();
    if (appName.startsWith(lowerCommand)) {
      return app;
    }
  }

  return null;
}

function showCommandSuggestion(app, partialCommand) {
  let suggestionEl = document.getElementById('command-suggestion');

  if (!suggestionEl) {
    suggestionEl = document.createElement('div');
    suggestionEl.id = 'command-suggestion';
    suggestionEl.style.cssText = `
      background: rgba(15, 23, 42, 0.95);
      border: 1px solid rgba(148, 163, 184, 0.3);
      border-radius: 0.5rem;
      padding: 0.75rem 1rem;
      margin-top: 0.5rem;
      margin-bottom: 0.5rem;
      font-size: 0.875rem;
      color: #cbd5e1;
      z-index: 10;
      white-space: nowrap;
      max-width: 300px;
      overflow: hidden;
      text-overflow: ellipsis;
    `;
    const searchInput = document.getElementById('search-input');
    searchInput.parentNode.insertBefore(suggestionEl, searchInput.nextSibling);
  }

  const suggestedCommand = app.quickCommands?.[0] || app.name.toLowerCase();
  const remaining = suggestedCommand.substring(partialCommand.length);

  suggestionEl.innerHTML = `Press <kbd style="background: #475569; padding: 0.2rem 0.4rem; border-radius: 0.25rem;">Tab</kbd> to complete: <span style="color: #10b981; font-weight: 500;">/${suggestedCommand}</span>`;
  suggestionEl.style.display = 'block';
}

function hideCommandSuggestion() {
  const suggestionEl = document.getElementById('command-suggestion');
  if (suggestionEl) {
    suggestionEl.style.display = 'none';
  }
}

function handleQuickCommand(command, allApps) {
  const lowerCommand = command.toLowerCase();

  // Search for matching app by quick command or name
  for (const app of allApps) {
    const quickCommands = (app.quickCommands || []).map(c => c.toLowerCase());
    const appName = app.name.toLowerCase();

    // Check if command matches quick command or app name
    if (quickCommands.includes(lowerCommand) || appName === lowerCommand) {
      if (!app.isUp) {
        alert(`${app.name} is currently down and cannot be opened.`);
        return;
      }

      if (app.appUrl) {
        window.open(app.appUrl, '_blank');
        return;
      }
    }
  }

  // Command not found
  alert(`Service not found. Try one of these commands:\n${allApps
    .filter(a => a.appUrl)
    .slice(0, 5)
    .map(a => `/${a.quickCommands?.[0] || a.name.toLowerCase()}`)
    .join('\n')}`);
}

function getIconForApp(appName, customIcon) {
  if (customIcon) return customIcon;

  const iconMap = {
    'nginx': 'fa-server',
    'apache': 'fa-server',
    'docker': 'fa-docker',
    'kubernetes': 'fa-cube',
    'prometheus': 'fa-chart-line',
    'grafana': 'fa-chart-area',
    'jenkins': 'fa-gears',
    'gitlab': 'fa-gitlab',
    'github': 'fa-github',
    'gitea': 'fa-git-alt',
    'sonarqube': 'fa-code',
    'vault': 'fa-lock',
    'consul': 'fa-sitemap',
    'minio': 'fa-database',
    'postgresql': 'fa-database',
    'mysql': 'fa-database',
    'sqlite': 'fa-database',
    'redis': 'fa-database',
    'elasticsearch': 'fa-search',
    'kibana': 'fa-chart-line',
    'nexus': 'fa-box',
    'artifactory': 'fa-box',
    'portainer': 'fa-docker',
    'pihole': 'fa-shield-alt',
    'adguard': 'fa-shield-alt',
    'jellyfin': 'fa-film',
    'plex': 'fa-film',
    'kodi': 'fa-tv',
    'emby': 'fa-film',
    'nextcloud': 'fa-cloud',
    'synology': 'fa-hdd',
    'qnap': 'fa-hdd',
    'home assistant': 'fa-home',
    'homebridge': 'fa-home',
    'openwrt': 'fa-network-wired',
    'unifi': 'fa-wifi',
    'piaware': 'fa-plane',
    'resin': 'fa-flask',
    'wireguard': 'fa-lock',
    'openvpn': 'fa-lock',
  };

  const lowerName = appName.toLowerCase();
  for (const [key, icon] of Object.entries(iconMap)) {
    if (lowerName.includes(key)) {
      return icon;
    }
  }

  // Default icon
  return 'fa-cube';
}

function openApp(url) {
  if (url) {
    window.open(url, '_blank');
  }
}

// ==================== STATUS PAGE ====================

async function getTargetUptime(targetId) {
  // Use cached data from consolidated endpoint if available
  const target = allTargets.find(t => t._id === targetId);
  if (target && target.uptime) {
    return target.uptime['30d']?.uptime || 0;
  }

  if (targetUptimeCache[targetId]) {
    return targetUptimeCache[targetId];
  }

  try {
    const res = await axios.get(`/api/targets/${targetId}/uptime?days=30`);
    const uptime = res.data.uptime;
    targetUptimeCache[targetId] = uptime;
    return uptime;
  } catch (error) {
    console.error('Error fetching uptime:', error);
    return 0;
  }
}

async function getTargetCurrentPing(targetId) {
  // Try to get from cached data first (we don't cache individual ping, but we can skip the request)
  // For now, return 0 as we don't have current ping in the consolidated endpoint
  // This can be enhanced later if needed
  return 0;
}

async function loadAndDisplayPing(targetId) {
  const ping = await getTargetCurrentPing(targetId);
  const el = document.querySelector(`.ping-${targetId}`);
  if (el) {
    if (ping > 0) {
      el.textContent = ping.toFixed(0) + 'ms';
    } else {
      el.textContent = '-';
    }
  }
}

function updateServicesList(targets) {
  const list = document.getElementById('services-list');
  const countEl = document.getElementById('service-count');

  if (!list) return;

  // Filter targets to only show those with publicShowStatus enabled (default true)
  const visibleTargets = targets.filter(t => t.publicShowStatus !== false);

  // Show all targets in status page
  if (visibleTargets.length === 0) {
    // Only clear if we're not on the status page or if there are no existing services
    const existingServices = list.querySelectorAll('.service-item');
    if (existingServices.length === 0) {
      list.innerHTML = '<div class="text-center text-slate-400 py-8">No services found</div>';
    }
    countEl.textContent = '(0)';
    return;
  }

  countEl.textContent = `(${visibleTargets.length})`;

  // Check if services list is still showing loading message (only clear if it's the ONLY content)
  const loadingMsg = list.querySelector('.text-center.text-slate-400');
  if (loadingMsg && list.children.length === 1) {
    // Only clear if this is the only child (the loading message)
    list.innerHTML = '';
  }

  // Get list of existing service IDs to track what needs to be removed
  const existingServiceIds = new Set();
  list.querySelectorAll('.service-item').forEach(el => {
    const id = el.id.replace('service-', '');
    if (id) existingServiceIds.add(id);
  });

  // Update each service row dynamically without re-rendering
  visibleTargets.forEach(target => {
    existingServiceIds.delete(target._id); // Mark as still existing
    const serviceEl = document.getElementById(`service-${target._id}`);

    if (!serviceEl) {
      // If service doesn't exist, add it using appendChild to preserve DOM state
      const tempDiv = document.createElement('div');
      tempDiv.innerHTML = createServiceElement(target);
      const newServiceEl = tempDiv.firstElementChild;
      list.appendChild(newServiceEl);
      
      loadAndDisplayUptime(target._id);
      loadAndDisplayUptimeBars(target._id);
      loadAndDisplayPing(target._id);
      
      // If this service should be expanded, restore its expanded state
      if (expandedServiceId === target._id) {
        const wrapper = document.getElementById(`details-wrapper-${target._id}`);
        const row = newServiceEl.querySelector('.service-row');
        const icon = row ? row.querySelector('.expand-icon') : null;
        
        if (wrapper) wrapper.classList.add('open');
        if (row) row.classList.add('expanded');
        if (icon) icon.classList.add('rotated');

        // Load details if not already loaded
        const contentEl = document.getElementById(`service-content-${target._id}`);
        if (contentEl && contentEl.innerHTML.includes('Loading details...')) {
          loadServiceDetails(target._id);
        }
      }
    } else {
      // Update existing service - preserve expanded state at all costs
      const isUp = target.isUp;
      const statusBadgeClass = isUp ? 'up' : 'down';
      const statusText = isUp ? 'Up' : 'Down';

      const row = serviceEl.querySelector('.service-row');
      if (!row) return; // Safety check
      
      const badgeEl = row.querySelector('.status-badge');
      const wrapper = document.getElementById(`details-wrapper-${target._id}`);
      const icon = row.querySelector('.expand-icon');
      const iconEl = row.querySelector('.service-icon');

      // Update icon if it exists
      if (iconEl) {
        const newIconHTML = getServiceIconHTML(target);
        iconEl.innerHTML = newIconHTML;
      }

      // Update status badge only
      if (badgeEl) {
        badgeEl.className = `service-status-badge status-badge ${statusBadgeClass}`;
        badgeEl.innerHTML = `<span class="w-2 h-2 rounded-full ${isUp ? 'bg-green-400' : 'bg-red-400'} inline-block"></span>${statusText}`;
      }

      // CRITICAL: Always preserve expanded state - never close if it's expanded
      const isExpanded = expandedServiceId === target._id;
      if (isExpanded) {
        // Force open state - don't check, just ensure it's open
        if (wrapper) wrapper.classList.add('open');
        if (row) row.classList.add('expanded');
        if (icon) icon.classList.add('rotated');
      } else {
        // Only close if it's not supposed to be expanded
        if (wrapper && wrapper.classList.contains('open')) {
          wrapper.classList.remove('open');
        }
        if (row && row.classList.contains('expanded')) {
          row.classList.remove('expanded');
        }
        if (icon) icon.classList.remove('rotated');
      }

      // Reload uptime data
      loadAndDisplayUptime(target._id);
      loadAndDisplayUptimeBars(target._id);
      loadAndDisplayPing(target._id);
    }
  });

  // Remove services that no longer exist (but preserve expanded state if it's the expanded one)
  existingServiceIds.forEach(serviceId => {
    // Don't remove if it's the currently expanded service
    if (serviceId === expandedServiceId) {
      return; // Keep it even if it's not in the targets list
    }
    const serviceEl = document.getElementById(`service-${serviceId}`);
    if (serviceEl) {
      serviceEl.remove();
    }
  });

  // Update expanded service details if one is open - do this AFTER all DOM updates
  if (expandedServiceId) {
    // Use setTimeout to ensure DOM is stable
    setTimeout(() => {
      loadServiceDetailsUpdate(expandedServiceId);
    }, 0);
  }
}

function createServiceElement(target) {
  const isUp = target.isUp;
  const statusBadgeClass = isUp ? 'up' : 'down';
  const statusText = isUp ? 'Up' : 'Down';
  const isExpanded = expandedServiceId === target._id;
  const showDetails = target.publicShowDetails === true;

  // Get icon HTML for the service
  const iconHTML = getServiceIconHTML(target);

  return `
    <div class="service-item bg-slate-900/50 backdrop-blur rounded-lg border border-slate-700/30 mb-3 overflow-hidden" id="service-${target._id}">
      <div class="service-row ${isExpanded ? 'expanded' : ''}" onclick="toggleServiceExpand('${target._id}')">
        <div class="service-icon">
          ${iconHTML}
        </div>
        <div class="service-name">
          <div class="font-semibold text-white text-sm sm:text-base">${target.name}</div>
          ${showDetails ? `<div class="hidden sm:block text-xs text-slate-400 mt-1">${target.host}${target.port ? ':' + target.port : ''} (${target.protocol})</div>` : ''}
        </div>
        <div class="service-ping ping-${target._id} text-yellow-400 font-semibold">-</div>
        <div class="service-uptime uptime-${target._id} text-cyan-400 font-semibold">-</div>
        <div class="service-bars">
          ${generateUptimeBars(target._id)}
        </div>
        <div class="service-status-badge status-badge ${statusBadgeClass}">
          <span class="w-2 h-2 rounded-full ${isUp ? 'bg-green-400' : 'bg-red-400'} inline-block"></span>
          ${statusText}
        </div>
        <div class="service-expand-icon expand-icon text-slate-400${isExpanded ? ' rotated' : ''}"><svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/><path d="m12 5 7 7-7 7"/></svg></div>
      </div>

      <div class="service-details-wrapper" id="details-wrapper-${target._id}">
        <div id="service-content-${target._id}" class="service-details-content">
          <div class="text-slate-400 text-sm text-center py-4">Loading details...</div>
        </div>
      </div>
    </div>
  `;
}

async function loadAndDisplayUptime(targetId) {
  const uptime = await getTargetUptime(targetId);
  const el = document.querySelector(`.uptime-${targetId}`);
  if (el) {
    el.textContent = uptime + '%';
  }
}

async function loadAndDisplayUptimeBars(targetId) {
  try {
    // Use cached daily stats from consolidated endpoint if available
    const target = allTargets.find(t => t._id === targetId);
    let stats = [];
    
    if (target && target.dailyStats) {
      stats = target.dailyStats;
    } else {
      // Fallback: fetch if not in cache (shouldn't happen if using consolidated endpoint)
      const now = Date.now();
      if (!statisticsCache || !statisticsCacheTime || (now - statisticsCacheTime) > STATISTICS_CACHE_DURATION) {
        const res = await axios.get(`/api/targets/${targetId}/statistics?days=30`);
        stats = res.data.statistics || [];
      } else {
        // Still in cache, but target not found - return early
        return;
      }
    }

    // Get the uptime bar container
    const serviceEl = document.getElementById(`service-${targetId}`);
    if (!serviceEl) return;

    const uptimeBar = serviceEl.querySelector('.uptime-bar');
    if (!uptimeBar) return;

    // Clear loading segments and rebuild with actual data
    let html = '';
    stats.forEach(stat => {
      const isUp = stat.successfulPings > 0;
      const status = isUp ? 'up' : 'down';
      const uptime = stat.successfulPings > 0 ? ((stat.successfulPings / stat.totalPings) * 100).toFixed(0) : 0;
      html += `<div class="uptime-segment ${status}" title="${new Date(stat.date).toLocaleDateString()}: ${uptime}% up"></div>`;
    });

    // If no stats yet, show loading state
    if (stats.length === 0) {
      html = '';
      for (let i = 0; i < 40; i++) {
        html += `<div class="uptime-segment" style="background-color: #64748b;" title="No data"></div>`;
      }
    }

    uptimeBar.innerHTML = html;
  } catch (error) {
    console.error('Error loading uptime bars:', error);
  }
}

function generateUptimeBars(targetId) {
  let html = '';
  for (let i = 0; i < 40; i++) {
    html += `<div class="uptime-segment loading" title="Loading..."></div>`;
  }
  return `<div class="uptime-bar">${html}</div>`;
}

function toggleServiceExpand(serviceId) {
  // If clicking the same service, close it
  if (expandedServiceId === serviceId) {
    expandedServiceId = null;
    const wrapper = document.getElementById(`details-wrapper-${serviceId}`);
    const row = document.querySelector(`#service-${serviceId} .service-row`);
    const icon = row.querySelector('.expand-icon');

    if (wrapper) {
      wrapper.classList.remove('open');
    }
    if (row) {
      row.classList.remove('expanded');
    }
    if (icon) {
      icon.classList.remove('rotated');
    }
  } else {
    // Close previous expanded service
    if (expandedServiceId) {
      const prevWrapper = document.getElementById(`details-wrapper-${expandedServiceId}`);
      const prevRow = document.querySelector(`#service-${expandedServiceId} .service-row`);
      const prevIcon = prevRow?.querySelector('.expand-icon');

      if (prevWrapper) {
        prevWrapper.classList.remove('open');
      }
      if (prevRow) {
        prevRow.classList.remove('expanded');
      }
      if (prevIcon) {
        prevIcon.classList.remove('rotated');
      }
    }

    // Open new service
    expandedServiceId = serviceId;
    const wrapper = document.getElementById(`details-wrapper-${serviceId}`);
    const row = document.querySelector(`#service-${serviceId} .service-row`);
    const icon = row.querySelector('.expand-icon');

    if (wrapper) {
      wrapper.classList.add('open');
    }
    if (row) {
      row.classList.add('expanded');
    }
    if (icon) {
      icon.classList.add('rotated');
    }

    // Load the details
    loadServiceDetails(serviceId);
  }
}

async function loadServiceDetails(serviceId) {
  const target = allTargets.find(t => t._id === serviceId);
  if (!target) return;

  const contentEl = document.getElementById(`service-content-${serviceId}`);

  try {
    // Use cached uptime data if available, otherwise fetch
    let uptime24h = 0;
    let uptime30d = 0;
    
    if (target.uptime) {
      uptime24h = parseFloat(target.uptime['24h']?.uptime || 0);
      uptime30d = parseFloat(target.uptime['30d']?.uptime || 0);
    } else {
      // Fallback: fetch if not in cache
      const statsResponse = await axios.get(`/api/targets/${serviceId}/statistics?period=24h`);
      const uptimeData = statsResponse.data.uptime || {};
      uptime24h = parseFloat(uptimeData['24h']?.uptime || 0);
      uptime30d = parseFloat(uptimeData['30d']?.uptime || 0);
    }
    
    // Chart data will be loaded separately when needed (only when details are expanded)

    contentEl.innerHTML = `
      <div class="space-y-4 p-4 border-t border-slate-700">
        <!-- Stats Grid -->
        <div class="grid ${target.publicShowDetails ? 'grid-cols-2 md:grid-cols-4' : 'grid-cols-3'} gap-3">
          <div class="bg-gradient-to-br from-slate-700/40 to-slate-800/40 rounded-lg p-3 border border-slate-600/50 backdrop-blur-sm shadow-lg">
            <p class="text-slate-400 text-xs mb-1">Current Status</p>
            <p class="text-lg font-bold ${target.isUp ? 'text-green-400' : 'text-red-400'} mt-1">${target.isUp ? '✓ UP' : '✗ DOWN'}</p>
          </div>
          <div class="bg-gradient-to-br from-slate-700/40 to-slate-800/40 rounded-lg p-3 border border-slate-600/50 backdrop-blur-sm shadow-lg">
            <p class="text-slate-400 text-xs mb-1">Uptime (24h)</p>
            <p class="text-lg font-bold text-green-400 mt-1 uptime-24h-${serviceId}">${uptime24h.toFixed(2)}%</p>
          </div>
          <div class="bg-gradient-to-br from-slate-700/40 to-slate-800/40 rounded-lg p-3 border border-slate-600/50 backdrop-blur-sm shadow-lg">
            <p class="text-slate-400 text-xs mb-1">Uptime (30d)</p>
            <p class="text-lg font-bold text-green-400 mt-1 uptime-30d-${serviceId}">${uptime30d.toFixed(2)}%</p>
          </div>
          ${target.publicShowDetails ? `
          <div class="bg-gradient-to-br from-slate-700/40 to-slate-800/40 rounded-lg p-3 border border-slate-600/50 backdrop-blur-sm shadow-lg">
            <p class="text-slate-400 text-xs mb-1">Protocol</p>
            <p class="text-lg font-bold text-cyan-400 mt-1">${target.protocol}</p>
          </div>
          ` : ''}
        </div>


        <!-- Time Period Selector -->
        <div class="flex gap-2 flex-wrap">
          <button onclick="switchChartPeriod('${serviceId}', '1h')" class="period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50" data-period="1h">1H</button>
          <button onclick="switchChartPeriod('${serviceId}', '24h')" class="period-btn px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30 transition-all duration-200 border border-cyan-500/50" data-period="24h">24H</button>
          <button onclick="switchChartPeriod('${serviceId}', '7d')" class="period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50" data-period="7d">7D</button>
          <button onclick="switchChartPeriod('${serviceId}', '30d')" class="period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50" data-period="30d">30D</button>
          <button onclick="switchChartPeriod('${serviceId}', 'all')" class="period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50" data-period="all">ALL</button>
        </div>

        <!-- Chart Container -->
        <div class="bg-gradient-to-br from-slate-900/60 to-slate-800/40 backdrop-blur rounded-xl p-6 border border-slate-700/50 shadow-2xl">
          <div class="mb-4 flex items-center justify-between">
            <h3 class="text-sm font-semibold text-slate-300">Response Time & Status</h3>
            <div class="flex gap-3 text-xs">
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-green-400"></div>
                <span class="text-slate-400">Response Time</span>
              </div>
              <div class="flex items-center gap-1.5">
                <div class="w-2 h-2 rounded-full bg-red-400"></div>
                <span class="text-slate-400">Downtime</span>
              </div>
            </div>
          </div>
          <div style="position: relative; height: 350px;">
            <canvas id="chart-${serviceId}"></canvas>
          </div>
        </div>
      </div>
    `;

    // Load initial chart
    setTimeout(() => {
      loadServiceChart(serviceId, '24h');
    }, 100);
  } catch (error) {
    console.error('Error loading service details:', error);
    contentEl.innerHTML = `<div class="text-red-400 text-sm p-4">Error loading details</div>`;
  }
}

async function loadServiceDetailsUpdate(serviceId) {
  const target = allTargets.find(t => t._id === serviceId);
  if (!target) return;

  try {
    // Ensure wrapper stays open if this is the expanded service
    const wrapper = document.getElementById(`details-wrapper-${serviceId}`);
    if (expandedServiceId === serviceId && wrapper) {
      wrapper.classList.add('open');
    }

    // Only update the values if the details panel exists
    const contentEl = document.getElementById(`service-content-${serviceId}`);
    if (!contentEl) {
      // If content doesn't exist but service is expanded, load it
      if (expandedServiceId === serviceId) {
        loadServiceDetails(serviceId);
      }
      return;
    }

    // Load all data in one API call (statistics + uptime) - use current period or 24h
    const currentPeriod = chartPeriods[serviceId] || '24h';
    const statsResponse = await axios.get(`/api/targets/${serviceId}/statistics?period=${currentPeriod}`);
    const uptimeData = statsResponse.data.uptime || {};

    const uptime24h = parseFloat(uptimeData['24h']?.uptime || 0).toFixed(2);
    const uptime30d = parseFloat(uptimeData['30d']?.uptime || 0).toFixed(2);

    // Update values dynamically
    const uptime24hEl = contentEl.querySelector(`.uptime-24h-${serviceId}`);
    const uptime30dEl = contentEl.querySelector(`.uptime-30d-${serviceId}`);
    
    // Find status element - it's in the first stat card
    const statusCard = contentEl.querySelector('.grid.grid-cols-2');
    const statusEl = statusCard ? statusCard.querySelector('.text-lg.font-bold') : null;
    
    if (uptime24hEl) uptime24hEl.textContent = uptime24h + '%';
    if (uptime30dEl) uptime30dEl.textContent = uptime30d + '%';
    
    // Update status if changed
    if (statusEl) {
      const isUp = target.isUp;
      statusEl.className = `text-lg font-bold ${isUp ? 'text-green-400' : 'text-red-400'} mt-1`;
      statusEl.textContent = isUp ? '✓ UP' : '✗ DOWN';
    }

    // Update chart data dynamically if chart exists
    if (charts[serviceId] && chartPeriods[serviceId]) {
      await updateChartData(serviceId, chartPeriods[serviceId]);
    } else if (contentEl.querySelector(`#chart-${serviceId}`)) {
      // Chart canvas exists but chart wasn't created yet, create it now
      const currentPeriod = chartPeriods[serviceId] || '24h';
      await loadServiceChart(serviceId, currentPeriod);
    }
  } catch (error) {
    console.error('Error updating service details:', error);
  }
}

async function switchChartPeriod(serviceId, period) {
  // Update button states
  const buttons = document.querySelectorAll(`#service-content-${serviceId} .period-btn`);
  buttons.forEach(btn => {
    if (btn.dataset.period === period) {
      btn.className = 'period-btn px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30 transition-all duration-200 border border-cyan-500/50';
    } else {
      btn.className = 'period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50';
    }
  });

  await loadServiceChart(serviceId, period);
}

async function updateChartData(serviceId, period) {
  try {
    const chart = charts[serviceId];
    if (!chart) return;

    // Fetch real statistics from the API with period parameter
    const statsRes = await axios.get(`/api/targets/${serviceId}/statistics?period=${period}`);
    const statistics = statsRes.data.statistics || [];

    // Parse and sort statistics chronologically (oldest first = left to right)
    const sortedStats = [...statistics]
      .map(stat => ({
        ...stat,
        dateObj: new Date(stat.date) // Parse date once
      }))
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()); // Sort chronologically (oldest first)

    const labels = [];
    const responseTimeData = [];
    const downData = [];

    sortedStats.forEach(stat => {
      const date = stat.dateObj;
      if (period === '1h') {
        // 1H: Show time only (HH:MM)
        labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } else if (period === '24h') {
        // 24H: Show day and time (Mon 15, 14:30)
        labels.push(date.toLocaleString([], { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      } else if (period === '7d') {
        // 7D: Show date and time (Nov 15, 14:30)
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      } else if (period === '30d') {
        // 30D: Show date only (Nov 15)
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric' }));
      } else {
        // Default: Show date and time
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      }

      // Add response time data (rounded to nearest integer)
      const avgResponseTime = stat.avgResponseTime || 0;
      responseTimeData.push(Math.round(avgResponseTime));

      // Add downtime indicator (will be scaled to max Y value later)
      const isDown = stat.successfulPings === 0;
      downData.push(isDown ? 1 : null); // Use 1 as placeholder, will scale to max
    });

    // Calculate max response time for scaling downtime indicator
    const validResponseTimes = responseTimeData.filter(v => v > 0);
    const maxResponseTime = validResponseTimes.length > 0 ? Math.max(...validResponseTimes) : 100;
    const downtimeMaxValue = Math.round(Math.max(maxResponseTime * 1.1, 100)); // Add 10% padding, minimum 100, rounded

    // Scale downtime indicator to max Y value
    const scaledDownData = downData.map(val => val !== null ? downtimeMaxValue : null);

    // Update chart data dynamically
    chart.data.labels = labels;
    chart.data.datasets[0].data = responseTimeData;
    chart.data.datasets[1].data = scaledDownData;
    
    // Update point radius based on period
    chart.data.datasets[0].pointRadius = period === '1h' || period === '24h' ? 4 : 0;
    
    chart.update('none'); // Update without animation for smooth refresh
  } catch (error) {
    console.error('Error updating chart data:', error);
  }
}

async function loadServiceChart(serviceId, period) {
  try {
    const canvas = document.getElementById(`chart-${serviceId}`);
    if (!canvas) return;

    // If chart already exists and period hasn't changed, just update the data
    if (charts[serviceId] && chartPeriods[serviceId] === period) {
      await updateChartData(serviceId, period);
      return;
    }

    // Fetch real statistics from the API with period parameter
    const statsRes = await axios.get(`/api/targets/${serviceId}/statistics?period=${period}`);
    const statistics = statsRes.data.statistics || [];

    // Parse and sort statistics chronologically (oldest first = left to right)
    const sortedStats = [...statistics]
      .map(stat => ({
        ...stat,
        dateObj: new Date(stat.date) // Parse date once
      }))
      .sort((a, b) => a.dateObj.getTime() - b.dateObj.getTime()); // Sort chronologically (oldest first)

    const labels = [];
    const responseTimeData = [];
    const downData = [];

    sortedStats.forEach(stat => {
      const date = stat.dateObj;
      if (period === '1h') {
        // 1H: Show time only (HH:MM)
        labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } else if (period === '24h') {
        // 24H: Show day and time (Mon 15, 14:30)
        labels.push(date.toLocaleString([], { weekday: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      } else if (period === '7d') {
        // 7D: Show date and time (Nov 15, 14:30)
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      } else if (period === '30d') {
        // 30D: Show date only (Nov 15)
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric' }));
      } else {
        // Default: Show date and time
        labels.push(date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }));
      }

      // Add response time data (rounded to nearest integer)
      const avgResponseTime = stat.avgResponseTime || 0;
      responseTimeData.push(Math.round(avgResponseTime));

      // Add downtime indicator (will be scaled to max Y value later)
      const isDown = stat.successfulPings === 0;
      downData.push(isDown ? 1 : null); // Use 1 as placeholder, will scale to max
    });

    // Destroy existing chart if any
    if (charts[serviceId]) {
      charts[serviceId].destroy();
    }

    const ctx = canvas.getContext('2d');
    
    // Calculate min/max for better scaling
    const validResponseTimes = responseTimeData.filter(v => v > 0);
    const minResponseTime = validResponseTimes.length > 0 ? Math.min(...validResponseTimes) : 0;
    const maxResponseTime = validResponseTimes.length > 0 ? Math.max(...validResponseTimes) : 100;
    const downtimeMaxValue = Math.round(Math.max(maxResponseTime * 1.1, 100)); // Add 10% padding, minimum 100, rounded

    // Scale downtime indicator to max Y value
    const scaledDownData = downData.map(val => val !== null ? downtimeMaxValue : null);
    
    // Store the period for this chart
    chartPeriods[serviceId] = period;
    
    charts[serviceId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Response Time (ms)',
            data: responseTimeData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.15)',
            fill: true,
            tension: 0.5,
            pointRadius: period === '1h' || period === '24h' ? 4 : 0,
            pointHoverRadius: 8,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#ffffff',
            pointBorderWidth: 2,
            pointHoverBackgroundColor: '#34d399',
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 3,
            borderWidth: 3,
            spanGaps: false,
          },
          {
            label: 'Downtime',
            data: scaledDownData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.25)',
            fill: true,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 0,
            spanGaps: false,
            order: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: {
          mode: 'index',
          intersect: false,
        },
        plugins: {
          legend: {
            display: false,
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.98)',
            titleColor: '#ffffff',
            bodyColor: '#cbd5e1',
            borderColor: '#06b6d4',
            borderWidth: 2,
            padding: 14,
            displayColors: true,
            cornerRadius: 8,
            titleFont: { size: 13, weight: 'bold' },
            bodyFont: { size: 12 },
            boxPadding: 8,
            callbacks: {
              title: function(context) {
                return context[0].label;
              },
              label: function(context) {
                if (context.datasetIndex === 0) {
                  const value = context.raw;
                  if (!value || value === 0) {
                    return '🔴 Offline';
                  }
                  const pingTag = value < 50 ? '🟢 Excellent' : value < 100 ? '🟡 Good' : value < 200 ? '🟠 Fair' : '🔴 Poor';
                  return `${pingTag} ${Math.round(value)} ms`;
                } else {
                  return context.raw ? '🔴 Service Down' : '';
                }
              },
              afterBody: function(context) {
                if (context[0].datasetIndex === 0 && context[0].raw > 0) {
                  const value = context[0].raw;
                  if (value < 50) return '⚡ Excellent response time';
                  if (value < 100) return '✓ Good response time';
                  if (value < 200) return '⚠ Acceptable response time';
                  return '⚠ Slow response time';
                }
                return '';
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: downtimeMaxValue, // Set max to ensure downtime indicator reaches top
            grid: { 
              color: 'rgba(255, 255, 255, 0.08)', 
              drawBorder: false,
              lineWidth: 1
            },
            ticks: { 
              color: '#94a3b8', 
              font: { size: 11, weight: '500' },
              padding: 8,
              callback: function(value) {
                return Math.round(value) + ' ms';
              }
            },
            title: { 
              display: true, 
              text: 'Response Time (ms)', 
              color: '#cbd5e1',
              font: { size: 12, weight: '600' },
              padding: { bottom: 10 }
            }
          },
          x: {
            type: 'category',
            grid: { 
              color: 'rgba(255, 255, 255, 0.05)', 
              drawBorder: false 
            },
            ticks: { 
              color: '#94a3b8', 
              maxRotation: 45, 
              minRotation: 0, 
              font: { size: 10, weight: '500' },
              padding: 8,
              autoSkip: true,
              maxTicksLimit: 12
            },
            // Ensure chronological order (left = oldest, right = newest)
            reverse: false
          },
        },
        elements: {
          point: {
            hoverRadius: 8,
            hoverBorderWidth: 3,
          }
        },
        animation: {
          duration: 1000,
          easing: 'easeInOutQuart'
        }
      },
    });
  } catch (error) {
    console.error('Error loading chart:', error);
  }
}
