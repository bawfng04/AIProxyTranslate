/**
 * background.js — Service Worker
 * Features: API fetch (streaming SSE + fallback), context menus, response history
 */

'use strict';

// ── Default button definitions (mirrored from content.js for context menus) ──
const DEFAULT_BUTTONS_META = [
    { id: 'btn-translate-vi', label: 'Translate → Vietnamese', systemPrompt: 'Dịch đoạn văn bản sau sang tiếng Việt tự nhiên, trôi chảy. Chỉ trả về bản dịch, không giải thích thêm.' },
    { id: 'btn-explain', label: 'Explain', systemPrompt: 'Hãy giải thích ngữ cảnh, ý nghĩa và các khái niệm chính của đoạn văn bản sau một cách rõ ràng và súc tích. Trả lời hoàn toàn bằng tiếng Việt.' },
    { id: 'btn-summarize', label: 'TL;DR', systemPrompt: 'Bạn là một trợ lý hiệu quả. Hãy tóm tắt đoạn văn bản sau thành 3-5 gạch đầu dòng súc tích. Chỉ giữ lại các luận điểm chính, loại bỏ phần không quan trọng. Trả lời hoàn toàn bằng tiếng Việt.' },
    { id: 'btn-analyze-code', label: 'Analyze Code', systemPrompt: 'Bạn là một kỹ sư phần mềm chuyên nghiệp. Hãy phân tích đoạn code sau: giải thích logic ngắn gọn, đánh giá Độ phức tạp Thời gian và Không gian (Big O), và chỉ ra các lỗi tiềm ẩn, trường hợp biên, hoặc anti-pattern nếu có. Trả lời hoàn toàn bằng tiếng Việt.' },
    { id: 'btn-fix-grammar', label: 'Polish English', systemPrompt: 'Hãy đóng vai một người viết kỹ thuật bản ngữ tiếng Anh. Sửa các lỗi ngữ pháp và chính tả trong đoạn văn sau, sau đó viết lại để nghe tự nhiên hơn, và thái độ sẽ phụ thuộc vào nội dung gốc, nếu nội dung gốc là tiêu cực thì thái độ sẽ là tiêu cực, nếu nội dung gốc là tích cực thì thái độ sẽ là tích cực, nếu nội dung gốc là trung lập thì thái độ sẽ là trung lập.' },
];

// Runtime prompt lookup: menuItemId → systemPrompt (rebuilt with custom buttons)
let PROMPT_MAP = {};
rebuildPromptMap([]);

// ── Install / startup ─────────────────────────────────────────────────────────

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.sync.get(
        ['API_BASE_URL', 'API_KEY', 'MODEL_NAME', 'customButtons'],
        (result) => {
            const defaults = {};
            if (!result.API_BASE_URL) defaults.API_BASE_URL = '';
            if (!result.API_KEY) defaults.API_KEY = '';
            if (!result.MODEL_NAME) defaults.MODEL_NAME = 'gpt-4o-mini';
            if (!result.customButtons) defaults.customButtons = [];
            if (Object.keys(defaults).length) chrome.storage.sync.set(defaults);
        }
    );
    rebuildContextMenus();
});

// Rebuild context menus whenever custom buttons change
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.customButtons) {
        rebuildContextMenus();
    }
});

// ── Context Menus ─────────────────────────────────────────────────────────────

function rebuildContextMenus() {
    chrome.contextMenus.removeAll(() => {
        chrome.contextMenus.create({
            id: 'ai-proxy-root',
            title: 'AI Proxy',
            contexts: ['selection'],
        });

        DEFAULT_BUTTONS_META.forEach((btn) => {
            chrome.contextMenus.create({
                id: btn.id,
                parentId: 'ai-proxy-root',
                title: btn.label,
                contexts: ['selection'],
            });
        });

        chrome.storage.sync.get(['customButtons'], (result) => {
            const custom = result.customButtons || [];
            rebuildPromptMap(custom);
            custom.forEach((btn) => {
                chrome.contextMenus.create({
                    id: `custom-${btn.id}`,
                    parentId: 'ai-proxy-root',
                    title: btn.name,
                    contexts: ['selection'],
                });
            });
        });
    });
}

function rebuildPromptMap(customButtons) {
    PROMPT_MAP = {};
    DEFAULT_BUTTONS_META.forEach((b) => { PROMPT_MAP[b.id] = b.systemPrompt; });
    (customButtons || []).forEach((b) => { PROMPT_MAP[`custom-${b.id}`] = b.prompt; });
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
    if (!info.selectionText || !tab?.id) return;
    const systemPrompt = PROMPT_MAP[info.menuItemId];
    if (!systemPrompt) return;

    // Send to content script; if not injected yet, inject first
    chrome.tabs.sendMessage(tab.id, {
        action: 'CONTEXT_MENU_ACTION',
        systemPrompt,
        selectedText: info.selectionText,
    }).catch(async () => {
        try {
            await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
            await chrome.scripting.insertCSS({ target: { tabId: tab.id }, files: ['content.css'] });
            setTimeout(() => {
                chrome.tabs.sendMessage(tab.id, {
                    action: 'CONTEXT_MENU_ACTION',
                    systemPrompt,
                    selectedText: info.selectionText,
                }).catch(() => { });
            }, 250);
        } catch (_) { }
    });
});

// ── Message listener (from content scripts) ───────────────────────────────────

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {

    // Regular (non-streaming) request — used as fallback
    if (message.action === 'AI_REQUEST') {
        fetchRegular(message.systemPrompt, message.userText, message.messages)
            .then(sendResponse)
            .catch((err) => sendResponse({ success: false, error: err.message }));
        return true; // async
    }

    // Streaming request — ack immediately, push chunks via tabs.sendMessage
    if (message.action === 'AI_STREAM_REQUEST') {
        const tabId = sender.tab?.id;
        if (!tabId) {
            sendResponse({ success: false, error: 'Cannot determine tab ID for streaming.' });
            return false;
        }
        sendResponse({ success: true, streaming: true }); // ack
        handleStreaming(message.systemPrompt, message.userText, tabId, message.messages);
        return false;
    }

    return false;
});

// ── Regular fetch ─────────────────────────────────────────────────────────────

async function fetchRegular(systemPrompt, userText, messages) {
    const { API_BASE_URL, API_KEY, MODEL_NAME } = await loadSettings();
    validateSettings(API_KEY, API_BASE_URL);
    const response = await apiFetch(API_BASE_URL, API_KEY, MODEL_NAME, false,
        messages || buildMessages(systemPrompt, userText));
    if (!response.ok) {
        const detail = await extractErrorDetail(response);
        throw new Error(`API Error (${response.status}): ${detail}`);
    }
    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;
    if (typeof content !== 'string') throw new Error('Unexpected API response format.');
    await saveHistory(userText || '', content);
    return { success: true, content };
}

// ── Streaming fetch ───────────────────────────────────────────────────────────

async function handleStreaming(systemPrompt, userText, tabId, messages) {
    const sendChunk = (text) => sendToTab(tabId, { action: 'STREAM_CHUNK', text });
    const sendDone = (text) => sendToTab(tabId, { action: 'STREAM_DONE', text });
    const sendError = (err) => sendToTab(tabId, { action: 'STREAM_ERROR', error: err });

    const msgs = messages || buildMessages(systemPrompt, userText);
    let settings;
    try { settings = await loadSettings(); } catch (e) { sendError(e.message); return; }

    const { API_BASE_URL, API_KEY, MODEL_NAME } = settings;

    try { validateSettings(API_KEY, API_BASE_URL); }
    catch (e) { sendError(e.message); return; }

    let response;
    try {
        response = await apiFetch(API_BASE_URL, API_KEY, MODEL_NAME, true, msgs);
    } catch (netErr) {
        // Network failure — fall back to regular
        try {
            const result = await fetchRegular(systemPrompt, userText, messages);
            sendDone(result.content);
        } catch (e) { sendError(e.message); }
        return;
    }

    if (!response.ok) {
        const detail = await extractErrorDetail(response);
        // For non-2xx, fallback to re-fetch without stream flag
        try {
            const result = await fetchRegular(systemPrompt, userText, messages);
            sendDone(result.content);
        } catch (_) { sendError(`API Error (${response.status}): ${detail}`); }
        return;
    }

    // No streaming body — read full JSON (some proxies don't support SSE)
    if (!response.body) {
        try {
            const data = await response.json();
            const content = data?.choices?.[0]?.message?.content || '';
            await saveHistory(userText || '', content);
            sendDone(content);
        } catch (e) { sendError(`Parse error: ${e.message}`); }
        return;
    }

    // ── SSE stream reader ────────────────────────────────────────────
    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    let accumulated = '';
    let buffer = '';

    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() ?? ''; // keep incomplete line

            for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed.startsWith('data:')) continue;
                const data = trimmed.slice(5).trim();
                if (data === '[DONE]') continue;
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) {
                        accumulated += delta;
                        sendChunk(accumulated);
                    }
                } catch (_) { /* malformed SSE line */ }
            }
        }

        // Flush remaining buffer
        if (buffer.trim().startsWith('data:')) {
            const data = buffer.slice(buffer.indexOf(':') + 1).trim();
            if (data && data !== '[DONE]') {
                try {
                    const parsed = JSON.parse(data);
                    const delta = parsed.choices?.[0]?.delta?.content;
                    if (delta) accumulated += delta;
                } catch (_) { }
            }
        }

        await saveHistory(userText, accumulated);
        sendDone(accumulated);

    } catch (streamErr) {
        if (accumulated) {
            await saveHistory(userText, accumulated);
            sendDone(accumulated); // return what we have
        } else {
            sendError(`Stream error: ${streamErr.message}`);
        }
    }
}

// ── History ───────────────────────────────────────────────────────────────────

async function saveHistory(selectedText, response) {
    try {
        const result = await chrome.storage.local.get(['aiHistory']);
        const history = result.aiHistory || [];
        history.unshift({
            id: Date.now(),
            timestamp: Date.now(),
            selectedText: selectedText.slice(0, 300),
            response,
        });
        await chrome.storage.local.set({ aiHistory: history.slice(0, 30) });
    } catch (_) { }
}

// ── Shared helpers ────────────────────────────────────────────────────────────

function loadSettings() {
    return new Promise((resolve) =>
        chrome.storage.sync.get(['API_BASE_URL', 'API_KEY', 'MODEL_NAME'], resolve)
    );
}

function validateSettings(apiKey, apiBaseUrl) {
    if (!apiKey?.trim()) throw new Error('API Key is not configured. Open the extension popup to set it.');
    if (!apiBaseUrl?.trim()) throw new Error('API Base URL is not configured. Open the extension popup to set it.');
}

// Global encoding guard appended to every system prompt
const ENCODING_GUARD = '\n\nQUAN TRỌNG: Không được xuất ký tự lỗi "️" (U+FFFD) trong bất kỳ trường hợp nào. Viết tất cả ký tự tiếng Việt (ê, ế, ề, ệ, ể, ễ, ơ, ớ, ờ, ợ, ở, ỡ, ...) đầy đủ và chính xác.';

// Helper: build messages array from simple prompt+text (applies encoding guard to system message)
function buildMessages(systemPrompt, userText) {
    return [
        { role: 'system', content: (systemPrompt || '') + ENCODING_GUARD },
        { role: 'user', content: userText || '' },
    ];
}

// apiFetch now accepts a pre-built messages array directly
function apiFetch(baseUrl, apiKey, model, stream, messages) {
    return fetch(baseUrl.trim(), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey.trim()}`,
        },
        body: JSON.stringify({
            model: (model || 'gpt-4o-mini').trim(),
            stream,
            messages, // already contains encoding guard via buildMessages()
        }),
    });
}

async function extractErrorDetail(response) {
    try {
        const b = await response.json();
        return b?.error?.message || JSON.stringify(b);
    } catch (_) {
        return response.statusText || String(response.status);
    }
}

function sendToTab(tabId, message) {
    chrome.tabs.sendMessage(tabId, message).catch(() => { }); // ignore if tab closed
}
