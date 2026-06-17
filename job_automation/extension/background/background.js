// Background page — persistent (MV2).
// This is the ONLY place the Claude API key is used.
// Content scripts never receive the key; they only get the text suggestion.

// Pre-seed LinkedIn email on first run.
(async () => {
  const profile = await getProfile()
  if (!profile.linkedinEmail) {
    await saveProfile({ linkedinEmail: 'tangelinawu100@gmail.com' })
  }
})()

// Sync seen job URLs from Google Sheets on startup so the auto-matcher
// skips already-processed jobs even across app restarts.
;(async () => {
  try {
    const resp = await fetch('http://127.0.0.1:3742/seen')
    if (!resp.ok) return
    const { urls } = await resp.json()
    if (!Array.isArray(urls) || urls.length === 0) return
    const seen = await getSeenJobs()
    for (const u of urls) seen.add(u)
    await chrome.storage.local.set({ seenJobUrls: [...seen] })
    console.log(`[JobApplier] Synced ${urls.length} seen job URLs from Sheets`)
  } catch {
    // Server not running or Sheets not configured — that's fine
  }
})()

// requestId → tabId: tracks which content tab is waiting for an overlay answer
const pendingQuestions = new Map()

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Overlay: content script → background → control window
  if (message.type === MSG.OVERLAY_QUESTION) {
    const tabId = sender.tab?.id
    const { requestId, question, fieldContext } = message.payload || {}
    if (!tabId || !requestId) return false
    pendingQuestions.set(requestId, { tabId, question })
    handleClaudeRequest({ question, fieldContext })
      .then(response => {
        const suggestion = response.error ? '' : (response.suggestion || '')
        chrome.runtime.sendMessage({
          type: MSG.OVERLAY_QUESTION,
          payload: { requestId, question, suggestion },
        }).catch(() => {})
      })
    return false
  }

  // Overlay: control window → background → content tab
  if (message.type === MSG.OVERLAY_ANSWER) {
    const { requestId, accepted, value } = message.payload || {}
    const pending = pendingQuestions.get(requestId)
    if (pending !== undefined) {
      pendingQuestions.delete(requestId)
      chrome.tabs.sendMessage(pending.tabId, {
        type: MSG.OVERLAY_ANSWER,
        payload: { requestId, accepted, value },
      }).catch(() => {})
      if (accepted && value) {
        saveAnswer(pending.question, value).catch(() => {})
      }
    }
    return false
  }

  if (message.type === MSG.ASK_CLAUDE) {
    handleClaudeRequest(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === MSG.CHECK_FIT) {
    handleFitCheck(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true;
  }

  if (message.type === MSG.SEND_TO_CLAUDE) {
    const { prompt, isJobAnalysis } = message.payload || {};
    if (isJobAnalysis) {
      // Auto-matcher mode: prompt is already in storage as pendingClaudeJobAnalysis.
      // claude.js content script picks it up via storage.onChanged — no tab interaction needed.
      return false;
    }
    // Manual Check Fit: push prompt and focus the Claude project tab
    if (prompt) {
      chrome.storage.local.set({ pendingClaudePrompt: prompt });
      chrome.tabs.query({ url: ['*://claude.ai/*'] }, (tabs) => {
        if (!tabs || tabs.length === 0) return;
        chrome.tabs.update(tabs[0].id, { active: true });
      });
    }
    return false;
  }

  if (message.type === MSG.FOCUS_TAB) {
    if (sender.tab?.id) chrome.tabs.update(sender.tab.id, { active: true });
    return false;
  }

  if (message.type === MSG.LOG_APPLICATION) {
    appendAppLog(message.payload).catch(() => {});
    // Forward to Google Sheets server running in the Electron main process.
    fetch('http://localhost:47293/log', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(message.payload),
    }).catch(() => {});
    if (message.payload?.url) {
      addSeenJob(message.payload.url).catch(() => {})
    }
    return false;
  }

  // Forward status updates to the popup (if open)
  if (message.type === MSG.FILL_STATUS) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // Auto-matcher: control panel → background → LinkedIn tab (first match only)
  if ([MSG.AUTO_MATCH_START, MSG.AUTO_MATCH_STOP, MSG.AUTO_MATCH_PAUSE, MSG.AUTO_MATCH_RESUME].includes(message.type)) {
    chrome.tabs.query({ url: ['*://www.linkedin.com/jobs/*', '*://linkedin.com/jobs/*'] }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
    return false;
  }

  // Auto-matcher: LinkedIn tab → background → control panel
  if ([MSG.AUTO_MATCH_STATUS, MSG.AUTO_MATCH_RESULT, MSG.AUTO_MATCH_DONE].includes(message.type)) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // Auto-apply: LinkedIn clicked apply → control panel
  if (message.type === MSG.AUTO_APPLY_STARTED) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // Apply button not found: LinkedIn tab → control panel
  if (message.type === MSG.APPLY_BTN_NOT_FOUND) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // User clicked Retry in control panel → LinkedIn tab
  if (message.type === MSG.APPLY_BTN_RETRY) {
    chrome.tabs.query({ url: ['*://www.linkedin.com/jobs/*', '*://linkedin.com/jobs/*'] }, (tabs) => {
      if (tabs && tabs.length > 0) {
        chrome.tabs.sendMessage(tabs[0].id, message).catch(() => {});
      }
    });
    return false;
  }

  // Auto-apply: ATS tab filling/done → LinkedIn tab (to unblock autoMatcher) + control panel
  if (message.type === MSG.AUTO_APPLY_FILLING || message.type === MSG.AUTO_APPLY_COMPLETE) {
    chrome.runtime.sendMessage(message).catch(() => {});
    chrome.tabs.query({ url: ['*://www.linkedin.com/jobs/*', '*://linkedin.com/jobs/*'] }, (tabs) => {
      for (const tab of (tabs || [])) {
        chrome.tabs.sendMessage(tab.id, message).catch(() => {});
      }
    });
    return false;
  }

  // Diagnostic fill logs: ATS content → control panel
  if (message.type === MSG.FILL_LOG) {
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }

  // Form field discovery: save to storage and forward to control panel
  if (message.type === MSG.FORM_DISCOVERED) {
    const entry = Object.assign({}, message.payload, { scannedAt: new Date().toISOString() });
    chrome.storage.local.get('discoveredFields', ({ discoveredFields }) => {
      const existing = Array.isArray(discoveredFields) ? discoveredFields : [];
      // Replace same URL if already scanned, otherwise append
      const deduped = existing.filter(e => e.url !== entry.url);
      chrome.storage.local.set({ discoveredFields: [...deduped, entry] });
    });
    chrome.runtime.sendMessage(message).catch(() => {});
    return false;
  }
});

// Returns a matched answer from the local answers DB, or null if nothing matches.
function findLocalAnswer(question, answers) {
  const lower = (question || "").toLowerCase().trim();
  for (const entry of (answers || [])) {
    if ((entry.patterns || []).some((p) => lower.includes(p.toLowerCase()))) {
      return entry.answer;
    }
  }
  return null;
}

async function handleClaudeRequest({ question, fieldContext, fieldLabel }) {
  const profile = await getProfile();

  // Check the local answers DB first — no API key or network needed
  const answers = await getAnswers();
  const localAnswer = findLocalAnswer(question || fieldLabel, answers);
  if (localAnswer !== null) {
    return { suggestion: localAnswer };
  }

  const apiKey = profile.claudeApiKey;

  if (!apiKey || !apiKey.trim()) {
    return { error: "NO_API_KEY" };
  }

  const systemPrompt = buildSystemPrompt(profile);
  const userPrompt = buildUserPrompt(question || fieldLabel, fieldContext);

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 300,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (err) {
    return { error: "NETWORK_ERROR: " + err.message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { error: `API_ERROR ${response.status}: ${body}` };
  }

  const data = await response.json();
  const suggestion = data.content && data.content[0] && data.content[0].text
    ? data.content[0].text.trim()
    : "";

  return { suggestion };
}

function buildSystemPrompt(profile) {
  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const gradDate = `${profile.graduationMonth || "May"} ${profile.graduationYear || "2027"}`;

  const lines = [
    `You are helping ${name || "a job applicant"} fill out a job application form.`,
    `Answer questions in first person as if you are the applicant.`,
    `Keep answers concise — 1–3 sentences unless the question clearly requires more.`,
    `Do not fabricate specific facts not provided below. If unsure, give a reasonable professional answer.`,
    ``,
    `APPLICANT PROFILE:`,
    `- Name: ${name}`,
    `- Email: ${profile.email}`,
    `- Phone: ${profile.phone}`,
    `- Location: ${profile.city}, ${profile.state}`,
    `- Current title: ${profile.currentTitle}`,
    `- Years of experience: ${profile.yearsOfExperience}`,
    `- Work authorization: ${profile.workAuthorization} — authorized to work in the US: Yes; requires sponsorship: No`,
    `- Education: ${profile.highestDegree} in ${profile.fieldOfStudy} from ${profile.university}, GPA: ${profile.gpa}, graduating ${gradDate}`,
    `- Currently a full-time student: Yes`,
    `- Prior internship/co-op experience: Yes (4 internships completed)`,
    `- Willing to relocate: No`,
    `- Can work on-site: Yes`,
    `- Available start date: ${profile.availableStartDate || "June 2026"}`,
    `- How heard about role: ${profile.referralSource || "LinkedIn"}`,
    `- Skills: ${profile.skills}`,
  ];

  if (profile.professionalSummary) {
    lines.push(`- Summary: ${profile.professionalSummary}`);
  }

  if (profile.workExperience) {
    lines.push(``, `WORK EXPERIENCE:`, profile.workExperience);
  }

  if (profile.projects) {
    lines.push(``, `PROJECTS:`, profile.projects);
  }

  if (profile.relevantCoursework) {
    lines.push(``, `RELEVANT COURSEWORK: ${profile.relevantCoursework}`);
  }

  return lines.filter((l) => l !== undefined).join("\n");
}

async function handleFitCheck({ jobDescription }) {
  const profile = await getProfile();
  const apiKey = profile.claudeApiKey;
  if (!apiKey || !apiKey.trim()) return { error: "NO_API_KEY" };

  const name = `${profile.firstName} ${profile.lastName}`.trim();
  const profileText = [
    `Name: ${name}`,
    `Title: ${profile.currentTitle}`,
    `Years of experience: ${profile.yearsOfExperience}`,
    `Education: ${profile.highestDegree} in ${profile.fieldOfStudy} from ${profile.university}` +
      (profile.gpa ? ` (GPA: ${profile.gpa})` : ''),
    `Skills: ${profile.skills}`,
    profile.certifications     && `Certifications: ${profile.certifications}`,
    profile.relevantCoursework && `Relevant coursework: ${profile.relevantCoursework}`,
    profile.workExperience     && `Work experience:\n${profile.workExperience}`,
    profile.projects           && `Projects:\n${profile.projects}`,
    profile.professionalSummary && `Summary: ${profile.professionalSummary}`,
  ].filter(Boolean).join("\n");

  const prompt = `You are evaluating a job candidate's fit for an internship or job.

HARD DISQUALIFIERS — check first. If ANY apply, set score to 0, scoreLabel to "Disqualified", and put the reason in recommendation:
• Requires Master's or PhD and does NOT accept a Bachelor's degree
• Requires more years of experience than the candidate has (${profile.yearsOfExperience || 1} year(s))
• Unpaid, academic credit only, or volunteer position
• Has an age requirement or age range restriction
• Requires a non-STEM degree specifically (CS, Engineering, Data Science, Math, Physics, or any STEM field is fine — candidate has CS + Economics)

CANDIDATE:
${profileText}

JOB DESCRIPTION:
${jobDescription.slice(0, 3500)}

Reply with a raw JSON object (no markdown fences):
{
  "score": <integer 0-10>,
  "scoreLabel": "<one of: Disqualified | Weak Match | Fair Match | Good Match | Strong Match | Excellent Match>",
  "matching": [<up to 5 short strings: skills or qualifications the candidate has that match>],
  "missing": [<up to 5 short strings: requirements the candidate doesn't clearly meet>],
  "recommendation": "<one sentence on whether to apply and why>"
}`;

  let response;
  try {
    response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey.trim(),
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });
  } catch (err) {
    return { error: "NETWORK_ERROR: " + err.message };
  }

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    return { error: `API_ERROR ${response.status}: ${body}` };
  }

  const data = await response.json();
  const text = data.content?.[0]?.text?.trim() || "";
  try {
    return JSON.parse(text);
  } catch {
    return { error: "PARSE_ERROR", raw: text };
  }
}

function buildUserPrompt(question, fieldContext) {
  let prompt = `Job application question: "${question}"`;
  if (fieldContext) {
    prompt += `\n\nContext from the form: ${fieldContext}`;
  }
  prompt += `\n\nProvide a concise, professional answer suitable for a job application form field.`;
  return prompt;
}
