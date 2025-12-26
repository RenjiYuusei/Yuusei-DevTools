import { sendCommand, escapeHtml } from './utils.js';

let appSidebar = null;
let appContent = null;
let appTableBody = null;
let currentView = { type: null, origin: null }; // { type: 'cookie'|'local'|'session', origin: string }
let mainFrameOrigin = '';
let currentUrl = '';
let lastItems = []; // Store currently displayed items for "Clear All" logic

// Value Preview Modal Elements
let valueModal = null;
let valueModalKey = null;
let valueModalContent = null;
let valueModalClose = null;

// Initialize the Application panel
export function initApplication(sidebarEl, contentEl, tableBodyEl, refreshBtn, clearBtn) {
    appSidebar = sidebarEl;
    appContent = contentEl;
    appTableBody = tableBodyEl;

    // Init Modal
    initValueModal();

    // Listeners for Sidebar
    appSidebar.addEventListener('click', (e) => {
        const item = e.target.closest('.app-sidebar-item');
        if (!item) return;

        // Active state
        document.querySelectorAll('.app-sidebar-item').forEach(el => el.classList.remove('active'));
        item.classList.add('active');

        const type = item.dataset.type;
        currentView.type = type;

        refreshView();
    });

    // Listeners for Buttons
    if (refreshBtn) refreshBtn.addEventListener('click', refreshView);
    if (clearBtn) clearBtn.addEventListener('click', clearCurrentStorage);

    // Initial load helper
    fetchMainFrame();
}

function initValueModal() {
    // Create the modal DOM dynamically if not exists, or expect it in HTML
    // We will expect it in HTML for cleaner code, but if missing, create it.
    // For now, let's assume we will add it to HTML in step 2.
    // Here we just grab references once the module loads/init runs.

    // We will do this lazy or in init.
}

async function fetchMainFrame() {
    try {
        const tree = await sendCommand('Page.getResourceTree');
        if (tree && tree.frameTree && tree.frameTree.frame) {
            mainFrameOrigin = tree.frameTree.frame.securityOrigin;
            currentUrl = tree.frameTree.frame.url;
            updateSidebarOrigins(mainFrameOrigin);
        }
    } catch (e) {
        console.error("Failed to get resource tree", e);
    }
}

function updateSidebarOrigins(origin) {
    // Update the text in sidebar to show the current origin
    document.querySelectorAll('.origin-label').forEach(el => el.textContent = origin);
}

export async function refreshView() {
    if (!currentView.type) return;

    // Always re-fetch origin/url on refresh to handle navigation
    await fetchMainFrame();
    currentView.origin = mainFrameOrigin;

    renderLoading();

    try {
        let data = [];
        if (currentView.type === 'local') {
            data = await getLocalStorage(currentView.origin);
        } else if (currentView.type === 'session') {
            data = await getSessionStorage(currentView.origin);
        } else if (currentView.type === 'cookies') {
            data = await getCookies();
        }
        lastItems = data; // Cache for "Clear All"
        renderTable(data);
    } catch (e) {
        renderError(e.message);
    }
}

// Replaced DOMStorage calls with Runtime.evaluate for robustness
async function getLocalStorage(origin) {
    // We use JSON.stringify(Object.entries(...)) to get all data safely
    const expression = `JSON.stringify(Object.entries(localStorage))`;
    const result = await sendCommand('Runtime.evaluate', { expression, returnByValue: true });

    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text);
    }

    const entries = JSON.parse(result.result.value);
    return entries.map(([key, value]) => ({ key, value }));
}

async function getSessionStorage(origin) {
    const expression = `JSON.stringify(Object.entries(sessionStorage))`;
    const result = await sendCommand('Runtime.evaluate', { expression, returnByValue: true });

    if (result.exceptionDetails) {
        throw new Error(result.exceptionDetails.text);
    }

    const entries = JSON.parse(result.result.value);
    return entries.map(([key, value]) => ({ key, value }));
}

async function getCookies() {
    // Network.getCookies returns { cookies: [...] }
    // Pass urls to limit to current page if possible, prevents flooding with unrelated cookies
    const params = currentUrl ? { urls: [currentUrl] } : {};
    const result = await sendCommand('Network.getCookies', params);

    // Map to key/value structure for the table
    return result.cookies.map(c => ({
        key: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path,
        expires: c.expires
    }));
}

// Rendering
function renderLoading() {
    appTableBody.innerHTML = '<tr><td colspan="2">Loading...</td></tr>';
}

function renderError(msg) {
    appTableBody.innerHTML = `<tr><td colspan="2" class="error">Error: ${escapeHtml(msg)}</td></tr>`;
}

function renderTable(items) {
    appTableBody.innerHTML = '';
    if (items.length === 0) {
        appTableBody.innerHTML = '<tr><td colspan="2" class="empty">No items found</td></tr>';
        return;
    }

    items.forEach(item => {
        const tr = document.createElement('tr');

        const tdKey = document.createElement('td');
        tdKey.className = 'key-col';
        tdKey.textContent = item.key;

        const tdValue = document.createElement('td');
        tdValue.className = 'value-col';
        tdValue.textContent = item.value;

        // Add delete button
        const delBtn = document.createElement('span');
        delBtn.className = 'delete-icon';
        delBtn.innerHTML = '&times;';
        delBtn.title = 'Delete Item';
        delBtn.onclick = (e) => {
            e.stopPropagation();
            deleteItem(item);
        };
        tdKey.prepend(delBtn);

        // Click on row to view details
        tr.onclick = () => {
             showValueModal(item);
        };

        // If it's a cookie, maybe show tooltip with more info
        if (currentView.type === 'cookies') {
            tr.title = `Domain: ${item.domain}\nPath: ${item.path}\nExpires: ${item.expires}`;
        }

        tr.appendChild(tdKey);
        tr.appendChild(tdValue);
        appTableBody.appendChild(tr);
    });
}

// Actions
async function deleteItem(item) {
    if (!confirm(`Delete item "${item.key}"?`)) return;

    try {
        if (currentView.type === 'local') {
            await sendCommand('Runtime.evaluate', {
                expression: `localStorage.removeItem(${JSON.stringify(item.key)})`
            });
        } else if (currentView.type === 'session') {
            await sendCommand('Runtime.evaluate', {
                expression: `sessionStorage.removeItem(${JSON.stringify(item.key)})`
            });
        } else if (currentView.type === 'cookies') {
             await sendCommand('Network.deleteCookies', {
                name: item.key,
                url: currentUrl || undefined, // Use currentUrl if available
                domain: item.domain,
                path: item.path
            });
        }
        refreshView();
    } catch (e) {
        alert("Failed to delete: " + e.message);
    }
}

async function clearCurrentStorage() {
    if (!currentView.type) return;
    if (lastItems.length === 0) return;
    if (!confirm(`Clear all ${currentView.type} items?`)) return;

    try {
        if (currentView.type === 'local') {
             await sendCommand('Runtime.evaluate', { expression: `localStorage.clear()` });
        } else if (currentView.type === 'session') {
             await sendCommand('Runtime.evaluate', { expression: `sessionStorage.clear()` });
        } else if (currentView.type === 'cookies') {
            // Safer clear: delete only visible cookies
            for (const item of lastItems) {
                 await sendCommand('Network.deleteCookies', {
                    name: item.key,
                    url: currentUrl || undefined,
                    domain: item.domain,
                    path: item.path
                });
            }
        }
        refreshView();
    } catch (e) {
        alert("Failed to clear: " + e.message);
    }
}

// Value Preview Modal Logic
function showValueModal(item) {
    const modal = document.getElementById('value-preview-modal');
    if (!modal) return;

    document.getElementById('value-preview-key').textContent = item.key;

    const contentBox = document.getElementById('value-preview-content');

    // Try to format JSON
    let displayValue = item.value;
    try {
        const obj = JSON.parse(item.value);
        displayValue = JSON.stringify(obj, null, 2);
    } catch (e) {
        // Not JSON, use as is
    }

    contentBox.textContent = displayValue;

    modal.classList.remove('hidden');

    // Close handlers
    const closeBtn = document.getElementById('value-preview-close');
    closeBtn.onclick = () => modal.classList.add('hidden');

    // Close on click outside
    modal.onclick = (e) => {
        if (e.target === modal) modal.classList.add('hidden');
    }
}
