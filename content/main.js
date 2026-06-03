// Entry point for all content script bundles.
// Each sites/*.js file sets window.__jaHandler before this file runs.
// This file orchestrates detection, profile loading, and button mounting.

(function () {
  "use strict";

  // Intercept SPA navigation (history.pushState) so we re-run on LinkedIn/Handshake
  // when the user navigates to a new job without a full page reload.
  const _origPushState = history.pushState;
  history.pushState = function (...args) {
    _origPushState.apply(this, args);
    window.dispatchEvent(new Event("ja:locationchange"));
  };
  const _origReplaceState = history.replaceState;
  history.replaceState = function (...args) {
    _origReplaceState.apply(this, args);
    window.dispatchEvent(new Event("ja:locationchange"));
  };
  window.addEventListener("popstate", () =>
    window.dispatchEvent(new Event("ja:locationchange"))
  );

  let initialized = false;

  async function init() {
    const handler = window.__jaHandler;
    if (!handler) return;

    // Detect whether we're on a job application page
    const isDetected = detector.detect(handler.detectionRules);

    if (!isDetected) {
      // Watch for the form to appear (SPA lazy render)
      detector.watchForForm(handler.detectionRules, () => {
        if (!initialized) init();
      });
      return;
    }

    if (initialized) return;
    initialized = true;

    const profile = await getProfile();

    // The onUnknown callback: ask Claude and show the overlay
    async function onUnknown(element, labelText) {
      const context = element.closest("form")
        ? element.closest("form").textContent.slice(0, 300)
        : "";
      const result = await overlayManager.ask(labelText, context);
      if (result.accepted && result.value) {
        formFiller.setInputValue(element, result.value);
        return "filled";
      }
      return "skipped";
    }

    floatingButton.mount({
      onStart: () => handler.run(profile, onUnknown),
      onPause: () => handler.pause(),
    });
  }

  // Re-initialize on SPA navigation
  window.addEventListener("ja:locationchange", () => {
    initialized = false;
    // Give the SPA a moment to render the new page before we check
    setTimeout(init, 600);
  });

  // Initial run
  init();
})();
