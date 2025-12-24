// network.js
import { getFileName, formatBytes, sendCommand } from './utils.js';

const networkRequests = new Map(); // requestId -> requestData
let currentFilter = 'all';
let networkListEl = null;
let preserveLog = false;
let detailsModal = null;
let detailsBody = null;

export function initNetwork(listElement, filterRadios, clearBtn, preserveCheckbox, modalElement) {
    networkListEl = listElement;

    // Filter Listeners
    filterRadios.forEach(radio => {
        radio.addEventListener('change', (e) => {
            currentFilter = e.target.value;
            refreshNetworkTable();
        });
    });

    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            clearTable();
        });
    }

    if (preserveCheckbox) {
        preserveCheckbox.addEventListener('change', (e) => {
            preserveLog = e.target.checked;
        });
    }

    if (modalElement) {
        detailsModal = modalElement;
        detailsBody = modalElement.querySelector('#details-body');
        modalElement.querySelector('.close-modal').onclick = () => {
            detailsModal.classList.add('hidden');
        };
        // Close on click outside
        window.onclick = (event) => {
            if (event.target === detailsModal) {
                detailsModal.classList.add('hidden');
            }
        };
    }
}

function clearTable() {
    networkRequests.clear();
    networkListEl.innerHTML = '';
}

export function handleNavigation() {
    if (!preserveLog) {
        clearTable();
    }
}

export function handleNetworkEvent(method, params) {
    if (method === 'Network.requestWillBeSent') {
        const { requestId, request, type, timestamp } = params;
        networkRequests.set(requestId, {
            id: requestId,
            url: request.url,
            name: getFileName(request.url),
            method: request.method,
            type: type || 'Other',
            status: 'Pending',
            size: 0,
            startTime: timestamp,
            display: true,
            postData: request.postData,
            requestHeaders: request.headers
        });
        renderNetworkRow(requestId);
    }
    else if (method === 'Network.responseReceived') {
        const { requestId, response } = params;
        const req = networkRequests.get(requestId);
        if (req) {
            req.status = response.status;
            req.mimeType = response.mimeType;
            if (!req.type || req.type === 'Other') {
                req.type = mapMimeToType(response.mimeType);
            }
            req.headers = response.headers;
            renderNetworkRow(requestId);
        }
    }
    else if (method === 'Network.loadingFinished') {
        const { requestId, encodedDataLength, timestamp } = params;
        const req = networkRequests.get(requestId);
        if (req) {
            req.size = encodedDataLength;
            req.status = req.status === 'Pending' ? 200 : req.status;
            if (req.startTime && timestamp) {
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

function mapMimeToType(mime) {
    if (!mime) return 'Other';
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

    if (!shouldShow(req)) {
        const existing = document.getElementById(`req-${requestId}`);
        if (existing) existing.remove();
        return;
    }

    let tr = document.getElementById(`req-${requestId}`);
    if (!tr) {
        tr = document.createElement('tr');
        tr.id = `req-${requestId}`;
        tr.onclick = () => showDetails(req);
        networkListEl.appendChild(tr);
    }

    // Reset classes
    tr.className = '';
    if (req.status === '(failed)' || (typeof req.status === 'number' && req.status >= 400)) {
        tr.classList.add('error');
    }

    let nameContent = `<div class="cell-text">${req.name}</div><div class="cell-sub">${req.method}</div>`;

    // Thumbnail for images
    if (req.type === 'Image') {
         nameContent = `<div class="name-col"><img src="${req.url}" class="row-thumb" alt=""> <div><div class="cell-text">${req.name}</div><div class="cell-sub">${req.method}</div></div></div>`;
    }

    tr.innerHTML = `
        <td title="${req.url}">${nameContent}</td>
        <td>${req.status}</td>
        <td>${req.type}</td>
        <td>${formatBytes(req.size)}</td>
        <td>${req.time || 'Pending'}</td>
    `;
}

async function showDetails(req) {
    if (!detailsModal || !detailsBody) return;

    let html = `
        <div class="details-toolbar">
            <button class="action-btn" id="btn-copy-curl">Copy as cURL</button>
        </div>
        <p><strong>URL:</strong> <span style="word-break: break-all;">${req.url}</span></p>
        <p><strong>Method:</strong> ${req.method}</p>
        <p><strong>Status:</strong> ${req.status}</p>
        <p><strong>Type:</strong> ${req.type}</p>
        <p><strong>Size:</strong> ${formatBytes(req.size)}</p>
        <p><strong>Time:</strong> ${req.time || '-'}</p>
    `;

    if (req.error) {
        html += `<p style="color:red"><strong>Error:</strong> ${req.error}</p>`;
    }

    // Request Headers & Body
    html += `<details open><summary>Request Data</summary>`;
    if (req.postData) {
        html += `<h5>Post Data:</h5><pre class="code-block">${escapeHtml(req.postData)}</pre>`;
    }
    if (req.requestHeaders) {
         html += `<h5>Request Headers:</h5><div class="headers-list">`;
         for (const [key, value] of Object.entries(req.requestHeaders)) {
             html += `<div><strong>${key}:</strong> ${value}</div>`;
         }
         html += `</div>`;
    }
    html += `</details>`;

    // Response Headers
    if (req.headers) {
         html += `<details open><summary>Response Headers</summary><div class="headers-list">`;
         for (const [key, value] of Object.entries(req.headers)) {
             html += `<div><strong>${key}:</strong> ${value}</div>`;
         }
         html += `</div></details>`;
    }

    // Response Body
    html += `<details open><summary>Response Body</summary>`;
    html += `<div id="response-body-content">Loading...</div>`;
    html += `</details>`;

    detailsBody.innerHTML = html;
    detailsModal.classList.remove('hidden');

    // Attach cURL listener
    document.getElementById('btn-copy-curl').onclick = () => {
        const curl = generateCurl(req);
        navigator.clipboard.writeText(curl).then(() => {
            alert('Copied cURL to clipboard');
        });
    };

    // Fetch body
    try {
        const result = await sendCommand('Network.getResponseBody', { requestId: req.id });
        const bodyEl = document.getElementById('response-body-content');
        if (result.base64Encoded) {
            if (req.type === 'Image') {
                bodyEl.innerHTML = `<img src="data:${req.mimeType};base64,${result.body}" style="max-width: 100%;">`;
            } else {
                bodyEl.textContent = "(Base64 Data)";
            }
        } else {
            let content = result.body;
            try {
                // Try to pretty print JSON
                if (req.mimeType.includes('json')) {
                    content = JSON.stringify(JSON.parse(content), null, 2);
                }
            } catch(e) {}
            bodyEl.innerHTML = `<pre class="code-block">${escapeHtml(content)}</pre>`;
        }
    } catch (e) {
        const bodyEl = document.getElementById('response-body-content');
        if (bodyEl) bodyEl.textContent = "Failed to load body (might be empty or restricted).";
    }
}

function generateCurl(req) {
    let curl = `curl '${req.url}'`;
    curl += ` \\\n  -X '${req.method}'`;

    if (req.requestHeaders) {
        for (const [key, value] of Object.entries(req.requestHeaders)) {
            curl += ` \\\n  -H '${key}: ${value}'`;
        }
    }

    if (req.postData) {
        curl += ` \\\n  --data-raw '${req.postData.replace(/'/g, "'\\''")}'`;
    }

    curl += ` \\\n  --compressed`;
    return curl;
}

function escapeHtml(text) {
    if (!text) return '';
    return text
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function shouldShow(req) {
    if (currentFilter === 'all') return true;
    return req.type === currentFilter || (currentFilter === 'Fetch' && req.type === 'XHR');
}

function refreshNetworkTable() {
    networkListEl.innerHTML = '';
    for (const [requestId, req] of networkRequests) {
        renderNetworkRow(requestId);
    }
}
