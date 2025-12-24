// Store the state of attached tabs
// Map<tabId, windowId>
const attachedTabs = new Map();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.type === 'GET_STATUS') {
        const isAttached = attachedTabs.has(message.tabId);
        sendResponse({ attached: isAttached });
    } else if (message.type === 'TOGGLE_DEVTOOLS') {
        const tabId = message.tabId;
        if (attachedTabs.has(tabId)) {
            const windowId = attachedTabs.get(tabId);
            chrome.windows.remove(windowId).catch(() => {});
            detachAndClean(tabId);
            sendResponse({ attached: false });
        } else {
            attachAndOpen(tabId);
            sendResponse({ attached: true });
        }
    }
    return true; // async response
});

function attachAndOpen(tabId) {
    const protocolVersion = "1.3";
    chrome.debugger.attach({ tabId: tabId }, protocolVersion, () => {
        if (chrome.runtime.lastError) {
            console.error("Attach failed:", chrome.runtime.lastError.message);
            if (chrome.runtime.lastError.message.includes("Already attached")) {
                // Force detach and retry
                chrome.debugger.detach({ tabId: tabId }, () => {
                    if (chrome.runtime.lastError) { /* ignore */ }
                    setTimeout(() => {
                        chrome.debugger.attach({ tabId: tabId }, protocolVersion, () => {
                            if (chrome.runtime.lastError) {
                                console.error("Retry attach failed:", chrome.runtime.lastError.message);
                                return;
                            }
                            openWindow(tabId);
                        });
                    }, 100);
                });
            }
            return;
        }
        openWindow(tabId);
    });
}

function openWindow(tabId) {
    chrome.windows.create({
        url: `devtools/devtools.html?tabId=${tabId}`,
        type: 'popup',
        width: 800,
        height: 600
    }, (win) => {
        attachedTabs.set(tabId, win.id);
    });
}

function detachAndClean(tabId) {
    chrome.debugger.detach({ tabId: tabId }, () => {
        if (chrome.runtime.lastError) {}
    });
    attachedTabs.delete(tabId);
}

// Handle detachment (e.g. user clicks "Cancel" on the browser banner)
chrome.debugger.onDetach.addListener((source, reason) => {
  const tabId = source.tabId;
  if (attachedTabs.has(tabId)) {
    const windowId = attachedTabs.get(tabId);
    // Try to close the associated window
    chrome.windows.remove(windowId, () => {
      if (chrome.runtime.lastError) {}
    });
    attachedTabs.delete(tabId);
  }
});

// If user closes the devtools window, we should detach
chrome.windows.onRemoved.addListener((windowId) => {
    for (const [tabId, winId] of attachedTabs.entries()) {
        if (winId === windowId) {
            detachAndClean(tabId);
            break;
        }
    }
});
