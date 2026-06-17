// Workday ATS handler — fills all steps automatically.
// Uses [data-automation-id] attributes as stable selectors.

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
      await this._fillAllSteps(profile, onUnknown);
    } catch (err) {
      console.error("[JobApplier] Workday error:", err);
      floatingButton.setState(floatingButton.STATES.ERROR);
    }
  },

  async _fillAllSteps(profile, onUnknown) {
    const MAX_STEPS = 12;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (this._paused) {
        floatingButton.setState(floatingButton.STATES.PAUSED);
        return;
      }

      const stepLabel = this._detectStepLabel();
      const stepDisplay = stepLabel || `Step ${step + 1}`;
      floatingButton.setProgress(`Filling: ${stepDisplay}…`);
      chrome.runtime.sendMessage({ type: MSG.FILL_LOG, payload: { label: stepDisplay, status: 'step' } }).catch(() => {});

      // Scan fields on first step so we capture what this application asks for
      if (step === 0) {
        formScanner.report({
          site: 'workday',
          company: document.querySelector("[data-automation-id='orgName'], .company-name")?.textContent.trim() || '',
          role: document.querySelector("[data-automation-id='jobPostingTitle'], h1")?.textContent.trim() || document.title,
          url: window.location.href,
          fields: formScanner.scan(document.body),
        })
      }

      // Resume upload — do it on whichever step it appears
      await this._handleResumeUpload(profile);

      // Work Experience step: Workday's add-experience flow is complex structured modals.
      // Fill what we can generically, but don't try to open/close the Add modal.
      if (this._isWorkExperienceStep()) {
        floatingButton.setProgress("Work Experience — filling visible fields…");
        await formFiller.fillContainer(document.body, profile, onUnknown);
        // Don't try to add new entries; just move on
      } else {
        // Generic fill: handle personal info, education, custom questions, etc.
        await this._fillPersonalInfoFields(profile);
        await formFiller.fillContainer(document.body, profile, onUnknown);
      }

      if (this._paused) {
        floatingButton.setState(floatingButton.STATES.PAUSED);
        return;
      }

      // Check for Submit button — we're on the review/submit page
      const submitBtn = formFiller.findButton(/^(submit|submit application|submit my application)$/i);
      if (submitBtn) {
        floatingButton.setState(floatingButton.STATES.DONE);
        floatingButton.setProgress("Review & submit");
        if (profile.autoSubmit) {
          await humanDelay.beforeClick();
          submitBtn.click();
        }
        this._logApplication();
        return;
      }

      // Advance to the next step
      const advanced = await formFiller.advanceStep();
      if (!advanced) {
        // No Next button found — we may be done or stuck
        floatingButton.setState(floatingButton.STATES.DONE);
        floatingButton.setProgress("Review & submit");
        this._logApplication();
        return;
      }
    }

    floatingButton.setState(floatingButton.STATES.DONE);
    floatingButton.setProgress("Review & submit");
    this._logApplication();
  },

  // Fill known personal-info fields by data-automation-id (most reliable on Workday).
  async _fillPersonalInfoFields(profile) {
    const FIELDS = [
      { id: "legalName--firstName",              value: profile.firstName },
      { id: "legalName--lastName",               value: profile.lastName },
      { id: "email",                             value: profile.email },
      { id: "phone-device-type",                 value: "Mobile" },
      { id: "phone-number",                      value: profile.phone },
      { id: "addressSection--addressLine1",      value: profile.address },
      { id: "addressSection--city",              value: profile.city },
      { id: "addressSection--stateProvinceCode", value: profile.state },
      { id: "addressSection--postalCode",        value: profile.zipCode },
    ];

    for (const field of FIELDS) {
      if (!field.value || this._paused) continue;
      const el =
        document.querySelector(`[data-automation-id="${field.id}"]`) ||
        document.querySelector(`[automation-id="${field.id}"]`);
      if (!el) continue;

      const type = formFiller.classifyElement(el);
      if (type === "select") {
        formFiller.fillSelect(el, field.value);
      } else if (type === "combobox") {
        await formFiller.fillCombobox(el, field.value);
      } else {
        formFiller.setInputValue(el, field.value);
      }
      await humanDelay.betweenFields();
    }
  },

  async _handleResumeUpload(profile) {
    if (!profile.resumeDataUrl) return;
    chrome.runtime.sendMessage({ type: MSG.FILL_LOG, payload: { label: 'Resume', status: 'uploading' } }).catch(() => {});

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

  // Detect the current step's heading text for progress display.
  _detectStepLabel() {
    const heading =
      document.querySelector("[data-automation-id='formHeader'] h2") ||
      document.querySelector("[data-automation-id='formHeader']") ||
      document.querySelector("[data-automation-id='stepTitle']") ||
      document.querySelector("h2[class*='title'], h1[class*='title']");
    return heading?.textContent.trim() || null;
  },

  // Returns true if the current step looks like the Work Experience section.
  _isWorkExperienceStep() {
    const label = this._detectStepLabel() || '';
    return /work experience|employment history|work history/i.test(label);
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
      payload: { site: "workday", company, role, url: window.location.href },
    }).catch(() => {});
  },
};
