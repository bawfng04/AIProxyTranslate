/**
 * popup.js — Settings & Custom Button Management
 */

'use strict';

// ── DOM refs ──
const apiUrlInput = document.getElementById('api-url');
const apiKeyInput = document.getElementById('api-key');
const modelNameInput = document.getElementById('model-name');
const saveBtn = document.getElementById('save-btn');
const statusBanner = document.getElementById('status-banner');

const customBtnList = document.getElementById('custom-btn-list');
const emptyState = document.getElementById('empty-state');
const addNewBtn = document.getElementById('add-new-btn');
const addForm = document.getElementById('add-form');
const formBtnName = document.getElementById('form-btn-name');
const formBtnPrompt = document.getElementById('form-btn-prompt');
const formSaveBtn = document.getElementById('form-save-btn');
const formCancelBtn = document.getElementById('form-cancel-btn');

// ── State ──
let customButtons = [];   // Array of { id, name, prompt }
let editingId = null; // null = adding new, string = editing existing

// ── Init ──
loadSettings();
loadCustomButtons();

// ── Save API settings ──
saveBtn.addEventListener('click', () => {
    const apiUrl = apiUrlInput.value.trim();
    const apiKey = apiKeyInput.value.trim();
    const model = modelNameInput.value.trim();

    if (!apiUrl) {
        showStatus('Please enter a valid API Base URL.', 'error');
        return;
    }

    chrome.storage.sync.set(
        { API_BASE_URL: apiUrl, API_KEY: apiKey, MODEL_NAME: model || 'gpt-4o-mini' },
        () => {
            if (chrome.runtime.lastError) {
                showStatus('Error saving: ' + chrome.runtime.lastError.message, 'error');
            } else {
                showStatus('✓ API settings saved successfully!', 'success');
            }
        }
    );
});

// ── Load API settings from storage ──
function loadSettings() {
    chrome.storage.sync.get(['API_BASE_URL', 'API_KEY', 'MODEL_NAME'], (result) => {
        apiUrlInput.value = result.API_BASE_URL || '';
        apiKeyInput.value = result.API_KEY || '';
        modelNameInput.value = result.MODEL_NAME || 'gpt-4o-mini';
    });
}

// ── Load custom buttons ──
function loadCustomButtons() {
    chrome.storage.sync.get(['customButtons'], (result) => {
        customButtons = result.customButtons || [];
        renderCustomButtonList();
    });
}

// ── Render the list of custom buttons ──
function renderCustomButtonList() {
    // Remove old item elements (keep empty-state element)
    Array.from(customBtnList.querySelectorAll('.custom-btn-item')).forEach((el) =>
        el.remove()
    );

    if (customButtons.length === 0) {
        emptyState.style.display = 'block';
        return;
    }

    emptyState.style.display = 'none';

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

// ── Open add form ──
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

// ── Open edit form ──
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

// ── Cancel form ──
formCancelBtn.addEventListener('click', closeForm);

function closeForm() {
    addForm.style.display = 'none';
    addNewBtn.style.display = '';
    editingId = null;
    formBtnName.value = '';
    formBtnPrompt.value = '';
}

// ── Save / update button ──
formSaveBtn.addEventListener('click', () => {
    const name = formBtnName.value.trim();
    const prompt = formBtnPrompt.value.trim();

    if (!name) {
        formBtnName.focus();
        formBtnName.style.borderColor = 'rgba(239,68,68,0.6)';
        setTimeout(() => (formBtnName.style.borderColor = ''), 1500);
        return;
    }

    if (!prompt) {
        formBtnPrompt.focus();
        formBtnPrompt.style.borderColor = 'rgba(239,68,68,0.6)';
        setTimeout(() => (formBtnPrompt.style.borderColor = ''), 1500);
        return;
    }

    if (editingId !== null) {
        // Update existing
        customButtons = customButtons.map((b) =>
            b.id === editingId ? { ...b, name, prompt } : b
        );
    } else {
        // Add new
        const newBtn = {
            id: `custom-${Date.now()}`,
            name,
            prompt,
        };
        customButtons.push(newBtn);
    }

    saveCustomButtons(() => {
        renderCustomButtonList();
        closeForm();
        showStatus(
            editingId ? '✓ Button updated!' : '✓ Button added!',
            'success'
        );
    });
});

// ── Delete a button ──
function deleteCustomButton(id) {
    customButtons = customButtons.filter((b) => b.id !== id);
    saveCustomButtons(() => {
        renderCustomButtonList();
        showStatus('Button deleted.', 'success');
    });
}

// ── Persist custom buttons to storage ──
function saveCustomButtons(callback) {
    chrome.storage.sync.set({ customButtons }, () => {
        if (chrome.runtime.lastError) {
            showStatus('Error saving buttons: ' + chrome.runtime.lastError.message, 'error');
        } else {
            callback && callback();
        }
    });
}

// ── Status banner ──
let statusTimer = null;
function showStatus(message, type) {
    statusBanner.textContent = message;
    statusBanner.className = type; // 'success' | 'error'
    statusBanner.style.display = 'block';
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => {
        statusBanner.style.display = 'none';
    }, 3000);
}
