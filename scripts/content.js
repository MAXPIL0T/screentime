chrome.runtime.sendMessage({ type: 'page_loaded' });

// Create and inject the clarification prompt UI
function createClarificationPrompt() {
  const prompt = document.createElement('div');
  prompt.id = 'productivity-clarification-prompt';
  prompt.style.cssText = `
    position: fixed;
    bottom: 20px;
    right: 20px;
    background: white;
    padding: 15px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0,0,0,0.1);
    z-index: 999999;
    font-family: system-ui, -apple-system, sans-serif;
    display: none;
  `;
  
  prompt.innerHTML = `
    <div color="#666" style="margin-bottom: 10px;">Is this activity productive?</div>
    <div style="display: flex; gap: 10px;">
      <button id="productive-yes" style="padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">Yes</button>
      <button id="productive-no" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">No</button>
    </div>
    <div id="auto-response-timer" style="margin-top: 8px; font-size: 12px; color: #666;"></div>
  `;
  
  document.body.appendChild(prompt);

  let autoResponseTimeout = null;
  let countdownInterval = null;
  let secondsLeft = 6;

  function updateTimerDisplay() {
    const timerElement = document.getElementById('auto-response-timer');
    if (timerElement) {
      timerElement.textContent = `Auto-responding in ${secondsLeft} seconds...`;
    }
  }

  function clearAutoResponse() {
    if (autoResponseTimeout) {
      clearTimeout(autoResponseTimeout);
      autoResponseTimeout = null;
    }
    if (countdownInterval) {
      clearInterval(countdownInterval);
      countdownInterval = null;
    }
    const timerElement = document.getElementById('auto-response-timer');
    if (timerElement) {
      timerElement.textContent = 'Auto-responding off';
    }
  }

  function sendUserResponse(isProductive, isAutoResponse = false) {
    clearAutoResponse();
    const currentUrl = window.location.href;
    const metadata = {
      url: currentUrl,
      title: document.title,
      timestamp: Date.now(),
      duration: 0  // Let background script calculate the actual duration
    };

    // Update lastResponseUrl before sending message
    lastResponseUrl = currentUrl;

    chrome.runtime.sendMessage({
      type: 'USER_CLARIFICATION',
      data: {
        isProductive,
        confidence: 1.0,
        metadata,
        isAutoResponse
      }
    });
    prompt.style.display = 'none';
  }

  // Add event listeners after the elements are created
  const yesButton = document.getElementById('productive-yes');
  const noButton = document.getElementById('productive-no');

  if (yesButton) {
    yesButton.addEventListener('click', () => {
      sendUserResponse(true);
    });
  }

  if (noButton) {
    noButton.addEventListener('click', () => {
      sendUserResponse(false);
    });
  }

  // Add hover listeners to pause auto-response
  prompt.addEventListener('mouseenter', () => {
    clearAutoResponse();
  });

  prompt.addEventListener('mouseleave', (event) => {
    // Only restart timer if we're not hovering over the prompt or its children
    if (!prompt.contains(event.relatedTarget)) {
      startAutoResponseTimer();
    }
  });

  // Function to start the auto-response timer
  function startAutoResponseTimer() {
    // Clear any existing timers first
    clearAutoResponse();
    
    secondsLeft = 6;
    updateTimerDisplay();

    countdownInterval = setInterval(() => {
      secondsLeft--;
      updateTimerDisplay();
      if (secondsLeft <= 0) {
        clearInterval(countdownInterval);
      }
    }, 1000);

    autoResponseTimeout = setTimeout(() => {
      console.log('Auto-responding with AI classification');
      if (prompt.aiResponse) {
        sendUserResponse(prompt.aiResponse.isProductive, true);
      }
    }, 6000);
  }

  // Attach the startAutoResponseTimer function to the prompt object
  prompt.startAutoResponseTimer = startAutoResponseTimer;

  return prompt;
}

// Initialize the prompt UI
let prompt = null;
let lastResponseUrl = null;

// Reset state when tab is activated
function resetState() {
  lastResponseUrl = null;
  if (prompt) {
    prompt.style.display = 'none';
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  console.log('Content script received message:', message.type);
  
  if (message.type === 'TAB_ACTIVATED') {
    console.log('Tab activated, resetting state');
    resetState();
  }
  else if (message.type === 'SHOW_CLARIFICATION') {
    const currentUrl = window.location.href;
    
    // Don't show prompt if we already have a response for this URL in this session
    if (lastResponseUrl === currentUrl) {
      console.log('Already have user response for this URL, skipping prompt');
      return;
    }
    
    console.log('Showing clarification prompt');
    if (!prompt) {
      prompt = createClarificationPrompt();
    }
    
    // Store AI response and show prompt
    prompt.aiResponse = message.data;
    prompt.style.display = 'block';
    
    // Start the auto-response timer
    prompt.startAutoResponseTimer();
  }
});