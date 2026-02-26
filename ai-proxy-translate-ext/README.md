# AI Proxy Translate — Chrome Extension

A **Manifest V3** Chrome Extension that lets you highlight text on any webpage and process it with your custom OpenAI-compatible AI proxy. Translate, explain, or run any custom action — all without leaving the page.

---

## 📁 File Structure

```
AIProxyTranslate/
├── manifest.json       # MV3 manifest
├── background.js       # Service worker (API fetch, message passing)
├── content.js          # Floating action bar & result modal
├── content.css         # Styles for the floating UI
├── popup.html          # Settings page UI
├── popup.js            # Settings logic (storage + custom button CRUD)
└── icons/
    ├── icon16.png
    ├── icon48.png
    └── icon128.png
```

---

## 🚀 Installation (Developer Mode)

1. Open Chrome and navigate to **`chrome://extensions`**
2. Enable **Developer Mode** (toggle in the top-right)
3. Click **"Load unpacked"**
4. Select the **`AIProxyTranslate`** folder
5. The extension icon will appear in your Chrome toolbar

---

## ⚙️ Configuration

Click the extension icon in the toolbar to open **Settings**:

| Field | Description |
|-------|-------------|
| **API Base URL** | Your proxy endpoint, e.g. `https://my-proxy.com/v1/chat/completions` |
| **API Key** | Your API key (stored securely in `chrome.storage.sync`) |
| **Model Name** | The model to use, e.g. `gpt-4o-mini`, `gpt-4o` |

Click **Save API Settings** to persist your config.

---

## 🎛️ Custom Buttons

In the popup, scroll to **Custom Action Buttons**. Click **"＋ Add Custom Button"** and fill in:

- **Button Name** — shown on the floating toolbar (e.g. `Summarize`)
- **System Prompt** — instructions for the AI (e.g. `Summarize this in 3 bullet points.`)

You can **edit** ✏️ or **delete** 🗑️ any custom button at any time.

---

## 📖 Usage

1. Visit any webpage
2. **Highlight** any text
3. A floating action bar appears near your cursor with:
   - 🌐 **Translate** — to natural, fluent Vietnamese
   - 💡 **Explain** — context, meaning, key concepts
   - **Your custom buttons** (dynamically loaded)
4. Click any button → loading state → AI response appears in a clean modal
5. Click **📋 Copy** to copy the response, or **×** to dismiss

---

## 🔒 Security Notes

- API calls are made from `background.js` (service worker) to avoid CORS issues on content scripts
- API keys are stored in `chrome.storage.sync` (synced across your Chrome profile, never exposed to page JS)
- No data leaves except to your own configured endpoint

---

## 🛠️ API Payload Format

```json
{
  "model": "MODEL_NAME",
  "messages": [
    { "role": "system", "content": "SYSTEM_PROMPT" },
    { "role": "user",   "content": "SELECTED_TEXT" }
  ]
}
```

Compatible with any OpenAI-format API (OpenAI, Azure OpenAI, local proxies like LM Studio, etc.)
