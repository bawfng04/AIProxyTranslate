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

    // Conversation history for follow-up questions
    // Each entry: { role: 'system'|'user'|'assistant', content: string }
    let conversationHistory = [];

    // Streaming state
    let isStreaming = false;
    let streamAnchorEl = null;
    let activeStreamBlock = null; // the <div> currently receiving streamed tokens

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
            activeStreamBlock = body; // first turn targets the body itself
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

    function buildFooter(lastResponseText) {
        const footer = document.createElement('div');
        footer.className = 'ai-proxy-modal-footer';

        const copyBtn = document.createElement('button');
        copyBtn.className = 'ai-proxy-copy-btn';
        copyBtn.textContent = '📋 Copy';
        copyBtn.addEventListener('click', () => {
            navigator.clipboard.writeText(lastResponseText).then(() => {
                copyBtn.textContent = '✅ Copied!';
                setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
            });
        });

        // Follow-up input
        const inputWrap = document.createElement('div');
        inputWrap.className = 'ai-proxy-followup-wrap';

        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'ai-proxy-followup-input';
        input.placeholder = 'Ask a follow-up…';
        input.setAttribute('aria-label', 'Follow-up question');

        const sendBtn = document.createElement('button');
        sendBtn.className = 'ai-proxy-followup-send';
        sendBtn.textContent = '↩';
        sendBtn.title = 'Send follow-up';

        const submitFollowUp = () => {
            const q = input.value.trim();
            if (!q || isStreaming) return;
            input.value = '';
            handleFollowUp(q);
        };

        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submitFollowUp(); });
        sendBtn.addEventListener('click', submitFollowUp);

        inputWrap.appendChild(input);
        inputWrap.appendChild(sendBtn);
        footer.appendChild(copyBtn);
        footer.appendChild(inputWrap);
        return footer;
    }

    // ── Streaming updates ──────────────────────────────────────────────────────

    function onStreamChunk(accumulatedText) {
        if (!resultModal || resultModal.style.display === 'none') return;
        // activeStreamBlock points to the <div> for the current AI turn
        if (activeStreamBlock) {
            activeStreamBlock.innerHTML = formatContent(accumulatedText) +
                '<span class="ai-proxy-streaming-cursor"></span>';
        }
    }

    function onStreamDone(finalText) {
        isStreaming = false;
        restoreActionButtons();

        if (!resultModal || resultModal.style.display === 'none') return;

        // Finalise the active stream block
        if (activeStreamBlock) {
            activeStreamBlock.innerHTML = formatContent(finalText);
            activeStreamBlock = null;
        }

        // Record assistant turn in history
        conversationHistory.push({ role: 'assistant', content: finalText });

        // Add / update footer with follow-up input
        const existingFooter = resultModal.querySelector('.ai-proxy-modal-footer');
        if (existingFooter) existingFooter.remove();
        resultModal.appendChild(buildFooter(finalText));

        // Focus follow-up input
        const followInput = resultModal.querySelector('.ai-proxy-followup-input');
        if (followInput) setTimeout(() => followInput.focus(), 80);
    }

    function onStreamError(errorText) {
        isStreaming = false;
        restoreActionButtons();
        if (!resultModal || resultModal.style.display === 'none') return;
        if (activeStreamBlock) {
            activeStreamBlock.classList.add('ai-proxy-modal-body--error');
            activeStreamBlock.innerHTML = formatContent(errorText || 'Unknown error.');
            activeStreamBlock = null;
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

        // Reset conversation for new selection
        conversationHistory = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: lastSelection },
        ];

        setLoadingState(buttonEl);
        showResultModal(buttonEl, '', false, true); // streaming mode
        if (!isContextValid()) { selfDestruct(); return; }

        sendStreamRequest(conversationHistory, buttonEl);
    }

    // ── Follow-up handler ──────────────────────────────────────────────────────
    function handleFollowUp(question) {
        if (!resultModal || isStreaming) return;
        if (!isContextValid()) { selfDestruct(); return; }

        // Append user question block to modal body
        const body = resultModal.querySelector('.ai-proxy-modal-body');
        if (!body) return;

        // Remove old footer while streaming
        const footer = resultModal.querySelector('.ai-proxy-modal-footer');
        if (footer) footer.remove();

        // User bubble
        const userBlock = document.createElement('div');
        userBlock.className = 'ai-proxy-chat-user';
        userBlock.innerHTML = `<span class="ai-proxy-chat-label">You</span>${escapeHtmlInline(question)}`;
        body.appendChild(userBlock);

        // AI streaming block (empty, fills on STREAM_CHUNK)
        const aiBlock = document.createElement('div');
        aiBlock.className = 'ai-proxy-chat-ai';
        aiBlock.innerHTML = '<span class="ai-proxy-streaming-cursor"></span>';
        body.appendChild(aiBlock);
        activeStreamBlock = aiBlock;

        // Scroll to bottom
        body.scrollTop = body.scrollHeight;

        // Record user turn and send
        conversationHistory.push({ role: 'user', content: question });
        isStreaming = true;
        sendStreamRequest(conversationHistory, null);
    }

    function escapeHtmlInline(s) {
        return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function sendStreamRequest(messages, loadingBtn) {
        chrome.runtime.sendMessage(
            { action: 'AI_STREAM_REQUEST', messages },
            (ack) => {
                if (chrome.runtime.lastError || !ack?.streaming) {
                    // Fallback: regular request
                    chrome.runtime.sendMessage(
                        { action: 'AI_REQUEST', messages },
                        (resp) => {
                            restoreActionButtons();
                            if (!resp || !resp.success) onStreamError(resp?.error || 'Unknown error.');
                            else onStreamDone(resp.content);
                        }
                    );
                }
            }
        );
    }

    // ── Context menu action ────────────────────────────────────────────────────
    function handleContextMenuAction(systemPrompt, selectedText) {
        lastSelection = selectedText;
        conversationHistory = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: selectedText },
        ];
        hideAll();
        showResultModal(null, '', false, true);
        if (!isContextValid()) { selfDestruct(); return; }
        sendStreamRequest(conversationHistory, null);
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
        '\\ell': 'ℓ',
        '\\sum': 'Σ', '\\prod': 'Π', '\\int': '∫',
        '\\infty': '∞', '\\partial': '∂', '\\nabla': '∇',
        '\\log': 'log', '\\ln': 'ln', '\\exp': 'exp',
        '\\max': 'max', '\\min': 'min', '\\arg': 'arg',
        '\\gcd': 'gcd', '\\det': 'det', '\\dim': 'dim',
        '\\times': '×', '\\cdot': '·', '\\div': '÷', '\\pm': '±', '\\mp': '∓',
        '\\leq': '≤', '\\geq': '≥', '\\neq': '≠', '\\approx': '≈', '\\propto': '∝',
        '\\ll': '≪', '\\gg': '≫',
        '\\mid': '|', '\\vert': '|', '\\|': '‖',
        '\\in': '∈', '\\notin': '∉', '\\subset': '⊂', '\\supset': '⊃',
        '\\cup': '∪', '\\cap': '∩',
        '\\rightarrow': '→', '\\leftarrow': '←', '\\Rightarrow': '⇒', '\\Leftrightarrow': '⟺',
        '\\to': '→',
        '\\forall': '∀', '\\exists': '∃',
        '\\ldots': '…', '\\dots': '…', '\\cdots': '⋯',
        '\\langle': '⟨', '\\rangle': '⟩',
    };

    const SUP_MAP = { '0': '⁰', '1': '¹', '2': '²', '3': '³', '4': '⁴', '5': '⁵', '6': '⁶', '7': '⁷', '8': '⁸', '9': '⁹', '+': '⁺', '-': '⁻', 'n': 'ⁿ', 'T': 'ᵀ' };
    const SUB_MAP = { '0': '₀', '1': '₁', '2': '₂', '3': '₃', '4': '₄', '5': '₅', '6': '₆', '7': '₇', '8': '₈', '9': '₉', 'i': 'ᵢ', 'j': 'ⱼ', 'n': 'ₙ', 'k': 'ₖ', 'm': 'ₘ' };

    function convertLatexExpr(expr) {
        let r = expr;
        // \text{...} \mathrm{...} etc → plain text (must come first)
        r = r.replace(/\\(?:text|mathrm|mathbf|mathit|mathcal|operatorname)\{([^}]*)\}/g, '$1');
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

    // ── Inline renderer: bold + italic + math ($...$ and \(...\)) ─────────────
    function renderInline(raw) {
        const maths = [];

        // Extract \(...\) delimiters first
        let text = raw.replace(/\\\((.+?)\\\)/g, (_, expr) => {
            maths.push(convertLatexExpr(expr.trim()));
            return `\x01M${maths.length - 1}\x01`;
        });

        // Extract $...$ delimiters
        text = text.replace(/\$([^$\n]{1,200}?)\$/g, (full, expr) => {
            if (!/[\\^_{}]|[a-zA-Z]{2,}/.test(expr) && !/^\d/.test(expr)) return full;
            maths.push(convertLatexExpr(expr.trim()));
            return `\x01M${maths.length - 1}\x01`;
        });

        // HTML-escape the rest
        text = escapeHtml(text);

        // Bold **text**
        text = text.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
        // Italic *text* (skip double-asterisk)
        text = text.replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, '<em>$1</em>');

        // Restore math spans
        text = text.replace(/\x01M(\d+)\x01/g, (_, i) =>
            `<span class="ai-proxy-math-inline">${escapeHtml(maths[+i])}</span>`
        );
        return text;
    }

    // ── Table renderer ─────────────────────────────────────────────────────────
    function renderTable(rows) {
        const parseRow = (line) =>
            line.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
        const isSeparator = (line) => /^\|[\s\-:|]+\|$/.test(line.trim());

        let html = '<table class="ai-proxy-table"><thead><tr>';
        parseRow(rows[0]).forEach(h => { html += `<th>${renderInline(h)}</th>`; });
        html += '</tr></thead><tbody>';
        for (let i = 1; i < rows.length; i++) {
            if (isSeparator(rows[i])) continue;
            html += '<tr>';
            parseRow(rows[i]).forEach(cell => { html += `<td>${renderInline(cell)}</td>`; });
            html += '</tr>';
        }
        return html + '</tbody></table>';
    }

    // ── Main markdown formatter ────────────────────────────────────────────────
    function formatContent(text) {
        // Sanitise U+FFFD replacement characters into a subtle placeholder
        text = text.replace(/\uFFFD+/g, '<span class="ai-proxy-char-missing" title="Character missing">?</span>');

        const outputLines = [];
        const rawLines = text.split('\n');
        let tableBuffer = [];

        function flushTable() {
            if (tableBuffer.length >= 2) outputLines.push(renderTable(tableBuffer));
            else if (tableBuffer.length === 1) outputLines.push(`<p>${renderInline(tableBuffer[0])}</p>`);
            tableBuffer = [];
        }

        for (const line of rawLines) {
            // $$...$$ single-line display math
            const dd = line.match(/^\s*\$\$(.+?)\$\$\s*$/);
            if (dd) { flushTable(); outputLines.push(`<div class="ai-proxy-math-block">${escapeHtml(convertLatexExpr(dd[1].trim()))}</div>`); continue; }
            // \[...\] display math
            const bb = line.match(/^\s*\\\[(.+?)\\\]\s*$/);
            if (bb) { flushTable(); outputLines.push(`<div class="ai-proxy-math-block">${escapeHtml(convertLatexExpr(bb[1].trim()))}</div>`); continue; }

            // Table row
            if (/^\s*\|.+\|/.test(line)) { tableBuffer.push(line.trim()); continue; }
            flushTable();

            const t = line.trim();
            if (!t) continue;

            if (/^###\s+/.test(t)) { outputLines.push(`<h3>${renderInline(t.replace(/^###\s+/, ''))}</h3>`); continue; }
            if (/^##\s+/.test(t)) { outputLines.push(`<h2>${renderInline(t.replace(/^##\s+/, ''))}</h2>`); continue; }
            if (/^#\s+/.test(t)) { outputLines.push(`<h2>${renderInline(t.replace(/^#\s+/, ''))}</h2>`); continue; }

            if (/^[-•*]\s/.test(t)) { outputLines.push(`<li>${renderInline(t.slice(2))}</li>`); continue; }
            if (/^\d+\.\s/.test(t)) { outputLines.push(`<oli>${renderInline(t.replace(/^\d+\.\s+/, ''))}</oli>`); continue; }

            outputLines.push(`<p>${renderInline(t)}</p>`);
        }
        flushTable();

        let html = outputLines.join('');
        html = html.replace(/(<li>[\s\S]*?<\/li>)+/g, m => `<ul>${m}</ul>`);
        html = html.replace(/(<oli>[\s\S]*?<\/oli>)+/g, m =>
            `<ol>${m.replace(/<\/?oli>/g, s => s === '<oli>' ? '<li>' : '</li>')}</ol>`
        );
        return html;
    }

    function escapeHtml(s) {
        return s
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }


})();
