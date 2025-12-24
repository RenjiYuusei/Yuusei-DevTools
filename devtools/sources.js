// sources.js
import { getFileName, sendCommand, escapeHtml } from './utils.js';

let fileTreeEl = null;
let codeViewerEl = null;
const scriptFiles = new Map(); // url -> scriptId
const resourcesMap = new Map(); // url -> { type, id, frameId }

// Tree Structure: { name: string, path: string, children: Map<string, Node>, type: 'folder'|'file', ... }
const rootNode = { name: 'root', children: new Map(), type: 'root' };

export function initSources(treeElement, viewerElement) {
    fileTreeEl = treeElement;
    codeViewerEl = viewerElement;
}

export function handleScriptParsed(params) {
    if (params.url) {
        scriptFiles.set(params.url, params.scriptId);
        addFileToTreeModel(params.url, 'script', params.scriptId);
    }
}

export async function loadResources() {
    const result = await sendCommand('Page.getResourceTree');
    if (result && result.frameTree) {
        processFrameTree(result.frameTree);
    }
    renderTree();
}

function processFrameTree(frameTree) {
    if (frameTree.resources) {
        frameTree.resources.forEach(res => {
             addFileToTreeModel(res.url, 'resource', null, frameTree.frame.id);
        });
    }
    if (frameTree.childFrames) {
        frameTree.childFrames.forEach(child => processFrameTree(child));
    }
}

function addFileToTreeModel(url, type, id, frameId = null) {
    if (!url || url.startsWith('chrome-extension:') || url.startsWith('devtools:')) return;

    // Store metadata
    resourcesMap.set(url, { type, id, frameId });

    try {
        const u = new URL(url);
        const host = u.hostname;
        const pathParts = u.pathname.split('/').filter(p => p);
        const search = u.search; // Append search to filename if needed

        // Ensure host node exists
        if (!rootNode.children.has(host)) {
            rootNode.children.set(host, {
                name: host,
                path: host,
                children: new Map(),
                type: 'domain',
                expanded: true
            });
        }
        let currentNode = rootNode.children.get(host);

        // Traverse path
        for (let i = 0; i < pathParts.length; i++) {
            const part = pathParts[i];
            const isFile = (i === pathParts.length - 1);

            if (isFile) {
                // File Node
                const fileName = part + search;
                currentNode.children.set(fileName, {
                    name: fileName,
                    path: url,
                    type: 'file',
                    url: url
                });
            } else {
                // Folder Node
                if (!currentNode.children.has(part)) {
                    currentNode.children.set(part, {
                        name: part,
                        path: currentNode.path + '/' + part,
                        children: new Map(),
                        type: 'folder',
                        expanded: false
                    });
                }
                currentNode = currentNode.children.get(part);
            }
        }

        // Handle root files (no path)
        if (pathParts.length === 0) {
             const fileName = '(index)' + search;
             currentNode.children.set(fileName, {
                 name: fileName,
                 path: url,
                 type: 'file',
                 url: url
             });
        }

        requestRender();

    } catch (e) {
        console.error("Error parsing URL", url, e);
    }
}

let renderPending = false;
function requestRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
        renderTree();
        renderPending = false;
    });
}

function renderTree() {
    if (!fileTreeEl) return;
    fileTreeEl.innerHTML = '';

    // Convert Map to Array and Sort
    const domains = Array.from(rootNode.children.values()).sort((a,b) => a.name.localeCompare(b.name));

    domains.forEach(domain => {
        fileTreeEl.appendChild(createTreeNode(domain, 0));
    });
}

function createTreeNode(node, level) {
    const container = document.createElement('div');

    const row = document.createElement('div');
    row.className = `tree-row ${node.type}`;
    row.style.paddingLeft = (level * 15) + 5 + 'px';

    // Icon
    let iconStr = '';
    if (node.type === 'domain') {
        iconStr = '<span class="icon">☁️</span>';
    } else if (node.type === 'folder') {
        iconStr = '<span class="icon">📁</span>';
    } else {
        // File
        if (node.name.endsWith('.js') || node.name.includes('.js?')) {
            iconStr = '<span class="icon-js-file"></span>';
        } else if (node.name.endsWith('.css') || node.name.includes('.css?')) {
            iconStr = '<span class="icon-css-file"></span>';
        } else {
            iconStr = '<span class="icon">📄</span>';
        }
    }

    // Toggle Arrow for folders/domains
    let arrow = '';
    if (node.children) {
        arrow = `<span class="arrow ${node.expanded ? 'expanded' : ''}">▶</span>`;
    } else {
        arrow = `<span class="arrow spacer"></span>`;
    }

    row.innerHTML = `${arrow} ${iconStr} <span class="label">${escapeHtml(node.name)}</span>`;

    // Event Listeners
    row.onclick = (e) => {
        e.stopPropagation();
        if (node.children) {
            node.expanded = !node.expanded;
            renderTree(); // Re-render to show/hide children
        } else {
            // File click
            loadFileContent(node.url);
            // Visual selection
            document.querySelectorAll('.tree-row').forEach(el => el.classList.remove('selected'));
            row.classList.add('selected');
        }
    };

    container.appendChild(row);

    // Render Children if expanded
    if (node.children && node.expanded) {
        const children = Array.from(node.children.values()).sort((a,b) => {
            // Folders first
            if (a.children && !b.children) return -1;
            if (!a.children && b.children) return 1;
            return a.name.localeCompare(b.name);
        });

        children.forEach(child => {
            container.appendChild(createTreeNode(child, level + 1));
        });
    }

    return container;
}

async function loadFileContent(url) {
    codeViewerEl.textContent = "Loading...";
    const meta = resourcesMap.get(url);
    if (!meta) return;

    try {
        let content = '';
        if (meta.type === 'script' && meta.id) {
            const res = await sendCommand('Debugger.getScriptSource', { scriptId: meta.id });
            content = res.scriptSource;
        } else {
             const res = await sendCommand('Page.getResourceContent', { frameId: meta.frameId, url: url });
             content = res.content;
        }

        // Simple syntax coloring prep (could be extended)
        codeViewerEl.innerHTML = '';
        const pre = document.createElement('pre');
        pre.className = 'code-block full-size';
        pre.textContent = content;
        codeViewerEl.appendChild(pre);

    } catch (e) {
        codeViewerEl.textContent = "Failed to load content: " + e.message;
    }
}
