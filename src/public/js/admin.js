let currentTab = 'targets';

// Get API key from environment or query parameter
function getApiKey() {
  const url = new URL(window.location);
  return url.searchParams.get('apiKey') || localStorage.getItem('apiKey') || '';
}

// Configure axios to include API key by default
axios.interceptors.request.use((config) => {
  const apiKey = getApiKey();
  if (apiKey) {
    config.headers['X-API-Key'] = apiKey;
  }
  return config;
});

// Switch between tabs
function switchTab(tab) {
  currentTab = tab;

  // Update tab buttons
  document.querySelectorAll('[id^="tab-"]').forEach((el) => {
    if (el.id === `tab-${tab}`) {
      el.classList.add('border-cyan-400', 'text-cyan-400');
      el.classList.remove('border-transparent', 'text-slate-400');
    } else {
      el.classList.remove('border-cyan-400', 'text-cyan-400');
      el.classList.add('border-transparent', 'text-slate-400');
    }
  });

  // Update content
  document.querySelectorAll('.tab-content').forEach((el) => {
    el.classList.add('hidden');
  });
  document.getElementById(`tab-content-${tab}`).classList.remove('hidden');

  // Load content
  if (tab === 'targets') {
    loadTargets();
  } else if (tab === 'alerts') {
    loadAlerts();
  } else if (tab === 'actions') {
    loadActions();
  }
}

// Load dashboard data
async function loadDashboard() {
  try {
    const res = await axios.get('/admin/api/dashboard');
    const { dashboard } = res.data;

    // Update stats
    const upCount = dashboard.targets.filter((t) => t.currentStatus === 'up').length;
    const downCount = dashboard.targets.length - upCount;

    document.getElementById('total-targets').textContent = dashboard.targets.length;
    document.getElementById('targets-up').textContent = upCount;
    document.getElementById('targets-down').textContent = downCount;
    document.getElementById('active-monitors').textContent = dashboard.targets.filter((t) => t.enabled).length;

    // Display targets
    displayTargets(dashboard.targets);
    displayAlerts(dashboard.recentAlerts);
  } catch (error) {
    console.error('Error loading dashboard:', error);
  }
}

// Load targets
async function loadTargets() {
  try {
    const res = await axios.get('/api/targets');
    displayTargets(res.data.targets);
  } catch (error) {
    console.error('Error loading targets:', error);
  }
}

// Display targets
function displayTargets(targets) {
  const list = document.getElementById('targets-list');

  if (targets.length === 0) {
    list.innerHTML = '<p class="text-slate-400">No targets configured</p>';
    return;
  }

  list.innerHTML = targets
    .map(
      (target) => `
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 fade-enter">
      <div class="flex justify-between items-start mb-3">
        <div>
          <h3 class="font-semibold text-lg">${target.name}</h3>
          <p class="text-slate-400 text-sm">${target.host}:${target.port || 'default'} (${target.protocol})</p>
        </div>
        <span class="px-3 py-1 rounded text-sm font-medium ${target.currentStatus === 'up' ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}">
          ${target.currentStatus === 'up' ? '✓ UP' : '✗ DOWN'}
        </span>
      </div>
      <div class="flex gap-2">
        <button onclick="testTarget('${target._id}')" class="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded">
          Test
        </button>
        <button onclick="editTarget('${target._id}')" class="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded">
          Edit
        </button>
        <button onclick="deleteTarget('${target._id}')" class="text-sm px-3 py-1 bg-red-900 hover:bg-red-800 rounded">
          Delete
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

// Load alerts
async function loadAlerts() {
  try {
    const res = await axios.get('/api/alerts?limit=100');
    displayAlerts(res.data.alerts);
  } catch (error) {
    console.error('Error loading alerts:', error);
  }
}

// Display alerts
function displayAlerts(alerts) {
  const list = document.getElementById('alerts-list');

  if (alerts.length === 0) {
    list.innerHTML = '<p class="text-slate-400">No alerts</p>';
    return;
  }

  list.innerHTML = alerts
    .map(
      (alert) => `
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 fade-enter">
      <div class="flex justify-between items-start">
        <div>
          <p class="font-semibold ${alert.type === 'down' ? 'text-red-400' : 'text-green-400'}">
            ${alert.type === 'down' ? '✗' : '✓'} ${alert.message}
          </p>
          <p class="text-slate-400 text-sm">${new Date(alert.timestamp).toLocaleString()}</p>
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

// Load actions
async function loadActions() {
  try {
    const res = await axios.get('/admin/api/actions');
    displayActions(res.data.actions);
  } catch (error) {
    console.error('Error loading actions:', error);
  }
}

// Display actions
function displayActions(actions) {
  const list = document.getElementById('actions-list');

  if (actions.length === 0) {
    list.innerHTML = '<p class="text-slate-400">No quick-fix actions configured</p>';
    return;
  }

  list.innerHTML = actions
    .map(
      (action) => `
    <div class="bg-slate-800 border border-slate-700 rounded-lg p-4 fade-enter">
      <div class="flex justify-between items-start mb-3">
        <div>
          <h3 class="font-semibold text-lg">${action.name}</h3>
          <p class="text-slate-400 text-sm">${action.description || 'No description'}</p>
          <p class="text-slate-500 text-xs mt-1">Type: ${action.type}</p>
        </div>
      </div>
      <div class="flex gap-2">
        <button onclick="executeAction('${action._id}')" class="text-sm px-3 py-1 bg-cyan-600 hover:bg-cyan-700 rounded">
          Execute
        </button>
        <button onclick="editAction('${action._id}')" class="text-sm px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded">
          Edit
        </button>
        <button onclick="deleteAction('${action._id}')" class="text-sm px-3 py-1 bg-red-900 hover:bg-red-800 rounded">
          Delete
        </button>
      </div>
    </div>
  `
    )
    .join('');
}

// Test target
async function testTarget(targetId) {
  try {
    const res = await axios.post(`/api/targets/${targetId}/test`);
    const result = res.data.result;
    alert(
      `Test Result:\nSuccess: ${result.success}\nResponse Time: ${result.responseTime}ms\n${
        result.error ? 'Error: ' + result.error : ''
      }`
    );
  } catch (error) {
    alert('Error testing target: ' + error.message);
  }
}

// Edit target
async function editTarget(targetId) {
  try {
    const res = await axios.get(`/api/targets/${targetId}`, {
      headers: { 'X-API-Key': document.querySelector('[data-api-key]')?.getAttribute('data-api-key') || '' }
    });
    const target = res.data.target;

    // Pre-fill the form
    document.getElementById('target-name').value = target.name;
    document.getElementById('target-host').value = target.host;
    document.getElementById('target-protocol').value = target.protocol;
    document.getElementById('target-port').value = target.port || '';
    document.getElementById('target-interval').value = target.interval || 60;

    // Change button text and form action
    const modal = document.getElementById('add-target-modal');
    const form = modal.querySelector('form');
    const title = modal.querySelector('h2');

    title.textContent = 'Edit Target';
    form.dataset.targetId = targetId;
    form.onsubmit = async (e) => await updateTarget(e, targetId);

    modal.classList.remove('hidden');
  } catch (error) {
    alert('Error loading target: ' + error.message);
  }
}

// Update target
async function updateTarget(event, targetId) {
  event.preventDefault();

  const target = {
    name: document.getElementById('target-name').value,
    host: document.getElementById('target-host').value,
    protocol: document.getElementById('target-protocol').value,
    port: document.getElementById('target-port').value ? parseInt(document.getElementById('target-port').value) : null,
    interval: document.getElementById('target-interval').value ? parseInt(document.getElementById('target-interval').value) : 60,
  };

  try {
    await axios.put(`/api/targets/${targetId}`, target);
    document.getElementById('add-target-modal').classList.add('hidden');
    document.querySelector('#add-target-modal form').reset();
    document.querySelector('#add-target-modal h2').textContent = 'Add Target';
    loadTargets();
  } catch (error) {
    alert('Error updating target: ' + error.message);
  }
}

// Delete target
async function deleteTarget(targetId) {
  if (!confirm('Are you sure you want to delete this target?')) return;

  try {
    await axios.delete(`/api/targets/${targetId}`);
    loadTargets();
  } catch (error) {
    alert('Error deleting target: ' + error.message);
  }
}

// Show add target modal
function showAddTargetModal() {
  document.getElementById('add-target-modal').classList.remove('hidden');
}

// Add target
async function addTarget(event) {
  event.preventDefault();

  const target = {
    name: document.getElementById('target-name').value,
    host: document.getElementById('target-host').value,
    protocol: document.getElementById('target-protocol').value,
    port: document.getElementById('target-port').value ? parseInt(document.getElementById('target-port').value) : null,
    interval: document.getElementById('target-interval').value ? parseInt(document.getElementById('target-interval').value) : 60,
  };

  try {
    await axios.post('/api/targets', target);
    document.getElementById('add-target-modal').classList.add('hidden');
    document.querySelector('#add-target-modal form').reset();
    loadTargets();
  } catch (error) {
    alert('Error adding target: ' + error.message);
  }
}

// Show add action modal
function showAddActionModal() {
  document.getElementById('add-action-modal').classList.remove('hidden');
}

// Update action form based on type
function updateActionForm() {
  const type = document.getElementById('action-type').value;
  const fieldsDiv = document.getElementById('action-fields');

  const fields = {
    command: '<input type="text" placeholder="Command" id="action-command" required class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">',
    ssh: `
      <input type="text" placeholder="Host" id="action-ssh-host" required class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
      <input type="text" placeholder="User (optional)" id="action-ssh-user" class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
      <input type="number" placeholder="Port (default 22)" id="action-ssh-port" class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
      <input type="text" placeholder="Command" id="action-ssh-command" required class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
    `,
    http: `
      <input type="text" placeholder="URL" id="action-http-url" required class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
      <select id="action-http-method" class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">
        <option>GET</option>
        <option>POST</option>
        <option>PUT</option>
      </select>
    `,
    script: '<input type="text" placeholder="Script Path" id="action-script-path" required class="w-full bg-slate-700 border border-slate-600 rounded px-3 py-2 text-slate-100">',
  };

  fieldsDiv.innerHTML = fields[type] || '';
}

// Add action
async function addAction(event) {
  event.preventDefault();

  const type = document.getElementById('action-type').value;
  const name = document.getElementById('action-name').value;

  const action = {
    name,
    type,
    description: '',
  };

  // Add type-specific fields
  if (type === 'command') {
    action.command = document.getElementById('action-command').value;
  } else if (type === 'ssh') {
    action.host = document.getElementById('action-ssh-host').value;
    action.user = document.getElementById('action-ssh-user').value;
    action.port = document.getElementById('action-ssh-port').value;
    action.command = document.getElementById('action-ssh-command').value;
  } else if (type === 'http') {
    action.url = document.getElementById('action-http-url').value;
    action.method = document.getElementById('action-http-method').value;
  } else if (type === 'script') {
    action.scriptPath = document.getElementById('action-script-path').value;
  }

  try {
    await axios.post('/admin/api/actions', action);
    document.getElementById('add-action-modal').classList.add('hidden');
    document.querySelector('#add-action-modal form').reset();
    loadActions();
  } catch (error) {
    alert('Error adding action: ' + error.message);
  }
}

// Edit action
async function editAction(actionId) {
  try {
    const res = await axios.get(`/admin/api/actions/${actionId}`, {
      headers: { 'X-API-Key': document.querySelector('[data-api-key]')?.getAttribute('data-api-key') || '' }
    });
    const action = res.data.action;

    // Pre-fill the form
    document.getElementById('action-name').value = action.name;
    document.getElementById('action-type').value = action.type;
    updateActionForm();

    // Pre-fill type-specific fields
    if (action.type === 'command') {
      document.getElementById('action-command').value = action.command;
    } else if (action.type === 'ssh') {
      document.getElementById('action-ssh-host').value = action.host;
      document.getElementById('action-ssh-user').value = action.user || '';
      document.getElementById('action-ssh-port').value = action.port || 22;
      document.getElementById('action-ssh-command').value = action.command;
    } else if (action.type === 'http') {
      document.getElementById('action-http-url').value = action.url;
      document.getElementById('action-http-method').value = action.method || 'GET';
    } else if (action.type === 'script') {
      document.getElementById('action-script-path').value = action.scriptPath;
    }

    // Change button text and form action
    const modal = document.getElementById('add-action-modal');
    const form = modal.querySelector('form');
    const title = modal.querySelector('h2');

    title.textContent = 'Edit Action';
    form.dataset.actionId = actionId;
    form.onsubmit = async (e) => await updateAction(e, actionId);

    modal.classList.remove('hidden');
  } catch (error) {
    alert('Error loading action: ' + error.message);
  }
}

// Update action
async function updateAction(event, actionId) {
  event.preventDefault();

  const type = document.getElementById('action-type').value;
  const name = document.getElementById('action-name').value;

  const action = {
    name,
    type,
    description: '',
  };

  // Add type-specific fields
  if (type === 'command') {
    action.command = document.getElementById('action-command').value;
  } else if (type === 'ssh') {
    action.host = document.getElementById('action-ssh-host').value;
    action.user = document.getElementById('action-ssh-user').value;
    action.port = document.getElementById('action-ssh-port').value;
    action.command = document.getElementById('action-ssh-command').value;
  } else if (type === 'http') {
    action.url = document.getElementById('action-http-url').value;
    action.method = document.getElementById('action-http-method').value;
  } else if (type === 'script') {
    action.scriptPath = document.getElementById('action-script-path').value;
  }

  try {
    await axios.put(`/admin/api/actions/${actionId}`, action);
    document.getElementById('add-action-modal').classList.add('hidden');
    document.querySelector('#add-action-modal form').reset();
    document.querySelector('#add-action-modal h2').textContent = 'Add Action';
    loadActions();
  } catch (error) {
    alert('Error updating action: ' + error.message);
  }
}

// Execute action
async function executeAction(actionId) {
  try {
    const res = await axios.post(`/api/actions/${actionId}/execute`);
    const result = res.data.result;
    alert(`Action executed successfully!\nExecution time: ${result.executionTime}ms`);
  } catch (error) {
    alert('Error executing action: ' + error.message);
  }
}

// Delete action
async function deleteAction(actionId) {
  if (!confirm('Are you sure you want to delete this action?')) return;

  try {
    await axios.delete(`/admin/api/actions/${actionId}`);
    loadActions();
  } catch (error) {
    alert('Error deleting action: ' + error.message);
  }
}

// Auto-refresh dashboard every 30 seconds
setInterval(loadDashboard, 30000);

// Load on page load
loadDashboard();
