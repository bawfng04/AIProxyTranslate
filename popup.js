/**
 * popup.js — Settings, Custom Buttons, and History
 */

'use strict';

// ── DOM refs ──────────────────────────────────────────────────────────────────

// Tab system
const tabBtns = document.querySelectorAll('.tab-btn');
const panels = document.querySelectorAll('.panel');

// Settings tab
const apiUrlInput = document.getElementById('api-url');
const apiKeyInput = document.getElementById('api-key');
const modelNameInput = document.getElementById('model-name');
const saveBtn = document.getElementById('save-btn');
const statusBanner = document.getElementById('status-banner');

// Buttons tab
const customBtnList = document.getElementById('custom-btn-list');
const emptyState = document.getElementById('empty-state');
const addNewBtn = document.getElementById('add-new-btn');
const addForm = document.getElementById('add-form');
const formBtnName = document.getElementById('form-btn-name');
const formBtnPrompt = document.getElementById('form-btn-prompt');
const formSaveBtn = document.getElementById('form-save-btn');
const formCancelBtn = document.getElementById('form-cancel-btn');

// History tab
const historyList = document.getElementById('history-list');
const clearHistoryBtn = document.getElementById('clear-history-btn');

// ── State ─────────────────────────────────────────────────────────────────────
let customButtons = [];
let editingId = null;

// ── Init ──────────────────────────────────────────────────────────────────────
setupTabs();
loadSettings();
loadCustomButtons();

// ── Tab switching ─────────────────────────────────────────────────────────────
function setupTabs() {
    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            tabBtns.forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
            panels.forEach((p) => p.classList.toggle('active', p.id === `panel-${tab}`));
            if (tab === 'history') loadHistory();
        });
    });
}

// ── API Settings ──────────────────────────────────────────────────────────────
saveBtn.addEventListener('click', () => {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelNameInput.value.trim();
    if (!apiUrl) { showStatus('Please enter a valid API Base URL.', 'error'); return; }
    chrome.storage.sync.set(
        { API_BASE_URL: apiUrl, API_KEY: apiKey, MODEL_NAME: model || 'gpt-4o-mini' },
        () => {
            if (chrome.runtime.lastError) showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
            else showStatus('✓ API settings saved!', 'success');
        }
    );
});

function loadSettings() {
    chrome.storage.sync.get(['API_BASE_URL', 'API_KEY', 'MODEL_NAME'], (result) => {
        apiUrlInput.value = result.API_BASE_URL || '';
        apiKeyInput.value = result.API_KEY || '';
        modelNameInput.value = result.MODEL_NAME || 'gpt-4o-mini';
    });
}

// ── Custom Buttons ────────────────────────────────────────────────────────────
function loadCustomButtons() {
    chrome.storage.sync.get(['customButtons'], (result) => {
        customButtons = result.customButtons || [];
        renderCustomButtonList();
    });
}

function renderCustomButtonList() {
    Array.from(customBtnList.querySelectorAll('.custom-btn-item')).forEach((el) => el.remove());
    emptyState.style.display = customButtons.length === 0 ? 'block' : 'none';

    customButtons.forEach((btn) => {
        const item = document.createElement('div');
        item.className = 'custom-btn-item';
        item.dataset.id = btn.id;

        const info = document.createElement('div');
        info.className = 'custom-btn-item-info';
        const nameEl = document.createElement('div');
        nameEl.className = 'custom-btn-item-name';
        nameEl.textContent = btn.name;
        const promptEl = document.createElement('div');
        promptEl.className = 'custom-btn-item-prompt';
        promptEl.textContent = btn.prompt;
        info.appendChild(nameEl);
        info.appendChild(promptEl);

        const editBtn = document.createElement('button');
        editBtn.className = 'item-action-btn edit-btn';
        editBtn.title = 'Edit';
        editBtn.textContent = '✏️';
        editBtn.addEventListener('click', () => openEditForm(btn.id));

        const delBtn = document.createElement('button');
        delBtn.className = 'item-action-btn delete-btn';
        delBtn.title = 'Delete';
        delBtn.textContent = '🗑️';
        delBtn.addEventListener('click', () => deleteCustomButton(btn.id));

        item.appendChild(info);
        item.appendChild(editBtn);
        item.appendChild(delBtn);
        customBtnList.appendChild(item);
    });
}

addNewBtn.addEventListener('click', () => {
    editingId = null;
    formBtnName.value = '';
    formBtnPrompt.value = '';
    formSaveBtn.textContent = 'Save Button';
    addForm.style.display = 'flex';
    addForm.style.flexDirection = 'column';
    addNewBtn.style.display = 'none';
    formBtnName.focus();
});

function openEditForm(id) {
    const btn = customButtons.find((b) => b.id === id);
    if (!btn) return;
    editingId = id;
    formBtnName.value = btn.name;
    formBtnPrompt.value = btn.prompt;
    formSaveBtn.textContent = 'Update Button';
    addForm.style.display = 'flex';
    addForm.style.flexDirection = 'column';
    addNewBtn.style.display = 'none';
    formBtnName.focus();
}

formCancelBtn.addEventListener('click', closeForm);
function closeForm() {
    addForm.style.display = 'none';
    addNewBtn.style.display = '';
    editingId = null;
    formBtnName.value = '';
    formBtnPrompt.value = '';
}

formSaveBtn.addEventListener('click', () => {
    const name = formBtnName.value.trim();
    const prompt = formBtnPrompt.value.trim();
    if (!name) { flashInvalid(formBtnName); return; }
    if (!prompt) { flashInvalid(formBtnPrompt); return; }

    if (editingId !== null) {
        customButtons = customButtons.map((b) => b.id === editingId ? { ...b, name, prompt } : b);
    } else {
        customButtons.push({ id: `custom-${Date.now()}`, name, prompt });
    }

    saveCustomButtons(() => {
        renderCustomButtonList();
        closeForm();
        showStatus(editingId ? '✓ Button updated!' : '✓ Button added!', 'success');
    });
});

function flashInvalid(el) {
    el.style.borderColor = 'rgba(239,68,68,0.6)';
    el.focus();
    setTimeout(() => (el.style.borderColor = ''), 1500);
}

function deleteCustomButton(id) {
    customButtons = customButtons.filter((b) => b.id !== id);
    saveCustomButtons(() => { renderCustomButtonList(); showStatus('Button deleted.', 'success'); });
}

function saveCustomButtons(cb) {
    chrome.storage.sync.set({ customButtons }, () => {
        if (chrome.runtime.lastError) showStatus('Error: ' + chrome.runtime.lastError.message, 'error');
        else cb && cb();
    });
}

// ── History ───────────────────────────────────────────────────────────────────
function loadHistory() {
    chrome.storage.local.get(['aiHistory'], (result) => {
        const history = result.aiHistory || [];
        renderHistory(history);
    });
}

function renderHistory(history) {
    historyList.innerHTML = '';

    if (history.length === 0) {
        historyList.innerHTML = '<div class="history-empty">No history yet. Use the toolbar on any page!</div>';
        return;
    }

    history.forEach((entry) => {
        const item = document.createElement('div');
        item.className = 'history-item';

        const meta = document.createElement('div');
        meta.className = 'history-item-meta';

        const time = document.createElement('span');
        time.className = 'history-item-time';
        time.textContent = formatDate(entry.timestamp);

        const copyBtn = document.createElement('button');
        copyBtn.className = 'history-item-copy';
        copyBtn.textContent = 'Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(entry.response).then(() => {
                copyBtn.textContent = 'Copied!';
                setTimeout(() => (copyBtn.textContent = 'Copy'), 1800);
            });
        });

        meta.appendChild(time);
        meta.appendChild(copyBtn);

        const inputEl = document.createElement('div');
        inputEl.className = 'history-item-input';
        inputEl.textContent = `"${entry.selectedText}"`;

        const respEl = document.createElement('div');
        respEl.className = 'history-item-response';
        respEl.textContent = entry.response;

        item.appendChild(meta);
        item.appendChild(inputEl);
        item.appendChild(respEl);
        historyList.appendChild(item);
    });
}

clearHistoryBtn.addEventListener('click', () => {
    chrome.storage.local.set({ aiHistory: [] }, () => {
        renderHistory([]);
        showStatus('History cleared.', 'success');
    });
});

function formatDate(ts) {
    const d = new Date(ts);
    return d.toLocaleDateString() + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// ── Status banner ─────────────────────────────────────────────────────────────
let statusTimer = null;
function showStatus(message, type) {
    statusBanner.textContent = message;
    statusBanner.className = type;
    statusBanner.style.display = 'block';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => (statusBanner.style.display = 'none'), 3000);
}
