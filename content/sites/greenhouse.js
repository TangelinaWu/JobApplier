// Greenhouse ATS handler
// Supports: boards.greenhouse.io and job-boards.greenhouse.io

window.__jaHandler = {
  detectionRules: {
    urlPatterns: [/greenhouse\.io/i],
    selectors: [
      "#application_form",
      "#application-form",
      "form#app_application",
      "[id*='greenhouse']",
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
      await this._fillForm(profile, onUnknown);
    } catch (err) {
      console.error("[JobApplier] Greenhouse error:", err);
      floatingButton.setState(floatingButton.STATES.ERROR);
    }
  },

  async _fillForm(profile, onUnknown) {
    const form =
      document.getElementById("application_form") ||
      document.getElementById("application-form") ||
      document.querySelector("form#app_application") ||
      document.querySelector("form[action*='application']") ||
      document.querySelector("form");

    if (!form) {
      floatingButton.setState(floatingButton.STATES.ERROR);
      return;
    }

    floatingButton.setProgress("Filling form…");

    // Greenhouse sometimes has a hidden resume file input
    await this._handleResumeUpload(form, profile);

    // Fill standard fields
    await formFiller.fillContainer(form, profile, onUnknown);

    if (this._paused) {
      floatingButton.setState(floatingButton.STATES.PAUSED);
      return;
    }

    // Greenhouse may have a separate demographic/EEOC section below the main form
    await this._handleEeocSection(profile, onUnknown);

    floatingButton.setState(floatingButton.STATES.DONE);
    floatingButton.setProgress("Review & submit");

    if (profile.autoSubmit) {
      await humanDelay.beforeClick();
      const submitBtn = form.querySelector(
        'input[type="submit"]#submit_app, button[type="submit"]'
      );
      if (submitBtn) submitBtn.click();
    }

    this._logApplication(profile);
  },

  async _handleResumeUpload(form, profile) {
    if (!profile.resumeDataUrl) return;

    // New Greenhouse: #resume_upload input[type=file]
    // Old Greenhouse: input[name="resume"] or input[name="resume_text"]
    const fileInput =
      form.querySelector("#resume_upload input[type='file']") ||
      form.querySelector("input[type='file'][name*='resume']") ||
      form.querySelector("input[type='file'][name*='cv']") ||
      form.querySelector("input[type='file']");

    if (fileInput) {
      await formFiller.fillFileInput(fileInput, profile.resumeDataUrl, profile.resumeFileName);
      await humanDelay.betweenFields();
    }
  },

  async _handleEeocSection(profile, onUnknown) {
    // Greenhouse renders EEOC fields in a separate div after the main form
    const eeocSection = document.querySelector(
      "#demographic_questions, .demographic-questions, [id*='eeoc'], [class*='eeoc']"
    );
    if (!eeocSection) return;

    await formFiller.fillContainer(eeocSection, profile, onUnknown);
  },

  _logApplication(profile) {
    const meta = document.querySelector("meta[property='og:title']");
    const role = meta ? meta.content : document.title;
    browser.runtime.sendMessage({
      type: MSG.LOG_APPLICATION,
      payload: {
        site: "greenhouse",
        company: document.querySelector(".company-name, h1.company")?.textContent.trim() || "",
        role: role.trim(),
        url: window.location.href,
      },
    }).catch(() => {});
  },
};
