// Initialize charts
let productivityChart;
let domainsChart;

// Initialize settings and UI
document.addEventListener('DOMContentLoaded', () => {
  // Initialize settings panel toggle
  const settingsToggle = document.getElementById('settings-toggle');
  const settingsPanel = document.getElementById('settings-panel');
  
  settingsToggle.addEventListener('click', () => {
    settingsPanel.classList.toggle('visible');
  });

  // Initialize settings
  chrome.storage.local.get(['settings'], (result) => {
    if (result.settings) {
      document.getElementById('api-key').value = result.settings.apiKey ? '********' : '';
      document.getElementById('confidence-threshold').value = Math.round((result.settings.confidenceThreshold || 0.75) * 100);
      document.getElementById('threshold-value').textContent = `${Math.round((result.settings.confidenceThreshold || 0.75) * 100)}%`;
      document.getElementById('check-interval').value = result.settings.checkInterval || 30;
      document.getElementById('auto-prompt').checked = result.settings.autoPrompt !== undefined ? result.settings.autoPrompt : true;
      document.getElementById('pause-tracking').checked = result.settings.isPaused || false;
    }
  });

  // Settings change handlers
  document.getElementById('confidence-threshold').addEventListener('input', (e) => {
    document.getElementById('threshold-value').textContent = `${e.target.value}%`;
  });

  // Save settings
  document.getElementById('save-settings').addEventListener('click', () => {
    const settings = {
      confidenceThreshold: parseInt(document.getElementById('confidence-threshold').value) / 100,
      checkInterval: parseInt(document.getElementById('check-interval').value),
      autoPrompt: document.getElementById('auto-prompt').checked,
      isPaused: document.getElementById('pause-tracking').checked
    };

    // Only update API key if changed
    const apiKey = document.getElementById('api-key').value;
    if (apiKey && apiKey !== '********') {
      settings.apiKey = apiKey;
    }

    chrome.runtime.sendMessage({
      type: 'UPDATE_SETTINGS',
      settings
    }, () => {
      const saveButton = document.getElementById('save-settings');
      const originalText = saveButton.textContent;
      saveButton.textContent = 'Saved!';
      setTimeout(() => {
        saveButton.textContent = originalText;
      }, 2000);
    });
  });

  // Clear data
  document.getElementById('clear-data').addEventListener('click', () => {
    if (confirm('Are you sure you want to clear all tracking data? This cannot be undone.')) {
      // Destroy existing charts first
      if (productivityChart) {
        productivityChart.destroy();
        productivityChart = null;
      }
      if (domainsChart) {
        domainsChart.destroy();
        domainsChart = null;
      }

      chrome.storage.local.set({ activityLog: [] }, () => {
        // Show empty state for charts
        const productivityCtx = document.getElementById('productivity-chart').getContext('2d');
        const domainsCtx = document.getElementById('domains-chart').getContext('2d');
        
        // Clear any existing content
        productivityCtx.clearRect(0, 0, productivityCtx.canvas.width, productivityCtx.canvas.height);
        domainsCtx.clearRect(0, 0, domainsCtx.canvas.width, domainsCtx.canvas.height);
        
        // Show "No data" message
        productivityCtx.font = '14px Arial';
        productivityCtx.textAlign = 'center';
        productivityCtx.fillStyle = '#666';
        productivityCtx.fillText('No data collected yet', productivityCtx.canvas.width / 2, productivityCtx.canvas.height / 2);
        
        domainsCtx.font = '14px Arial';
        domainsCtx.textAlign = 'center';
        domainsCtx.fillStyle = '#666';
        domainsCtx.fillText('No domain data collected yet', domainsCtx.canvas.width / 2, domainsCtx.canvas.height / 2);

        // Show feedback
        const clearButton = document.getElementById('clear-data');
        const originalText = clearButton.textContent;
        clearButton.textContent = 'Cleared!';
        setTimeout(() => {
          clearButton.textContent = originalText;
        }, 2000);
      });
    }
  });

  // Export data
  document.getElementById('export-data').addEventListener('click', () => {
    chrome.storage.local.get(['activityLog'], (result) => {
      const activityLog = result.activityLog || [];
      
      // Format data for export
      const exportData = activityLog.map(entry => ({
        url: entry.metadata.url,
        title: entry.metadata.title,
        timestamp: new Date(entry.metadata.timestamp).toLocaleString(),
        duration: Math.round(entry.metadata.duration / 1000) + ' seconds',
        isProductive: entry.isProductive ? 'Yes' : 'No',
        confidence: Math.round(entry.confidence * 100) + '%',
        reason: entry.reason
      }));

      // Convert to CSV
      const headers = ['URL', 'Title', 'Timestamp', 'Duration', 'Productive', 'Confidence', 'Reason'];
      const csv = [
        headers.join(','),
        ...exportData.map(row => [
          `"${row.url}"`,
          `"${row.title}"`,
          `"${row.timestamp}"`,
          `"${row.duration}"`,
          `"${row.isProductive}"`,
          `"${row.confidence}"`,
          `"${row.reason.replace(/"/g, '""')}"`
        ].join(','))
      ].join('\n');

      // Create and trigger download
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `productivity-data-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      // Show feedback
      const exportButton = document.getElementById('export-data');
      const originalText = exportButton.textContent;
      exportButton.textContent = 'Exported!';
      setTimeout(() => {
        exportButton.textContent = originalText;
      }, 2000);
    });
  });

  // Initialize charts
  updateCharts();
});

// Helper function to format duration in seconds to human readable format
function formatDuration(ms) {
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return `${minutes}m ${remainingSeconds}s`;
}

// Update charts with current data
function updateCharts() {
  chrome.storage.local.get(['activityLog'], (result) => {
    const activityLog = result.activityLog || [];
    
    // Productivity chart data
    const productiveTime = activityLog
      .filter(entry => entry.isProductive)
      .reduce((sum, entry) => sum + entry.metadata.duration, 0);
    
    const wastedTime = activityLog
      .filter(entry => !entry.isProductive)
      .reduce((sum, entry) => sum + entry.metadata.duration, 0);

    // Destroy existing charts if they exist
    if (productivityChart) {
      productivityChart.destroy();
    }
    if (domainsChart) {
      domainsChart.destroy();
    }

    // Initialize productivity chart
    const productivityCtx = document.getElementById('productivity-chart').getContext('2d');
    productivityChart = new Chart(productivityCtx, {
      type: 'pie',
      data: {
        labels: [
          `Productive (${formatDuration(productiveTime)})`,
          `Wasted (${formatDuration(wastedTime)})`
        ],
        datasets: [{
          data: [productiveTime, wastedTime],
          backgroundColor: ['#4CAF50', '#f44336']
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.raw;
                const total = context.dataset.data.reduce((a, b) => a + b, 0);
                const percentage = Math.round((value / total) * 100);
                return `${context.label}: ${formatDuration(value)} (${percentage}%)`;
              }
            }
          }
        }
      }
    });

    // Domains chart data
    const domainStats = activityLog.reduce((stats, entry) => {
      try {
        const domain = new URL(entry.metadata.url).hostname;
        if (!stats[domain]) {
          stats[domain] = { productive: 0, wasted: 0 };
        }
        if (entry.isProductive) {
          stats[domain].productive += entry.metadata.duration;
        } else {
          stats[domain].wasted += entry.metadata.duration;
        }
        return stats;
      } catch (e) {
        console.error('Error processing URL:', entry.metadata.url);
        return stats;
      }
    }, {});

    const domains = Object.keys(domainStats)
      .sort((a, b) => {
        const totalA = domainStats[a].productive + domainStats[a].wasted;
        const totalB = domainStats[b].productive + domainStats[b].wasted;
        return totalB - totalA;
      })
      .slice(0, 5);

    // Initialize domains chart
    const domainsCtx = document.getElementById('domains-chart').getContext('2d');
    domainsChart = new Chart(domainsCtx, {
      type: 'bar',
      data: {
        labels: domains,
        datasets: [
          {
            label: 'Productive Time',
            data: domains.map(domain => domainStats[domain].productive),
            backgroundColor: '#4CAF50'
          },
          {
            label: 'Wasted Time',
            data: domains.map(domain => domainStats[domain].wasted),
            backgroundColor: '#f44336'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            stacked: true,
            ticks: {
              maxRotation: 45,
              minRotation: 45
            }
          },
          y: {
            stacked: true,
            ticks: {
              callback: function(value) {
                return formatDuration(value);
              }
            }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12
            }
          },
          tooltip: {
            callbacks: {
              label: function(context) {
                const value = context.raw;
                const datasetLabel = context.dataset.label;
                return `${datasetLabel}: ${formatDuration(value)}`;
              }
            }
          }
        }
      }
    });
  });
}

// Validate check interval input
document.getElementById('check-interval').addEventListener('input', (e) => {
  const value = parseInt(e.target.value);
  if (value < 10) {
    e.target.setCustomValidity('Check interval must be at least 10 seconds');
  } else if (value > 300) {
    e.target.setCustomValidity('Check interval cannot be more than 300 seconds (5 minutes)');
  } else {
    e.target.setCustomValidity('');
  }
});

// Initialize productivity pie chart
function initProductivityChart(data) {
  const ctx = document.getElementById('productivity-chart').getContext('2d');
  
  if (productivityChart) {
    productivityChart.destroy();
  }
  
  const productiveTime = data.filter(d => d.isProductive).reduce((sum, d) => sum + d.metadata.duration, 0);
  const wastedTime = data.filter(d => !d.isProductive).reduce((sum, d) => sum + d.metadata.duration, 0);
  const totalTime = productiveTime + wastedTime;
  
  if (totalTime === 0) {
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No data collected yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }
  
  productivityChart = new Chart(ctx, {
    type: 'pie',
    data: {
      labels: [
        `Productive (${formatDuration(productiveTime)})`,
        `Wasted (${formatDuration(wastedTime)})`
      ],
      datasets: [{
        data: [productiveTime, wastedTime],
        backgroundColor: ['#4CAF50', '#f44336']
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.raw;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = Math.round((value / total) * 100);
              return `${context.label}: ${formatDuration(value)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });
}

// Initialize domains bar chart
function initDomainsChart(data) {
  const ctx = document.getElementById('domains-chart').getContext('2d');
  
  if (domainsChart) {
    domainsChart.destroy();
  }
  
  // Group by domain
  const domainData = data.reduce((acc, item) => {
    const domain = new URL(item.metadata.url).hostname;
    if (!acc[domain]) {
      acc[domain] = { productive: 0, wasted: 0 };
    }
    if (item.isProductive) {
      acc[domain].productive += item.metadata.duration;
    } else {
      acc[domain].wasted += item.metadata.duration;
    }
    return acc;
  }, {});
  
  // Sort domains by total time
  const sortedDomains = Object.entries(domainData)
    .sort(([, a], [, b]) => (b.productive + b.wasted) - (a.productive + a.wasted))
    .slice(0, 5); // Top 5 domains
  
  if (sortedDomains.length === 0) {
    ctx.font = '14px Arial';
    ctx.textAlign = 'center';
    ctx.fillText('No domain data collected yet', ctx.canvas.width / 2, ctx.canvas.height / 2);
    return;
  }
  
  domainsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: sortedDomains.map(([domain]) => domain),
      datasets: [
        {
          label: 'Productive',
          data: sortedDomains.map(([, data]) => data.productive),
          backgroundColor: '#4CAF50'
        },
        {
          label: 'Wasted',
          data: sortedDomains.map(([, data]) => data.wasted),
          backgroundColor: '#f44336'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          stacked: true,
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        },
        y: {
          stacked: true,
          ticks: {
            callback: function(value) {
              return formatDuration(value);
            }
          }
        }
      },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            boxWidth: 12
          }
        },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.raw;
              const datasetLabel = context.dataset.label;
              return `${datasetLabel}: ${formatDuration(value)}`;
            }
          }
        }
      }
    }
  });
}

// Load and display data
function loadData() {
  chrome.runtime.sendMessage({ type: 'GET_STATS' }, (response) => {
    if (response && response.activityLog) {
      initProductivityChart(response.activityLog);
      initDomainsChart(response.activityLog);
    }
  });
}

// Initial load
loadData();

// Refresh data every 30 seconds to match the classification interval
setInterval(loadData, 30000); 