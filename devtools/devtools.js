import { setTabId, sendCommand } from './utils.js';
import * as Network from './network.js';
import * as Sources from './sources.js';

// 1. Get tabId from URL
const params = new URLSearchParams(window.location.search);
const tabId = parseInt(params.get('tabId'));

if (!tabId) {
    document.body.innerHTML = "<h1>Error: No tabId provided</h1>";
    throw new Error("No tabId");
}

// Keep-Alive Connection
try {
    const port = chrome.runtime.connect({ name: 'devtools-page' });
    port.onDisconnect.addListener(() => {
        console.log("Disconnected from background");
    });
} catch (e) {
    console.error("Failed to connect to background:", e);
}

setTabId(tabId);

// 2. UI Elements & Init
const networkList = document.getElementById('network-list');
const filterRadios = document.querySelectorAll('input[name="filter"]');
const clearNetworkBtn = document.getElementById('clear-network');
const preserveCheckbox = document.getElementById('preserve-log');
const detailsModal = document.getElementById('details-modal');

const fileTree = document.getElementById('file-tree');
const codeViewer = document.getElementById('code-viewer');

Network.initNetwork(networkList, filterRadios, clearNetworkBtn, preserveCheckbox, detailsModal);
Sources.initSources(fileTree, codeViewer);

// Expose modules for testing/debugging
window.Network = Network;
window.Sources = Sources;

// 3. Tab Switching
const tabs = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');

tabs.forEach(tab => {
    tab.addEventListener('click', () => {
        tabs.forEach(t => t.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));

        tab.classList.add('active');
        const target = tab.dataset.tab;
        document.getElementById(`${target}-panel`).classList.add('active');
    });
});

// 4. Event Listeners
if (typeof chrome !== 'undefined' && chrome.debugger) {
    chrome.debugger.onEvent.addListener((source, method, params) => {
        if (source.tabId !== tabId) return;

        if (method.startsWith('Network.')) {
            Network.handleNetworkEvent(method, params);
        }
        else if (method === 'Page.frameNavigated') {
            // Only handle top frame navigation for clearing
            if (!params.frame || !params.frame.parentId) {
                 Network.handleNavigation();
            }
        }
        else if (method.startsWith('Debugger.')) {
            if (method === 'Debugger.scriptParsed') {
                Sources.handleScriptParsed(params);
            }
        }
    });
}

// 5. Initial Setup
async function init() {
    try {
        await sendCommand('Network.enable');
        await sendCommand('Page.enable');
        await sendCommand('Debugger.enable'); // For scripts

        // Initial fetch of resources (non-scripts)
        Sources.loadResources();
    } catch (e) {
        console.error("Failed to init debugger protocols", e);
    }
}

// Start
init();
