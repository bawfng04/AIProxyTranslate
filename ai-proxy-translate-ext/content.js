/**
 * content.js — Content Script
 * Detects text selection and displays the AI floating action bar.
 */

(function () {
    'use strict';

    // --- Constants ---
    const TOOLBAR_ID = 'ai-proxy-toolbar';
    const RESULT_MODAL_ID = 'ai-proxy-result-modal';
    const DEFAULT_BUTTONS = [
        {
            id: 'btn-translate-vi',
            label: 'Translate',
            systemPrompt:
                'Dịch đoạn văn bản sau sang tiếng Việt tự nhiên, trôi chảy. Chỉ trả về bản dịch, không giải thích thêm.',
        },
        {
            id: 'btn-explain',
            label: 'Explain',
            systemPrompt:
                'Hãy giải thích ngữ cảnh, ý nghĩa và các khái niệm chính của đoạn văn bản sau một cách rõ ràng và súc tích. Trả lời hoàn toàn bằng tiếng Việt.',
        },
        {
            id: 'btn-summarize',
            label: 'TL;DR',
            systemPrompt:
                'Bạn là một trợ lý hiệu quả. Hãy tóm tắt đoạn văn bản sau thành 3-5 gạch đầu dòng súc tích. Chỉ giữ lại các luận điểm chính, loại bỏ phần không quan trọng. Trả lời hoàn toàn bằng tiếng Việt.',
        },
        {
            id: 'btn-analyze-code',
            label: 'Analyze Code',
            systemPrompt:
                'Bạn là một kỹ sư phần mềm chuyên nghiệp. Hãy phân tích đoạn code sau: giải thích logic ngắn gọn, đánh giá Độ phức tạp Thời gian và Không gian (Big O), và chỉ ra các lỗi tiềm ẩn, trường hợp biên, hoặc anti-pattern nếu có. Trả lời hoàn toàn bằng tiếng Việt.',
        },
        {
            id: 'btn-academic-explain',
            label: 'Academic',
            systemPrompt:
                'Hãy đóng vai một giáo sư đại học. Giải thích đoạn văn học thuật, công thức, hoặc khái niệm học máy sau theo cách có cấu trúc. Phân tích các phần phức tạp và đưa ra ví dụ thực tế dễ hiểu. Trả lời hoàn toàn bằng tiếng Việt.',
        },
        {
            id: 'btn-fix-grammar',
            label: 'Polish English',
            systemPrompt:
                'Hãy đóng vai một người viết kỹ thuật bản ngữ tiếng Anh. Sửa các lỗi ngữ pháp và chính tả trong đoạn văn sau, sau đó viết lại để nghe tự nhiên, chuyên nghiệp và rõ ràng. Sau bản sửa, hãy giải thích ngắn gọn những thay đổi chính bằng tiếng Việt.',
        }
    ];

    // --- State ---
    let toolbar = null;
    let resultModal = null;
    let lastSelection = null;
    let lastRange = null;

    // --- Initialization ---
    init();

    function init() {
        injectToolbar();
        injectResultModal();
        document.addEventListener('mouseup', onMouseUp);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') hideAll();
        });
    }

    // --------------------------------------------------------------------------
    // Toolbar
    // --------------------------------------------------------------------------

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

        // Add a close/dismiss button
        const closeBtn = document.createElement('button');
        closeBtn.className = 'ai-proxy-btn ai-proxy-btn--close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Dismiss';
        closeBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            hideAll();
        });
        toolbar.appendChild(closeBtn);
    }

    function showToolbar(x, y) {
        if (!toolbar) return;
        toolbar.style.display = 'flex';

        // Position: anchor to cursor, keep within viewport
        const OFFSET = 10;
        const tbWidth = toolbar.offsetWidth;
        const tbHeight = toolbar.offsetHeight;
        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;

        let left = x - tbWidth / 2;
        let top = y - tbHeight - OFFSET;

        // Horizontal clamp
        if (left < 8) left = 8;
        if (left + tbWidth > vpWidth - 8) left = vpWidth - tbWidth - 8;

        // Flip below if no room above
        if (top < 8) top = y + OFFSET;

        toolbar.style.left = `${left + window.scrollX}px`;
        toolbar.style.top = `${top + window.scrollY}px`;
    }

    function hideToolbar() {
        if (toolbar) toolbar.style.display = 'none';
    }

    // --------------------------------------------------------------------------
    // Result Modal
    // --------------------------------------------------------------------------

    function injectResultModal() {
        if (document.getElementById(RESULT_MODAL_ID)) return;
        resultModal = document.createElement('div');
        resultModal.id = RESULT_MODAL_ID;
        resultModal.setAttribute('role', 'dialog');
        resultModal.setAttribute('aria-modal', 'true');
        resultModal.style.display = 'none';
        document.body.appendChild(resultModal);
    }

    function showResultModal(anchorEl, content, isError = false) {
        resultModal.innerHTML = '';

        // Header row
        const header = document.createElement('div');
        header.className = 'ai-proxy-modal-header';

        const title = document.createElement('span');
        title.className = 'ai-proxy-modal-title';
        title.textContent = isError ? '⚠️ Error' : '✨ AI Result';
        header.appendChild(title);

        const closeBtn = document.createElement('button');
        closeBtn.className = 'ai-proxy-modal-close';
        closeBtn.innerHTML = '&times;';
        closeBtn.title = 'Close';
        closeBtn.addEventListener('click', hideResultModal);
        header.appendChild(closeBtn);
        resultModal.appendChild(header);

        // Content area
        const body = document.createElement('div');
        body.className = `ai-proxy-modal-body${isError ? ' ai-proxy-modal-body--error' : ''}`;

        // Render with basic markdown-like newline support
        body.innerHTML = formatContent(content);
        resultModal.appendChild(body);

        // Copy button (only for success)
        if (!isError) {
            const footer = document.createElement('div');
            footer.className = 'ai-proxy-modal-footer';
            const copyBtn = document.createElement('button');
            copyBtn.className = 'ai-proxy-copy-btn';
            copyBtn.textContent = '📋 Copy';
            copyBtn.addEventListener('click', () => {
                navigator.clipboard.writeText(content).then(() => {
                    copyBtn.textContent = '✅ Copied!';
                    setTimeout(() => (copyBtn.textContent = '📋 Copy'), 2000);
                });
            });
            footer.appendChild(copyBtn);
            resultModal.appendChild(footer);
        }

        resultModal.style.display = 'block';

        // Position below the anchor element (button that was clicked)
        positionModalNearAnchor(anchorEl);
    }

    function positionModalNearAnchor(anchorEl) {
        const rect = anchorEl
            ? anchorEl.getBoundingClientRect()
            : { left: window.innerWidth / 2, bottom: window.innerHeight / 2, top: window.innerHeight / 2, width: 0 };

        const OFFSET = 8;
        const MARGIN = 10;
        const modalWidth = resultModal.offsetWidth || 420;
        const modalHeight = resultModal.offsetHeight || 300;
        const vpWidth = window.innerWidth;
        const vpHeight = window.innerHeight;

        // Horizontal: centre under the anchor, then clamp inside viewport
        let left = rect.left + (rect.width || 0) / 2 - modalWidth / 2;
        left = Math.max(MARGIN, Math.min(left, vpWidth - modalWidth - MARGIN));

        // Vertical: prefer below the toolbar, flip above if not enough room
        let top;
        const spaceBelow = vpHeight - rect.bottom;
        const spaceAbove = rect.top;
        if (spaceBelow >= modalHeight + OFFSET || spaceBelow >= spaceAbove) {
            top = rect.bottom + OFFSET;
        } else {
            top = rect.top - modalHeight - OFFSET;
        }
        top = Math.max(MARGIN, top);

        resultModal.style.left = `${left + window.scrollX}px`;
        resultModal.style.top = `${top + window.scrollY}px`;
    }

    function hideResultModal() {
        if (resultModal) resultModal.style.display = 'none';
    }

    function hideAll() {
        hideToolbar();
        hideResultModal();
    }

    // --------------------------------------------------------------------------
    // Event Handlers
    // --------------------------------------------------------------------------

    function onMouseUp(e) {
        // Ignore clicks inside our own UI
        if (
            (toolbar && toolbar.contains(e.target)) ||
            (resultModal && resultModal.contains(e.target))
        ) {
            return;
        }

        setTimeout(() => {
            const selection = window.getSelection();
            const selectedText = selection ? selection.toString().trim() : '';

            if (!selectedText) {
                hideAll();
                return;
            }

            lastSelection = selectedText;

            // Store the range for potential repositioning
            if (selection && selection.rangeCount > 0) {
                lastRange = selection.getRangeAt(0);
            }

            // Load custom buttons then show toolbar
            chrome.storage.sync.get(['customButtons'], (result) => {
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

    // --------------------------------------------------------------------------
    // AI Request
    // --------------------------------------------------------------------------

    function handleButtonClick(systemPrompt, buttonEl) {
        if (!lastSelection) return;

        // Show loading state on clicked button
        const allBtns = toolbar.querySelectorAll('.ai-proxy-btn');
        allBtns.forEach((b) => (b.disabled = true));
        const originalText = buttonEl.textContent;
        buttonEl.innerHTML = '<span class="ai-proxy-spinner"></span> Processing…';
        buttonEl.classList.add('ai-proxy-btn--loading');

        // Hide any previous result
        hideResultModal();

        chrome.runtime.sendMessage(
            {
                action: 'AI_REQUEST',
                systemPrompt: systemPrompt,
                userText: lastSelection,
            },
            (response) => {
                // Restore button state
                allBtns.forEach((b) => (b.disabled = false));
                buttonEl.textContent = originalText;
                buttonEl.classList.remove('ai-proxy-btn--loading');

                if (chrome.runtime.lastError) {
                    showResultModal(
                        buttonEl,
                        `Extension error: ${chrome.runtime.lastError.message}`,
                        true
                    );
                    return;
                }

                if (!response) {
                    showResultModal(buttonEl, 'No response received from the extension.', true);
                    return;
                }

                if (response.success) {
                    showResultModal(buttonEl, response.content, false);
                } else {
                    showResultModal(buttonEl, response.error || 'Unknown error occurred.', true);
                }
            }
        );
    }

    // --------------------------------------------------------------------------
    // Utilities
    // --------------------------------------------------------------------------

    function formatContent(text) {
        // 1. HTML-escape everything first
        const escaped = text
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');

        // 2. Bold: **text**
        const withBold = escaped.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');

        // 3. Process line by line
        const lines = withBold.split('\n');
        const rendered = lines
            .map((line) => {
                const trimmed = line.trim();
                // Headings: ### ## #
                if (/^###\s+/.test(trimmed)) {
                    return `<h3>${trimmed.replace(/^###\s+/, '')}</h3>`;
                }
                if (/^##\s+/.test(trimmed)) {
                    return `<h2>${trimmed.replace(/^##\s+/, '')}</h2>`;
                }
                if (/^#\s+/.test(trimmed)) {
                    return `<h2>${trimmed.replace(/^#\s+/, '')}</h2>`;
                }
                // Bullet points: - • *
                if (/^[-•*]\s/.test(trimmed)) {
                    return `<li>${trimmed.slice(2)}</li>`;
                }
                return trimmed ? `<p>${trimmed}</p>` : '';
            })
            .join('');

        // 4. Wrap consecutive <li> in <ul>
        return rendered.replace(/(<li>.*?<\/li>)+/gs, (match) => `<ul>${match}</ul>`);
    }
})();
