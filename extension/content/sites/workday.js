// Workday ATS handler (partial — fills personal info, pauses before Work Experience)
// Workday is a heavy SPA with generated class names; we rely on [data-automation-id] attributes.

window.__jaHandler = {
  detectionRules: {
    urlPatterns: [/myworkdayjobs\.com/i],
    selectors: [
      "[data-automation-id='applicationPage']",
      "[data-automation-id='jobApplicationPage']",
      "[data-automation-id='createAccountPage']",
    ],
  },

  _paused: false,

  pause() {
    this._paused = true;
  },

  async run(profile, onUnknown) {
    this._paused = false;
    floatingButton.setState(floatingButton.STATES.RUNNING);

    try {
      await this._fillPersonalInfo(profile, onUnknown);
    } catch (err) {
      console.error("[JobApplier] Workday error:", err);
      floatingButton.setState(floatingButton.STATES.ERROR);
      chrome.runtime.sendMessage({
        type: MSG.FILL_LOG,
        payload: { severity: 'warn', text: `⚠ Workday error: ${err.message}` },
      }).catch(() => {});
    }
  },

  async _fillPersonalInfo(profile, onUnknown) {
    floatingButton.setProgress("Filling personal info…");

    // Workday uses [data-automation-id] attributes as stable selectors.
    // Fill each known field individually since Workday form structure varies by company.
    const fills = [
      { id: "legalName--firstName", value: profile.firstName },
      { id: "legalName--lastName", value: profile.lastName },
      { id: "email", value: profile.email },
      { id: "phone-device-type", value: "Mobile" }, // select
      { id: "phone-number", value: profile.phone },
      { id: "addressSection--addressLine1", value: profile.address },
      { id: "addressSection--city", value: profile.city },
      { id: "addressSection--stateProvinceCode", value: profile.state },
      { id: "addressSection--postalCode", value: profile.zipCode },
    ];

    for (const fill of fills) {
      if (!fill.value || this._paused) continue;

      const el =
        document.querySelector(`[data-automation-id="${fill.id}"]`) ||
        document.querySelector(`[automation-id="${fill.id}"]`);

      if (!el) continue;

      const type = formFiller.classifyElement(el);

      if (type === "select") {
        formFiller.fillSelect(el, fill.value);
      } else if (type === "combobox") {
        await formFiller.fillCombobox(el, fill.value);
      } else {
        formFiller.setInputValue(el, fill.value);
      }

      await humanDelay.betweenFields();
    }

    if (this._paused) {
      floatingButton.setState(floatingButton.STATES.PAUSED);
      return;
    }

    // Handle resume upload
    await this._handleResumeUpload(profile);

    // Pause before Work Experience — Workday's work history section is complex
    // and varies significantly between employers. Let the user fill it manually.
    floatingButton.setState(floatingButton.STATES.DONE);
    floatingButton.setProgress("Personal info done — complete Work Experience manually");
  },

  async _handleResumeUpload(profile) {
    if (!profile.resumeDataUrl) return;

    // Workday's file input is hidden behind a custom upload area.
    // Try automation-id selectors first (most stable), then fall back to generic ones.
    const fileInput =
      document.querySelector("[data-automation-id='file-upload-input'] input[type='file']") ||
      document.querySelector("[data-automation-id='file-upload-input-ref']") ||
      document.querySelector("[data-automation-id='resume-upload'] input[type='file']") ||
      document.querySelector("input[type='file'][accept*='pdf']") ||
      document.querySelector("input[type='file'][name*='resume']") ||
      document.querySelector("input[type='file']");

    if (fileInput) {
      await formFiller.fillFileInput(fileInput, profile.resumeDataUrl, profile.resumeFileName);
      await humanDelay.betweenFields();
    }
  },

  _logApplication() {
    const role = document.querySelector(
      "[data-automation-id='jobPostingTitle'], h1"
    )?.textContent.trim() || document.title;

    const company = document.querySelector(
      "[data-automation-id='orgName'], .company-name"
    )?.textContent.trim() || "";

    chrome.runtime.sendMessage({
      type: MSG.LOG_APPLICATION,
      payload: {
        site: "workday",
        company,
        role,
        url: window.location.href,
      },
    }).catch(() => {});
  },
};
