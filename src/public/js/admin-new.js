let currentMonitorId = null;
let statusChart = null;

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
      monitorList.innerHTML = '<p class="text-gray-400 text-sm">No monitors yet</p>';
      return;
    }

    targets.forEach(target => {
      const status = target.currentStatus === 'up' ? 'up' : 'down';
      const statusColor = status === 'up' ? 'text-green-400' : 'text-red-400';
      const statusText = status === 'up' ? 'Up' : 'Down';

      const card = document.createElement('div');
      card.className = 'monitor-card';
      card.innerHTML = `
        <div class="flex justify-between items-start">
          <div class="flex-1">
            <h4 class="font-semibold">${target.name}</h4>
            <p class="text-sm text-gray-400">${target.host}</p>
          </div>
          <span class="status-badge ${status}">
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
  } catch (error) {
    console.error('Error loading monitors:', error);
    showNotification('Error loading monitors', 'error');
  }
}

// Select monitor and show details
function selectMonitor(monitor) {
  currentMonitorId = monitor._id;

  // Update UI
  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('monitorDetails').classList.remove('hidden');

  // Populate form
  document.getElementById('editName').value = monitor.name;
  document.getElementById('editHost').value = monitor.host;
  document.getElementById('editProtocol').value = monitor.protocol;
  document.getElementById('editPort').value = monitor.port || '';
  document.getElementById('editInterval').value = monitor.interval || 60;
  document.getElementById('editGroup').value = monitor.group || '';
  document.getElementById('monitorName').textContent = monitor.name;

  // Update status
  const status = monitor.currentStatus === 'up' ? 'Up' : 'Down';
  const statusColor = monitor.currentStatus === 'up' ? 'text-green-400' : 'text-red-400';
  document.getElementById('monitorStatus').textContent = status;
  document.getElementById('monitorStatus').className = statusColor;

  // Update monitor list selection
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.classList.remove('selected');
  });
  event.currentTarget.classList.add('selected');

  // Draw chart
  drawStatusChart();
}

// Draw status chart
function drawStatusChart() {
  const ctx = document.getElementById('statusChart').getContext('2d');

  // Destroy existing chart
  if (statusChart) {
    statusChart.destroy();
  }

  // Sample data - in production, this would come from the API
  const data = {
    labels: ['00:00', '04:00', '08:00', '12:00', '16:00', '20:00', '24:00'],
    datasets: [
      {
        label: 'Uptime %',
        data: [99.9, 99.8, 100, 99.9, 99.7, 99.9, 100],
        borderColor: '#10b981',
        backgroundColor: 'rgba(16, 185, 129, 0.1)',
        borderWidth: 2,
        tension: 0.4,
        fill: true
      }
    ]
  };

  statusChart = new Chart(ctx, {
    type: 'line',
    data: data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          labels: {
            color: '#9ca3af'
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            color: '#9ca3af'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          }
        },
        x: {
          ticks: {
            color: '#9ca3af'
          },
          grid: {
            color: 'rgba(255, 255, 255, 0.05)'
          }
        }
      }
    }
  });
}

// Save monitor changes
async function saveMonitor() {
  if (!currentMonitorId) {
    showNotification('No monitor selected', 'error');
    return;
  }

  const data = {
    name: document.getElementById('editName').value,
    host: document.getElementById('editHost').value,
    protocol: document.getElementById('editProtocol').value,
    port: document.getElementById('editPort').value ? parseInt(document.getElementById('editPort').value) : null,
    interval: parseInt(document.getElementById('editInterval').value),
    group: document.getElementById('editGroup').value
  };

  try {
    const response = await axios.put(`/admin/api/targets/${currentMonitorId}`, data);
    showNotification('Monitor updated successfully', 'success');
    loadMonitors();
  } catch (error) {
    console.error('Error saving monitor:', error);
    showNotification(error.response?.data?.error || 'Error saving monitor', 'error');
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
  document.getElementById('editName').value = '';
  document.getElementById('editHost').value = '';
  document.getElementById('editProtocol').value = 'ICMP';
  document.getElementById('editPort').value = '';
  document.getElementById('editInterval').value = '60';
  document.getElementById('editGroup').value = '';

  document.getElementById('emptyState').classList.add('hidden');
  document.getElementById('monitorDetails').classList.remove('hidden');
  document.getElementById('monitorName').textContent = 'New Monitor';

  // Update monitor list selection
  document.querySelectorAll('.monitor-card').forEach(card => {
    card.classList.remove('selected');
  });

  // Focus on name field
  document.getElementById('editName').focus();
}

// Save new monitor
async function saveMonitor() {
  const data = {
    name: document.getElementById('editName').value,
    host: document.getElementById('editHost').value,
    protocol: document.getElementById('editProtocol').value,
    port: document.getElementById('editPort').value ? parseInt(document.getElementById('editPort').value) : null,
    interval: parseInt(document.getElementById('editInterval').value),
    group: document.getElementById('editGroup').value
  };

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
      await axios.post('/admin/api/targets', data);
      showNotification('Monitor created successfully', 'success');
    }
    cancelEdit();
    loadMonitors();
  } catch (error) {
    console.error('Error saving monitor:', error);
    showNotification(error.response?.data?.error || 'Error saving monitor', 'error');
  }
}

// Cancel edit
function cancelEdit() {
  currentMonitorId = null;
  document.getElementById('monitorDetails').classList.add('hidden');
  document.getElementById('emptyState').classList.remove('hidden');
  document.getElementById('editForm').reset();

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
      incidentsList.innerHTML = '<p class="text-gray-400">No incidents recorded</p>';
      return;
    }

    incidents.forEach(incident => {
      const card = document.createElement('div');
      card.className = 'bg-gray-800/50 rounded-lg p-4 border border-gray-700';
      card.innerHTML = `
        <div class="flex justify-between items-start mb-2">
          <h4 class="font-semibold">${incident.title}</h4>
          <span class="text-xs bg-yellow-900 text-yellow-200 px-2 py-1 rounded">${incident.status}</span>
        </div>
        <p class="text-sm text-gray-400 mb-2">${incident.description}</p>
        <p class="text-xs text-gray-500">${new Date(incident.createdAt).toLocaleString()}</p>
      `;
      incidentsList.appendChild(card);
    });
  } catch (error) {
    console.error('Error loading incidents:', error);
    document.getElementById('incidentsList').innerHTML = '<p class="text-gray-400">Error loading incidents</p>';
  }
}

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
    notification.remove();
  }, 3000);
}

// Logout
function logout() {
  axios.get('/admin/logout').then(() => {
    window.location.href = '/admin/login';
  });
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  loadMonitors();
});
