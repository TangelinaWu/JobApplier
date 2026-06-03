// LinkedIn Easy Apply handler
// LinkedIn is a React SPA. The Easy Apply modal appears without a page reload.
// Key challenges:
//   1. React synthetic events — direct .value assignment is ignored
//   2. Multi-step paginated modal
//   3. Custom ARIA comboboxes for dropdowns
//   4. SPA navigation — content script fires once; we use locationchange events from main.js

window.__jaHandler = {
  detectionRules: {
    // Show button on any LinkedIn jobs page; detect the apply button or open modal
    urlPatterns: [/linkedin\.com\/jobs/i],
    selectors: [
      ".jobs-easy-apply-button",      // "Easy Apply" button present
      ".jobs-easy-apply-content",     // modal is already open
    ],
  },

  _paused: false,
  _currentStep: 0,
  _totalSteps: 0,

  pause() {
    this._paused = true;
  },

  async run(profile, onUnknown) {
    this._paused = false;
    floatingButton.setState(floatingButton.STATES.RUNNING);

    try {
      await this._openModal();
      await this._processModal(profile, onUnknown);
    } catch (err) {
      console.error("[JobApplier] LinkedIn error:", err);
      floatingButton.setState(floatingButton.STATES.ERROR);
    }
  },

  // Click "Easy Apply" to open the modal (if not already open)
  async _openModal() {
    const modalAlreadyOpen = document.querySelector(".jobs-easy-apply-content");
    if (modalAlreadyOpen) return;

    const applyBtn = document.querySelector(
      ".jobs-easy-apply-button, " +
      'button[aria-label*="Easy Apply"], ' +
      '.jobs-apply-button--top-card'
    );

    if (!applyBtn) {
      throw new Error("Easy Apply button not found on this page.");
    }

    applyBtn.click();

    // Wait for the modal to appear
    const modal = await formFiller.waitForSelector(".jobs-easy-apply-content", 5000);
    if (!modal) throw new Error("Easy Apply modal did not open.");

    await humanDelay.afterNavigation();
  },

  async _processModal(profile, onUnknown) {
    let stepCount = 0;
    const maxSteps = 15; // guard against infinite loops

    while (stepCount < maxSteps) {
      if (this._paused) {
        floatingButton.setState(floatingButton.STATES.PAUSED);
        return;
      }

      const modal = document.querySelector(".jobs-easy-apply-content");
      if (!modal) break;

      stepCount++;

      // Try to determine total steps from the modal header
      this._updateProgress(modal, stepCount);

      // Check if we're on the final "Review" page
      const isReview = this._isReviewPage(modal);

      if (!isReview) {
        await this._fillModalPage(modal, profile, onUnknown);
      }

      if (this._paused) {
        floatingButton.setState(floatingButton.STATES.PAUSED);
        return;
      }

      // Find the primary action button
      const nextBtn = this._findActionButton(modal);
      if (!nextBtn) break;

      const btnText = nextBtn.textContent.trim().toLowerCase();

      if (btnText.includes("submit")) {
        // Final submit step
        if (!profile.autoSubmit) {
          floatingButton.setState(floatingButton.STATES.DONE);
          floatingButton.setProgress("Click Submit to apply");
          return;
        }
        await humanDelay.beforeClick();
        nextBtn.click();
        await humanDelay.afterNavigation();
        floatingButton.setState(floatingButton.STATES.DONE);
        this._logApplication(profile);
        return;
      }

      // Click Next or Review
      await humanDelay.beforeClick();
      nextBtn.click();
      await humanDelay.afterNavigation();

      // Wait for the modal content to update
      await formFiller.waitForSelector(".jobs-easy-apply-content", 3000);
    }

    // Reached max steps or modal disappeared
    floatingButton.setState(floatingButton.STATES.DONE);
  },

  async _fillModalPage(modal, profile, onUnknown) {
    // LinkedIn modal pages contain various field types including:
    // - Standard text inputs
    // - <select> dropdowns
    // - Custom comboboxes ([role="combobox"])
    // - Radio button groups
    // - Checkboxes

    const handleUnknown = async (element, labelText) => {
      const context = `LinkedIn job application. Field: "${labelText}". Job: "${document.title}"`;
      return onUnknown(element, labelText, context);
    };

    await formFiller.fillContainer(modal, profile, handleUnknown);
  },

  _isReviewPage(modal) {
    const heading = modal.querySelector("h3, h2, .jobs-easy-apply-form-section__summary");
    if (heading) {
      return /review|summary/i.test(heading.textContent);
    }
    return false;
  },

  _findActionButton(modal) {
    // Priority: "Submit application" > "Review" > "Next"
    const buttons = modal.querySelectorAll(
      'button[aria-label*="Submit"], ' +
      'button[data-easy-apply-next-button], ' +
      'footer button'
    );

    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes("submit")) return btn;
    }
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes("review")) return btn;
    }
    for (const btn of buttons) {
      const text = btn.textContent.trim().toLowerCase();
      if (text.includes("next")) return btn;
    }

    // Fallback: any button in the footer
    return modal.querySelector("footer button:last-of-type");
  },

  _updateProgress(modal, currentStep) {
    // LinkedIn shows step progress like "1 of 3" in the modal header
    const progressEl = modal.querySelector(
      ".t-12.t-black--light, .jobs-easy-apply-header__progress-bar-text"
    );
    if (progressEl) {
      const match = progressEl.textContent.match(/(\d+)\s+of\s+(\d+)/i);
      if (match) {
        floatingButton.setProgress(`Step ${match[1]} of ${match[2]}`);
        return;
      }
    }
    floatingButton.setProgress(`Step ${currentStep}`);
  },

  _logApplication(profile) {
    const jobTitle = document.querySelector(
      ".job-details-jobs-unified-top-card__job-title, " +
      "h1.t-24"
    )?.textContent.trim() || document.title;

    const company = document.querySelector(
      ".job-details-jobs-unified-top-card__company-name, " +
      ".jobs-unified-top-card__company-name"
    )?.textContent.trim() || "";

    browser.runtime.sendMessage({
      type: MSG.LOG_APPLICATION,
      payload: {
        site: "linkedin",
        company,
        role: jobTitle,
        url: window.location.href,
      },
    }).catch(() => {});
  },
};
