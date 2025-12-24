// Store the state of attached tabs
// Map<tabId, windowId>
const attachedTabs = new Map();

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'GET_STATUS') {
    const isAttached = attachedTabs.has(request.tabId);
    sendResponse({ attached: isAttached });
  }
  else if (request.type === 'TOGGLE_DEBUGGER') {
    const tabId = request.tabId;

    if (attachedTabs.has(tabId)) {
      // Detach
      chrome.debugger.detach({ tabId: tabId }, () => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          sendResponse({ attached: true }); // Failed to detach
          return;
        }
        // Window closing is handled by the onDetach listener or manual
        // We'll let the onDetach listener handle the cleanup
        sendResponse({ attached: false });
      });
    } else {
      // Attach
      chrome.debugger.attach({ tabId: tabId }, "1.3", () => {
        if (chrome.runtime.lastError) {
          console.error(chrome.runtime.lastError);
          sendResponse({ attached: false }); // Failed to attach
          return;
        }

        // Open DevTools window
        chrome.windows.create({
          url: `src/devtools/devtools.html?tabId=${tabId}`,
          type: 'popup',
          width: 800,
          height: 600
        }, (win) => {
            attachedTabs.set(tabId, win.id);
            sendResponse({ attached: true });
        });
      });
    }
    return true; // Async response
  }
});

// Handle detachment (e.g. user clicks "Cancel" on the browser banner)
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (attachedTabs.has(tabId)) {
    const windowId = attachedTabs.get(tabId);
    // Try to close the associated window
    chrome.windows.remove(windowId, () => {
      // Ignore errors if window is already closed
      if (chrome.runtime.lastError) {}
    });
    attachedTabs.delete(tabId);
  }
});

// Optional: If user closes the popup window, we should detach the debugger
chrome.windows.onRemoved.addListener((windowId) => {
    for (const [tabId, winId] of attachedTabs.entries()) {
        if (winId === windowId) {
            chrome.debugger.detach({ tabId: tabId }, () => {
                 if (chrome.runtime.lastError) {}
            });
            attachedTabs.delete(tabId);
            break;
        }
    }
});
