let allTargets = [];
let expandedServiceId = null;
let charts = {};
let targetUptimeCache = {};
let faviconCache = {}; // Cache for favicons in localStorage

// Load on page load
loadData();

// Auto-refresh every 10 seconds
setInterval(loadData, 10000);

async function loadData() {
  try {
    const [statusRes, incidentsRes] = await Promise.all([
      axios.get('/api/status'),
      axios.get('/api/incidents')
    ]);

    const { status, targets } = statusRes.data;
    const { incidents } = incidentsRes.data;

    allTargets = targets;

    // Update header status
    updateHeaderStatus(status);

    // Display incidents
    displayIncidents(incidents);
    displayIncidentHistory(incidents);

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

// Display active incidents at the top of status page
function displayIncidents(incidents) {
  const incidentsContainer = document.getElementById('incidents-container');
  if (!incidentsContainer) return;

  // Filter for active incidents (investigating, identified, monitoring)
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
          'monitoring': 'bg-orange-900/30 text-orange-300'
        };

        return `
          <div class="border border-slate-700 rounded-lg p-4 mb-3 ${severityColors[incident.severity] || 'bg-slate-900/30 border-slate-700'}">
            <div class="flex justify-between items-start mb-2">
              <h4 class="font-semibold text-white">${incident.title}</h4>
              <span class="text-xs px-2 py-1 rounded ${statusColors[incident.status] || 'bg-slate-700'}">${incident.status.toUpperCase()}</span>
            </div>
            <p class="text-slate-300 text-sm mb-2">${incident.description}</p>
            <p class="text-slate-500 text-xs">Reported: ${new Date(incident.createdAt).toLocaleString()}</p>
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
          'resolved': '✅'
        };

        const isResolved = incident.status === 'resolved';

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
}

// ==================== APPS PAGE ====================

function displayApps(targets) {
  const pageHome = document.getElementById('page-home');
  const countEl = document.getElementById('app-count');

  // Check if there are ANY targets at all
  if (targets.length === 0) {
    pageHome.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Welcome to LocalPing</h2>
        <p class="text-slate-400 text-sm">Get started by adding monitors</p>
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
            Start monitoring your homelab services and applications. Add monitors to track the status, uptime, and performance of your infrastructure.
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
  const apps = targets.filter(t => t.appUrl || t.appIcon);
  const appCount = apps.length;

  if (appCount === 0) {
    pageHome.innerHTML = `
      <div class="mb-6">
        <h2 class="text-2xl font-bold text-white mb-2">Your Applications</h2>
        <p id="app-count" class="text-slate-400 text-sm">(0 apps)</p>
      </div>
      <div class="text-center text-slate-400 py-12 col-span-full">
        <p>No applications configured with icons. You have ${targets.length} monitor${targets.length !== 1 ? 's' : ''} on the <strong>Status & Uptime</strong> tab.</p>
      </div>
    `;
    return;
  }

  countEl.textContent = `(${appCount} app${appCount !== 1 ? 's' : ''})`;

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
      <h2 class="text-2xl font-bold text-white mb-2">Your Applications</h2>
      <p class="text-slate-400 text-sm">(${appCount} app${appCount !== 1 ? 's' : ''})</p>
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
    html += '<div id="apps-grid" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4 mb-8">';
    html += ungroupedApps.map(app => buildAppCard(app)).join('');
    html += '</div>';
  }

  // Display grouped apps
  Object.entries(groupedApps).forEach(([group, appsInGroup]) => {
    html += `
      <div class="mb-8">
        <h3 class="text-lg font-semibold text-white mb-4">${group}</h3>
        <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-4">
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

  // Determine icon - prefer cached favicon, then API favicon
  let iconHTML = '';
  const cachedFavicon = faviconCache[app.appUrl];

  if (cachedFavicon) {
    iconHTML = `<img src="${cachedFavicon}" alt="${app.name}" class="app-favicon" onerror="this.remove()" />`;
  } else if (app.favicon) {
    faviconCache[app.appUrl] = app.favicon;
    iconHTML = `<img src="${app.favicon}" alt="${app.name}" class="app-favicon" onerror="this.remove()" />`;
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

function updateServicesList(targets) {
  const list = document.getElementById('services-list');
  const countEl = document.getElementById('service-count');

  // Show all targets in status page
  if (targets.length === 0) {
    list.innerHTML = '<div class="text-center text-slate-400 py-8">No services found</div>';
    countEl.textContent = '(0)';
    return;
  }

  countEl.textContent = `(${targets.length})`;

  // Check if services list is still showing loading message
  const loadingMsg = list.querySelector('.text-center.text-slate-400');
  if (loadingMsg) {
    list.innerHTML = ''; // Clear loading message
  }

  // Update each service row dynamically without re-rendering
  targets.forEach(target => {
    const serviceEl = document.getElementById(`service-${target._id}`);

    if (!serviceEl) {
      // If service doesn't exist, add it
      list.innerHTML += createServiceElement(target);
      loadAndDisplayUptime(target._id);
      loadAndDisplayUptimeBars(target._id);
    } else {
      // Update existing service
      const isUp = target.isUp;
      const statusBadgeClass = isUp ? 'up' : 'down';
      const statusText = isUp ? '● Up' : '● Down';

      const row = serviceEl.querySelector('.service-row');
      const badgeEl = row.querySelector('.status-badge');

      // Update status badge
      badgeEl.className = `status-badge ${statusBadgeClass}`;
      badgeEl.textContent = statusText;

      // Reload uptime data
      loadAndDisplayUptime(target._id);
      loadAndDisplayUptimeBars(target._id);
    }
  });

  // Update expanded service details if one is open
  if (expandedServiceId) {
    loadServiceDetailsUpdate(expandedServiceId);
  }
}

function createServiceElement(target) {
  const isUp = target.isUp;
  const statusBadgeClass = isUp ? 'up' : 'down';
  const statusText = isUp ? '● Up' : '● Down';
  const isExpanded = expandedServiceId === target._id;

  return `
    <div class="service-item" id="service-${target._id}">
      <div class="service-row ${isExpanded ? 'expanded' : ''}" onclick="toggleServiceExpand('${target._id}')">
        <div class="service-name">
          <div class="font-medium text-white">${target.name}</div>
          <div class="text-xs text-slate-400 mt-1">${target.host}</div>
        </div>
        <div class="service-uptime uptime-${target._id}">-</div>
        <div class="service-bars">
          ${generateUptimeBars(target._id)}
        </div>
        <div class="status-badge ${statusBadgeClass}">
          ${statusText}
        </div>
        <div class="expand-icon">${isExpanded ? '▼' : '▶'}</div>
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
    // Fetch statistics for the last 30 days (hourly data)
    const res = await axios.get(`/api/targets/${targetId}/statistics?days=30`);
    const stats = res.data.statistics || [];

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
      icon.textContent = '▶';
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
        prevIcon.textContent = '▶';
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
      icon.textContent = '▼';
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
    // Load uptime data for 24h and 30d
    const uptime24hRes = await axios.get(`/api/targets/${serviceId}/uptime?days=1`);
    const uptime30dRes = await axios.get(`/api/targets/${serviceId}/uptime?days=30`);

    const uptime24h = parseFloat(uptime24hRes.data.uptime);
    const uptime30d = parseFloat(uptime30dRes.data.uptime);
    const totalPings = uptime30dRes.data.totalPings;
    const successfulPings = uptime30dRes.data.successfulPings;

    contentEl.innerHTML = `
      <div class="space-y-4 p-4 border-t border-slate-700">
        <!-- Stats Grid -->
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Current Status</p>
            <p class="text-lg font-bold ${target.isUp ? 'text-green-400' : 'text-red-400'} mt-1">${target.isUp ? '✓ UP' : '✗ DOWN'}</p>
          </div>
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Uptime (24h)</p>
            <p class="text-lg font-bold text-green-400 mt-1 uptime-24h-${serviceId}">${uptime24h.toFixed(2)}%</p>
          </div>
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Uptime (30d)</p>
            <p class="text-lg font-bold text-green-400 mt-1 uptime-30d-${serviceId}">${uptime30d.toFixed(2)}%</p>
          </div>
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Protocol</p>
            <p class="text-lg font-bold text-cyan-400 mt-1">${target.protocol}</p>
          </div>
        </div>

        <!-- Additional Stats Row -->
        <div class="grid grid-cols-3 gap-3">
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Total Pings</p>
            <p class="text-lg font-bold text-blue-400 mt-1">${totalPings}</p>
          </div>
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Successful</p>
            <p class="text-lg font-bold text-green-400 mt-1">${successfulPings}</p>
          </div>
          <div class="bg-slate-700/30 rounded p-3 border border-slate-600">
            <p class="text-slate-400 text-xs">Failed</p>
            <p class="text-lg font-bold text-red-400 mt-1">${totalPings - successfulPings}</p>
          </div>
        </div>

        <!-- Time Period Selector -->
        <div class="flex gap-2">
          <button onclick="switchChartPeriod('${serviceId}', '1h')" class="period-btn px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600" data-period="1h">1H</button>
          <button onclick="switchChartPeriod('${serviceId}', '24h')" class="period-btn px-3 py-1 rounded text-xs bg-cyan-600 text-white" data-period="24h">24H</button>
          <button onclick="switchChartPeriod('${serviceId}', '7d')" class="period-btn px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600" data-period="7d">7D</button>
          <button onclick="switchChartPeriod('${serviceId}', '30d')" class="period-btn px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600" data-period="30d">30D</button>
          <button onclick="switchChartPeriod('${serviceId}', 'all')" class="period-btn px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600" data-period="all">ALL</button>
        </div>

        <!-- Chart -->
        <div class="bg-slate-700/30 rounded p-4 border border-slate-600">
          <div style="position: relative; height: 280px;">
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
    // Only update the values if the details panel exists
    const contentEl = document.getElementById(`service-content-${serviceId}`);
    if (!contentEl) return;

    // Load uptime data for 24h and 30d
    const uptime24hRes = await axios.get(`/api/targets/${serviceId}/uptime?days=1`);
    const uptime30dRes = await axios.get(`/api/targets/${serviceId}/uptime?days=30`);

    const uptime24h = parseFloat(uptime24hRes.data.uptime).toFixed(2);
    const uptime30d = parseFloat(uptime30dRes.data.uptime).toFixed(2);

    // Update values dynamically
    const uptime24hEl = document.querySelector(`.uptime-24h-${serviceId}`);
    const uptime30dEl = document.querySelector(`.uptime-30d-${serviceId}`);

    if (uptime24hEl) uptime24hEl.textContent = uptime24h + '%';
    if (uptime30dEl) uptime30dEl.textContent = uptime30d + '%';
  } catch (error) {
    console.error('Error updating service details:', error);
  }
}

async function switchChartPeriod(serviceId, period) {
  // Update button states
  const buttons = document.querySelectorAll(`#service-content-${serviceId} .period-btn`);
  buttons.forEach(btn => {
    if (btn.dataset.period === period) {
      btn.className = 'period-btn px-3 py-1 rounded text-xs bg-cyan-600 text-white';
    } else {
      btn.className = 'period-btn px-3 py-1 rounded text-xs bg-slate-700 hover:bg-slate-600';
    }
  });

  await loadServiceChart(serviceId, period);
}

async function loadServiceChart(serviceId, period) {
  try {
    const canvas = document.getElementById(`chart-${serviceId}`);
    if (!canvas) return;

    let days = 1;
    if (period === '1h') {
      days = 0.04; // 1 hour = 1/24 days
    } else if (period === '7d') {
      days = 7;
    } else if (period === '30d') {
      days = 30;
    } else if (period === 'all') {
      days = 90;
    }

    // Fetch real statistics from the API
    const statsRes = await axios.get(`/api/targets/${serviceId}/statistics?days=${days}`);
    const statistics = statsRes.data.statistics || [];

    const labels = [];
    const responseTimeData = [];
    const downData = [];

    statistics.forEach(stat => {
      const date = new Date(stat.date);
      if (period === '1h' || period === '24h') {
        labels.push(date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
      } else {
        labels.push(date.toLocaleDateString([], { month: 'short', day: 'numeric' }));
      }

      // Add response time data
      const avgResponseTime = stat.avgResponseTime || 0;
      responseTimeData.push(avgResponseTime);

      // Add downtime indicator
      const isDown = stat.successfulPings === 0;
      downData.push(isDown ? 100 : null);
    });

    // Destroy existing chart if any
    if (charts[serviceId]) {
      charts[serviceId].destroy();
    }

    const ctx = canvas.getContext('2d');
    charts[serviceId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Response Time (ms)',
            data: responseTimeData,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: period === '24h' ? 2 : 0,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointHoverRadius: 5,
            borderWidth: 2,
            spanGaps: false,
          },
          {
            label: 'Downtime',
            data: downData,
            borderColor: '#ef4444',
            backgroundColor: 'rgba(239, 68, 68, 0.3)',
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            borderWidth: 0,
            spanGaps: false,
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
            display: true,
            labels: {
              color: '#cbd5e1',
              font: { size: 11 },
              usePointStyle: true,
              padding: 15,
            },
          },
          tooltip: {
            backgroundColor: 'rgba(15, 23, 42, 0.95)',
            titleColor: '#fff',
            bodyColor: '#cbd5e1',
            borderColor: '#475569',
            borderWidth: 1,
            padding: 12,
            displayColors: true,
            callbacks: {
              label: function(context) {
                if (context.datasetIndex === 0) {
                  return context.raw ? `${context.raw.toFixed(2)} ms` : 'Offline';
                } else {
                  return context.raw ? 'Service Down' : '';
                }
              }
            }
          }
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            grid: { color: '#475569', drawBorder: false },
            ticks: { color: '#cbd5e1', font: { size: 10 } },
            title: { display: true, text: 'Response Time (ms)', color: '#cbd5e1' }
          },
          x: {
            grid: { color: '#475569', drawBorder: false },
            ticks: { color: '#cbd5e1', maxRotation: 45, minRotation: 0, font: { size: 10 } },
          },
        },
      },
    });
  } catch (error) {
    console.error('Error loading chart:', error);
  }
}
