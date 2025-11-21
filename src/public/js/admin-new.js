let currentMonitorId = null;
let statusChart = null;
let editPanelOpen = false;
let currentChartPeriod = '24h'; // Default period
let currentStartDate = null;
let currentEndDate = null;

// Tab switching
function switchTab(tabName) {
  // Hide all tabs
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });

  // Remove active class from all buttons
  document.querySelectorAll('.tab-button').forEach(btn => {
    btn.classList.remove('active');
  });

  // Show selected tab
  document.getElementById(tabName).classList.add('active');

  // Set active button
  event.target.classList.add('active');

  // Load tab-specific data
  if (tabName === 'monitors') {
    loadMonitors();
  } else if (tabName === 'incidents') {
    loadIncidents();
  } else if (tabName === 'posts') {
    loadPosts();
  } else if (tabName === 'visibility') {
    loadVisibility();
  } else if (tabName === 'settings') {
    loadPublicUISettings();
  } else if (tabName === 'backup') {
    // Backup tab doesn't need to load anything on switch
  }
}

// Load monitors list
async function loadMonitors() {
  try {
    const response = await axios.get('/admin/api/dashboard');
    const targets = response.data.dashboard.targets;

    const monitorList = document.getElementById('monitorList');
    monitorList.innerHTML = '';

    if (targets.length === 0) {
      monitorList.innerHTML = '<p class="text-slate-400 text-sm">No monitors yet</p>';
      return;
    }

    targets.forEach(target => {
      const status = target.currentStatus === 'up' ? 'up' : 'down';
      const statusText = status === 'up' ? 'Up' : 'Down';

      // Get favicon - prefer appIcon, then favicon from API, then try to get from appUrl
      let faviconHtml = '';
      if (target.appIcon) {
        // Proxy the icon URL
        const proxyUrl = `/admin/api/proxy-icon?url=${encodeURIComponent(target.appIcon)}`;
        faviconHtml = `<img src="${proxyUrl}" alt="${target.name}" class="w-4 h-4 rounded" onerror="this.style.display='none'" />`;
      } else if (target.favicon) {
        // Use cached favicon from API - if it's base64, use directly, otherwise proxy
        if (target.favicon.startsWith('data:')) {
          faviconHtml = `<img src="${target.favicon}" alt="${target.name}" class="w-4 h-4 rounded" onerror="this.style.display='none'" />`;
        } else {
          const proxyUrl = `/admin/api/proxy-icon?url=${encodeURIComponent(target.favicon)}`;
          faviconHtml = `<img src="${proxyUrl}" alt="${target.name}" class="w-4 h-4 rounded" onerror="this.style.display='none'" />`;
        }
      } else if (target.appUrl) {
        // Try to get favicon from appUrl
        const faviconUrl = getFaviconUrl(target.appUrl);
        if (faviconUrl) {
          const proxyUrl = `/admin/api/proxy-icon?url=${encodeURIComponent(faviconUrl)}`;
          faviconHtml = `<img src="${proxyUrl}" alt="${target.name}" class="w-4 h-4 rounded" onerror="this.style.display='none'" />`;
        }
      }

      const card = document.createElement('div');
      card.className = 'monitor-card';
      card.dataset.monitorId = target._id;
      card.innerHTML = `
        <div class="flex items-center gap-2">
          ${faviconHtml ? `<div class="flex-shrink-0">${faviconHtml}</div>` : ''}
          <div class="flex-1 min-w-0">
            <h4 class="font-semibold text-sm truncate">${target.name}</h4>
            <p class="text-xs text-slate-400 truncate">${target.host}</p>
          </div>
          <span class="status-badge ${status} flex-shrink-0">
            <span class="w-2 h-2 rounded-full ${status === 'up' ? 'bg-green-400' : 'bg-red-400'}"></span>
            ${statusText}
          </span>
        </div>
      `;
      card.onclick = () => selectMonitor(target);

      if (currentMonitorId === target._id) {
        card.classList.add('selected');
      }

      monitorList.appendChild(card);
    });

    // Auto-select first monitor if none is selected
    if (currentMonitorId === null && targets.length > 0) {
      selectMonitor(targets[0]);
    }
  } catch (error) {
    console.error('Error loading monitors:', error);
    showNotification('Error loading monitors', 'error');
  }
}

// Select monitor and show details
async function selectMonitor(monitor) {
  currentMonitorId = monitor._id;

  // Update UI
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('monitorDetails').classList.remove('hidden');

  // Load full monitor data
  try {
    const response = await axios.get(`/admin/api/targets/${monitor._id}`);
    const fullMonitor = response.data.target;

    // Populate form with all fields
    document.getElementById('editName').value = fullMonitor.name || '';
    document.getElementById('editHost').value = fullMonitor.host || '';
    document.getElementById('editProtocol').value = fullMonitor.protocol || 'ICMP';
    document.getElementById('editPort').value = fullMonitor.port || '';
    document.getElementById('editInterval').value = fullMonitor.interval || 60;
    document.getElementById('editGroup').value = fullMonitor.group || '';
    document.getElementById('editEnabled').checked = fullMonitor.enabled !== false;
    document.getElementById('editAppUrl').value = fullMonitor.appUrl || '';
    document.getElementById('editAppIcon').value = fullMonitor.appIcon || '';
    document.getElementById('editRetries').value = fullMonitor.retries || 0;
    document.getElementById('editRetryInterval').value = fullMonitor.retryInterval || 5;
    document.getElementById('editHttpMethod').value = fullMonitor.httpMethod || 'GET';
    document.getElementById('editTimeout').value = fullMonitor.timeout || 30;
    document.getElementById('editStatusCodes').value = fullMonitor.statusCodes || '200-299';
    document.getElementById('editMaxRedirects').value = fullMonitor.maxRedirects || 5;
    document.getElementById('editIgnoreSsl').checked = fullMonitor.ignoreSsl || false;
    document.getElementById('editUpsideDown').checked = fullMonitor.upsideDown || false;
    document.getElementById('editPosition').value = fullMonitor.position || 0;
    document.getElementById('editQuickCommands').value = (fullMonitor.quickCommands || []).join(', ');

    // Handle authentication
    if (fullMonitor.auth) {
      if (fullMonitor.auth.type === 'basic') {
        document.getElementById('editAuthMethod').value = 'basic';
        document.getElementById('editAuthUsername').value = fullMonitor.auth.username || '';
        document.getElementById('editAuthPassword').value = fullMonitor.auth.password || '';
      } else if (fullMonitor.auth.type === 'bearer') {
        document.getElementById('editAuthMethod').value = 'bearer';
        document.getElementById('editAuthToken').value = fullMonitor.auth.token || '';
      } else {
        document.getElementById('editAuthMethod').value = 'none';
      }
    } else {
      document.getElementById('editAuthMethod').value = 'none';
    }

    // Update protocol-specific sections
    updateProtocolSettings();
    updateAuthFields();
    attachFormListeners();

    document.getElementById('monitorName').textContent = fullMonitor.name;

    // Update status
    const status = fullMonitor.currentStatus === 'up' ? 'Up' : 'Down';
    const statusColor = fullMonitor.currentStatus === 'up' ? 'text-green-400' : 'text-red-400';
    document.getElementById('monitorStatus').textContent = status;
    document.getElementById('monitorStatus').className = statusColor;

    // Load real statistics (pass timeout for chart)
    await loadMonitorStatistics(fullMonitor._id, fullMonitor.timeout || 30);
  } catch (error) {
    console.error('Error loading monitor details:', error);
    showNotification('Error loading monitor details', 'error');
  }

  // Update monitor list selection
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.classList.remove('selected');
    if (card.dataset.monitorId === monitor._id) {
      card.classList.add('selected');
    }
  });

  // Show clone button
  const cloneBtn = document.getElementById('cloneMonitorBtn');
  if (cloneBtn) {
    cloneBtn.style.display = 'block';
  }
}

// Switch chart period (matching public UI style)
async function switchChartPeriod(period) {
  currentChartPeriod = period;
  
  // Update button states
  const buttons = document.querySelectorAll('.period-btn');
  buttons.forEach(btn => {
    if (btn.dataset.period === period) {
      btn.className = 'period-btn px-4 py-2 rounded-lg text-xs font-medium bg-gradient-to-r from-cyan-600 to-cyan-500 text-white shadow-lg shadow-cyan-500/30 transition-all duration-200 border border-cyan-500/50';
    } else {
      btn.className = 'period-btn px-4 py-2 rounded-lg text-xs font-medium bg-slate-700/50 hover:bg-slate-600/70 text-slate-300 transition-all duration-200 border border-slate-600/50';
    }
  });

  if (currentMonitorId) {
    const monitorResponse = await axios.get(`/admin/api/targets/${currentMonitorId}`);
    await loadMonitorStatistics(currentMonitorId, monitorResponse.data.target?.timeout || 30);
  }
}

// Apply custom date range
function applyCustomRange() {
  const startDate = document.getElementById('startDate').value;
  const endDate = document.getElementById('endDate').value;
  
  if (!startDate || !endDate) {
    showNotification('Please select both start and end dates', 'error');
    return;
  }
  
  if (new Date(startDate) > new Date(endDate)) {
    showNotification('Start date must be before end date', 'error');
    return;
  }
  
  currentStartDate = startDate;
  currentEndDate = endDate;
  currentTimePeriod = null;
  
  if (currentMonitorId) {
    const monitorResponse = axios.get(`/admin/api/targets/${currentMonitorId}`).then(res => {
      loadMonitorStatistics(currentMonitorId, res.data.target?.timeout || 30);
    });
  }
}

// Navigate time period (previous/next)
function navigateTimePeriod(direction) {
  if (currentTimePeriod) {
    // For fixed periods, shift the window
    // This is a simple implementation - you could make it more sophisticated
    showNotification('Time navigation for fixed periods coming soon', 'error');
  } else if (currentStartDate && currentEndDate) {
    // For custom ranges, shift by the range duration
    const start = new Date(currentStartDate);
    const end = new Date(currentEndDate);
    const duration = end - start;
    
    if (direction < 0) {
      // Previous period
      end.setTime(start.getTime() - 1);
      start.setTime(start.getTime() - duration);
    } else {
      // Next period
      start.setTime(end.getTime() + 1);
      end.setTime(start.getTime() + duration);
    }
    
    currentStartDate = start.toISOString().split('T')[0];
    currentEndDate = end.toISOString().split('T')[0];
    
    document.getElementById('startDate').value = currentStartDate;
    document.getElementById('endDate').value = currentEndDate;
    
    if (currentMonitorId) {
      const monitorResponse = axios.get(`/admin/api/targets/${currentMonitorId}`).then(res => {
        loadMonitorStatistics(currentMonitorId, res.data.target?.timeout || 30);
      });
    }
  }
}

// Load monitor statistics and draw chart
async function loadMonitorStatistics(targetId, timeout = 30) {
  try {
    // Determine days based on current chart period
    let days = 1;
    if (currentChartPeriod === '1h') {
      days = 0.04; // 1 hour = 1/24 days
    } else if (currentChartPeriod === '7d') {
      days = 7;
    } else if (currentChartPeriod === '30d') {
      days = 30;
    } else if (currentChartPeriod === 'all') {
      days = 90;
    }
    
    // Load statistics for chart
    const statsResponse = await axios.get(`/admin/api/targets/${targetId}/statistics?days=${days}`);
    const stats = statsResponse.data.statistics || [];

    // Load monitor details for status and protocol
    const monitorResponse = await axios.get(`/admin/api/targets/${targetId}`);
    const monitor = monitorResponse.data.target;
    const isUp = monitor.currentStatus === 'up';

    // Load uptime data for 24h and 30d
    const uptime24hRes = await axios.get(`/admin/api/targets/${targetId}/uptime?days=1`);
    const uptime30dRes = await axios.get(`/admin/api/targets/${targetId}/uptime?days=30`);

    const uptime24h = parseFloat(uptime24hRes.data.uptime || 0);
    const uptime30d = parseFloat(uptime30dRes.data.uptime || 0);
    const totalPings = uptime30dRes.data.totalPings || 0;
    const successfulPings = uptime30dRes.data.successfulPings || 0;
    const failedPings = totalPings - successfulPings;

    // Update stats displays
    document.getElementById('currentStatusDisplay').textContent = isUp ? '✓ UP' : '✗ DOWN';
    document.getElementById('currentStatusDisplay').className = `text-lg font-bold mt-1 ${isUp ? 'text-green-400' : 'text-red-400'}`;
    document.getElementById('uptime24hDisplay').textContent = `${uptime24h.toFixed(2)}%`;
    document.getElementById('uptime30dDisplay').textContent = `${uptime30d.toFixed(2)}%`;
    document.getElementById('protocolDisplay').textContent = monitor.protocol || '--';
    document.getElementById('totalPingsDisplay').textContent = totalPings;
    document.getElementById('successfulPingsDisplay').textContent = successfulPings;
    document.getElementById('failedPingsDisplay').textContent = failedPings;

    // Update legacy displays
    document.getElementById('monitorUptime').textContent = `${uptime24h.toFixed(2)}%`;
    document.getElementById('monitorStatus').textContent = isUp ? 'Up' : 'Down';
    document.getElementById('monitorStatus').className = isUp ? 'text-green-400' : 'text-red-400';
    
    const latestStat = stats.length > 0 ? stats[stats.length - 1] : null;
    const currentPing = latestStat?.lastResponseTime || 0;
    document.getElementById('monitorPing').textContent = currentPing > 0 ? `${currentPing.toFixed(2)} ms` : '--';
    
    // Calculate average ping
    let totalResponseTime = 0;
    let responseTimeCount = 0;
    stats.forEach(stat => {
      if (stat.avgResponseTime && stat.totalPings) {
        totalResponseTime += stat.avgResponseTime * stat.totalPings;
        responseTimeCount += stat.totalPings;
      }
    });
    const avgPing = responseTimeCount > 0 ? totalResponseTime / responseTimeCount : 0;
    document.getElementById('monitorAvgPing').textContent = avgPing > 0 ? `${avgPing.toFixed(2)} ms` : '--';

    // Generate uptime block indicator
    generateUptimeBlocks(stats);

    // Draw chart (matching public UI style)
    drawStatusChart(stats, null, timeout * 1000);
  } catch (error) {
    console.error('Error loading statistics:', error);
    document.getElementById('monitorUptime').textContent = '--';
    document.getElementById('monitorPing').textContent = '--';
    document.getElementById('monitorAvgPing').textContent = '--';
    document.getElementById('uptimeBlocksLabel').textContent = 'Error loading data';
    drawStatusChart([], null, 30000);
    generateUptimeBlocks([]);
  }
}

// Generate uptime block indicator (simplified for admin UI)
function generateUptimeBlocks(stats) {
  const blocksContainer = document.getElementById('uptimeBlocks');
  const labelElement = document.getElementById('uptimeBlocksLabel');
  const titleElement = document.getElementById('uptimeBlocksTitle');
  
  blocksContainer.innerHTML = '';

  if (stats.length === 0) {
    labelElement.textContent = 'No data available';
    titleElement.textContent = 'Uptime Overview';
    return;
  }

  // Show last 30 days of uptime blocks
  const now = new Date();
  const blocks = [];
  let upCount = 0;
  let totalCount = 0;

  for (let i = 29; i >= 0; i--) {
    const dayStart = new Date(now);
    dayStart.setDate(now.getDate() - i);
    dayStart.setHours(0, 0, 0, 0);
    const dayEnd = new Date(dayStart);
    dayEnd.setDate(dayStart.getDate() + 1);

    // Find statistics for this day
    const dayStats = stats.filter(stat => {
      const statDate = new Date(stat.date);
      return statDate >= dayStart && statDate < dayEnd;
    });

    let isUp = true;
    if (dayStats.length > 0) {
      const totalPings = dayStats.reduce((sum, s) => sum + (s.totalPings || 0), 0);
      const successfulPings = dayStats.reduce((sum, s) => sum + (s.successfulPings || 0), 0);
      isUp = totalPings === 0 || (successfulPings / totalPings) >= 0.5;
    } else {
      if (dayStart > now) {
        isUp = null; // Future day
      } else {
        isUp = null; // No data
      }
    }

    blocks.push({
      period: dayStart,
      isUp: isUp
    });

    if (isUp === true) upCount++;
    if (isUp !== null) totalCount++;
  }

  // Generate blocks
  blocks.forEach((block) => {
    const blockEl = document.createElement('div');
    blockEl.className = 'uptime-block';
    
    const titleText = block.period.toLocaleDateString([], { month: 'short', day: 'numeric' });
    
    if (block.isUp === null) {
      blockEl.classList.add('unknown');
      blockEl.title = `${titleText} - No data`;
    } else if (block.isUp) {
      blockEl.classList.add('up');
      blockEl.title = `${titleText} - Up`;
    } else {
      blockEl.classList.add('down');
      blockEl.title = `${titleText} - Down`;
    }

    blocksContainer.appendChild(blockEl);
  });

  // Update label
  if (totalCount > 0) {
    const uptimePercent = (upCount / totalCount) * 100;
    labelElement.textContent = `${upCount}/${totalCount} days up (${uptimePercent.toFixed(1)}%)`;
  } else {
    labelElement.textContent = 'No data available';
  }
  titleElement.textContent = '30-Day Uptime';
}

// Draw status chart with real data (matching public UI style)
function drawStatusChart(stats, testResult = null, timeoutMs = 30000) {
  const ctx = document.getElementById('statusChart').getContext('2d');

  // Destroy existing chart
  if (statusChart) {
    statusChart.destroy();
  }

  if (stats.length === 0 && !testResult) {
    statusChart = new Chart(ctx, {
      type: 'line',
      data: { labels: [], datasets: [] },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { enabled: false }
        }
      }
    });
    return;
  }

  // Sort stats by date
  const sortedStats = [...stats].sort((a, b) => new Date(a.date) - new Date(b.date));
  
  // Generate labels based on period
  const labels = sortedStats.map(stat => {
    const date = new Date(stat.date);
    if (currentChartPeriod === '1h' || currentChartPeriod === '24h') {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  });

  const responseTimeData = [];
  const downData = [];

  sortedStats.forEach(stat => {
    // Add response time data
    const avgResponseTime = stat.avgResponseTime || 0;
    responseTimeData.push(avgResponseTime);

    // Add downtime indicator
    const isDown = stat.successfulPings === 0;
    downData.push(isDown ? 100 : null);
  });

  // Add test result if provided
  if (testResult && sortedStats.length > 0) {
    const lastIndex = responseTimeData.length - 1;
    if (testResult.success && testResult.responseTime) {
      responseTimeData[lastIndex] = testResult.responseTime;
      downData[lastIndex] = null;
    } else {
      responseTimeData[lastIndex] = 0;
      downData[lastIndex] = 100;
    }
  }

  statusChart = new Chart(ctx, {
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
          pointRadius: currentChartPeriod === '1h' || currentChartPeriod === '24h' ? 4 : 0,
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
          data: downData,
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
                return `${pingTag} ${value.toFixed(2)} ms`;
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
              return value + ' ms';
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
          grid: { 
            color: 'rgba(255, 255, 255, 0.05)', 
            drawBorder: false 
          },
          ticks: { 
            color: '#94a3b8', 
            maxRotation: 45, 
            minRotation: 0, 
            font: { size: 10, weight: '500' },
            padding: 8
          },
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
}

// Update protocol settings visibility
function updateProtocolSettings() {
  const protocolElement = getFormElement('editProtocol');
  if (!protocolElement) return;
  
  const protocol = protocolElement.value;
  
  // Find the form container (desktop, modal, or mobile)
  const formContainer = protocolElement.closest('form') || protocolElement.closest('#editFormModal') || document.getElementById('editFormContainer');
  if (!formContainer) return;
  
  const httpSection = formContainer.querySelector('#httpOptionsSection');
  const authSection = formContainer.querySelector('#authSection');

  if (httpSection && authSection) {
    if (protocol === 'HTTP' || protocol === 'HTTPS') {
      httpSection.classList.remove('hidden');
      authSection.classList.remove('hidden');
    } else {
      httpSection.classList.add('hidden');
      authSection.classList.add('hidden');
    }
  }
}

// Update auth fields visibility
function updateAuthFields() {
  const authMethodElement = getFormElement('editAuthMethod');
  if (!authMethodElement) return;
  
  const authMethod = authMethodElement.value;
  
  // Find the form container (desktop, modal, or mobile)
  const formContainer = authMethodElement.closest('form') || authMethodElement.closest('#editFormModal') || document.getElementById('editFormContainer');
  if (!formContainer) return;
  
  const basicFields = formContainer.querySelector('#basicAuthFields');
  const bearerFields = formContainer.querySelector('#bearerAuthFields');

  if (basicFields && bearerFields) {
    basicFields.classList.add('hidden');
    bearerFields.classList.add('hidden');

    if (authMethod === 'basic') {
      basicFields.classList.remove('hidden');
    } else if (authMethod === 'bearer') {
      bearerFields.classList.remove('hidden');
    }
  }
}

// Delete monitor
async function deleteMonitor() {
  if (!currentMonitorId) {
    showNotification('No monitor selected', 'error');
    return;
  }

  if (!confirm('Are you sure you want to delete this monitor?')) {
    return;
  }

  try {
    await axios.delete(`/admin/api/targets/${currentMonitorId}`);
    showNotification('Monitor deleted successfully', 'success');
    cancelEdit();
    loadMonitors();
  } catch (error) {
    console.error('Error deleting monitor:', error);
    showNotification(error.response?.data?.error || 'Error deleting monitor', 'error');
  }
}

// Add new monitor
function addNewMonitor() {
  currentMonitorId = null;
  document.getElementById('editForm').reset();
  
  // Set defaults
  document.getElementById('editProtocol').value = 'ICMP';
  document.getElementById('editInterval').value = '60';
  document.getElementById('editEnabled').checked = true;
  document.getElementById('editRetries').value = '0';
  document.getElementById('editRetryInterval').value = '5';
  document.getElementById('editHttpMethod').value = 'GET';
  document.getElementById('editTimeout').value = '30';
  document.getElementById('editStatusCodes').value = '200-299';
  document.getElementById('editMaxRedirects').value = '5';
  document.getElementById('editPosition').value = '0';
  document.getElementById('editAuthMethod').value = 'none';

  // Update protocol settings
  updateProtocolSettings();
  updateAuthFields();

  // Update monitor list selection
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.classList.remove('selected');
  });

  // Hide clone button for new monitor
  const cloneBtn = document.getElementById('cloneMonitorBtn');
  if (cloneBtn) {
    cloneBtn.style.display = 'none';
  }

  // Open edit modal
  openEditMonitor();
}

// Show clone monitor confirmation modal
function showCloneMonitorConfirm() {
  if (!currentMonitorId) {
    showNotification('No monitor selected', 'error');
    return;
  }

  const monitorName = document.getElementById('monitorName')?.textContent || 'Monitor';
  document.getElementById('cloneMonitorName').textContent = monitorName;
  
  const modal = document.getElementById('cloneMonitorModal');
  modal.classList.add('active');
}

// Close clone monitor modal
function closeCloneMonitorModal() {
  const modal = document.getElementById('cloneMonitorModal');
  modal.classList.remove('active');
}

// Find available clone name
async function findAvailableCloneName(baseName, existingNames) {
  let cloneName = `${baseName} (clone)`;
  let counter = 1;
  
  while (existingNames.includes(cloneName)) {
    counter++;
    cloneName = `${baseName} (clone ${counter})`;
  }
  
  return cloneName;
}

// Confirm and clone monitor
async function confirmCloneMonitor() {
  if (!currentMonitorId) {
    showNotification('No monitor selected', 'error');
    return;
  }

  try {
    // Get current monitor data
    const response = await axios.get(`/admin/api/targets/${currentMonitorId}`);
    const monitor = response.data.target;
    
    // Get all existing monitor names
    const dashboardResponse = await axios.get('/admin/api/dashboard');
    const existingNames = dashboardResponse.data.dashboard.targets.map(t => t.name);
    
    // Find available clone name
    const cloneName = await findAvailableCloneName(monitor.name, existingNames);
    
    // Prepare clone data (same settings, but disabled and no data points)
    const cloneData = {
      name: cloneName,
      host: monitor.host || '',
      protocol: monitor.protocol || 'ICMP',
      port: monitor.port || null,
      interval: monitor.interval || 60,
      enabled: false, // Disabled by default
      publicVisible: monitor.publicVisible !== false,
      publicShowDetails: monitor.publicShowDetails === true,
      group: monitor.group || null,
      appUrl: monitor.appUrl || null,
      appIcon: monitor.appIcon || null,
      retries: monitor.retries || 0,
      retryInterval: monitor.retryInterval || 5,
      timeout: monitor.timeout || 30,
      httpMethod: monitor.httpMethod || 'GET',
      statusCodes: monitor.statusCodes || '200-299',
      maxRedirects: monitor.maxRedirects || 5,
      ignoreSsl: monitor.ignoreSsl || false,
      upsideDown: monitor.upsideDown || false,
      position: monitor.position || 0,
      quickCommands: monitor.quickCommands || [],
      auth: monitor.auth || null
    };

    // Create the cloned monitor
    const createResponse = await axios.post('/admin/api/targets', cloneData);
    const newMonitorId = createResponse.data.targetId;

    // Close modal
    closeCloneMonitorModal();

    // Show success notification
    showNotification('Monitor cloned successfully', 'success');

    // Reload monitors and select the new one
    await loadMonitors();
    const newMonitorResponse = await axios.get(`/admin/api/targets/${newMonitorId}`);
    await selectMonitor(newMonitorResponse.data.target);
  } catch (error) {
    console.error('Error cloning monitor:', error);
    showNotification(error.response?.data?.error || 'Error cloning monitor', 'error');
  }
}

// Helper to get form element (works for both desktop, mobile, and modal)
function getFormElement(id) {
  // Check if modal is active first (prioritize modal form)
  const editModal = document.getElementById('editMonitorModal');
  if (editModal && editModal.classList.contains('active')) {
    const modalForm = document.querySelector('#editFormModal');
    if (modalForm) {
      const element = modalForm.querySelector(`#${id}`);
      if (element) return element;
    }
  }
  
  // Check if mobile panel is open
  const settingsPanel = document.getElementById('settingsPanel');
  if (settingsPanel && settingsPanel.classList.contains('open')) {
    const mobileForm = document.querySelector('#editFormMobileContainer #editForm');
    if (mobileForm) {
      const element = mobileForm.querySelector(`#${id}`);
      if (element) return element;
    }
  }
  
  // Fall back to desktop form
  return document.getElementById(id);
}

// Handle edit button click - mobile uses panel, desktop uses modal
function handleEditClick() {
  // Check if we're on mobile (viewport width < 1024px)
  if (window.innerWidth < 1024) {
    toggleEditPanel();
  } else {
    openEditMonitor();
  }
}

// Open edit monitor modal (desktop)
function openEditMonitor() {
  const modal = document.getElementById('editMonitorModal');
  const modalContainer = document.getElementById('editFormModal');
  const desktopForm = document.getElementById('editForm');
  
  if (desktopForm && modalContainer) {
    // Clone entire form to modal
    modalContainer.innerHTML = desktopForm.outerHTML;
    
    // Re-attach event listeners and copy values from desktop form
    const clonedForm = modalContainer.querySelector('#editForm');
    if (clonedForm) {
      // Copy all form values from desktop form to modal form
      const formFields = [
        'editName', 'editHost', 'editProtocol', 'editPort', 'editInterval', 
        'editGroup', 'editAppUrl', 'editAppIcon', 'editRetries', 'editRetryInterval',
        'editHttpMethod', 'editTimeout', 'editStatusCodes', 'editMaxRedirects',
        'editPosition', 'editQuickCommands', 'editAuthMethod', 'editAuthUsername',
        'editAuthPassword', 'editAuthToken', 'editEnabled', 'editIgnoreSsl', 
        'editUpsideDown', 'editPublicVisible'
      ];
      
      formFields.forEach(fieldId => {
        const desktopField = desktopForm.querySelector(`#${fieldId}`);
        const modalField = clonedForm.querySelector(`#${fieldId}`);
        if (desktopField && modalField) {
          if (desktopField.type === 'checkbox') {
            modalField.checked = desktopField.checked;
          } else {
            modalField.value = desktopField.value;
          }
        }
      });
      
      // Re-attach event listeners
      const protocolSelect = clonedForm.querySelector('#editProtocol');
      const authSelect = clonedForm.querySelector('#editAuthMethod');
      if (protocolSelect) {
        protocolSelect.onchange = updateProtocolSettings;
        // Update protocol settings visibility in modal
        updateProtocolSettings();
      }
      if (authSelect) {
        authSelect.onchange = updateAuthFields;
        // Update auth fields visibility in modal
        updateAuthFields();
      }
    }
    
    // Update modal title
    if (currentMonitorId) {
      const monitorName = document.getElementById('monitorName')?.textContent || 'Monitor';
      document.getElementById('editMonitorModalTitle').textContent = `Edit ${monitorName}`;
    } else {
      document.getElementById('editMonitorModalTitle').textContent = 'Add New Monitor';
    }
    
    // Show modal
    modal.classList.add('active');
    
    // Focus on name field
    setTimeout(() => {
      const nameField = modalContainer.querySelector('#editName');
      if (nameField) nameField.focus();
    }, 100);
  }
}

// Close edit monitor modal
function closeEditMonitorModal() {
  const modal = document.getElementById('editMonitorModal');
  modal.classList.remove('active');
}

// Save monitor
async function saveMonitor() {
  const data = {
    name: getFormElement('editName')?.value || '',
    host: getFormElement('editHost')?.value || '',
    protocol: getFormElement('editProtocol')?.value || 'ICMP',
    port: getFormElement('editPort')?.value ? parseInt(getFormElement('editPort').value) : null,
    interval: parseInt(getFormElement('editInterval')?.value) || 60,
    enabled: getFormElement('editEnabled')?.checked !== false,
    group: getFormElement('editGroup')?.value || null,
    appUrl: getFormElement('editAppUrl')?.value || null,
    appIcon: getFormElement('editAppIcon')?.value || null,
    retries: parseInt(getFormElement('editRetries')?.value) || 0,
    retryInterval: parseInt(getFormElement('editRetryInterval')?.value) || 5,
    timeout: parseInt(getFormElement('editTimeout')?.value) || 30,
    httpMethod: getFormElement('editHttpMethod')?.value || 'GET',
    statusCodes: getFormElement('editStatusCodes')?.value || '200-299',
    maxRedirects: parseInt(getFormElement('editMaxRedirects')?.value) || 5,
    ignoreSsl: getFormElement('editIgnoreSsl')?.checked || false,
    upsideDown: getFormElement('editUpsideDown')?.checked || false,
    position: parseInt(getFormElement('editPosition')?.value) || 0,
    quickCommands: getFormElement('editQuickCommands')?.value
      ? getFormElement('editQuickCommands').value.split(',').map(cmd => cmd.trim()).filter(cmd => cmd)
      : []
  };

  // Add authentication if set
  const authMethod = getFormElement('editAuthMethod')?.value;
  if (authMethod === 'basic') {
    data.auth = {
      type: 'basic',
      username: getFormElement('editAuthUsername')?.value || '',
      password: getFormElement('editAuthPassword')?.value || ''
    };
  } else if (authMethod === 'bearer') {
    data.auth = {
      type: 'bearer',
      token: getFormElement('editAuthToken')?.value || ''
    };
  }

  // Validate
  if (!data.name || !data.host) {
    showNotification('Please fill in all required fields', 'error');
    return;
  }

  try {
    if (currentMonitorId) {
      // Update existing
      await axios.put(`/admin/api/targets/${currentMonitorId}`, data);
      showNotification('Monitor updated successfully', 'success');
    } else {
      // Create new
      const response = await axios.post('/admin/api/targets', data);
      currentMonitorId = response.data.targetId;
      showNotification('Monitor created successfully', 'success');
    }
    
    // Close mobile panel if open
    if (editPanelOpen) {
      toggleEditPanel();
    }
    
    // Close edit modal if open
    const editModal = document.getElementById('editMonitorModal');
    if (editModal && editModal.classList.contains('active')) {
      closeEditMonitorModal();
    }

    // Reload monitors and refresh current selection
    await loadMonitors();
    if (currentMonitorId) {
      const response = await axios.get(`/admin/api/targets/${currentMonitorId}`);
      await selectMonitor(response.data.target);
    }
  } catch (error) {
    console.error('Error saving monitor:', error);
    showNotification(error.response?.data?.error || 'Error saving monitor', 'error');
  }
}

// Helper to get favicon URL
function getFaviconUrl(appUrl) {
  if (!appUrl) return null;
  try {
    const url = new URL(appUrl);
    return `${url.protocol}//${url.host}/favicon.ico`;
  } catch (e) {
    return null;
  }
}

// Test monitor and update graph instantly
async function testMonitor() {
  if (!currentMonitorId) {
    showNotification('No monitor selected', 'error');
    return;
  }

  try {
    const response = await axios.post(`/admin/api/targets/${currentMonitorId}/test`);
    const result = response.data.result;

    // Update status immediately
    const status = result.success ? 'Up' : 'Down';
    const statusColor = result.success ? 'text-green-400' : 'text-red-400';
    document.getElementById('monitorStatus').textContent = status;
    document.getElementById('monitorStatus').className = statusColor;

    // Update ping displays
    if (result.success && result.responseTime) {
      document.getElementById('monitorPing').textContent = `${result.responseTime.toFixed(2)} ms`;
      // Update average if we have it
      const currentAvg = document.getElementById('monitorAvgPing').textContent;
      if (currentAvg !== '--') {
        // Keep current average for now, or recalculate if needed
      }
    } else {
      document.getElementById('monitorPing').textContent = '--';
    }

    // Reload statistics to get updated chart data
    const statsResponse = await axios.get(`/admin/api/targets/${currentMonitorId}/statistics?days=1`);
    const stats = statsResponse.data.statistics || [];

    // Get monitor timeout
    const monitorResponse = await axios.get(`/admin/api/targets/${currentMonitorId}`);
    const timeoutMs = (monitorResponse.data.target?.timeout || 30) * 1000;

    // Draw chart with test result added
    drawStatusChart(stats, result, timeoutMs);

    // Update monitor list status
    const card = document.querySelector(`[data-monitor-id="${currentMonitorId}"]`);
    if (card) {
      const badge = card.querySelector('.status-badge');
      if (badge) {
        badge.className = `status-badge ${result.success ? 'up' : 'down'}`;
        badge.innerHTML = `
          <span class="w-2 h-2 rounded-full ${result.success ? 'bg-green-400' : 'bg-red-400'}"></span>
          ${result.success ? 'Up' : 'Down'}
        `;
      }
    }

    if (result.success) {
      showNotification(`Test successful: ${result.responseTime?.toFixed(2)}ms`, 'success');
    } else {
      showNotification(`Test failed: ${result.error || 'Connection failed'}`, 'error');
    }
  } catch (error) {
    console.error('Error testing monitor:', error);
    showNotification('Error testing monitor', 'error');
  }
}

// Cancel edit
function cancelEdit() {
  // Close edit modal if open
  const editModal = document.getElementById('editMonitorModal');
  if (editModal && editModal.classList.contains('active')) {
    closeEditMonitorModal();
    return; // Don't clear selection if just closing modal
  }
  
  currentMonitorId = null;
  document.getElementById('monitorDetails').classList.add('hidden');
  document.getElementById('emptyState').classList.remove('hidden');
  const desktopForm = document.getElementById('editForm');
  if (desktopForm) {
    desktopForm.reset();
  }

  // Remove selection from all cards
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.classList.remove('selected');
  });
}

// Load incidents
async function loadIncidents() {
  try {
    const response = await axios.get('/admin/api/incidents');
    const incidents = response.data.incidents || [];

    const incidentsList = document.getElementById('incidentsList');
    incidentsList.innerHTML = '';

    if (incidents.length === 0) {
      incidentsList.innerHTML = '<p class="text-slate-400 text-center py-8">No incidents recorded</p>';
      return;
    }

    incidents.forEach(incident => {
      const card = document.createElement('div');
      card.className = 'bg-slate-900/50 backdrop-blur rounded-lg p-4 border border-slate-700/30';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-semibold">${incident.title}</h4>
          <span class="text-xs bg-yellow-900 text-yellow-200 px-2 py-1 rounded">${incident.status}</span>
        </div>
        <p class="text-sm text-slate-400 mb-2">${incident.description}</p>
        <p class="text-xs text-slate-500">${new Date(incident.createdAt).toLocaleString()}</p>
      `;
      incidentsList.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading incidents:', error);
    document.getElementById('incidentsList').innerHTML = '<p class="text-slate-400">Error loading incidents</p>';
  }
}

// Show create incident modal
function showCreateIncidentModal() {
  showNotification('Incident creation not yet implemented', 'error');
}

// Load posts
async function loadPosts() {
  try {
    const response = await axios.get('/admin/api/posts');
    const posts = response.data.posts || [];

    const postsList = document.getElementById('postsList');
    postsList.innerHTML = '';

    if (posts.length === 0) {
      postsList.innerHTML = '<p class="text-slate-400 text-center py-8">No posts yet. Create your first post!</p>';
      return;
    }

    posts.forEach(post => {
      const card = document.createElement('div');
      card.className = 'bg-slate-900/50 backdrop-blur rounded-lg p-4 border border-slate-700/30';
      const date = new Date(post.createdAt).toLocaleDateString('en-US', { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric' 
      });
      const publishedBadge = post.published 
        ? '<span class="text-xs bg-green-900 text-green-200 px-2 py-1 rounded">Published</span>'
        : '<span class="text-xs bg-slate-700 text-slate-300 px-2 py-1 rounded">Draft</span>';
      
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-semibold text-lg">${post.title}</h4>
          ${publishedBadge}
        </div>
        <p class="text-sm text-slate-400 mb-3 line-clamp-2">${post.content.substring(0, 150)}${post.content.length > 150 ? '...' : ''}</p>
        <div class="flex justify-between items-center">
          <p class="text-xs text-slate-500">${date}</p>
          <div class="flex gap-2">
            <button onclick="editPost('${post._id}')" class="btn-secondary text-xs px-3 py-1">
              <i class="fas fa-edit mr-1"></i>Edit
            </button>
            <button onclick="deletePost('${post._id}')" class="btn-danger text-xs px-3 py-1">
              <i class="fas fa-trash mr-1"></i>Delete
            </button>
          </div>
        </div>
      `;
      postsList.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading posts:', error);
    document.getElementById('postsList').innerHTML = '<p class="text-slate-400">Error loading posts</p>';
  }
}

// Configure marked.js for markdown rendering
if (typeof marked !== 'undefined') {
  marked.setOptions({
    breaks: true,
    gfm: true,
  });
}

let currentPostId = null;

// Show create post modal
function showCreatePostModal() {
  currentPostId = null;
  document.getElementById('postModalTitle').textContent = 'Create New Post';
  document.getElementById('postTitle').value = '';
  document.getElementById('postContent').value = '';
  document.getElementById('postPublished').checked = true;
  document.getElementById('markdownPreview').innerHTML = '<p class="text-slate-500 text-sm">Preview will appear here...</p>';
  document.getElementById('postModal').classList.add('active');
  
  // Focus on title input
  setTimeout(() => {
    document.getElementById('postTitle').focus();
  }, 100);
  
  // Setup markdown preview
  setupMarkdownPreview();
}

// Show edit post modal
async function editPost(postId) {
  try {
    const response = await axios.get(`/admin/api/posts/${postId}`);
    const post = response.data.post;

    currentPostId = postId;
    document.getElementById('postModalTitle').textContent = 'Edit Post';
    document.getElementById('postTitle').value = post.title;
    document.getElementById('postContent').value = post.content;
    document.getElementById('postPublished').checked = post.published;
    document.getElementById('postModal').classList.add('active');
    
    // Update preview immediately
    updateMarkdownPreview();
    
    // Setup markdown preview
    setupMarkdownPreview();
  } catch (error) {
    console.error('Error loading post:', error);
    showNotification('Error loading post: ' + (error.response?.data?.error || error.message), 'error');
  }
}

// Close post modal
function closePostModal() {
  document.getElementById('postModal').classList.remove('active');
  currentPostId = null;
  document.getElementById('postForm').reset();
}

// Setup markdown preview listener
function setupMarkdownPreview() {
  const contentTextarea = document.getElementById('postContent');
  if (!contentTextarea) return;

  // Remove existing listener if any
  const newTextarea = contentTextarea.cloneNode(true);
  contentTextarea.parentNode.replaceChild(newTextarea, contentTextarea);

  // Add new listener
  newTextarea.addEventListener('input', updateMarkdownPreview);
  newTextarea.addEventListener('keyup', updateMarkdownPreview);
}

// Update markdown preview
function updateMarkdownPreview() {
  const content = document.getElementById('postContent').value;
  const preview = document.getElementById('markdownPreview');
  
  if (!content.trim()) {
    preview.innerHTML = '<p class="text-slate-500 text-sm">Preview will appear here...</p>';
    return;
  }

  if (typeof marked !== 'undefined') {
    preview.innerHTML = marked.parse(content);
  } else {
    // Fallback: simple line break conversion
    preview.innerHTML = content
      .replace(/\n\n/g, '</p><p>')
      .replace(/\n/g, '<br>')
      .replace(/^/, '<p>')
      .replace(/$/, '</p>');
  }
}

// Save post (create or update)
async function savePost(event) {
  if (event) {
    event.preventDefault();
  }

  const title = document.getElementById('postTitle').value.trim();
  const content = document.getElementById('postContent').value.trim();
  const published = document.getElementById('postPublished').checked;

  if (!title || !content) {
    showNotification('Title and content are required', 'error');
    return;
  }

  try {
    if (currentPostId) {
      // Update existing post
      await axios.put(`/admin/api/posts/${currentPostId}`, {
        title,
        content,
        published
      });
      showNotification('Post updated successfully', 'success');
    } else {
      // Create new post
      await axios.post('/admin/api/posts', {
        title,
        content,
        published
      });
      showNotification('Post created successfully', 'success');
    }

    closePostModal();
    loadPosts();
  } catch (error) {
    console.error('Error saving post:', error);
    showNotification('Error saving post: ' + (error.response?.data?.error || error.message), 'error');
  }
}

// Setup form submission handler
document.addEventListener('DOMContentLoaded', () => {
  const postForm = document.getElementById('postForm');
  if (postForm) {
    postForm.addEventListener('submit', savePost);
  }
});

// Delete post
async function deletePost(postId) {
  if (!confirm('Are you sure you want to delete this post?')) return;

  try {
    await axios.delete(`/admin/api/posts/${postId}`);
    showNotification('Post deleted successfully', 'success');
    loadPosts();
  } catch (error) {
    console.error('Error deleting post:', error);
    showNotification('Error deleting post: ' + (error.response?.data?.error || error.message), 'error');
  }
}

// Close modal on escape key
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    const modal = document.getElementById('postModal');
    if (modal && modal.classList.contains('active')) {
      closePostModal();
    }
    
    const clearPingDataModal = document.getElementById('clearPingDataModal');
    if (clearPingDataModal && clearPingDataModal.classList.contains('active')) {
      closeClearPingDataModal();
    }
  }
});

// Close modal when clicking outside
document.addEventListener('click', (e) => {
  const modal = document.getElementById('postModal');
  if (modal && modal.classList.contains('active') && e.target === modal) {
    closePostModal();
  }
  
  const clearPingDataModal = document.getElementById('clearPingDataModal');
  if (clearPingDataModal && clearPingDataModal.classList.contains('active') && e.target === clearPingDataModal) {
    closeClearPingDataModal();
  }
});

// Change password
function changePassword() {
  const newPassword = prompt('Enter new password:');
  if (!newPassword) return;

  const confirmPassword = prompt('Confirm password:');
  if (newPassword !== confirmPassword) {
    showNotification('Passwords do not match', 'error');
    return;
  }

  // Note: This would require a new API endpoint to be implemented
  showNotification('Password change not yet implemented', 'error');
}

// Show notification
function showNotification(message, type = 'success') {
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;

  document.getElementById('notificationContainer').appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideIn 0.3s ease-out reverse';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Test all monitors
async function testAllMonitors() {
  const testAllBtn = document.getElementById('testAllBtn');
  const originalText = testAllBtn.innerHTML;
  
  try {
    // Get all monitors
    const response = await axios.get('/admin/api/dashboard');
    const targets = response.data.dashboard.targets;

    if (targets.length === 0) {
      showNotification('No monitors to test', 'error');
      return;
    }

    // Disable button and show loading
    testAllBtn.disabled = true;
    testAllBtn.innerHTML = '<i class="fas fa-spinner fa-spin mr-1"></i>Testing...';

    let successCount = 0;
    let failCount = 0;

    // Test all monitors in parallel
    const testPromises = targets.map(async (target) => {
      try {
        const testResponse = await axios.post(`/admin/api/targets/${target._id}/test`);
        const result = testResponse.data.result;
        
        // Update the monitor card status
        const card = document.querySelector(`[data-monitor-id="${target._id}"]`);
        if (card) {
          const badge = card.querySelector('.status-badge');
          if (badge) {
            const isSuccess = result.success;
            badge.className = `status-badge ${isSuccess ? 'up' : 'down'}`;
            badge.innerHTML = `
              <span class="w-2 h-2 rounded-full ${isSuccess ? 'bg-green-400' : 'bg-red-400'}"></span>
              ${isSuccess ? 'Up' : 'Down'}
            `;
          }
        }

        // Update current monitor if it's selected
        if (currentMonitorId === target._id) {
          const status = result.success ? 'Up' : 'Down';
          const statusColor = result.success ? 'text-green-400' : 'text-red-400';
          document.getElementById('monitorStatus').textContent = status;
          document.getElementById('monitorStatus').className = statusColor;

          if (result.success && result.responseTime) {
            document.getElementById('monitorPing').textContent = `${result.responseTime.toFixed(2)} ms`;
          }

          // Reload statistics and update chart (get timeout from monitor)
          const monitorResponse = await axios.get(`/admin/api/targets/${target._id}`);
          const monitorTimeout = monitorResponse.data.target?.timeout || 30;
          await loadMonitorStatistics(target._id, monitorTimeout);
          
          // Update uptime blocks
          const statsResponse = await axios.get(`/admin/api/targets/${target._id}/statistics?days=1`);
          const stats = statsResponse.data.statistics || [];
          generateUptimeBlocks(stats);
        }

        if (result.success) {
          successCount++;
        } else {
          failCount++;
        }
      } catch (error) {
        console.error(`Error testing monitor ${target.name}:`, error);
        failCount++;
        
        // Update card to show error
        const card = document.querySelector(`[data-monitor-id="${target._id}"]`);
        if (card) {
          const badge = card.querySelector('.status-badge');
          if (badge) {
            badge.className = 'status-badge down';
            badge.innerHTML = `
              <span class="w-2 h-2 rounded-full bg-red-400"></span>
              Down
            `;
          }
        }
      }
    });

    await Promise.all(testPromises);

    // Reload monitors list to refresh all statuses
    await loadMonitors();

    // Show summary notification
    showNotification(`Tested ${targets.length} monitors: ${successCount} up, ${failCount} down`, 
      failCount === 0 ? 'success' : 'error');

  } catch (error) {
    console.error('Error testing all monitors:', error);
    showNotification('Error testing monitors', 'error');
  } finally {
    // Re-enable button
    testAllBtn.disabled = false;
    testAllBtn.innerHTML = originalText;
  }
}

// Load visibility settings
async function loadVisibility() {
  try {
    const response = await axios.get('/admin/api/targets');
    const targets = response.data.targets;

    const visibilityList = document.getElementById('visibilityList');
    visibilityList.innerHTML = '';

    if (targets.length === 0) {
      visibilityList.innerHTML = '<p class="text-slate-400 text-sm">No monitors found</p>';
      return;
    }

    // Sort by name
    targets.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    targets.forEach(target => {
      const isPublic = target.publicVisible !== false; // Default to true if not set
      const showDetails = target.publicShowDetails === true; // Default to false
      const hasAppUrl = target.appUrl && target.appUrl.trim() !== '';
      
      const item = document.createElement('div');
      item.className = 'flex flex-col gap-3 p-4 bg-slate-800/50 rounded-lg border border-slate-700/30';
      item.innerHTML = `
        <div class="flex-1 min-w-0">
          <div class="flex items-center gap-3">
            <h4 class="font-semibold text-white">${target.name}</h4>
            ${hasAppUrl ? '<span class="text-xs text-cyan-400 bg-cyan-400/10 px-2 py-1 rounded">App Link</span>' : ''}
            ${!target.enabled ? '<span class="text-xs text-slate-400 bg-slate-700/50 px-2 py-1 rounded">Disabled</span>' : ''}
          </div>
          <p class="text-sm text-slate-400 mt-1">${target.host}${target.port ? ':' + target.port : ''} (${target.protocol})</p>
        </div>
        <div class="flex items-center justify-between gap-4">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" 
                   class="checkbox-input" 
                   ${isPublic ? 'checked' : ''} 
                   onchange="toggleMonitorVisibility('${target._id}', this.checked)">
            <span class="text-sm text-slate-300">Publicly Visible</span>
          </label>
          ${isPublic ? `
            <label class="flex items-center gap-3 cursor-pointer">
              <input type="checkbox" 
                     class="checkbox-input" 
                     ${showDetails ? 'checked' : ''} 
                     onchange="toggleMonitorDetails('${target._id}', this.checked)">
              <span class="text-sm text-slate-300">Show Technical Details</span>
            </label>
          ` : ''}
        </div>
      `;
      visibilityList.appendChild(item);
    });
  } catch (error) {
    console.error('Error loading visibility settings:', error);
    showNotification('Error loading visibility settings', 'error');
  }
}

// Toggle monitor visibility
async function toggleMonitorVisibility(targetId, isPublic) {
  try {
    await axios.put(`/admin/api/targets/${targetId}`, {
      publicVisible: isPublic
    });
    showNotification(`Monitor visibility updated to ${isPublic ? 'public' : 'private'}`, 'success');
    // Reload to update UI (show/hide details checkbox)
    loadVisibility();
  } catch (error) {
    console.error('Error updating monitor visibility:', error);
    showNotification(error.response?.data?.error || 'Error updating visibility', 'error');
    // Reload to reset checkbox state
    loadVisibility();
  }
}

// Toggle monitor technical details visibility
async function toggleMonitorDetails(targetId, showDetails) {
  try {
    await axios.put(`/admin/api/targets/${targetId}`, {
      publicShowDetails: showDetails
    });
    showNotification(`Technical details visibility ${showDetails ? 'enabled' : 'disabled'}`, 'success');
  } catch (error) {
    console.error('Error updating technical details visibility:', error);
    showNotification(error.response?.data?.error || 'Error updating details visibility', 'error');
    // Reload to reset checkbox state
    loadVisibility();
  }
}

// Logout
function logout() {
  axios.get('/admin/logout').then(() => {
    window.location.href = '/admin/login';
  });
}

// Load public UI settings
async function loadPublicUISettings() {
  try {
    const response = await axios.get('/admin/api/public-ui-settings');
    const settings = response.data.settings;

    if (settings) {
      const title = settings.title || 'Homelab';
      const publicUITitleEl = document.getElementById('publicUITitle');
      if (publicUITitleEl) {
        publicUITitleEl.value = title;
      }
      const publicUISubtitleEl = document.getElementById('publicUISubtitle');
      if (publicUISubtitleEl) {
        publicUISubtitleEl.value = settings.subtitle || 'System Status & Application Dashboard';
      }
      const publicUICustomCSSEl = document.getElementById('publicUICustomCSS');
      if (publicUICustomCSSEl) {
        publicUICustomCSSEl.value = settings.customCSS || '';
      }
      
      // Update header title
      updateAdminHeaderTitle(title);
    } else {
      // No settings, use default
      updateAdminHeaderTitle('LocalPing');
    }

    // Also load admin settings
    await loadAdminSettings();
  } catch (error) {
    console.error('Error loading public UI settings:', error);
    // Don't show notification on initial load error, just use default
    updateAdminHeaderTitle('LocalPing');
    // Still try to load admin settings
    await loadAdminSettings();
  }
}

// Load admin settings
async function loadAdminSettings() {
  try {
    const response = await axios.get('/admin/api/admin-settings');
    const settings = response.data.settings;
    const dbSize = response.data.dbSize || 0;

    if (settings) {
      const sessionDurationEl = document.getElementById('sessionDurationDays');
      if (sessionDurationEl) {
        sessionDurationEl.value = settings.sessionDurationDays || 30;
      }
      const dataRetentionEl = document.getElementById('dataRetentionDays');
      if (dataRetentionEl) {
        dataRetentionEl.value = settings.dataRetentionDays || 30;
      }
    }

    // Update database size display
    const dbSizeEl = document.getElementById('databaseSize');
    if (dbSizeEl) {
      dbSizeEl.textContent = formatFileSize(dbSize);
    }
  } catch (error) {
    console.error('Error loading admin settings:', error);
  }
}

// Format file size to human-readable format
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Save admin settings
async function saveAdminSettings() {
  try {
    const sessionDurationEl = document.getElementById('sessionDurationDays');
    const dataRetentionEl = document.getElementById('dataRetentionDays');
    const sessionDurationDays = sessionDurationEl ? parseInt(sessionDurationEl.value, 10) : 30;
    const dataRetentionDays = dataRetentionEl ? parseInt(dataRetentionEl.value, 10) : 30;

    if (isNaN(sessionDurationDays) || sessionDurationDays < 1 || sessionDurationDays > 365) {
      showNotification('Session duration must be between 1 and 365 days', 'error');
      return;
    }

    if (isNaN(dataRetentionDays) || dataRetentionDays < 1 || dataRetentionDays > 3650) {
      showNotification('Data retention must be between 1 and 3650 days', 'error');
      return;
    }

    await axios.put('/admin/api/admin-settings', {
      sessionDurationDays: sessionDurationDays,
      dataRetentionDays: dataRetentionDays
    });

    showNotification('Admin settings saved successfully', 'success');
  } catch (error) {
    console.error('Error saving admin settings:', error);
    showNotification(error.response?.data?.error || 'Error saving admin settings', 'error');
  }
}

// Update admin header title
function updateAdminHeaderTitle(customTitle) {
  const headerTitle = document.getElementById('adminHeaderTitle');
  if (headerTitle) {
    if (customTitle && customTitle !== 'Homelab' && customTitle !== 'LocalPing') {
      headerTitle.textContent = `${customTitle} Admin`;
    } else {
      headerTitle.textContent = 'LocalPing Admin';
    }
  }
}

// Save public UI settings
async function savePublicUISettings() {
  try {
    const data = {
      title: document.getElementById('publicUITitle').value || 'Homelab',
      subtitle: document.getElementById('publicUISubtitle').value || 'System Status & Application Dashboard',
      customCSS: document.getElementById('publicUICustomCSS').value || null,
    };

    await axios.put('/admin/api/public-ui-settings', data);
    showNotification('Public UI settings saved successfully', 'success');
    
    // Update header title
    updateAdminHeaderTitle(data.title);
  } catch (error) {
    console.error('Error saving public UI settings:', error);
    showNotification(error.response?.data?.error || 'Error saving public UI settings', 'error');
  }
}

// Preview public UI
function previewPublicUI() {
  window.open('/', '_blank');
}

// Show clear ping data warning modal
function showClearPingDataWarning() {
  document.getElementById('clearPingDataModal').classList.add('active');
}

// Close clear ping data modal
function closeClearPingDataModal() {
  document.getElementById('clearPingDataModal').classList.remove('active');
}

// Confirm and clear all ping data
async function confirmClearPingData() {
  try {
    const response = await axios.post('/admin/api/clear-ping-data');
    if (response.data.success) {
      showNotification('All ping data cleared successfully', 'success');
      closeClearPingDataModal();
      
      // Reload monitors to refresh statistics
      if (currentMonitorId) {
        await loadMonitorStatistics(currentMonitorId);
      }
    } else {
      showNotification(response.data.error || 'Error clearing ping data', 'error');
    }
  } catch (error) {
    console.error('Error clearing ping data:', error);
    showNotification(error.response?.data?.error || 'Error clearing ping data', 'error');
  }
}

// Toggle edit panel (mobile)
function toggleEditPanel() {
  const panel = document.getElementById('settingsPanel');
  const overlay = document.getElementById('settingsOverlay');
  const desktopContainer = document.getElementById('editFormContainer');
  const mobileContainer = document.getElementById('editFormMobileContainer');
  
  editPanelOpen = !editPanelOpen;
  
  if (editPanelOpen) {
    panel.classList.add('open');
    overlay.classList.add('active');
    // Clone form content to mobile container
    if (desktopContainer && mobileContainer) {
      const form = desktopContainer.querySelector('#editForm');
      if (form) {
        mobileContainer.innerHTML = form.outerHTML;
        // Re-attach event listeners to cloned form
        const clonedForm = mobileContainer.querySelector('#editForm');
        if (clonedForm) {
          const protocolSelect = clonedForm.querySelector('#editProtocol');
          const authSelect = clonedForm.querySelector('#editAuthMethod');
          if (protocolSelect) protocolSelect.onchange = updateProtocolSettings;
          if (authSelect) authSelect.onchange = updateAuthFields;
        }
      }
    }
  } else {
    panel.classList.remove('open');
    overlay.classList.remove('active');
  }
}

// Attach form listeners for protocol and auth changes
function attachFormListeners() {
  const protocolSelect = document.getElementById('editProtocol');
  const authSelect = document.getElementById('editAuthMethod');
  
  if (protocolSelect) {
    protocolSelect.onchange = updateProtocolSettings;
  }
  if (authSelect) {
    authSelect.onchange = updateAuthFields;
  }
}

// ============ BACKUP FUNCTIONS ============

// Toggle export options based on full backup checkbox
function toggleExportOptions() {
  const fullBackup = document.getElementById('exportFull').checked;
  const exportOptions = document.getElementById('exportOptions');
  const checkboxes = exportOptions.querySelectorAll('input[type="checkbox"]');
  
  if (fullBackup) {
    checkboxes.forEach(cb => {
      cb.checked = true;
      cb.disabled = true;
    });
  } else {
    checkboxes.forEach(cb => {
      cb.disabled = false;
    });
  }
}

// Export backup
async function exportBackup() {
  try {
    const fullBackup = document.getElementById('exportFull').checked;
    const exportOptions = {
      full: fullBackup,
      monitors: document.getElementById('exportMonitors').checked,
      incidents: document.getElementById('exportIncidents').checked,
      posts: document.getElementById('exportPosts').checked,
      dataPoints: document.getElementById('exportDataPoints').checked,
      actions: document.getElementById('exportActions').checked,
      alerts: document.getElementById('exportAlerts').checked,
      settings: document.getElementById('exportSettings').checked,
      favicons: document.getElementById('exportFavicons').checked,
    };

    // Check if at least one option is selected
    if (!fullBackup && !Object.values(exportOptions).slice(1).some(v => v === true)) {
      showNotification('Please select at least one data type to export', 'error');
      return;
    }

    showNotification('Exporting backup...', 'success');
    
    const response = await axios.post('/admin/api/backup/export', exportOptions);
    
    if (response.data.success) {
      // Create download link
      const dataStr = JSON.stringify(response.data.data, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      const url = URL.createObjectURL(dataBlob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `localping-backup-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      
      showNotification('Backup exported successfully', 'success');
    } else {
      showNotification(response.data.error || 'Error exporting backup', 'error');
    }
  } catch (error) {
    console.error('Error exporting backup:', error);
    showNotification(error.response?.data?.error || 'Error exporting backup', 'error');
  }
}

// Import backup
async function importBackup() {
  try {
    const fileInput = document.getElementById('importFile');
    const file = fileInput.files[0];
    
    if (!file) {
      showNotification('Please select a backup file to import', 'error');
      return;
    }

    if (!file.name.endsWith('.json')) {
      showNotification('Please select a valid JSON backup file', 'error');
      return;
    }

    showNotification('Reading backup file...', 'success');
    
    const fileContent = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = reject;
      reader.readAsText(file);
    });

    let importData;
    try {
      importData = JSON.parse(fileContent);
    } catch (error) {
      showNotification('Invalid JSON file format', 'error');
      return;
    }

    // Validate import data structure
    if (!importData.data || typeof importData.data !== 'object') {
      showNotification('Invalid backup file format', 'error');
      return;
    }

    const overwrite = document.getElementById('importOverwrite').checked;
    
    showNotification('Importing backup...', 'success');
    
    const response = await axios.post('/admin/api/backup/import', {
      importData,
      overwrite,
    });

    if (response.data.success) {
      const results = response.data.results;
      let message = 'Backup imported successfully:\n';
      
      // Build summary message
      if (results.imported) {
        Object.keys(results.imported).forEach(key => {
          const data = results.imported[key];
          if (data.imported) message += `\n${key}: ${data.imported} imported`;
          if (data.updated) message += `, ${data.updated} updated`;
        });
      }
      
      if (results.errors && results.errors.length > 0) {
        message += `\n\nErrors: ${results.errors.length} error(s) occurred`;
      }
      
      showNotification(message, 'success');
      
      // Clear file input
      fileInput.value = '';
      
      // Reload relevant data
      if (results.imported.targets || results.imported.incidents || results.imported.posts) {
        // Reload current tab if applicable
        const activeTab = document.querySelector('.tab-content.active');
        if (activeTab) {
          const tabId = activeTab.id;
          if (tabId === 'monitors' && results.imported.targets) {
            loadMonitors();
          } else if (tabId === 'incidents' && results.imported.incidents) {
            loadIncidents();
          } else if (tabId === 'posts' && results.imported.posts) {
            loadPosts();
          }
        }
      }
    } else {
      showNotification(response.data.error || 'Error importing backup', 'error');
    }
  } catch (error) {
    console.error('Error importing backup:', error);
    showNotification(error.response?.data?.error || 'Error importing backup', 'error');
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadMonitors();
  attachFormListeners();
  loadPublicUISettings(); // Load custom title for header
  
  // Hide clone button initially
  const cloneBtn = document.getElementById('cloneMonitorBtn');
  if (cloneBtn) {
    cloneBtn.style.display = 'none';
  }
});

