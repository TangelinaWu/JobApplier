const { app, BrowserWindow, ipcMain, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')

const CREDENTIALS_DIR = path.join(__dirname, '..', 'credentials')
const MASTER_RESUME_PATH = path.join(CREDENTIALS_DIR, 'master_resume.json')
const OUTPUT_PDF_PATH = path.join(CREDENTIALS_DIR, 'tailored_resume.pdf')

let mainWindow

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 1100,
    minHeight: 700,
    title: 'Resume Tailor',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  })
  mainWindow.loadFile(path.join(__dirname, 'ui', 'index.html'))
  mainWindow.on('closed', () => { mainWindow = null })
}

ipcMain.handle('load-master-resume', () => {
  if (!fs.existsSync(MASTER_RESUME_PATH)) return null
  return JSON.parse(fs.readFileSync(MASTER_RESUME_PATH, 'utf8'))
})

// ── Resume tailoring via Claude.ai window ──────────────────────────────────────

ipcMain.handle('tailor-resume', async (_, { jobDescription, masterResume }) => {
  const prompt = buildPrompt(jobDescription, masterResume)

  const claudeWin = new BrowserWindow({
    width: 1050,
    height: 720,
    title: 'Resume Tailor — Claude.ai',
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  await claudeWin.loadURL('https://claude.ai/new')
  await sleep(2500)

  // Inject prompt using the same ClipboardEvent paste trick as the job automation claude.js
  let injected
  try {
    injected = await claudeWin.webContents.executeJavaScript(buildInjectScript(prompt))
  } catch (err) {
    if (!claudeWin.isDestroyed()) claudeWin.close()
    throw new Error('Injection failed: ' + err.message)
  }

  if (!injected) {
    if (!claudeWin.isDestroyed()) claudeWin.close()
    throw new Error('Could not find the Claude.ai editor — make sure you\'re logged in to claude.ai and try again')
  }

  // Poll page text every 3 s until we find a complete parseable JSON block (up to 2 min)
  const deadline = Date.now() + 120000
  while (Date.now() < deadline) {
    await sleep(3000)
    if (claudeWin.isDestroyed()) throw new Error('Claude window was closed before a response arrived')

    let pageText
    try { pageText = await claudeWin.webContents.executeJavaScript('document.body.innerText') }
    catch { continue }

    const result = extractJSON(pageText)
    if (result?.fitScore !== undefined && Array.isArray(result.selectedExperience)) {
      claudeWin.close()
      return result
    }
  }

  if (!claudeWin.isDestroyed()) claudeWin.close()
  throw new Error('No valid response received within 2 minutes — try again')
})

// ── PDF generation ─────────────────────────────────────────────────────────────

ipcMain.handle('generate-pdf', async (_, html) => {
  const tmpPath = path.join(os.tmpdir(), 'tailored_resume_render.html')
  fs.writeFileSync(tmpPath, html, 'utf8')

  const pdfWin = new BrowserWindow({
    show: false,
    width: 816,
    height: 1056,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })

  await pdfWin.loadFile(tmpPath)

  const pdfBuffer = await pdfWin.webContents.printToPDF({
    pageSize: 'Letter',
    printBackground: true,
    margins: { marginType: 'none' },
  })

  pdfWin.close()
  fs.unlinkSync(tmpPath)
  fs.writeFileSync(OUTPUT_PDF_PATH, pdfBuffer)
  return OUTPUT_PDF_PATH
})

ipcMain.handle('open-file', (_, filePath) => shell.openPath(filePath))

// ── Helpers ────────────────────────────────────────────────────────────────────

function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

// Build the executeJavaScript string that pastes the prompt and submits it.
// Mirrors the logic in job_automation/extension/content/sites/claude.js.
function buildInjectScript(prompt) {
  return `(async () => {
    function wait(ms) { return new Promise(r => setTimeout(r, ms)) }
    const EDITORS = [
      'div[contenteditable="true"]',
      '.ProseMirror',
      '[data-testid="chat-input"]',
    ]
    const BTNS = [
      'button[aria-label="Send message"]',
      'button[aria-label="Send Message"]',
      'button[aria-label*="send" i]',
      'button[data-testid="send-button"]',
    ]

    // Wait up to 12 s for the editor to appear (handles slow page loads / redirects)
    const deadline = Date.now() + 12000
    let editor = null
    while (Date.now() < deadline) {
      for (const sel of EDITORS) {
        const el = document.querySelector(sel)
        if (el && el.offsetParent !== null) { editor = el; break }
      }
      if (editor) break
      await wait(300)
    }
    if (!editor) return false

    editor.focus()
    await wait(200)

    const text = ${JSON.stringify(prompt)}
    try {
      const dt = new DataTransfer()
      dt.setData('text/plain', text)
      editor.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }))
    } catch {
      document.execCommand('selectAll', false, null)
      document.execCommand('delete', false, null)
      document.execCommand('insertText', false, text)
    }
    await wait(700)

    for (const sel of BTNS) {
      const btn = document.querySelector(sel)
      if (btn && !btn.disabled) { btn.click(); return true }
    }
    editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }))
    return true
  })()`
}

// Walk the page text to find and parse the JSON block containing fitScore.
// Handles both raw JSON and code-fenced blocks (```json ... ```).
function extractJSON(text) {
  const sources = []

  // Prefer code-fenced blocks
  const fenceRe = /```(?:json)?\s*([\s\S]*?)\s*```/g
  let m
  while ((m = fenceRe.exec(text)) !== null) sources.push(m[1])

  // Also try raw text
  sources.push(text)

  for (const src of sources) {
    const keyIdx = src.lastIndexOf('"fitScore"')
    if (keyIdx === -1) continue

    // Walk left from "fitScore" to find the opening {
    let depth = 0, start = -1
    for (let i = keyIdx; i >= 0; i--) {
      if (src[i] === '}') depth++
      else if (src[i] === '{') {
        if (depth === 0) { start = i; break }
        depth--
      }
    }
    if (start === -1) continue

    // Walk right from { to find the matching }
    depth = 0; let end = -1
    for (let i = start; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}') {
        depth--
        if (depth === 0) { end = i; break }
      }
    }
    if (end === -1) continue

    try { return JSON.parse(src.slice(start, end + 1)) } catch {}
  }
  return null
}

function buildPrompt(jobDescription, masterResume) {
  return `You are a resume tailoring expert. Analyze the job description and select the best matching content from this candidate's master resume.

JOB DESCRIPTION:
${jobDescription}

MASTER RESUME (all available experience and bullet points):
${JSON.stringify(masterResume, null, 2)}

INSTRUCTIONS:
1. Analyze the job for key required skills, technologies, and role responsibilities
2. Select the most relevant work experiences — choose 3–4 bullets per role that best match
3. Rewrite bullets if needed to emphasize relevant impact — always keep quantitative metrics
4. Select 2–3 most relevant projects; pick 2–3 bullets each
5. Filter skills to the most relevant for this role
6. Provide a fit score (0–100) and a 1–2 sentence explanation

Return ONLY valid JSON with no extra commentary, markdown, or code fences:
{
  "fitScore": 85,
  "fitReason": "Strong match for...",
  "selectedExperience": [
    {
      "company": "...",
      "title": "...",
      "startDate": "...",
      "endDate": "...",
      "location": "...",
      "bullets": ["Accomplished X by doing Y, resulting in Z"]
    }
  ],
  "selectedProjects": [
    {
      "name": "...",
      "technologies": ["..."],
      "date": "...",
      "bullets": ["..."]
    }
  ],
  "selectedSkills": {
    "languages": ["..."],
    "frameworks": ["..."],
    "databases": ["..."],
    "tools": ["..."]
  }
}`
}

app.whenReady().then(createWindow)
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
