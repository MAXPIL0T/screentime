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
    <div style="margin-bottom: 10px;">Is this activity productive?</div>
    <div style="display: flex; gap: 10px;">
      <button id="productive-yes" style="padding: 5px 10px; background: #4CAF50; color: white; border: none; border-radius: 4px; cursor: pointer;">Yes</button>
      <button id="productive-no" style="padding: 5px 10px; background: #f44336; color: white; border: none; border-radius: 4px; cursor: pointer;">No</button>
    </div>
  `;
  
  document.body.appendChild(prompt);
  return prompt;
}

// Initialize the prompt UI
const prompt = createClarificationPrompt();

// Handle prompt button clicks
document.getElementById('productive-yes').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'USER_CLARIFICATION',
    data: {
      isProductive: true,
      confidence: 1.0,
      metadata: {
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      }
    }
  });
  prompt.style.display = 'none';
});

document.getElementById('productive-no').addEventListener('click', () => {
  chrome.runtime.sendMessage({
    type: 'USER_CLARIFICATION',
    data: {
      isProductive: false,
      confidence: 1.0,
      metadata: {
        url: window.location.href,
        title: document.title,
        timestamp: Date.now()
      }
    }
  });
  prompt.style.display = 'none';
});

// Listen for messages from the background script
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'SHOW_CLARIFICATION') {
    prompt.style.display = 'block';
  }
});