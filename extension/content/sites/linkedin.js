// LinkedIn — credential fit check + external company apply (no Easy Apply).
// If API key is set: calls Claude API and shows a scored overlay.
// If no API key: builds a prompt, copies it to clipboard, and prompts you to paste into the Claude window.

function _escHtml(s) {
  return String(s || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Shown after the fit prompt is sent to the Claude.ai project tab automatically
const claudeSentOverlay = {
  show() {
    return new Promise((resolve) => {
      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });

      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .backdrop { position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
          .card { background:#fff;border-radius:14px;padding:28px 32px;width:420px;max-width:92vw;box-shadow:0 24px 64px rgba(0,0,0,.35); }
          h2 { font-size:18px;font-weight:700;color:#1e293b;margin:0 0 8px; }
          p  { font-size:14px;color:#64748b;margin:0 0 22px;line-height:1.5; }
          .sent-badge { display:inline-flex;align-items:center;gap:8px;background:#f0fdf4;border:1.5px solid #bbf7d0;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:600;color:#16a34a;margin-bottom:20px; }
          .actions { display:flex;gap:10px; }
          .btn-apply { flex:1;background:#0a66c2;color:#fff;border:none;border-radius:8px;padding:13px;font-size:14px;font-weight:600;cursor:pointer; }
          .btn-apply:hover { background:#0952a5; }
          .btn-skip  { padding:13px 16px;border:1.5px solid #e2e8f0;background:#fff;border-radius:8px;font-size:14px;cursor:pointer;color:#94a3b8; }
          .btn-skip:hover { background:#f8fafc; }
        </style>
        <div class="backdrop">
          <div class="card">
            <h2>Sent to Claude ✓</h2>
            <div class="sent-badge">✓ Prompt sent to your JobApplier project</div>
            <p>Switch to the <strong>Claude tab</strong> to read the fit analysis. Apply directly if it looks good.</p>
            <div class="actions">
              <button class="btn-apply">Apply on Company Website →</button>
              <button class="btn-skip">Skip</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(host);

      const backdrop = shadow.querySelector(".backdrop");
      shadow.querySelector(".btn-apply").onclick = () => { host.remove(); resolve("apply"); };
      shadow.querySelector(".btn-skip").onclick  = () => { host.remove(); resolve("skip"); };
      backdrop.onclick = (e) => { if (e.target === backdrop) { host.remove(); resolve("skip"); } };
    });
  },
};

const fitOverlay = {
  show(fit) {
    return new Promise((resolve) => {
      const score = fit.score || 0;
      const color = score >= 8 ? "#22c55e" : score >= 6 ? "#f59e0b" : "#ef4444";

      const host = document.createElement("div");
      const shadow = host.attachShadow({ mode: "open" });

      shadow.innerHTML = `
        <style>
          :host { all: initial; }
          .backdrop { position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;z-index:999999;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; }
          .card { background:#fff;border-radius:14px;padding:28px 32px;width:480px;max-width:92vw;max-height:90vh;overflow-y:auto;box-shadow:0 24px 64px rgba(0,0,0,.35); }
          .score-row { display:flex;align-items:baseline;gap:12px;margin-bottom:20px;border-bottom:1px solid #f1f5f9;padding-bottom:18px; }
          .score { font-size:52px;font-weight:800;color:${color};line-height:1; }
          .score sup { font-size:22px;color:#cbd5e1;font-weight:600; }
          .score-label { font-size:20px;font-weight:700;color:${color}; }
          h3 { font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:#94a3b8;margin:16px 0 6px 0; }
          ul { margin:0;padding:0;list-style:none; }
          li { display:flex;gap:8px;font-size:14px;color:#334155;padding:3px 0;line-height:1.4; }
          li.match::before { content:"✓";color:#22c55e;font-weight:700;flex-shrink:0; }
          li.gap::before   { content:"✗";color:#ef4444;font-weight:700;flex-shrink:0; }
          .rec { background:#f8fafc;border-left:3px solid #6366f1;border-radius:0 8px 8px 0;padding:11px 14px;font-size:14px;color:#334155;margin-top:16px;line-height:1.5; }
          .actions { display:flex;gap:10px;margin-top:22px; }
          .btn-apply { flex:1;background:#0a66c2;color:#fff;border:none;border-radius:8px;padding:13px;font-size:15px;font-weight:600;cursor:pointer;transition:background .15s; }
          .btn-apply:hover { background:#0952a5; }
          .btn-skip { padding:13px 20px;border:1.5px solid #e2e8f0;background:#fff;border-radius:8px;font-size:14px;cursor:pointer;color:#64748b;transition:background .15s; }
          .btn-skip:hover { background:#f8fafc; }
        </style>
        <div class="backdrop">
          <div class="card">
            <div class="score-row">
              <span class="score">${score}<sup>/10</sup></span>
              <span class="score-label">${_escHtml(fit.scoreLabel || "")}</span>
            </div>
            ${fit.matching?.length ? `
              <h3>Matches Your Profile</h3>
              <ul>${fit.matching.map(m => `<li class="match">${_escHtml(m)}</li>`).join("")}</ul>
            ` : ""}
            ${fit.missing?.length ? `
              <h3>Gaps to Be Aware Of</h3>
              <ul>${fit.missing.map(m => `<li class="gap">${_escHtml(m)}</li>`).join("")}</ul>
            ` : ""}
            ${fit.recommendation ? `<div class="rec">${_escHtml(fit.recommendation)}</div>` : ""}
            <div class="actions">
              <button class="btn-apply">Apply on Company Website →</button>
              <button class="btn-skip">Skip</button>
            </div>
          </div>
        </div>
      `;

      document.body.appendChild(host);

      const backdrop = shadow.querySelector(".backdrop");
      shadow.querySelector(".btn-apply").onclick = () => { host.remove(); resolve("apply"); };
      shadow.querySelector(".btn-skip").onclick  = () => { host.remove(); resolve("skip"); };
      backdrop.onclick = (e) => { if (e.target === backdrop) { host.remove(); resolve("skip"); } };
    });
  },
};

window.__jaHandler = {
  detectionRules: {
    // Show on any LinkedIn job detail panel — not restricted to Easy Apply jobs
    urlPatterns: [/linkedin\.com\/jobs/i],
    selectors: [
      ".job-details-jobs-unified-top-card__job-title",
      ".jobs-unified-top-card__job-title",
      ".jobs-details__main-content",
      ".jobs-search__job-details--wrapper",
    ],
  },

  idleLabel: "Check Fit",
  _paused: false,
  _profile: null,

  pause() { this._paused = true; },

  async run(profile, onUnknown) {
    this._paused = false;
    this._profile = profile;
    floatingButton.setState(floatingButton.STATES.RUNNING);
    floatingButton.setProgress("Reading job…");

    try {
      const jobDescription = this._extractJobDescription();
      if (!jobDescription) {
        floatingButton.setState(floatingButton.STATES.ERROR);
        floatingButton.setProgress("Can't read job description");
        return;
      }

      floatingButton.setProgress("Analyzing fit…");
      const fit = await chrome.runtime.sendMessage({
        type: MSG.CHECK_FIT,
        payload: { jobDescription },
      });

      // No API key — send prompt to the Claude.ai project tab automatically
      if (fit.error === "NO_API_KEY") {
        const prompt = this._buildClaudePrompt(profile, jobDescription);
        chrome.runtime.sendMessage({ type: MSG.SEND_TO_CLAUDE, payload: { prompt } }).catch(() => {});
        floatingButton.setState(floatingButton.STATES.WAITING_USER);
        floatingButton.setProgress("Sent to Claude →");
        const decision = await claudeSentOverlay.show(jobDescription);
        if (decision === "apply") {
          const opened = this._openExternalApply();
          if (opened) { this._logApplication(); floatingButton.setState(floatingButton.STATES.DONE); }
          else { floatingButton.setState(floatingButton.STATES.ERROR); floatingButton.setProgress("No company apply link found"); }
        } else {
          floatingButton.setState(floatingButton.STATES.IDLE);
        }
        return;
      }

      if (fit.error) {
        floatingButton.setState(floatingButton.STATES.ERROR);
        floatingButton.setProgress("Analysis failed");
        return;
      }

      floatingButton.setState(floatingButton.STATES.WAITING_USER);
      const decision = await fitOverlay.show(fit);

      if (decision === "apply") {
        const opened = this._openExternalApply();
        if (!opened) {
          floatingButton.setState(floatingButton.STATES.ERROR);
          floatingButton.setProgress("No company apply link found");
          return;
        }
        this._logApplication();
        floatingButton.setState(floatingButton.STATES.DONE);
      } else {
        floatingButton.setState(floatingButton.STATES.IDLE);
      }
    } catch (err) {
      console.error("[JobApplier] Fit check error:", err);
      floatingButton.setState(floatingButton.STATES.ERROR);
    }
  },

  _buildClaudePrompt(profile, jobDescription) {
    const name = `${profile.firstName} ${profile.lastName}`.trim();
    const profileText = [
      name && `Name: ${name}`,
      profile.currentTitle && `Current title: ${profile.currentTitle}`,
      profile.yearsOfExperience && `Years of experience: ${profile.yearsOfExperience}`,
      profile.highestDegree && `Education: ${profile.highestDegree} in ${profile.fieldOfStudy} from ${profile.university}` +
        (profile.gpa ? ` (GPA: ${profile.gpa})` : ''),
      profile.skills && `Skills: ${profile.skills}`,
      profile.certifications && `Certifications: ${profile.certifications}`,
      profile.relevantCoursework && `Relevant coursework: ${profile.relevantCoursework}`,
      profile.workExperience && `Work experience:\n${profile.workExperience}`,
      profile.projects && `Projects:\n${profile.projects}`,
      profile.professionalSummary && `Summary: ${profile.professionalSummary}`,
    ].filter(Boolean).join("\n");

    return `I'm deciding whether to apply for this internship/role. Please analyze my fit.

HARD DISQUALIFIERS — check these first. If ANY apply, say "DISQUALIFIED: [reason]" at the top and stop:
• Requires Master's or PhD and does NOT accept a Bachelor's degree
• Requires more years of experience than I have (${profile.yearsOfExperience || 1} year(s))
• Unpaid, academic credit only, or volunteer
• Has an age requirement or age range restriction
• Requires a non-STEM-specific degree only (note: I have CS + Economics — any CS, engineering, data science, math, physics, or general STEM degree requirement is fine)

If none of those apply, give me:
1. Fit score out of 10
2. Key qualifications I have that match this role
3. Gaps or requirements I don't clearly meet
4. One-sentence recommendation on whether to apply

MY PROFILE:
${profileText}

JOB DESCRIPTION:
${jobDescription.slice(0, 3500)}`;
  },

  _extractJobDescription() {
    const candidates = [
      "#job-details",
      ".jobs-description-content__text",
      ".jobs-description__container",
      ".jobs-box__html-content",
      ".jobs-description",
    ];
    for (const sel of candidates) {
      const el = document.querySelector(sel);
      if (el?.textContent.trim().length > 100) {
        return el.textContent.trim().slice(0, 4000);
      }
    }
    return null;
  },

  _openExternalApply() {
    // LinkedIn shows a regular "Apply" link/button for non-Easy-Apply jobs
    const btn =
      document.querySelector(".jobs-apply-button:not(.jobs-easy-apply-button)") ||
      document.querySelector('a.jobs-apply-button[href]') ||
      document.querySelector('.jobs-unified-top-card__apply-btn a[href]') ||
      // Fallback: any visible apply button that isn't Easy Apply
      [...document.querySelectorAll("button, a")].find(
        (el) =>
          /^apply$/i.test(el.textContent.trim()) &&
          !el.textContent.includes("Easy")
      );

    if (btn) {
      btn.click();
      return true;
    }
    return false;
  },

  _logApplication() {
    const jobTitle =
      document.querySelector(
        ".job-details-jobs-unified-top-card__job-title, h1.t-24"
      )?.textContent.trim() || document.title;

    const company =
      document.querySelector(
        ".job-details-jobs-unified-top-card__company-name, " +
        ".jobs-unified-top-card__company-name"
      )?.textContent.trim() || "";

    chrome.runtime.sendMessage({
      type: MSG.LOG_APPLICATION,
      payload: { site: "linkedin", company, role: jobTitle, url: window.location.href },
    }).catch(() => {});
  },
};
