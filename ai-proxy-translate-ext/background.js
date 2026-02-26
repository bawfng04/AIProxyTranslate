/**
 * background.js — Service Worker
 * Handles API fetch requests from the content script to avoid CORS issues.
 */

chrome.runtime.onInstalled.addListener(() => {
  // Set default storage values on first install
  chrome.storage.sync.get(
    ['API_BASE_URL', 'API_KEY', 'MODEL_NAME', 'customButtons'],
    (result) => {
      const defaults = {};
      if (!result.API_BASE_URL) defaults.API_BASE_URL = '';
      if (!result.API_KEY) defaults.API_KEY = '';
      if (!result.MODEL_NAME) defaults.MODEL_NAME = 'gpt-4o-mini';
      if (!result.customButtons) defaults.customButtons = [];
      if (Object.keys(defaults).length > 0) {
        chrome.storage.sync.set(defaults);
      }
    }
  );
});

/**
 * Main message listener.
 * Expects: { action: 'AI_REQUEST', systemPrompt, userText }
 * Returns: { success: true, content } or { success: false, error }
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action !== 'AI_REQUEST') return false;

  handleAIRequest(message)
    .then((result) => sendResponse(result))
    .catch((err) => sendResponse({ success: false, error: err.message }));

  // Return true to keep the message channel open for async response
  return true;
});

async function handleAIRequest({ systemPrompt, userText }) {
  // Load settings from storage
  const settings = await new Promise((resolve) => {
    chrome.storage.sync.get(['API_BASE_URL', 'API_KEY', 'MODEL_NAME'], resolve);
  });

  const { API_BASE_URL, API_KEY, MODEL_NAME } = settings;

  if (!API_KEY || API_KEY.trim() === '') {
    return {
      success: false,
      error:
        'API Key is not configured. Please open the extension popup and set your API key.',
    };
  }

  if (!API_BASE_URL || API_BASE_URL.trim() === '') {
    return {
      success: false,
      error:
        'API Base URL is not configured. Please open the extension popup and set your endpoint.',
    };
  }

  const modelName = (MODEL_NAME || 'gpt-4o-mini').trim();

  const payload = {
    model: modelName,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userText },
    ],
  };

  let response;
  try {
    response = await fetch(API_BASE_URL.trim(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${API_KEY.trim()}`,
      },
      body: JSON.stringify(payload),
    });
  } catch (networkErr) {
    return {
      success: false,
      error: `Network error: Unable to reach the API endpoint. Check your URL and internet connection. (${networkErr.message})`,
    };
  }

  if (!response.ok) {
    let errorDetail = `HTTP ${response.status}`;
    try {
      const errBody = await response.json();
      errorDetail = errBody?.error?.message || JSON.stringify(errBody);
    } catch (_) {
      // ignore parse errors
    }
    return {
      success: false,
      error: `API Error (${response.status}): ${errorDetail}`,
    };
  }

  let data;
  try {
    data = await response.json();
  } catch (_) {
    return {
      success: false,
      error: 'Failed to parse API response as JSON.',
    };
  }

  const content = data?.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    return {
      success: false,
      error: 'Unexpected API response format: missing choices[0].message.content.',
    };
  }

  return { success: true, content };
}
