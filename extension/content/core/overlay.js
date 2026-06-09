// Claude suggestion overlay — appears when an unknown form field is encountered.
// Uses Shadow DOM so page CSS cannot override our styles.
// Returns a Promise that resolves with { accepted: boolean, value: string }.

const OVERLAY_STYLES = `
  :host { all: initial; }

  .backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.55);
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fadeIn 0.15s ease;
  }

  @keyframes fadeIn {
    from { opacity: 0; }
    to   { opacity: 1; }
  }

  .modal {
    background: #fff;
    border-radius: 14px;
    width: 480px;
    max-width: calc(100vw - 32px);
    box-shadow: 0 24px 60px rgba(0,0,0,0.25);
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    font-size: 14px;
    color: #1a1a2e;
    overflow: hidden;
    animation: slideUp 0.2s ease;
  }

  @keyframes slideUp {
    from { transform: translateY(16px); opacity: 0; }
    to   { transform: translateY(0);    opacity: 1; }
  }

  .header {
    background: #4f46e5;
    color: #fff;
    padding: 14px 20px;
    display: flex;
    align-items: center;
    gap: 10px;
  }

  .header h2 {
    font-size: 15px;
    font-weight: 600;
    flex: 1;
    margin: 0;
  }

  .header .badge {
    background: rgba(255,255,255,0.2);
    font-size: 11px;
    font-weight: 500;
    padding: 3px 8px;
    border-radius: 20px;
  }

  .close-btn {
    background: none;
    border: none;
    color: rgba(255,255,255,0.8);
    font-size: 20px;
    cursor: pointer;
    line-height: 1;
    padding: 0 4px;
  }
  .close-btn:hover { color: #fff; }

  .body {
    padding: 20px;
    display: flex;
    flex-direction: column;
    gap: 14px;
  }

  .label {
    font-size: 12px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: #6b7280;
    margin-bottom: 4px;
  }

  .question-text {
    background: #f9fafb;
    border: 1px solid #e5e7eb;
    border-radius: 8px;
    padding: 10px 14px;
    font-size: 14px;
    font-style: italic;
    color: #374151;
  }

  .suggestion-input {
    width: 100%;
    padding: 10px 14px;
    border: 2px solid #4f46e5;
    border-radius: 8px;
    font-size: 14px;
    color: #1a1a2e;
    resize: vertical;
    min-height: 80px;
    font-family: inherit;
    outline: none;
    box-sizing: border-box;
    background: #fff;
  }

  .suggestion-input:focus {
    box-shadow: 0 0 0 3px rgba(79, 70, 229, 0.2);
  }

  .loading-text {
    color: #6b7280;
    font-size: 13px;
    font-style: italic;
  }

  .footer {
    padding: 14px 20px;
    border-top: 1px solid #f3f4f6;
    display: flex;
    justify-content: flex-end;
    gap: 10px;
  }

  .btn-skip {
    background: #f3f4f6;
    color: #374151;
    border: none;
    padding: 9px 18px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 500;
    cursor: pointer;
  }
  .btn-skip:hover { background: #e5e7eb; }

  .btn-accept {
    background: #4f46e5;
    color: #fff;
    border: none;
    padding: 9px 20px;
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    cursor: pointer;
  }
  .btn-accept:hover { background: #4338ca; }
  .btn-accept:disabled { background: #9ca3af; cursor: not-allowed; }
`;

const overlayManager = (() => {
  let host = null;
  let shadow = null;
  let resolvePromise = null;

  function init() {
    if (host) return;

    host = document.createElement("div");
    host.id = "ja-overlay-host";
    document.body.appendChild(host);

    shadow = host.attachShadow({ mode: "open" });

    const style = document.createElement("style");
    style.textContent = OVERLAY_STYLES;
    shadow.appendChild(style);
  }

  function buildHTML(question, suggestion, isLoading) {
    return `
      <div class="backdrop" id="ja-backdrop">
        <div class="modal" role="dialog" aria-modal="true" aria-labelledby="ja-title">
          <div class="header">
            <h2 id="ja-title">Unknown Field</h2>
            <span class="badge">JobApplier AI</span>
            <button class="close-btn" id="ja-close" aria-label="Skip">&times;</button>
          </div>
          <div class="body">
            <div>
              <div class="label">Question</div>
              <div class="question-text" id="ja-question">${escapeHtml(question)}</div>
            </div>
            <div>
              <div class="label">Suggested Answer ${isLoading ? "(thinking...)" : "(edit before using)"}</div>
              ${isLoading
                ? `<div class="loading-text">Claude is generating a suggestion...</div>`
                : `<textarea class="suggestion-input" id="ja-answer" rows="4">${escapeHtml(suggestion || "")}</textarea>`
              }
            </div>
          </div>
          <div class="footer">
            <button class="btn-skip" id="ja-skip">Skip this field</button>
            <button class="btn-accept" id="ja-accept" ${isLoading ? "disabled" : ""}>Use this answer</button>
          </div>
        </div>
      </div>
    `;
  }

  function escapeHtml(str) {
    return String(str || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function attachListeners() {
    const close = shadow.getElementById("ja-close");
    const skip = shadow.getElementById("ja-skip");
    const accept = shadow.getElementById("ja-accept");
    const backdrop = shadow.getElementById("ja-backdrop");

    const resolve = (result) => {
      hide();
      if (resolvePromise) {
        resolvePromise(result);
        resolvePromise = null;
      }
    };

    if (close) close.onclick = () => resolve({ accepted: false, value: null });
    if (skip) skip.onclick = () => resolve({ accepted: false, value: null });
    if (accept) {
      accept.onclick = () => {
        const textarea = shadow.getElementById("ja-answer");
        resolve({ accepted: true, value: textarea ? textarea.value : "" });
      };
    }

    // Click backdrop to dismiss
    if (backdrop) {
      backdrop.onclick = (e) => {
        if (e.target === backdrop) resolve({ accepted: false, value: null });
      };
    }

    // Keyboard: Escape to skip, Enter to accept
    document.addEventListener("keydown", function handler(e) {
      if (!host.classList.contains("visible")) return;
      if (e.key === "Escape") {
        document.removeEventListener("keydown", handler);
        resolve({ accepted: false, value: null });
      }
      if (e.key === "Enter" && e.ctrlKey) {
        document.removeEventListener("keydown", handler);
        const textarea = shadow.getElementById("ja-answer");
        resolve({ accepted: true, value: textarea ? textarea.value : "" });
      }
    });
  }

  function show(question, suggestion, isLoading) {
    init();
    const container = document.createElement("div");
    container.innerHTML = buildHTML(question, suggestion, isLoading);

    // Remove any previous content
    while (shadow.lastChild && shadow.lastChild.tagName !== "STYLE") {
      shadow.removeChild(shadow.lastChild);
    }
    shadow.appendChild(container);
    host.classList.add("visible");
    attachListeners();
  }

  function hide() {
    if (host) host.classList.remove("visible");
  }

  function updateSuggestion(suggestion) {
    const container = shadow.querySelector(".body");
    if (!container) return;
    const loadingEl = shadow.querySelector(".loading-text");
    const acceptBtn = shadow.getElementById("ja-accept");

    if (loadingEl) {
      const textarea = document.createElement("textarea");
      textarea.className = "suggestion-input";
      textarea.id = "ja-answer";
      textarea.rows = 4;
      textarea.value = suggestion;
      loadingEl.parentNode.replaceChild(textarea, loadingEl);

      const label = loadingEl.previousSibling;
      if (label) label.textContent = "Suggested Answer (edit before using)";
    }

    if (acceptBtn) acceptBtn.disabled = false;
  }

  // Show the overlay, call Claude, then show the suggestion.
  // Returns Promise<{ accepted: boolean, value: string }>
  async function ask(question, fieldContext) {
    return new Promise(async (resolve) => {
      resolvePromise = resolve;

      // Show immediately with loading state
      show(question, "", true);

      // Ask Claude via background script
      let suggestion = "";
      try {
        const response = await chrome.runtime.sendMessage({
          type: MSG.ASK_CLAUDE,
          payload: { question, fieldContext },
        });

        if (response && !response.error) {
          suggestion = response.suggestion || "";
        } else if (response && response.error === "NO_API_KEY") {
          suggestion = ""; // User will type their own answer
        }
      } catch {
        suggestion = "";
      }

      updateSuggestion(suggestion);
    });
  }

  return { ask, show, hide };
})();
