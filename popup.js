document.addEventListener('DOMContentLoaded', async () => {
    const statusEl = document.getElementById('status');
    const toggleBtn = document.getElementById('toggleBtn');

    // Get current tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
        statusEl.textContent = 'No active tab';
        toggleBtn.disabled = true;
        return;
    }

    // Check status
    chrome.runtime.sendMessage({ type: 'GET_STATUS', tabId: tab.id }, (response) => {
        updateUI(response && response.attached);
    });

    toggleBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'TOGGLE_DEVTOOLS', tabId: tab.id }, (response) => {
             updateUI(response && response.attached);
             // Close popup if opening
             if (response && response.attached) {
                 window.close();
             }
        });
    });

    function updateUI(isAttached) {
        if (isAttached) {
            statusEl.textContent = 'Status: Active';
            statusEl.className = 'status active';
            toggleBtn.textContent = 'Close DevTools';
            toggleBtn.className = 'btn-disable';
        } else {
            statusEl.textContent = 'Status: Inactive';
            statusEl.className = 'status inactive';
            toggleBtn.textContent = 'Open DevTools';
            toggleBtn.className = 'btn-enable';
        }
    }
});
