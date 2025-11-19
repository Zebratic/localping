let uptimeChart = null;
let selectedServiceId = null;

// Load status on page load
loadStatus();

// Auto-refresh every 30 seconds
setInterval(loadStatus, 30000);

async function loadStatus() {
  try {
    const res = await axios.get('/api/status');
    const { status, targets, timestamp } = res.data;

    // Update overall stats
    document.getElementById('total-count').textContent = status.totalTargets;
    document.getElementById('up-count').textContent = status.upTargets;
    document.getElementById('down-count').textContent = status.downTargets;
    document.getElementById('status-time').textContent = `Last updated: ${new Date(timestamp).toLocaleTimeString()}`;

    // Update status indicator
    const statusEl = document.getElementById('status-text');
    if (status.overallStatus === 'operational') {
      statusEl.textContent = '✓ All Systems Operational';
      statusEl.className = 'text-lg font-semibold text-green-400';
    } else if (status.overallStatus === 'degraded') {
      statusEl.textContent = '⚠ Degraded Performance';
      statusEl.className = 'text-lg font-semibold text-yellow-400';
    } else {
      statusEl.textContent = '✗ System Down';
      statusEl.className = 'text-lg font-semibold text-red-400';
    }

    // Display services
    displayServices(targets);

    // Calculate average uptime
    await loadAverageUptime();
  } catch (error) {
    console.error('Error loading status:', error);
  }
}

function displayServices(targets) {
  const list = document.getElementById('services-list');

  if (targets.length === 0) {
    list.innerHTML = '<p class="px-6 py-4 text-slate-400">No services configured</p>';
    return;
  }

  list.innerHTML = targets
    .map(
      (target) => `
    <div class="px-6 py-4 hover:bg-slate-700/50 cursor-pointer transition" onclick="selectService('${target._id}', '${target.name}')">
      <div class="flex justify-between items-center">
        <div>
          <h3 class="font-semibold">${target.name}</h3>
          <p class="text-slate-400 text-sm">${target.host} (${target.protocol})</p>
        </div>
        <div class="flex items-center gap-4">
          <span class="px-3 py-1 rounded text-sm font-medium ${target.isUp ? 'bg-green-900 text-green-200' : 'bg-red-900 text-red-200'}">
            ${target.isUp ? '✓ Operational' : '✗ Down'}
          </span>
        </div>
      </div>
    </div>
  `
    )
    .join('');
}

async function selectService(serviceId, serviceName) {
  selectedServiceId = serviceId;
  document.getElementById('detail-service-name').textContent = serviceName;

  try {
    const res = await axios.get(`/api/targets/${serviceId}/uptime`);
    const { uptime, totalPings, successfulPings, failedPings } = res.data;

    document.getElementById('detail-uptime').textContent = uptime + '%';
    document.getElementById('detail-pings').textContent = totalPings;
    document.getElementById('detail-successful').textContent = successfulPings;
    document.getElementById('detail-failed').textContent = failedPings;

    // Load and display uptime chart
    await loadUptimeChart(serviceId);

    document.getElementById('service-details').classList.remove('hidden');
    document.getElementById('service-details').scrollIntoView({ behavior: 'smooth' });
  } catch (error) {
    console.error('Error loading service details:', error);
  }
}

async function loadUptimeChart(serviceId) {
  try {
    const res = await axios.get(`/api/targets/${serviceId}/statistics?days=30`);
    const stats = res.data.statistics;

    const labels = stats.map((s) => new Date(s.date).toLocaleDateString());
    const uptimeData = stats.map((s) => s.uptime);

    const ctx = document.getElementById('uptime-chart').getContext('2d');

    if (uptimeChart) {
      uptimeChart.destroy();
    }

    uptimeChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels,
        datasets: [
          {
            label: '30-Day Uptime',
            data: uptimeData,
            borderColor: '#22c55e',
            backgroundColor: 'rgba(34, 197, 94, 0.1)',
            tension: 0.4,
            fill: true,
            pointRadius: 4,
            pointBackgroundColor: '#22c55e',
            pointBorderColor: '#1e40af',
            pointBorderWidth: 2,
          },
        ],
      },
      options: {
        responsive: true,
        plugins: {
          legend: {
            display: true,
            labels: {
              color: '#e2e8f0',
            },
          },
        },
        scales: {
          y: {
            beginAtZero: true,
            max: 100,
            ticks: {
              color: '#94a3b8',
              callback: function (value) {
                return value + '%';
              },
            },
            grid: {
              color: '#334155',
            },
          },
          x: {
            ticks: {
              color: '#94a3b8',
            },
            grid: {
              color: '#334155',
            },
          },
        },
      },
    });
  } catch (error) {
    console.error('Error loading uptime chart:', error);
  }
}

async function loadAverageUptime() {
  try {
    const res = await axios.get('/api/status');
    const { targets } = res.data;

    let totalUptime = 0;
    let count = 0;

    for (const target of targets) {
      try {
        const uptimeRes = await axios.get(`/api/targets/${target._id}/uptime?days=30`);
        totalUptime += uptimeRes.data.uptime;
        count++;
      } catch (e) {
        // Skip on error
      }
    }

    if (count > 0) {
      const avgUptime = (totalUptime / count).toFixed(2);
      document.getElementById('avg-uptime').textContent = avgUptime + '%';
    }
  } catch (error) {
    console.error('Error calculating average uptime:', error);
  }
}
