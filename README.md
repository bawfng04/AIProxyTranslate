# AI Proxy Translate

A Manifest V3 Chrome extension that brings an AI assistant to any webpage. Highlight text, choose an action from the floating toolbar, and get a streamed response in a modal — without leaving the page.

Designed to work with any OpenAI-compatible API endpoint, including self-hosted proxies and Cloudflare AI Gateway.

---

## File Structure

```
AIProxyTranslate/
├── manifest.json         MV3 manifest
├── background.js         Service worker — API requests, streaming SSE, context menu, history
├── content.js            Floating toolbar and result modal (injected into every page)
├── content.css           Styles for the floating UI
├── popup.html            Extension popup — settings and history tabs
├── popup.js              Popup logic — API settings, custom button CRUD, history viewer
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## Installation

1. Open Chrome and go to `chrome://extensions`
2. Enable **Developer Mode** in the top-right corner
3. Click **Load unpacked**
4. Select the `AIProxyTranslate` folder

---

## Configuration

Click the extension icon to open the popup and go to the **Settings** tab.

| Field | Description |
|---|---|
| API Base URL | Your proxy endpoint, e.g. `https://my-proxy.workers.dev/v1/chat/completions` |
| API Key | Stored in `chrome.storage.sync`, never exposed to page scripts |
| Model Name | e.g. `gpt-4o-mini`, or the model name your proxy expects |

---

## Built-in Actions

Five default buttons are shown on the floating toolbar whenever you select text:

| Button | What it does |
|---|---|
| Translate | Translates the selection to fluent Vietnamese |
| Explain | Explains context, meaning, and key concepts in Vietnamese |
| TL;DR | Summarises to 3-5 bullet points in Vietnamese |
| Analyze Code | Reviews logic, Big-O complexity, and potential bugs in Vietnamese |
| Polish English | Rewrites the selection as natural, grammatically correct English |

---

## Custom Buttons

In the popup, go to the **Buttons** tab and click **Add Custom Button**. Provide:

- **Button Name** — shown on the toolbar
- **System Prompt** — the instruction sent to the model before the selected text

Custom buttons also appear in the browser right-click context menu under **AI Proxy**.

---

## Using the Extension

1. Select any text on any page
2. A floating toolbar appears near your cursor
3. Click a button — the result modal opens immediately and the response streams in real time
4. Once the response finishes:
   - Use **Copy** to copy the full response to the clipboard
   - Type a follow-up question in the input bar at the bottom of the modal and press Enter
   - The conversation continues in the same modal, preserving full context across turns
5. Drag the modal header to reposition it; it pins in place when dragged
6. Press Escape or click X to dismiss

You can also trigger actions via the **right-click context menu** on selected text without the toolbar appearing first.

---

## Response History

The last 30 AI responses are saved automatically. Open the popup and go to the **History** tab to review past responses or copy them. Use **Clear All** to wipe the history.

---

## API Request Format

Each request is sent as an OpenAI-compatible chat completion:

```json
{
  "model": "MODEL_NAME",
  "stream": true,
  "messages": [
    { "role": "system",    "content": "SYSTEM_PROMPT" },
    { "role": "user",      "content": "SELECTED_TEXT" },
    { "role": "assistant", "content": "PREVIOUS_RESPONSE" },
    { "role": "user",      "content": "FOLLOW_UP_QUESTION" }
  ]
}
```

For the first request only the system and user messages are present. Follow-up turns append the full conversation history. Streaming is attempted first via SSE; if the endpoint does not support it, the extension falls back to a standard JSON response.

---

## Security

- All API requests are made from the service worker (`background.js`), not from page-level scripts, avoiding CORS and script-injection issues
- API keys are stored in `chrome.storage.sync` and are never accessible to page JavaScript
- All data stays between your browser and your configured endpoint — nothing is sent to third parties

---

## Compatibility

Works with any API that follows the OpenAI chat completions format, including:

- OpenAI API
- Azure OpenAI
- Cloudflare AI Gateway
- Local proxies such as LM Studio or Ollama with an OpenAI-compatible adapter
