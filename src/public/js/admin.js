let pingChart = null;
let selectedTargetId = null;
let allTargets = [];

// Session-based authentication - no API key needed for admin panel
// API calls use secure session cookies automatically
axios.interceptors.response.use(
  (response) => response,
  (error) => {
    // If 401, redirect to login
    if (error.response?.status === 401) {
      window.location.href = '/admin/login';
    }
    return Promise.reject(error);
  }
);

// Load on page load
loadDashboard();

// Auto-refresh every 15 seconds
setInterval(loadDashboard, 15000);

async function loadDashboard() {
  try {
    const res = await axios.get('/admin/api/dashboard');
    const { dashboard } = res.data;

    allTargets = dashboard.targets;

    // Update stats
    const upCount = dashboard.targets.filter((t) => t.currentStatus === 'up').length;
    const downCount = dashboard.targets.length - upCount;

    document.getElementById('total-targets').textContent = dashboard.targets.length;
    document.getElementById('targets-up').textContent = upCount;
    document.getElementById('targets-down').textContent = downCount;
    document.getElementById('active-monitors').textContent = dashboard.targets.filter((t) => t.enabled).length;

    // Display monitors list
    displayMonitorsList(dashboard.targets);

    // Update selected monitor if one is selected (but NOT if form is open)
    const formPanel = document.getElementById('form-panel');
    if (selectedTargetId && !formPanel.classList.contains('hidden')) {
      // Form is open, don't switch to details view
      return;
    }

    if (selectedTargetId) {
      const selectedTarget = dashboard.targets.find(t => t._id === selectedTargetId);
      if (selectedTarget) {
        displayMonitorDetail(selectedTarget);
      }
    }
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

function displayMonitorsList(targets) {
  const list = document.getElementById('services-list');
  const searchTerm = document.getElementById('search-input')?.value.toLowerCase() || '';

  const filtered = targets.filter(target =>
    target.name.toLowerCase().includes(searchTerm) ||
    target.host.toLowerCase().includes(searchTerm)
  );

  if (filtered.length === 0) {
    list.innerHTML = '<div class="px-4 py-8 text-center text-slate-400">No monitors found</div>';
    return;
  }

  list.innerHTML = filtered.map(target => {
    const isSelected = selectedTargetId === target._id;
    const statusColor = target.currentStatus === 'up' ? 'bg-green-500' : 'bg-red-500';

    return `
      <div
        onclick="selectMonitor('${target._id}')"
        class="px-4 py-3 cursor-pointer hover:bg-slate-700/50 transition ${isSelected ? 'service-item-selected' : ''}"
      >
        <div class="flex items-start justify-between mb-2">
          <div class="flex items-center gap-2 flex-1">
            <div class="w-2 h-2 rounded-full ${statusColor} flex-shrink-0"></div>
            <div class="flex-1 min-w-0">
              <h3 class="font-semibold text-sm truncate">${target.name}</h3>
              <p class="text-slate-400 text-xs">${target.host}:${target.port || 'default'}</p>
            </div>
          </div>
          <span class="text-xs font-medium px-2 py-1 rounded ${target.currentStatus === 'up' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'} flex-shrink-0">
            ${target.currentStatus === 'up' ? '✓' : '✗'}
          </span>
        </div>
        <div class="uptime-bar uptime-bar-${target._id}" style="width: 100%; max-width: 200px;">
          Loading...
        </div>
      </div>
    `;
  }).join('');

  // Load uptime data for all monitors
  filtered.forEach(target => {
    loadAndDisplayMiniUptime(target._id);
  });
}

async function loadAndDisplayMiniUptime(targetId) {
  try {
    const res = await axios.get(`/api/targets/${targetId}/statistics?days=1`);
    const stats = res.data.statistics || [];

    let html = '';
    stats.forEach(stat => {
      const isUp = stat.successfulPings > 0;
      html += `<div class="uptime-segment ${isUp ? 'up' : 'down'}" style="width: 4px; height: 12px;" title="${isUp ? 'Up' : 'Down'}"></div>`;
    });

    const el = document.querySelector(`.uptime-bar-${targetId}`);
    if (el) {
      el.innerHTML = html;
    }
  } catch (error) {
    console.error('Error loading uptime bars:', error);
  }
}

function selectMonitor(targetId) {
  selectedTargetId = targetId;
  const selectedTarget = allTargets.find(t => t._id === targetId);
  if (selectedTarget) {
    displayMonitorDetail(selectedTarget);
    // Compact the sidebar when a monitor is selected
    const sidebarTop = document.getElementById('sidebar-top-section');
    sidebarTop.classList.remove('sidebar-top-expanded');
    sidebarTop.classList.add('sidebar-top-compact');
  }
}

async function displayMonitorDetail(target) {
  // Show details panel
  document.getElementById('no-selection').classList.add('hidden');
  document.getElementById('details-panel').classList.remove('hidden');

  // Update header immediately
  document.getElementById('detail-name').textContent = target.name;
  document.getElementById('detail-host').textContent = `${target.host}:${target.port || 'default'} • ${target.protocol}`;
  document.getElementById('detail-interval').textContent = `Check every ${target.interval || 60} seconds`;

  // Update status badge
  const statusBadge = document.getElementById('detail-status');
  if (target.currentStatus === 'up') {
    statusBadge.textContent = '✓ Up';
    statusBadge.className = 'px-4 py-2 rounded-lg font-medium text-lg bg-green-900 text-green-200';
  } else {
    statusBadge.textContent = '✗ Down';
    statusBadge.className = 'px-4 py-2 rounded-lg font-medium text-lg bg-red-900 text-red-200';
  }

  // Set loading state for chart
  document.getElementById('detail-uptime-24h').textContent = 'Loading...';
  document.getElementById('detail-uptime-30d').textContent = 'Loading...';
  document.getElementById('detail-current-ping').textContent = 'Loading...';
  document.getElementById('detail-avg-ping').textContent = 'Loading...';

  // Load uptime data
  try {
    const res24h = await axios.get(`/api/targets/${target._id}/uptime?days=1`);
    const res30d = await axios.get(`/api/targets/${target._id}/uptime?days=30`);
    const resStats = await axios.get(`/api/targets/${target._id}/statistics?days=1`);

    const uptime24h = res24h.data.uptime;
    const uptime30d = res30d.data.uptime;
    const stats = resStats.data.statistics || [];

    // Get the most recent avg response time
    const latestStat = stats.length > 0 ? stats[stats.length - 1] : null;
    const currentPing = latestStat?.lastResponseTime || 0;
    const avgPing = latestStat?.avgResponseTime || 0;

    // Update uptime stats
    document.getElementById('detail-uptime-24h').textContent = `${uptime24h.toFixed(2)}%`;
    document.getElementById('detail-uptime-30d').textContent = `${uptime30d.toFixed(2)}%`;
    document.getElementById('detail-current-ping').textContent = currentPing.toFixed(2) + ' ms';
    document.getElementById('detail-avg-ping').textContent = avgPing.toFixed(2) + ' ms';

    // Generate uptime visualization
    await generateUptimeVisualization(target._id);

    // Load and display ping chart
    await loadPingChart(target._id);
  } catch (error) {
    console.error('Error loading monitor details:', error);
    document.getElementById('detail-uptime-24h').textContent = '-- %';
    document.getElementById('detail-uptime-30d').textContent = '-- %';
    document.getElementById('detail-current-ping').textContent = '-- ms';
    document.getElementById('detail-avg-ping').textContent = '-- ms';
  }
}

async function generateUptimeVisualization(targetId) {
  try {
    const res = await axios.get(`/api/targets/${targetId}/statistics?days=30`);
    const stats = res.data.statistics || [];

    const viz = document.getElementById('uptime-visualization');
    viz.innerHTML = '';

    // Create segments based on real statistics data
    stats.forEach(stat => {
      const segment = document.createElement('div');
      segment.className = 'uptime-segment';

      const isUp = stat.successfulPings > 0;
      if (!isUp) {
        segment.classList.add('down');
      } else {
        segment.classList.add('up');
      }

      segment.title = `${new Date(stat.date).toLocaleDateString()}: ${isUp ? 'Up' : 'Down'}`;
      viz.appendChild(segment);
    });
  } catch (error) {
    console.error('Error generating uptime visualization:', error);
  }
}

async function loadPingChart(targetId, days = 1) {
  try {
    // Update button styling
    document.querySelectorAll('.period-btn').forEach(btn => {
      btn.classList.remove('bg-cyan-600', 'text-white');
      btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
    });

    // Find and highlight the clicked button
    const clickedBtn = document.querySelector(`.period-btn[data-period="${days <= 0.05 ? '1h' : days === 1 ? '24h' : days === 7 ? '7d' : '30d'}"]`);
    if (clickedBtn) {
      clickedBtn.classList.remove('bg-slate-700', 'hover:bg-slate-600');
      clickedBtn.classList.add('bg-cyan-600', 'text-white');
    }

    const res = await axios.get(`/api/targets/${targetId}/statistics?days=${days}`);
    const stats = res.data.statistics || [];

    const labels = [];
    const data = [];

    stats.forEach(stat => {
      const date = new Date(stat.date);
      const label = days <= 0.05
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : days <= 1
        ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
        : date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
      labels.push(label);
      data.push(stat.avgResponseTime || 0);
    });

    const ctx = document.getElementById('ping-chart').getContext('2d');

    if (pingChart) {
      pingChart.destroy();
    }

    pingChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: 'Response Time (ms)',
            data,
            borderColor: '#10b981',
            backgroundColor: 'rgba(16, 185, 129, 0.1)',
            fill: true,
            tension: 0.4,
            pointRadius: 2,
            pointBackgroundColor: '#10b981',
            pointBorderColor: '#fff',
            pointHoverRadius: 5,
            borderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#cbd5e1' },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            grid: { color: '#475569' },
            ticks: { color: '#cbd5e1' },
          },
          x: {
            grid: { color: '#475569' },
            ticks: { color: '#cbd5e1', maxRotation: 45, minRotation: 0 },
          },
        },
      },
    });
  } catch (error) {
    console.error('Error loading ping chart:', error);
  }
}

// Form panel functions
function showAddTargetForm() {
  const formPanel = document.getElementById('form-panel');
  const detailsPanel = document.getElementById('details-panel');
  const noSelection = document.getElementById('no-selection');
  const form = document.getElementById('target-form');
  const title = document.getElementById('form-title');

  title.textContent = 'Add Monitor';
  form.reset();
  delete form.dataset.targetId;

  // Reset protocol-specific sections
  updateProtocolSettings();
  resetAuthenticationMethod();

  // Show form panel, hide details
  formPanel.classList.remove('hidden');
  detailsPanel.classList.add('hidden');
  noSelection.classList.add('hidden');
}

function cancelEditForm() {
  const formPanel = document.getElementById('form-panel');
  const detailsPanel = document.getElementById('details-panel');
  const noSelection = document.getElementById('no-selection');
  const sidebarTop = document.getElementById('sidebar-top-section');

  // If a monitor is selected, show details. Otherwise show no-selection
  if (selectedTargetId) {
    formPanel.classList.add('hidden');
    detailsPanel.classList.remove('hidden');
    // Keep sidebar compact when a monitor is selected
    sidebarTop.classList.remove('sidebar-top-expanded');
    sidebarTop.classList.add('sidebar-top-compact');
  } else {
    formPanel.classList.add('hidden');
    noSelection.classList.remove('hidden');
    // Expand sidebar when no monitor is selected
    sidebarTop.classList.remove('sidebar-top-compact');
    sidebarTop.classList.add('sidebar-top-expanded');
  }
}

function showEditForm() {
  const formPanel = document.getElementById('form-panel');
  const detailsPanel = document.getElementById('details-panel');
  const form = document.getElementById('target-form');

  // First load the target data
  editTarget();

  // Then show the form panel
  setTimeout(() => {
    formPanel.classList.remove('hidden');
    detailsPanel.classList.add('hidden');
  }, 10);
}

function updateProtocolSettings() {
  const protocol = document.getElementById('target-protocol').value;
  const httpSection = document.getElementById('http-options-section');
  const authSection = document.getElementById('auth-section');

  // Show HTTP options for HTTP/HTTPS protocols
  if (protocol === 'HTTP' || protocol === 'HTTPS') {
    httpSection.classList.remove('hidden');
    authSection.classList.remove('hidden');
  } else {
    httpSection.classList.add('hidden');
    authSection.classList.add('hidden');
  }
}

function resetAuthenticationMethod() {
  const authMethod = document.getElementById('target-auth-method');
  const basicFields = document.getElementById('basic-auth-fields');
  const bearerFields = document.getElementById('bearer-auth-fields');

  authMethod.value = 'none';
  basicFields.classList.add('hidden');
  bearerFields.classList.add('hidden');
}

// Listen for auth method changes
document.addEventListener('DOMContentLoaded', () => {
  const authMethod = document.getElementById('target-auth-method');
  if (authMethod) {
    authMethod.addEventListener('change', (e) => {
      const basicFields = document.getElementById('basic-auth-fields');
      const bearerFields = document.getElementById('bearer-auth-fields');

      basicFields.classList.add('hidden');
      bearerFields.classList.add('hidden');

      if (e.target.value === 'basic') {
        basicFields.classList.remove('hidden');
      } else if (e.target.value === 'bearer') {
        bearerFields.classList.remove('hidden');
      }
    });
  }
});

async function addTarget(event) {
  event.preventDefault();

  const form = document.getElementById('target-form');
  const isEdit = form.dataset.targetId;

  const target = {
    name: document.getElementById('target-name').value,
    host: document.getElementById('target-host').value,
    protocol: document.getElementById('target-protocol').value,
    port: document.getElementById('target-port').value ? parseInt(document.getElementById('target-port').value) : null,
    interval: document.getElementById('target-interval').value ? parseInt(document.getElementById('target-interval').value) : 60,
    enabled: document.getElementById('target-enabled').checked,
    appUrl: document.getElementById('target-app-url').value || null,
    appIcon: document.getElementById('target-app-icon').value || null,
    retries: parseInt(document.getElementById('target-retries').value) || 0,
    retryInterval: parseInt(document.getElementById('target-retry-interval').value) || 5,
    timeout: parseInt(document.getElementById('target-timeout').value) || 30,
    httpMethod: document.getElementById('target-http-method').value || 'GET',
    statusCodes: document.getElementById('target-status-codes').value || '200-299',
    maxRedirects: parseInt(document.getElementById('target-max-redirects').value) || 5,
    ignoreSsl: document.getElementById('target-ignore-ssl').checked,
    upsideDown: document.getElementById('target-upside-down').checked,
    position: parseInt(document.getElementById('target-position').value) || 0,
    group: document.getElementById('target-group').value || null,
    quickCommands: document.getElementById('target-quick-commands').value
      ? document.getElementById('target-quick-commands').value.split(',').map(cmd => cmd.trim()).filter(cmd => cmd)
      : [],
  };

  // Add authentication if set
  const authMethod = document.getElementById('target-auth-method').value;
  if (authMethod === 'basic') {
    target.auth = {
      type: 'basic',
      username: document.getElementById('target-auth-username').value,
      password: document.getElementById('target-auth-password').value,
    };
  } else if (authMethod === 'bearer') {
    target.auth = {
      type: 'bearer',
      token: document.getElementById('target-auth-token').value,
    };
  }

  try {
    let savedTargetId;
    if (isEdit) {
      await axios.put(`/api/targets/${form.dataset.targetId}`, target);
      savedTargetId = form.dataset.targetId;
    } else {
      const res = await axios.post('/api/targets', target);
      savedTargetId = res.data.target._id;
    }

    // Close form and return to details
    const formPanel = document.getElementById('form-panel');
    const detailsPanel = document.getElementById('details-panel');
    formPanel.classList.add('hidden');

    form.reset();
    document.getElementById('target-enabled').checked = true;

    // Reload dashboard and show the saved monitor details
    await loadDashboard();

    // If we just saved a new monitor, select the first one
    if (!isEdit && allTargets.length > 0) {
      selectMonitor(allTargets[0]._id);
    } else if (isEdit) {
      // If editing, refresh the details view
      displayMonitorDetail(allTargets.find(t => t._id === form.dataset.targetId));
    }

    // Test the monitor immediately after saving
    selectedTargetId = savedTargetId;
    setTimeout(() => {
      testTarget();
    }, 500);
  } catch (error) {
    alert('Error saving target: ' + error.message);
  }
}

async function editTarget() {
  if (!selectedTargetId) return;

  try {
    const res = await axios.get(`/api/targets/${selectedTargetId}`);
    const target = res.data.target;

    // General section
    document.getElementById('target-name').value = target.name;
    document.getElementById('target-host').value = target.host;
    document.getElementById('target-protocol').value = target.protocol;
    document.getElementById('target-port').value = target.port || '';
    document.getElementById('target-interval').value = target.interval || 60;

    // Application section
    document.getElementById('target-app-url').value = target.appUrl || '';
    document.getElementById('target-app-icon').value = target.appIcon || '';

    // Retries section
    document.getElementById('target-retries').value = target.retries || 0;
    document.getElementById('target-retry-interval').value = target.retryInterval || 5;

    // HTTP Options section
    document.getElementById('target-http-method').value = target.httpMethod || 'GET';
    document.getElementById('target-timeout').value = target.timeout || 30;
    document.getElementById('target-status-codes').value = target.statusCodes || '200-299';
    document.getElementById('target-max-redirects').value = target.maxRedirects || 5;

    // Authentication section
    if (target.auth) {
      if (target.auth.type === 'basic') {
        document.getElementById('target-auth-method').value = 'basic';
        document.getElementById('target-auth-username').value = target.auth.username || '';
        document.getElementById('target-auth-password').value = target.auth.password || '';
      } else if (target.auth.type === 'bearer') {
        document.getElementById('target-auth-method').value = 'bearer';
        document.getElementById('target-auth-token').value = target.auth.token || '';
      }
    } else {
      document.getElementById('target-auth-method').value = 'none';
    }

    // Advanced section
    document.getElementById('target-ignore-ssl').checked = target.ignoreSsl || false;
    document.getElementById('target-upside-down').checked = target.upsideDown || false;
    document.getElementById('target-enabled').checked = target.enabled !== false;

    // Public UI settings
    document.getElementById('target-position').value = target.position || 0;
    document.getElementById('target-group').value = target.group || '';
    const quickCommandsInput = document.getElementById('target-quick-commands');
    if (quickCommandsInput) {
      quickCommandsInput.value = (target.quickCommands || []).join(', ');
    }

    const form = document.getElementById('target-form');
    const title = document.getElementById('form-title');

    title.textContent = 'Edit Monitor';
    form.dataset.targetId = selectedTargetId;

    // Update protocol settings to show HTTP/auth options if needed
    updateProtocolSettings();
  } catch (error) {
    alert('Error loading target: ' + error.message);
  }
}

async function deleteTarget() {
  if (!selectedTargetId) return;
  if (!confirm('Are you sure you want to delete this monitor?')) return;

  try {
    await axios.delete(`/api/targets/${selectedTargetId}`);
    selectedTargetId = null;
    document.getElementById('no-selection').classList.remove('hidden');
    document.getElementById('details-panel').classList.add('hidden');
    loadDashboard();
  } catch (error) {
    alert('Error deleting target: ' + error.message);
  }
}

async function testTarget() {
  if (!selectedTargetId) return;

  try {
    const res = await axios.post(`/api/targets/${selectedTargetId}/test`);
    const result = res.data.result;

    showTestNotification(result);
  } catch (error) {
    showTestNotification(null, error.message);
  }
}

function showTestNotification(result, errorMessage) {
  const notificationId = 'test-notification-' + Date.now();
  const isSuccess = result && result.success;
  const targetName = allTargets.find(t => t._id === selectedTargetId)?.name || 'Target';

  let container = document.getElementById('notificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; max-width: 400px; pointer-events: none;';
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.id = notificationId;
  notification.className = `notification ${isSuccess ? 'success' : 'error'}`;

  if (isSuccess) {
    notification.innerHTML = `
      <button class="notification-close" onclick="document.getElementById('${notificationId}').remove()">×</button>
      <div class="notification-title">✓ ${targetName} is UP</div>
      <div class="notification-stat">
        <span>Response Time:</span>
        <span><strong>${(result.responseTime || 0).toFixed(2)} ms</strong></span>
      </div>
      <div class="notification-stat">
        <span>Protocol:</span>
        <span><strong>${result.protocol || 'N/A'}</strong></span>
      </div>
      <div class="notification-stat">
        <span>Timestamp:</span>
        <span><strong>${new Date().toLocaleTimeString()}</strong></span>
      </div>
    `;
  } else {
    notification.innerHTML = `
      <button class="notification-close" onclick="document.getElementById('${notificationId}').remove()">×</button>
      <div class="notification-title">✗ ${targetName} is DOWN</div>
      <div class="notification-stat">
        <span>Error:</span>
        <span><strong>${errorMessage || result?.error || 'Connection failed'}</strong></span>
      </div>
      <div class="notification-stat">
        <span>Timestamp:</span>
        <span><strong>${new Date().toLocaleTimeString()}</strong></span>
      </div>
    `;
  }

  container.appendChild(notification);

  // Auto-remove after 5 seconds
  setTimeout(() => {
    const el = document.getElementById(notificationId);
    if (el) {
      el.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => el.remove(), 300);
    }
  }, 5000);
}

// Search functionality
document.getElementById('search-input')?.addEventListener('input', () => {
  displayMonitorsList(allTargets);
});

// Public UI Settings functions
function showPublicUISettings() {
  const modal = document.getElementById('public-settings-modal');
  const settingsList = document.getElementById('public-settings-list');

  if (allTargets.length === 0) {
    settingsList.innerHTML = '<div class="text-slate-400 text-sm text-center py-4">No monitors available</div>';
    modal.classList.remove('hidden');
    return;
  }

  settingsList.innerHTML = allTargets.map(target => {
    const isEnabled = target.enabled !== false;
    return `
      <label class="flex items-center gap-3 p-3 bg-slate-700/30 rounded cursor-pointer hover:bg-slate-700/50 transition">
        <input
          type="checkbox"
          class="public-ui-setting w-4 h-4 cursor-pointer"
          data-target-id="${target._id}"
          ${isEnabled ? 'checked' : ''}
        >
        <div class="flex-1">
          <div class="text-sm font-medium text-white">${target.name}</div>
          <div class="text-xs text-slate-400">${target.host}:${target.port || 'default'}</div>
        </div>
        <span class="text-xs px-2 py-1 rounded ${isEnabled ? 'bg-green-900 text-green-200' : 'bg-slate-600 text-slate-300'}">
          ${isEnabled ? 'Visible' : 'Hidden'}
        </span>
      </label>
    `;
  }).join('');

  modal.classList.remove('hidden');
}

async function savePublicSettings() {
  const checkboxes = document.querySelectorAll('.public-ui-setting');
  const updates = [];

  for (const checkbox of checkboxes) {
    const targetId = checkbox.dataset.targetId;
    const isEnabled = checkbox.checked;
    updates.push({ targetId, enabled: isEnabled });
  }

  try {
    // Update each target's enabled status
    for (const update of updates) {
      await axios.put(`/api/targets/${update.targetId}`, {
        enabled: update.enabled
      });
    }

    document.getElementById('public-settings-modal').classList.add('hidden');

    // Show success notification
    showSuccessNotification('Public UI settings saved successfully!');

    // Reload dashboard
    await loadDashboard();
  } catch (error) {
    alert('Error saving settings: ' + error.message);
  }
}

function showSuccessNotification(message) {
  const notificationId = 'success-notification-' + Date.now();
  
  let container = document.getElementById('notificationContainer');
  if (!container) {
    container = document.createElement('div');
    container.id = 'notificationContainer';
    container.style.cssText = 'position: fixed; top: 20px; right: 20px; z-index: 1000; display: flex; flex-direction: column; gap: 10px; max-width: 400px; pointer-events: none;';
    document.body.appendChild(container);
  }

  const notification = document.createElement('div');
  notification.id = notificationId;
  notification.className = 'notification success';
  notification.innerHTML = `
    <button class="notification-close" onclick="document.getElementById('${notificationId}').remove()">×</button>
    <div class="notification-title">✓ ${message}</div>
  `;

  container.appendChild(notification);

  setTimeout(() => {
    const el = document.getElementById(notificationId);
    if (el) {
      el.style.animation = 'slideOut 0.3s ease-in forwards';
      setTimeout(() => el.remove(), 300);
    }
  }, 3000);
}

// ============ INCIDENT MANAGEMENT FUNCTIONS ============

function showIncidentsPanel() {
  // Hide details and form panels
  document.getElementById('details-panel').classList.add('hidden');
  document.getElementById('form-panel').classList.add('hidden');
  document.getElementById('no-selection').classList.add('hidden');

  // Show incidents panel
  document.getElementById('incidents-panel').classList.remove('hidden');

  loadIncidentsPanel();
}

function hideIncidentsPanel() {
  const incidentsPanel = document.getElementById('incidents-panel');
  const noSelection = document.getElementById('no-selection');
  const sidebarTop = document.getElementById('sidebar-top-section');

  incidentsPanel.classList.add('hidden');

  // If a monitor is selected, show details with compact sidebar. Otherwise show no-selection with expanded sidebar
  if (selectedTargetId) {
    noSelection.classList.add('hidden');
    const selectedTarget = allTargets.find(t => t._id === selectedTargetId);
    if (selectedTarget) {
      displayMonitorDetail(selectedTarget);
      sidebarTop.classList.remove('sidebar-top-expanded');
      sidebarTop.classList.add('sidebar-top-compact');
    }
  } else {
    noSelection.classList.remove('hidden');
    sidebarTop.classList.remove('sidebar-top-compact');
    sidebarTop.classList.add('sidebar-top-expanded');
  }
}

function loadIncidentsPanel() {
  loadIncidents();
}

async function loadIncidents() {
  try {
    const res = await axios.get('/admin/api/incidents');
    const incidents = res.data.incidents || [];

    const list = document.getElementById('incidents-list-panel');

    if (incidents.length === 0) {
      list.innerHTML = '<div class="text-slate-400 text-sm text-center py-8">No incidents reported</div>';
      return;
    }

    list.innerHTML = incidents.map(incident => {
      const severityColor = {
        minor: 'bg-yellow-900 text-yellow-200',
        major: 'bg-orange-900 text-orange-200',
        critical: 'bg-red-900 text-red-200'
      }[incident.severity] || 'bg-slate-700';

      const statusColor = {
        investigating: 'bg-blue-900 text-blue-200',
        identified: 'bg-cyan-900 text-cyan-200',
        monitoring: 'bg-purple-900 text-purple-200',
        resolved: 'bg-green-900 text-green-200'
      }[incident.status] || 'bg-slate-700';

      return `
        <div class="bg-slate-700/30 rounded p-4 border border-slate-600">
          <div class="flex justify-between items-start mb-3">
            <div class="flex-1">
              <h3 class="font-semibold text-white text-sm">${incident.title}</h3>
              <p class="text-slate-400 text-xs mt-1">${new Date(incident.createdAt).toLocaleString()}</p>
            </div>
            <div class="flex gap-2">
              <span class="text-xs px-2 py-1 rounded ${severityColor}">
                ${incident.severity.toUpperCase()}
              </span>
              <span class="text-xs px-2 py-1 rounded ${statusColor}">
                ${incident.status.toUpperCase()}
              </span>
            </div>
          </div>
          <p class="text-slate-300 text-xs mb-3">${incident.description}</p>
          <div class="flex gap-2">
            <button onclick="editIncident('${incident._id}')" class="flex-1 bg-slate-600 hover:bg-slate-500 px-2 py-1 rounded text-xs">
              Edit
            </button>
            <button onclick="deleteIncident('${incident._id}')" class="flex-1 bg-red-900 hover:bg-red-800 px-2 py-1 rounded text-xs">
              Delete
            </button>
          </div>
        </div>
      `;
    }).join('');
  } catch (error) {
    console.error('Error loading incidents:', error);
    const list = document.getElementById('incidents-list-panel');
    if (list) {
      list.innerHTML = `<div class="text-red-400 text-sm">Error loading incidents</div>`;
    }
  }
}

function showCreateIncidentModal() {
  document.getElementById('incident-form').reset();
  document.getElementById('incident-form-modal').classList.remove('hidden');
  delete document.getElementById('incident-form').dataset.incidentId;
}

async function editIncident(incidentId) {
  try {
    const res = await axios.get(`/admin/api/incidents/${incidentId}`);
    const incident = res.data.incident;

    document.getElementById('incident-title').value = incident.title;
    document.getElementById('incident-description').value = incident.description;
    document.getElementById('incident-severity').value = incident.severity;
    document.getElementById('incident-status').value = incident.status;

    document.getElementById('incident-form').dataset.incidentId = incidentId;
    document.getElementById('incident-form-modal').classList.remove('hidden');
  } catch (error) {
    alert('Error loading incident: ' + error.message);
  }
}

async function saveIncident(event) {
  event.preventDefault();

  const title = document.getElementById('incident-title').value;
  const description = document.getElementById('incident-description').value;
  const severity = document.getElementById('incident-severity').value;
  const status = document.getElementById('incident-status').value;
  const incidentId = document.getElementById('incident-form').dataset.incidentId;

  try {
    if (incidentId) {
      // Update existing incident
      await axios.put(`/admin/api/incidents/${incidentId}`, {
        title,
        description,
        severity,
        status
      });
      showSuccessNotification('Incident updated successfully!');
    } else {
      // Create new incident
      await axios.post('/admin/api/incidents', {
        title,
        description,
        severity,
        status
      });
      showSuccessNotification('Incident reported successfully!');
    }

    document.getElementById('incident-form-modal').classList.add('hidden');
    loadIncidents();
  } catch (error) {
    alert('Error saving incident: ' + error.message);
  }
}

async function deleteIncident(incidentId) {
  if (!confirm('Are you sure you want to delete this incident?')) return;

  try {
    await axios.delete(`/admin/api/incidents/${incidentId}`);
    showSuccessNotification('Incident deleted successfully!');
    loadIncidents();
  } catch (error) {
    alert('Error deleting incident: ' + error.message);
  }
}
