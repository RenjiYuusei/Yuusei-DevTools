// devtools.js

// 1. Get tabId from URL
const params = new URLSearchParams(window.location.search);
const tabId = parseInt(params.get('tabId'));

if (!tabId) {
    document.body.innerHTML = "<h1>Error: No tabId provided</h1>";
    throw new Error("No tabId");
}

// 2. State
const networkRequests = new Map(); // requestId -> { url, type, status, ... }
const resources = new Map(); // url -> content

// 3. UI Elements
const networkList = document.getElementById('network-list');
const fileTree = document.getElementById('file-tree');
const codeViewer = document.getElementById('code-viewer');
const clearNetworkBtn = document.getElementById('clear-network');
const filterRadios = document.querySelectorAll('input[name="filter"]');

// 4. Filters
let currentFilter = 'all';

// 5. Initialize Debugger
// Since the background script already attached the debugger, we just need to send commands.
// Note: We need to use chrome.debugger.sendCommand with the tabId.

function sendCommand(method, params = {}) {
    return new Promise((resolve, reject) => {
        chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
            if (chrome.runtime.lastError) {
                console.error("Command failed:", method, chrome.runtime.lastError);
                reject(chrome.runtime.lastError);
            } else {
                resolve(result);
            }
        });
    });
}

// 6. Event Listeners
chrome.debugger.onEvent.addListener((source, method, params) => {
    if (source.tabId !== tabId) return;

    if (method.startsWith('Network.')) {
        handleNetworkEvent(method, params);
    } else if (method.startsWith('Debugger.') || method === 'Page.frameNavigated') {
        // We use Page.getResourceTree instead of stream events for simplicity initially,
        // but Debugger.scriptParsed gives us JS files.
        if (method === 'Debugger.scriptParsed') {
            handleScriptParsed(params);
        }
    }
});

// 7. Initial Setup
async function init() {
    try {
        await sendCommand('Network.enable');
        await sendCommand('Page.enable');
        await sendCommand('Debugger.enable'); // For scripts

        // Initial fetch of resources (non-scripts)
        loadResources();
    } catch (e) {
        console.error("Failed to init debugger protocols", e);
    }
}

// --- Network Logic ---

function handleNetworkEvent(method, params) {
    if (method === 'Network.requestWillBeSent') {
        const { requestId, request, type, initiator, timestamp } = params;
        networkRequests.set(requestId, {
            id: requestId,
            url: request.url,
            name: getFileName(request.url),
            method: request.method,
            type: type || 'Other',
            status: 'Pending',
            size: 0,
            startTime: timestamp,
            display: true
        });
        renderNetworkRow(requestId);
    }
    else if (method === 'Network.responseReceived') {
        const { requestId, response, timestamp } = params;
        const req = networkRequests.get(requestId);
        if (req) {
            req.status = response.status;
            req.mimeType = response.mimeType;
            // Update type if it was missing/generic
            if (!req.type || req.type === 'Other') {
                req.type = mapMimeToType(response.mimeType);
            }
            renderNetworkRow(requestId);
        }
    }
    else if (method === 'Network.loadingFinished') {
        const { requestId, encodedDataLength, timestamp } = params;
        const req = networkRequests.get(requestId);
        if (req) {
            req.size = encodedDataLength;
            req.status = req.status === 'Pending' ? 200 : req.status; // Fallback
            if (req.startTime && timestamp) {
                 // Timestamp is in seconds (with high precision), convert to ms
                 req.time = Math.round((timestamp - req.startTime) * 1000) + ' ms';
            }
            renderNetworkRow(requestId);
        }
    }
    else if (method === 'Network.loadingFailed') {
        const { requestId, errorText } = params;
        const req = networkRequests.get(requestId);
        if (req) {
            req.status = '(failed)';
            req.error = errorText;
            renderNetworkRow(requestId);
        }
    }
}

function getFileName(url) {
    try {
        const u = new URL(url);
        const name = u.pathname.split('/').pop();
        return name || u.hostname;
    } catch (e) {
        return url;
    }
}

function mapMimeToType(mime) {
    if (mime.includes('javascript')) return 'Script';
    if (mime.includes('html')) return 'Document';
    if (mime.includes('css')) return 'Stylesheet';
    if (mime.includes('image')) return 'Image';
    if (mime.includes('json') || mime.includes('xml')) return 'Fetch';
    return 'Other';
}

function renderNetworkRow(requestId) {
    const req = networkRequests.get(requestId);
    if (!req) return;

    // Filter check
    if (!shouldShow(req)) {
        // Remove if exists
        const existing = document.getElementById(`req-${requestId}`);
        if (existing) existing.remove();
        return;
    }

    let tr = document.getElementById(`req-${requestId}`);
    if (!tr) {
        tr = document.createElement('tr');
        tr.id = `req-${requestId}`;
        networkList.appendChild(tr);
    }

    if (req.status === '(failed)') tr.classList.add('error');

    tr.innerHTML = `
        <td title="${req.url}">${req.name}</td>
        <td>${req.status}</td>
        <td>${req.type}</td>
        <td>${formatBytes(req.size)}</td>
        <td>${req.time || 'Pending'}</td>
    `;
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    if (!bytes) return '-';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function shouldShow(req) {
    if (currentFilter === 'all') return true;
    // Map Chrome types (Script, Image, Stylesheet, Media, Font, Document, WebSocket, Other)
    // to our filter values.
    // Fetch/XHR often comes as 'XHR' or 'Fetch' type in Network.requestWillBeSent
    return req.type === currentFilter || (currentFilter === 'Fetch' && req.type === 'XHR');
}

// Filter Listeners
filterRadios.forEach(radio => {
    radio.addEventListener('change', (e) => {
        currentFilter = e.target.value;
        refreshNetworkTable();
    });
});

function refreshNetworkTable() {
    networkList.innerHTML = '';
    for (const [requestId, req] of networkRequests) {
        renderNetworkRow(requestId);
    }
}

clearNetworkBtn.addEventListener('click', () => {
    networkRequests.clear();
    networkList.innerHTML = '';
});

// --- Sources Logic ---

const scriptFiles = new Map(); // url -> scriptId

function handleScriptParsed(params) {
    // params: { scriptId, url, ... }
    if (params.url) {
        scriptFiles.set(params.url, params.scriptId);
        addFileToTree(params.url, 'script', params.scriptId);
    }
}

async function loadResources() {
    const result = await sendCommand('Page.getResourceTree');
    if (result && result.frameTree) {
        processFrameTree(result.frameTree);
    }
}

function processFrameTree(frameTree) {
    // Frame resources
    if (frameTree.resources) {
        frameTree.resources.forEach(res => {
             addFileToTree(res.url, 'resource', null, frameTree.frame.id);
        });
    }
    // Child frames
    if (frameTree.childFrames) {
        frameTree.childFrames.forEach(child => processFrameTree(child));
    }
}

const addedFiles = new Set();

function addFileToTree(url, type, id, frameId = null) {
    if (!url || url.startsWith('chrome-extension:')) return;
    if (addedFiles.has(url)) return;
    addedFiles.add(url);

    const name = getFileName(url);
    const div = document.createElement('div');
    div.className = 'file-tree-item';
    div.textContent = name;
    div.title = url;
    div.onclick = () => loadFileContent(url, type, id, frameId, div);

    fileTree.appendChild(div);
}

async function loadFileContent(url, type, id, frameId, element) {
    // Highlight selection
    document.querySelectorAll('.file-tree-item').forEach(el => el.classList.remove('selected'));
    element.classList.add('selected');

    codeViewer.textContent = "Loading...";

    try {
        let content = '';
        if (type === 'script' && id) {
            const res = await sendCommand('Debugger.getScriptSource', { scriptId: id });
            content = res.scriptSource;
        } else {
            // For Page resources
             const res = await sendCommand('Page.getResourceContent', { frameId: frameId, url: url });
             content = res.content;
        }
        codeViewer.textContent = content;
    } catch (e) {
        codeViewer.textContent = "Failed to load content: " + e.message;
    }
}

// --- Tab Switching ---
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

// Start
init();
