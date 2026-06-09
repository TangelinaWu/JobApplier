// Message type constants shared between content scripts and background.
// Using constants avoids string typos and makes it easy to grep for usages.

const MSG = {
  // Content → Background: ask Claude to answer an unknown form field
  ASK_CLAUDE: "ASK_CLAUDE",

  // Background → Content: Claude's response
  CLAUDE_RESPONSE: "CLAUDE_RESPONSE",

  // Content → Background / Popup: fill status updates
  FILL_STATUS: "FILL_STATUS",

  // Popup → Content: query current status
  GET_STATUS: "GET_STATUS",

  // Content → Background: analyze fit between job description and user profile
  CHECK_FIT: "CHECK_FIT",

  // Content → Background: send a prompt to the Claude.ai project tab
  SEND_TO_CLAUDE: "SEND_TO_CLAUDE",

  // Control panel ↔ Background ↔ Content: auto-matcher commands and events
  AUTO_MATCH_START:  "AUTO_MATCH_START",
  AUTO_MATCH_STOP:   "AUTO_MATCH_STOP",
  AUTO_MATCH_PAUSE:  "AUTO_MATCH_PAUSE",
  AUTO_MATCH_RESUME: "AUTO_MATCH_RESUME",
  AUTO_MATCH_STATUS: "AUTO_MATCH_STATUS",
  AUTO_MATCH_RESULT: "AUTO_MATCH_RESULT",
  AUTO_MATCH_DONE:   "AUTO_MATCH_DONE",

  // Auto-apply pipeline: LinkedIn → ATS tab → back to LinkedIn
  AUTO_APPLY_STARTED:  "AUTO_APPLY_STARTED",   // autoMatcher clicked apply button
  AUTO_APPLY_FILLING:  "AUTO_APPLY_FILLING",   // ATS content script started filling
  AUTO_APPLY_COMPLETE: "AUTO_APPLY_COMPLETE",  // ATS form fill finished

  // Content → Background: bring the sending tab into focus
  FOCUS_TAB: "FOCUS_TAB",

  // Content → Background: log a completed application
  LOG_APPLICATION: "LOG_APPLICATION",
};

// Fill status values sent in FILL_STATUS messages
const FILL_STATUS = {
  IDLE: "idle",
  RUNNING: "running",
  PAUSED: "paused",
  WAITING_USER: "waiting_user",
  DONE: "done",
  ERROR: "error",
};
