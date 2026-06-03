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
