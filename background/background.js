// Background page — persistent (MV2).
// This is the ONLY place the Claude API key is used.
// Content scripts never receive the key; they only get the text suggestion.

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === MSG.ASK_CLAUDE) {
    handleClaudeRequest(message.payload)
      .then(sendResponse)
      .catch((err) => sendResponse({ error: err.message }));
    return true; // keep the message channel open for async response
  }

  if (message.type === MSG.LOG_APPLICATION) {
    appendAppLog(message.payload).catch(() => {});
    return false;
  }

  // Forward status updates to the popup (if open)
  if (message.type === MSG.FILL_STATUS) {
    browser.runtime.sendMessage(message).catch(() => {});
    return false;
  }
});

async function handleClaudeRequest({ question, fieldContext, fieldLabel }) {
  const profile = await getProfile();
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
  const lines = [
    `You are helping ${name || "a job applicant"} fill out a job application form.`,
    `Answer questions in first person as if you are the applicant.`,
    `Keep answers concise — 1–3 sentences unless the question clearly requires more.`,
    `Do not fabricate specific facts not provided below. If unsure, give a reasonable professional answer.`,
    ``,
    `Applicant profile:`,
    `- Name: ${name}`,
    `- Email: ${profile.email}`,
    `- Current title: ${profile.currentTitle}`,
    `- Years of experience: ${profile.yearsOfExperience}`,
    `- Work authorization: ${profile.workAuthorization}`,
    `- Highest degree: ${profile.highestDegree} in ${profile.fieldOfStudy} from ${profile.university}`,
    `- Skills: ${profile.skills}`,
  ];

  if (profile.professionalSummary) {
    lines.push(`- Professional summary: ${profile.professionalSummary}`);
  }

  return lines.filter(Boolean).join("\n");
}

function buildUserPrompt(question, fieldContext) {
  let prompt = `Job application question: "${question}"`;
  if (fieldContext) {
    prompt += `\n\nContext from the form: ${fieldContext}`;
  }
  prompt += `\n\nProvide a concise, professional answer suitable for a job application form field.`;
  return prompt;
}
