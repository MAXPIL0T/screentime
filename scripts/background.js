// State management
let activeTabId = null;
let activeTabStartTime = null;
let isTracking = false;
let classificationQueue = [];
let periodicCheckInterval = null;
let lastActiveTime = null;
let currentTabResponses = {
  tabId: null,
  url: null,
  response: null
}; // Store response only for current tab session
let settings = {
  apiKey: '',
  confidenceThreshold: 0.75,
  autoPrompt: true,
  checkInterval: 30,
  isPaused: false
};

// Initialize settings from storage
chrome.storage.local.get(['settings'], (result) => {
  if (result.settings) {
    settings = { ...settings, ...result.settings };
  }
  console.log('Settings initialized:', { ...settings, apiKey: '***' });
  
  // If no API key is set, notify the user
  if (!settings.apiKey) {
    chrome.runtime.sendMessage({
      type: 'SHOW_API_KEY_PROMPT'
    });
  }
});

// Time tracking functions
function startTracking(tabId) {
  // Don't start tracking if extension is paused
  if (settings.isPaused) {
    console.log('Extension is paused, not starting tracking');
    return;
  }
  
  // Verify the tab is still active before starting tracking
  chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
    if (tabs[0] && tabs[0].id === tabId) {
      if (isTracking && activeTabId === tabId) {
        // Update last active time
        lastActiveTime = Date.now();
        return;
      }
      
      if (isTracking) {
        stopTracking();
      }
      
      // Reset current tab response if switching tabs
      if (activeTabId !== tabId) {
        currentTabResponses = {
          tabId: null,
          url: null,
          response: null
        };
      }
      
      activeTabId = tabId;
      activeTabStartTime = Date.now();
      lastActiveTime = activeTabStartTime;
      isTracking = true;
      console.log('Started tracking tab:', tabId, 'at:', new Date(activeTabStartTime).toISOString());
      
      // Clear any existing interval
      if (periodicCheckInterval) {
        clearInterval(periodicCheckInterval);
      }
      
      // Set up periodic check with current interval setting
      periodicCheckInterval = setInterval(() => {
        // Verify tab is still active before classification
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
          if (tabs[0] && tabs[0].id === activeTabId) {
            // Only count time if the window is focused
            chrome.windows.getCurrent((window) => {
              if (window.focused) {
                lastActiveTime = Date.now();
                const currentDuration = getActiveDuration();
                console.log('Periodic check - Current duration:', Math.round(currentDuration / 1000), 'seconds');
                queueClassification(activeTabId, currentDuration);
              }
            });
          } else {
            // Tab is no longer active, stop tracking
            stopTracking();
          }
        });
      }, settings.checkInterval * 1000);
    }
  });
}

function stopTracking() {
  if (!isTracking) return;
  
  const duration = getActiveDuration();
  console.log('Stopped tracking tab:', activeTabId, 'Duration:', Math.round(duration / 1000), 'seconds');
  
  // Clear the periodic check interval
  if (periodicCheckInterval) {
    clearInterval(periodicCheckInterval);
    periodicCheckInterval = null;
  }
  
  // Only classify if spent at least 5 seconds (to avoid very short visits)
  if (duration >= 5000) {
    queueClassification(activeTabId, duration);
  }
  
  isTracking = false;
  activeTabId = null;
  activeTabStartTime = null;
  lastActiveTime = null;
}

function getActiveDuration() {
  if (!isTracking || !activeTabStartTime || !lastActiveTime) return 0;
  return lastActiveTime - activeTabStartTime;
}

// AI Classification
async function classifyActivity(tabId, duration) {
  try {
    const tab = await chrome.tabs.get(tabId);
    const metadata = {
      url: tab.url,
      title: tab.title,
      duration: duration,
      timestamp: Date.now()
    };

    // Check if we have a response for this tab and URL
    if (currentTabResponses.tabId === tabId && 
        currentTabResponses.url === tab.url && 
        currentTabResponses.response) {
      console.log('Using previous response for current tab session');
      return {
        ...currentTabResponses.response,
        metadata
      };
    }

    console.log('Classifying activity:', {
      url: metadata.url,
      title: metadata.title,
      duration: Math.round(duration / 1000) + 's'
    });

    // Get visible text from the page
    const [result] = await chrome.scripting.executeScript({
      target: { tabId },
      func: () => {
        const text = document.body.innerText;
        return text.substring(0, 500);
      }
    });

    const pageSnippet = result.result;

    // Prepare the prompt for OpenAI
    const prompt = `Analyze if this browsing activity is productive or a waste of time.
URL: ${metadata.url}
Title: ${metadata.title}
Time spent: ${Math.round(duration / 1000)} seconds
Page Content Snippet: ${pageSnippet}

Please classify this activity as either "productive" or "waste of time" and provide a confidence score between 0 and 1.
Format your response as JSON: {"isProductive": boolean, "confidence": number, "reason": string}`;

    console.log('Sending request to OpenAI...');
    
    // Call OpenAI API
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${settings.apiKey}`,
        'OpenAI-Organization': 'org-OGiksDrIaaGhc8s8tzMLmbhU',
        'OpenAI-Project': 'proj_VfK0SG0C6KcQmlHJFdEz8EsD'
      },
      body: JSON.stringify({
        model: 'gpt-3.5-turbo',
        messages: [
          {
            role: 'system',
            content: 'You are a productivity analyzer. Your task is to determine if a browsing activity is productive or a waste of time based on the URL, title, and content snippet provided.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3,
        max_tokens: 150
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      console.error('OpenAI API error:', errorData);
      throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data = await response.json();
    console.log('OpenAI raw response:', data);

    const classification = JSON.parse(data.choices[0].message.content);
    console.log('Parsed classification:', {
      isProductive: classification.isProductive,
      confidence: classification.confidence,
      reason: classification.reason,
      duration: Math.round(duration / 1000) + 's'
    });

    return {
      ...classification,
      metadata
    };
  } catch (error) {
    console.error('Classification error:', error);
    return {
      isProductive: false,
      confidence: 0.5,
      reason: 'Error during classification',
      metadata
    };
  }
}

function queueClassification(tabId, duration) {
  console.log('Queueing classification for tab:', tabId, 'Duration:', Math.round(duration / 1000), 'seconds');
  classificationQueue.push({ tabId, duration });
  processClassificationQueue();
}

async function processClassificationQueue() {
  if (classificationQueue.length === 0) return;
  
  const { tabId, duration } = classificationQueue.shift();
  const result = await classifyActivity(tabId, duration);
  
  if (result) {
    if (result.confidence < settings.confidenceThreshold && settings.autoPrompt) {
      // Only show clarification prompt if we don't have a response for this tab session
      if (!currentTabResponses.response || 
          currentTabResponses.tabId !== tabId || 
          currentTabResponses.url !== result.metadata.url) {
        console.log('Showing clarification prompt due to low confidence:', result.confidence);
        chrome.tabs.sendMessage(tabId, {
          type: 'SHOW_CLARIFICATION',
          data: result
        });
      } else {
        console.log('Using existing response for low confidence result');
        storeClassificationResult(result);
      }
    } else {
      console.log('Storing classification result with confidence:', result.confidence);
      storeClassificationResult(result);
    }
  }
  
  if (classificationQueue.length > 0) {
    processClassificationQueue();
  }
}

function storeClassificationResult(result) {
  chrome.storage.local.get(['activityLog'], (data) => {
    const activityLog = data.activityLog || [];
    activityLog.push(result);
    console.log('Storing activity:', {
      url: result.metadata.url,
      duration: Math.round(result.metadata.duration / 1000) + 's',
      isProductive: result.isProductive,
      confidence: result.confidence
    });
    chrome.storage.local.set({ activityLog });
  });
}

// Event Listeners
chrome.tabs.onActivated.addListener((activeInfo) => {
  console.log('Tab switched to:', activeInfo.tabId);
  startTracking(activeInfo.tabId);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.active) {
    console.log('Active tab updated:', tabId, 'URL:', tab.url);
    startTracking(tabId);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (activeTabId === tabId) {
    console.log('Active tab closed:', tabId);
    stopTracking();
  }
});

// Handle window focus changes
chrome.windows.onFocusChanged.addListener((windowId) => {
  if (windowId === chrome.windows.WINDOW_ID_NONE) {
    // Window lost focus
    console.log('Window lost focus, stopping tracking');
    stopTracking();
  } else {
    // Window gained focus, start tracking the active tab
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        console.log('Window gained focus, starting tracking for tab:', tabs[0].id);
        startTracking(tabs[0].id);
      }
    });
  }
});

// Handle messages from content script and popup
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Received message:', message.type);
  
  switch (message.type) {
    case 'USER_CLARIFICATION':
      // Don't process if extension is paused
      if (settings.isPaused) {
        console.log('Extension is paused, ignoring user clarification');
        return;
      }
      console.log('User clarification:', message.data.isProductive ? 'Productive' : 'Wasted');
      // Store the response for the current tab session only
      currentTabResponses = {
        tabId: sender.tab.id,
        url: message.data.metadata.url,
        response: {
          isProductive: message.data.isProductive,
          confidence: 1.0,
          reason: 'Based on user response'
        }
      };
      
      // Calculate duration if not provided
      const duration = message.data.metadata.duration || (Date.now() - activeTabStartTime);
      
      storeClassificationResult({
        ...message.data,
        metadata: {
          ...message.data.metadata,
          duration: duration,
          timestamp: Date.now()
        },
        isUserClarified: true
      });
      break;
      
    case 'UPDATE_SETTINGS':
      console.log('Settings update:', { ...message.settings, apiKey: '***' });
      const oldInterval = settings.checkInterval;
      const wasPaused = settings.isPaused;
      settings = { ...settings, ...message.settings };
      
      // If check interval changed, restart tracking with new interval
      if (oldInterval !== settings.checkInterval && isTracking && !settings.isPaused) {
        startTracking(activeTabId);
      }
      
      // If unpausing, start tracking the current tab
      if (wasPaused && !settings.isPaused && activeTabId) {
        startTracking(activeTabId);
      }
      // If pausing, stop tracking
      else if (!wasPaused && settings.isPaused) {
        stopTracking();
      }
      
      chrome.storage.local.set({ settings });
      break;
      
    case 'GET_STATS':
      chrome.storage.local.get(['activityLog'], (data) => {
        const activityLog = data.activityLog || [];
        console.log('Sending stats:', {
          totalEntries: activityLog.length,
          productive: activityLog.filter(entry => entry.isProductive).length,
          wasted: activityLog.filter(entry => !entry.isProductive).length
        });
        sendResponse({ activityLog });
      });
      return true;
      
    case 'CHECK_API_KEY':
      sendResponse({ hasApiKey: !!settings.apiKey });
      return true;
  }
});