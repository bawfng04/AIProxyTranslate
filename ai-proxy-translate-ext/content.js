/**
 * content.js — Content Script
 * Features: floating toolbar, streaming modal, drag/pin, context menu handler
 */

(function () {
    'use strict';

    // ── Constants ──────────────────────────────────────────────────────────────
    const TOOLBAR_ID = 'ai-proxy-toolbar';
    const RESULT_MODAL_ID = 'ai-proxy-result-modal';

    const DEFAULT_BUTTONS = [
        { id: 'btn-translate-vi', label: 'Translate', systemPrompt: 'Dịch đoạn văn bản sau sang tiếng Việt tự nhiên, trôi chảy. Chỉ trả về bản dịch, không giải thích thêm.' },
        { id: 'btn-explain', label: 'Explain', systemPrompt: 'Hãy giải thích ngữ cảnh, ý nghĩa và các khái niệm chính của đoạn văn bản sau một cách rõ ràng và súc tích. Trả lời hoàn toàn bằng tiếng Việt.' },
        { id: 'btn-summarize', label: 'TL;DR', systemPrompt: 'Bạn là một trợ lý hiệu quả. Hãy tóm tắt đoạn văn bản sau thành 3-5 gạch đầu dòng súc tích. Chỉ giữ lại các luận điểm chính, loại bỏ phần không quan trọng. Trả lời hoàn toàn bằng tiếng Việt.' },
        { id: 'btn-analyze-code', label: 'Analyze Code', systemPrompt: 'Bạn là một kỹ sư phần mềm chuyên nghiệp. Hãy phân tích đoạn code sau: giải thích logic ngắn gọn, đánh giá Độ phức tạp Thời gian và Không gian (Big O), và chỉ ra các lỗi tiềm ẩn, trường hợp biên, hoặc anti-pattern nếu có. Trả lời hoàn toàn bằng tiếng Việt.' },
        { id: 'btn-fix-grammar', label: 'Polish English', systemPrompt: 'Hãy đóng vai một người viết kỹ thuật bản ngữ tiếng Anh. Sửa các lỗi ngữ pháp và chính tả trong đoạn văn sau, sau đó viết lại để nghe tự nhiên hơn, và thái độ sẽ phụ thuộc vào nội dung gốc, nếu nội dung gốc là tiêu cực thì thái độ sẽ là tiêu cực, nếu nội dung gốc là tích cực thì thái độ sẽ là tích cực, nếu nội dung gốc là trung lập thì thái độ sẽ là trung lập.' },
    ];

    // ── State ──────────────────────────────────────────────────────────────────
    let toolbar = null;
    let resultModal = null;
    let lastSelection = null;

    // Streaming state
    let isStreaming = false;
    let streamAnchorEl = null;

    // Drag/pin state
    let modalIsPinned = false;
    let isDragging = false;
    let dragOffsetX = 0;
    let dragOffsetY = 0;

    // ── Init ───────────────────────────────────────────────────────────────────
    init();

    // ── Context-validity guard ─────────────────────────────────────────────────
    function isContextValid() {
        try { return !!(chrome && chrome.runtime && chrome.runtime.id); }
        catch (_) { return false; }
    }

    function selfDestruct() {
        try { if (toolbar) toolbar.remove(); } catch (_) { }
        try { if (resultModal) resultModal.remove(); } catch (_) { }
        document.removeEventListener('mouseup', onMouseUp);
        document.removeEventListener('keydown', onKeyDown);
        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
    }

    function init() {
        injectToolbar();
        injectResultModal();
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('keydown', onKeyDown);
        listenForBackgroundMessages();
    }

    function onKeyDown(e) {
        if (e.key === 'Escape') hideAll();
    }

    // ── Background message listener ────────────────────────────────────────────
    function listenForBackgroundMessages() {
        chrome.runtime.onMessage.addListener((message) => {
            if (!message?.action) return;

            switch (message.action) {
                case 'STREAM_CHUNK':
                    onStreamChunk(message.text);
                    break;
                case 'STREAM_DONE':
                    onStreamDone(message.text);
                    break;
                case 'STREAM_ERROR':
                    onStreamError(message.error);
                    break;
                case 'CONTEXT_MENU_ACTION':
                    handleContextMenuAction(message.systemPrompt, message.selectedText);
                    break;
            }
        });
    }

    // ── Toolbar ────────────────────────────────────────────────────────────────
    function injectToolbar() {
        if (document.getElementById(TOOLBAR_ID)) return;
        toolbar = document.createElement('div');
        toolbar.id = TOOLBAR_ID;
        toolbar.setAttribute('role', 'toolbar');
        toolbar.setAttribute('aria-label', 'AI Actions');
        toolbar.style.display = 'none';
        document.body.appendChild(toolbar);
    }

    function renderToolbarButtons(customButtons) {
        toolbar.innerHTML = '';
        const allButtons = [...DEFAULT_BUTTONS, ...customButtons];

        allButtons.forEach((btn) => {
            const button = document.createElement('button');
            button.className = 'ai-proxy-btn';
            button.textContent = btn.label;
            button.title = btn.systemPrompt;
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                handleButtonClick(btn.systemPrompt, button);
            });
            toolbar.appendChild(button);
        });

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ai-proxy-btn ai-proxy-btn--close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Dismiss';
        closeBtn.addEventListener('click', (e) => { e.stopPropagation(); hideAll(); });
        toolbar.appendChild(closeBtn);
    }

    function showToolbar(x, y) {
        if (!toolbar) return;
        toolbar.style.display = 'flex';
        const OFFSET = 10;
        const tbWidth = toolbar.offsetWidth;
        const tbHeight = toolbar.offsetHeight;
        const vpWidth = window.innerWidth;

        let left = x - tbWidth / 2;
        let top = y - tbHeight - OFFSET;
        if (left < 8) left = 8;
        if (left + tbWidth > vpWidth - 8) left = vpWidth - tbWidth - 8;
        if (top < 8) top = y + OFFSET;

        toolbar.style.left = `${left + window.scrollX}px`;
        toolbar.style.top = `${top + window.scrollY}px`;
    }

    function hideToolbar() {
        if (toolbar) toolbar.style.display = 'none';
    }

    // ── Result Modal ───────────────────────────────────────────────────────────
    function injectResultModal() {
        if (document.getElementById(RESULT_MODAL_ID)) return;
        resultModal = document.createElement('div');
        resultModal.id = RESULT_MODAL_ID;
        resultModal.setAttribute('role', 'dialog');
        resultModal.setAttribute('aria-modal', 'true');
        resultModal.style.display = 'none';

        // Prevent wheel scroll from propagating to page
        resultModal.addEventListener('wheel', (e) => {
            e.stopPropagation();
        }, { passive: true });

        document.body.appendChild(resultModal);
    }

    /**
     * Open (or reset) the result modal.
     * @param {Element|null} anchorEl — element to position near
     * @param {string}       text     — initial content (empty for streaming)
     * @param {boolean}      isError
     * @param {boolean}      streaming — if true, show blinking cursor, no copy button yet
     */
    function showResultModal(anchorEl, text, isError, streaming) {
        resultModal.innerHTML = '';
        isStreaming = !!streaming;

        // ── Header ──
        const header = document.createElement('div');
        header.className = 'ai-proxy-modal-header';

        const title = document.createElement('span');
        title.className = 'ai-proxy-modal-title';
        title.textContent = isError ? 'ERROR' : 'RESULT — bawfng04 Cloudflare Proxy API';
        header.appendChild(title);

        // Pin button
        const pinBtn = document.createElement('button');
        pinBtn.className = 'ai-proxy-pin-btn';
        pinBtn.title = 'Pin / unpin position';
        pinBtn.innerHTML = '📌';
        pinBtn.addEventListener('click', () => {
            modalIsPinned = !modalIsPinned;
            pinBtn.classList.toggle('ai-proxy-pin-btn--active', modalIsPinned);
        });
        header.appendChild(pinBtn);

        // Close button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ai-proxy-modal-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', hideResultModal);
        header.appendChild(closeBtn);

        resultModal.appendChild(header);

        // ── Body ──
        const body = document.createElement('div');
        body.className = `ai-proxy-modal-body${isError ? ' ai-proxy-modal-body--error' : ''}`;
        if (streaming) {
            body.innerHTML = '<span class="ai-proxy-streaming-cursor"></span>';
        } else {
            body.innerHTML = formatContent(text);
        }
        resultModal.appendChild(body);

        // ── Footer (copy button — added after stream completes) ──
        if (!streaming && !isError) {
            resultModal.appendChild(buildFooter(text));
        }

        // Hide toolbar while modal is visible
        hideToolbar();

        // Show
        resultModal.style.display = 'flex';

        // Position (skip if user has pinned the modal)
        if (!modalIsPinned) {
            streamAnchorEl = anchorEl;
            positionModalNearAnchor(anchorEl);
        }

        // Set up drag on header
        initDrag(header);
    }

    function buildFooter(text) {
        const footer = document.createElement('div');
        footer.className = 'ai-proxy-modal-footer';
        const copyBtn = document.createElement('button');
        copyBtn.className = 'ai-proxy-copy-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(text).then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
            });
        });
        footer.appendChild(copyBtn);
        return footer;
    }

    // ── Streaming updates ──────────────────────────────────────────────────────

    function onStreamChunk(accumulatedText) {
        if (!resultModal || resultModal.style.display === 'none') return;
        const body = resultModal.querySelector('.ai-proxy-modal-body');
        if (!body) return;
        body.innerHTML = formatContent(accumulatedText) +
            '<span class="ai-proxy-streaming-cursor"></span>';
    }

    function onStreamDone(finalText) {
        isStreaming = false;
        restoreActionButtons();

        if (!resultModal || resultModal.style.display === 'none') return;
        const body = resultModal.querySelector('.ai-proxy-modal-body');
        if (body) body.innerHTML = formatContent(finalText);

        // Add copy footer if not already there
        if (!resultModal.querySelector('.ai-proxy-modal-footer')) {
            resultModal.appendChild(buildFooter(finalText));
        }
    }

    function onStreamError(errorText) {
        isStreaming = false;
        restoreActionButtons();

        if (!resultModal || resultModal.style.display === 'none') return;
        const body = resultModal.querySelector('.ai-proxy-modal-body');
        if (body) {
            body.classList.add('ai-proxy-modal-body--error');
            body.innerHTML = formatContent(errorText || 'Unknown error.');
        }
        const title = resultModal.querySelector('.ai-proxy-modal-title');
        if (title) title.textContent = 'ERROR';
    }

    // ── Action button loading state ────────────────────────────────────────────
    let _loadingBtn = null;
    let _loadingOriginalText = '';

    function setLoadingState(buttonEl) {
        _loadingBtn = buttonEl;
        _loadingOriginalText = buttonEl.textContent;
        const allBtns = toolbar.querySelectorAll('.ai-proxy-btn');
        allBtns.forEach((b) => (b.disabled = true));
        buttonEl.innerHTML = '<span class="ai-proxy-spinner"></span> Processing…';
        buttonEl.classList.add('ai-proxy-btn--loading');
    }

    function restoreActionButtons() {
        if (!toolbar) return;
        const allBtns = toolbar.querySelectorAll('.ai-proxy-btn');
        allBtns.forEach((b) => (b.disabled = false));
        if (_loadingBtn) {
            _loadingBtn.textContent = _loadingOriginalText;
            _loadingBtn.classList.remove('ai-proxy-btn--loading');
            _loadingBtn = null;
        }
    }

    // ── Modal positioning ──────────────────────────────────────────────────────
    function positionModalNearAnchor(anchorEl) {
        const rect = anchorEl
            ? anchorEl.getBoundingClientRect()
            : { left: window.innerWidth / 2, bottom: window.innerHeight * 0.3, top: window.innerHeight * 0.3, width: 0 };

        const OFFSET = 8;
        const MARGIN = 10;
        const modalW = resultModal.offsetWidth || 440;
        const modalH = resultModal.offsetHeight || 300;
        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;

        let left = rect.left + (rect.width || 0) / 2 - modalW / 2;
        left = Math.max(MARGIN, Math.min(left, vpWidth - modalW - MARGIN));

        let top;
        const spaceBelow = vpHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow >= modalH + OFFSET || spaceBelow >= spaceAbove) {
            top = rect.bottom + OFFSET;
        } else {
            top = rect.top - modalH - OFFSET;
        }
        top = Math.max(MARGIN, top);

        resultModal.style.left = `${left}px`;
        resultModal.style.top = `${top}px`;
    }

    function hideResultModal() {
        if (resultModal) resultModal.style.display = 'none';
        modalIsPinned = false;
        isStreaming = false;
        // Toolbar stays hidden; user re-selects text to bring it back
    }

    function hideAll() {
        hideToolbar();
        hideResultModal();
    }

    // ── Drag / Pin ─────────────────────────────────────────────────────────────
    function initDrag(headerEl) {
        headerEl.classList.add('ai-proxy-modal-header--draggable');

        headerEl.addEventListener('mousedown', (e) => {
            // Don't start drag on buttons inside header
            if (e.target.closest('button')) return;
            e.preventDefault();

            isDragging = true;
            const rect = resultModal.getBoundingClientRect();
            dragOffsetX = e.clientX - rect.left;
            dragOffsetY = e.clientY - rect.top;
            headerEl.classList.add('ai-proxy-modal-header--dragging');

            document.addEventListener('mousemove', onDragMove);
            document.addEventListener('mouseup', onDragEnd);
        });
    }

    function onDragMove(e) {
        if (!isDragging) return;
        const MARGIN = 8;
        const vpW = window.innerWidth;
        const vpH = window.innerHeight;
        const modalW = resultModal.offsetWidth;
        const modalH = resultModal.offsetHeight;

        let left = e.clientX - dragOffsetX;
        let top = e.clientY - dragOffsetY;

        left = Math.max(MARGIN, Math.min(left, vpW - modalW - MARGIN));
        top = Math.max(MARGIN, Math.min(top, vpH - modalH - MARGIN));

        resultModal.style.left = `${left}px`;
        resultModal.style.top = `${top}px`;
    }

    function onDragEnd() {
        if (!isDragging) return;
        isDragging = false;
        modalIsPinned = true; // auto-pin after dragging

        // Update pin button visual
        const pinBtn = resultModal.querySelector('.ai-proxy-pin-btn');
        if (pinBtn) pinBtn.classList.add('ai-proxy-pin-btn--active');

        const header = resultModal.querySelector('.ai-proxy-modal-header');
        if (header) header.classList.remove('ai-proxy-modal-header--dragging');

        document.removeEventListener('mousemove', onDragMove);
        document.removeEventListener('mouseup', onDragEnd);
    }

    // ── Event handlers ─────────────────────────────────────────────────────────
    function onMouseUp(e) {
        if (
            (toolbar && toolbar.contains(e.target)) ||
            (resultModal && resultModal.contains(e.target))
        ) return;

        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection?.toString().trim() ?? '';

            if (!selectedText) { hideAll(); return; }

            lastSelection = selectedText;

            if (!isContextValid()) { selfDestruct(); return; }

            chrome.storage.sync.get(['customButtons'], (result) => {
                if (chrome.runtime.lastError) return;
                const customButtons = (result.customButtons || []).map((cb) => ({
                    id: `custom-${cb.id}`,
                    label: cb.name,
                    systemPrompt: cb.prompt,
                }));
                renderToolbarButtons(customButtons);
                showToolbar(e.clientX, e.clientY);
            });
        }, 10);
    }

    // ── AI request (streaming) ─────────────────────────────────────────────────
    function handleButtonClick(systemPrompt, buttonEl) {
        if (!lastSelection) return;
        setLoadingState(buttonEl);
        showResultModal(buttonEl, '', false, true); // streaming mode

        if (!isContextValid()) { selfDestruct(); return; }

        chrome.runtime.sendMessage(
            { action: 'AI_STREAM_REQUEST', systemPrompt, userText: lastSelection },
            (ack) => {
                if (chrome.runtime.lastError || !ack?.streaming) {
                    // Fallback: regular request
                    chrome.runtime.sendMessage(
                        { action: 'AI_REQUEST', systemPrompt, userText: lastSelection },
                        (resp) => {
                            restoreActionButtons();
                            if (!resp || !resp.success) {
                                onStreamError(resp?.error || 'Unknown error.');
                            } else {
                                onStreamDone(resp.content);
                            }
                        }
                    );
                }
                // If streaming ack OK, wait for STREAM_CHUNK / STREAM_DONE messages
            }
        );
    }

    // ── Context menu action ────────────────────────────────────────────────────
    function handleContextMenuAction(systemPrompt, selectedText) {
        lastSelection = selectedText;
        hideAll();

        showResultModal(null, '', false, true); // centre of screen, streaming

        if (!isContextValid()) { selfDestruct(); return; }

        chrome.runtime.sendMessage(
            { action: 'AI_STREAM_REQUEST', systemPrompt, userText: selectedText },
            (ack) => {
                if (chrome.runtime.lastError || !ack?.streaming) {
                    chrome.runtime.sendMessage(
                        { action: 'AI_REQUEST', systemPrompt, userText: selectedText },
                        (resp) => {
                            if (!resp || !resp.success) onStreamError(resp?.error || 'Error.');
                            else onStreamDone(resp.content);
                        }
                    );
                }
            }
        );
    }

    // ── LaTeX → Unicode converter ──────────────────────────────────────────────
    const LATEX_SYMBOLS = {
        '\\theta': 'θ', '\\Theta': 'Θ',
        '\\mu': 'μ', '\\nu': 'ν',
        '\\sigma': 'σ', '\\Sigma': 'Σ',
        '\\pi': 'π', '\\Pi': 'Π',
        '\\alpha': 'α', '\\beta': 'β',
        '\\gamma': 'γ', '\\Gamma': 'Γ',
        '\\delta': 'δ', '\\Delta': 'Δ',
        '\\epsilon': 'ε', '\\varepsilon': 'ε',
        '\\lambda': 'λ', '\\Lambda': 'Λ',
        '\\phi': 'φ', '\\Phi': 'Φ',
        '\\psi': 'ψ', '\\Psi': 'Ψ',
        '\\omega': 'ω', '\\Omega': 'Ω',
        '\\rho': 'ρ', '\\eta': 'η',
        '\\xi': 'ξ', '\\chi': 'χ',
        '\\tau': 'τ', '\\kappa': 'κ',
        '\\zeta': 'ζ', '\\iota': 'ι',
        '\\sum': 'Σ', '\\prod': 'Π', '\\int': '∫',
        '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
        '\\log': 'log', '\\ln': 'ln', '\\exp': 'exp',
        '\\max': 'max', '\\min': 'min', '\\arg': 'arg',
        '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
        '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\propto': '∝',
        '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\supset': '⊃',
        '\\cup': '∪', '\\cap': '∩',
        '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftrightarrow': '⟺',
        '\\forall': '∀', '\\exists': '∃',
        '\\ell': 'ℓ', '\\ldots': '…', '\\cdots': '⋯',
        '\\langle': '⟨', '\\rangle': '⟩',
    };

    const SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', 'n': 'ⁿ', 'T': 'ᵀ' };
    const SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', 'i': 'ᵢ', 'j': 'ⱼ', 'n': 'ₙ', 'k': 'ₖ', 'm': 'ₘ' };

    function convertLatexExpr(expr) {
        let r = expr;
        // \frac{a}{b} → (a/b)
        r = r.replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '($1∕$2)');
        // \sqrt{x} → √(x)
        r = r.replace(/\\sqrt\{([^}]*)\}/g, '√($1)');
        r = r.replace(/\\sqrt(\w)/g, '√$1');
        // \hat{x} \bar{x} \vec{x} \tilde{x}
        r = r.replace(/\\hat\{([^}]*)\}/g, '$1̂');
        r = r.replace(/\\bar\{([^}]*)\}/g, '$1̄');
        r = r.replace(/\\vec\{([^}]*)\}/g, '$1⃗');
        r = r.replace(/\\tilde\{([^}]*)\}/g, '$1̃');
        // ^{...} superscript
        r = r.replace(/\^\{([^}]*)\}/g, (_, g) => g.split('').map(c => SUP_MAP[c] || c).join(''));
        r = r.replace(/\^(\w)/g, (_, c) => SUP_MAP[c] || '^' + c);
        // _{...} subscript
        r = r.replace(/_\{([^}]*)\}/g, (_, g) => g.split('').map(c => SUB_MAP[c] || c).join(''));
        r = r.replace(/_(\w)/g, (_, c) => SUB_MAP[c] || '_' + c);
        // Known symbols — longest first to avoid prefix collisions
        const keys = Object.keys(LATEX_SYMBOLS).sort((a, b) => b.length - a.length);
        for (const sym of keys) r = r.split(sym).join(LATEX_SYMBOLS[sym]);
        // Strip remaining braces
        r = r.replace(/[{}]/g, '');
        return r;
    }

    // ── Inline content renderer (bold + math, stays on one line) ──────────────
    function renderInline(raw) {
        // 1. Extract $...$ math into safe placeholders BEFORE html-escaping
        //    so that < > & " inside math aren't mangled.
        const maths = [];
        let text = raw.replace(/\$([^$\n]{1,200}?)\$/g, (full, expr) => {
            if (!/[\\^_{}]|[a-zA-Z]{2,}/.test(expr) && !/^\d/.test(expr)) return full;
            const converted = convertLatexExpr(expr.trim());
            const idx = maths.length;
            maths.push(converted);
            return `\x01M${idx}\x01`; // \x01 is never in normal text
        });

        // 2. HTML-escape everything that remains
        text = escapeHtml(text);

        // 3. Bold: **text** (may contain math placeholders — that's fine)
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // 4. Restore math placeholders as styled spans
        text = text.replace(/\x01M(\d+)\x01/g, (_, i) =>
            `<span class="ai-proxy-math-inline">${escapeHtml(maths[+i])}</span>`
        );

        return text;
    }

    // ── Markdown formatter ─────────────────────────────────────────────────────
    function formatContent(text) {
        // Handle display math ($$...$$) as full-line blocks first
        text = text.replace(/\$\$([^$]+?)\$\$/gs, (_, expr) =>
            `\n\x02MATHBLOCK\x02${convertLatexExpr(expr.trim())}\x02\x02\n`
        );

        const lines = text.split('\n');
        const rendered = lines.map((line) => {
            // Display math block
            const blockMatch = line.match(/^\x02MATHBLOCK\x02([\s\S]*?)\x02\x02$/);
            if (blockMatch) return `<div class="ai-proxy-math-block">${escapeHtml(blockMatch[1])}</div>`;

            const t = line.trim();
            if (!t) return '';

            // Headings
            if (/^###\s+/.test(t)) return `<h3>${renderInline(t.replace(/^###\s+/, ''))}</h3>`;
            if (/^##\s+/.test(t)) return `<h2>${renderInline(t.replace(/^##\s+/, ''))}</h2>`;
            if (/^#\s+/.test(t)) return `<h2>${renderInline(t.replace(/^#\s+/, ''))}</h2>`;

            // Bullets
            if (/^[-•*]\s/.test(t)) return `<li>${renderInline(t.slice(2))}</li>`;

            // Paragraph
            return `<p>${renderInline(t)}</p>`;
        }).join('');

        // Wrap consecutive <li> in <ul>
        return rendered.replace(/(<li>[\s\S]*?<\/li>)+/g, (m) => `<ul>${m}</ul>`);
    }

    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }


})();
