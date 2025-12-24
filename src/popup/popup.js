document.addEventListener('DOMContentLoaded', async () => {
    const toggleBtn = document.getElementById('toggleBtn');
    const statusText = document.getElementById('statusText');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      statusText.innerText = "No active tab found.";
      toggleBtn.disabled = true;
      return;
    }

    // Check status from background
    chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: tab.id }, (response) => {
      updateUI(response && response.attached);
    });

    toggleBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'TOGGLE_DEBUGGER', tabId: tab.id }, (response) => {
        // The background script will handle the attach/detach and window creation
        // We just update our local UI state based on what it says
        updateUI(response && response.attached);
      });
    });

    function updateUI(attached) {
      if (attached) {
        toggleBtn.textContent = "Disable DevTools";
        toggleBtn.classList.add('active');
        statusText.innerText = "Status: On";
      } else {
        toggleBtn.textContent = "Enable DevTools";
        toggleBtn.classList.remove('active');
        statusText.innerText = "Status: Off";
      }
    }
  });
