const { app, BrowserWindow, Menu, session, webContents } = require('electron')
const path = require('path')
const fs = require('fs')
const http = require('http')
const crypto = require('crypto')

const TAB_ID = 'jobapplier'
const SHEETS_PORT = 47293

let mainWindow
let extensionId

// ── Google Sheets integration ─────────────────────────────────────────────────

let _sheetsServiceAccount = null
let _sheetsConfig = null
let _cachedToken = null
let _tokenExpiresAt = 0

function loadSheetsConfig() {
  const saPath  = path.join(__dirname, 'credentials', 'sheets-service-account.json')
  const cfgPath = path.join(__dirname, 'credentials', 'sheets-config.json')
  if (!fs.existsSync(saPath) || !fs.existsSync(cfgPath)) return false
  try {
    _sheetsServiceAccount = JSON.parse(fs.readFileSync(saPath, 'utf8'))
    _sheetsConfig         = JSON.parse(fs.readFileSync(cfgPath, 'utf8'))
    return true
  } catch (e) {
    console.warn('[JobApplier] Sheets config parse error:', e.message)
    return false
  }
}

function base64url(buf) {
  return buf.toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

async function getSheetsAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiresAt) return _cachedToken
  const sa = _sheetsServiceAccount
  const now = Math.floor(Date.now() / 1000)
  const header  = base64url(Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const payload = base64url(Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })))
  const toSign = `${header}.${payload}`
  const sign = crypto.createSign('SHA256')
  sign.update(toSign)
  const signature = base64url(sign.sign(sa.private_key))
  const jwt = `${toSign}.${signature}`

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${encodeURIComponent(jwt)}`,
  })
  const data = await res.json()
  if (!data.access_token) throw new Error('No token: ' + JSON.stringify(data))
  _cachedToken = data.access_token
  _tokenExpiresAt = Date.now() + 50 * 60 * 1000
  return _cachedToken
}

async function appendToSheet(rowData) {
  if (!_sheetsServiceAccount || !_sheetsConfig) return
  const token = await getSheetsAccessToken()
  const { spreadsheetId, range } = _sheetsConfig
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}:append?valueInputOption=USER_ENTERED`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [rowData] }),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    console.warn('[JobApplier] Sheets API error:', res.status, text)
  }
}

function startSheetsServer() {
  if (!loadSheetsConfig()) {
    console.log('[JobApplier] No Sheets credentials found — Google Sheets logging disabled.')
    console.log('[JobApplier] To enable, add credentials/sheets-service-account.json and credentials/sheets-config.json')
    return
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    if (req.method === 'POST' && req.url === '/log') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', async () => {
        try {
          const d = JSON.parse(body)
          const now = new Date(d.timestamp || Date.now())
          const row = [
            now.toLocaleDateString(),
            now.toLocaleTimeString(),
            d.company    || '',
            d.title      || d.role || '',
            d.atsUrl     || d.url  || '',
            d.linkedinUrl || '',
            d.platform   || d.site || '',
            d.status     || 'applied',
          ]
          await appendToSheet(row)
          res.writeHead(200); res.end('OK')
        } catch (err) {
          console.warn('[JobApplier] Sheets log error:', err.message)
          res.writeHead(500); res.end(err.message)
        }
      })
    } else {
      res.writeHead(404); res.end()
    }
  })

  server.listen(SHEETS_PORT, '127.0.0.1', () => {
    console.log(`[JobApplier] Google Sheets server ready on port ${SHEETS_PORT}`)
  })

  server.on('error', err => {
    if (err.code === 'EADDRINUSE') {
      console.warn(`[JobApplier] Port ${SHEETS_PORT} already in use — Sheets logging disabled`)
    } else {
      console.warn('[JobApplier] Sheets server error:', err.message)
    }
  })
}

async function loadExtension() {
  const ext = await session.defaultSession.extensions.loadExtension(
    path.join(__dirname, 'extension'),
    { allowFileAccess: true }
  )
  extensionId = ext.id
}

// Remove "Electron/x.x.x" from the user agent so sites treat us as regular Chrome.
function patchUserAgent() {
  const ua = session.defaultSession.getUserAgent().replace(/ Electron\/[\d.]+/, '')
  session.defaultSession.setUserAgent(ua)
}

function makeTab(url) {
  const win = new BrowserWindow({
    tabbingIdentifier: TAB_ID,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  win.loadURL(url)
  return win
}

function openSettings() {
  if (!extensionId) return
  const win = new BrowserWindow({
    width: 860,
    height: 920,
    title: 'JobApplier — Settings',
    autoHideMenuBar: true,
  })
  win.loadURL(`chrome-extension://${extensionId}/options/options.html`)
}

function openPopup() {
  if (!extensionId) return
  const win = new BrowserWindow({
    width: 380,
    height: 520,
    title: 'JobApplier',
    autoHideMenuBar: true,
    resizable: false,
    alwaysOnTop: true,
  })
  win.loadURL(`chrome-extension://${extensionId}/popup/popup.html`)
}

function buildMenu() {
  // Navigate in whichever tab is currently focused
  const navigate = (url) => () => {
    const win = BrowserWindow.getFocusedWindow() || mainWindow
    if (win) win.loadURL(url)
  }

  const template = [
    {
      label: 'JobApplier',
      submenu: [
        { label: 'Settings…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'Status Popup', accelerator: 'CmdOrCtrl+Shift+J', click: openPopup },
        { label: 'Reload Credentials', click: () => seedCredentialsToStorage() },
        { type: 'separator' },
        { role: 'quit' },
      ],
    },
    {
      label: 'Go To',
      submenu: [
        { label: 'LinkedIn Jobs',          accelerator: 'CmdOrCtrl+1', click: navigate('https://www.linkedin.com/jobs/search/?f_E=1&f_JT=I&keywords=software+engineer+intern') },
        { label: 'Internships (Simplify)', accelerator: 'CmdOrCtrl+2', click: navigate('https://github.com/SimplifyJobs/Summer2026-Internships#-software-engineering-internship-roles') },
        { label: 'Claude',                 accelerator: 'CmdOrCtrl+3', click: navigate('https://claude.ai/new') },
        { label: 'Handshake',              accelerator: 'CmdOrCtrl+4', click: navigate('https://app.joinhandshake.com/') },
        { label: 'Greenhouse',             accelerator: 'CmdOrCtrl+5', click: navigate('https://boards.greenhouse.io/') },
        { label: 'Lever',                  accelerator: 'CmdOrCtrl+6', click: navigate('https://jobs.lever.co/') },
        { label: 'Workday',                accelerator: 'CmdOrCtrl+7', click: navigate('https://www.myworkdayjobs.com/') },
      ],
    },
    {
      label: 'Navigate',
      submenu: [
        {
          label: 'Back',
          accelerator: 'Cmd+[',
          click() { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.goBack() },
        },
        {
          label: 'Forward',
          accelerator: 'Cmd+]',
          click() { const w = BrowserWindow.getFocusedWindow(); if (w) w.webContents.goForward() },
        },
        { type: 'separator' },
        { role: 'reload' },
        { role: 'forceReload' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]

  return Menu.buildFromTemplate(template)
}

function flattenCredentials(creds) {
  const flat = {}
  Object.assign(flat, creds.personal)
  Object.assign(flat, creds.work)
  flat.highestDegree       = creds.education.highestDegree
  flat.fieldOfStudy        = creds.education.fieldOfStudy
  flat.university          = creds.education.university
  flat.graduationYear      = creds.education.graduationYear
  flat.graduationMonth     = creds.education.graduationMonth || 'May'
  flat.gpa                 = creds.education.gpa
  flat.relevantCoursework  = (creds.education.relevantCoursework || []).join(', ')
  flat.skills              = (creds.skills || []).join(', ')
  flat.certifications      = (creds.certifications || []).join(', ')
  flat.targetRoles         = (creds.targeting.targetRoles || []).join(', ')
  flat.preferredIndustries = (creds.targeting.preferredIndustries || []).join(', ')
  flat.workExperience = (creds.workExperience || []).map(e =>
    `${e.company} · ${e.title} · ${e.startDate} – ${e.endDate}\n` +
    (e.bullets || []).map(b => `• ${b}`).join('\n')
  ).join('\n\n')
  flat.projects = (creds.projects || []).map(p =>
    `${p.name} — ${(p.technologies || []).join(', ')}\n` +
    (p.bullets || []).map(b => `• ${b}`).join('\n')
  ).join('\n\n')
  flat.professionalSummary = creds.narrative.professionalSummary
  flat.coverLetterTemplate = creds.narrative.coverLetterTemplate
  Object.assign(flat, creds.demographics)
  return flat
}

async function seedCredentialsToStorage() {
  const credPath = path.join(__dirname, 'credentials', 'profile.json')
  if (!fs.existsSync(credPath)) return

  let creds
  try {
    creds = JSON.parse(fs.readFileSync(credPath, 'utf8'))
  } catch (e) {
    console.warn('[JobApplier] credentials/profile.json parse error:', e.message)
    return
  }

  const flat = flattenCredentials(creds)

  // Seed resume PDF if present in credentials/
  const resumePath = path.join(__dirname, 'credentials', 'resume.pdf')
  if (fs.existsSync(resumePath)) {
    const pdfBase64 = fs.readFileSync(resumePath).toString('base64')
    flat.resumeFileName = 'resume.pdf'
    flat.resumeDataUrl  = `data:application/pdf;base64,${pdfBase64}`
  }

  // Wait up to 2s for the background page to be ready
  const bgPrefix = `chrome-extension://${extensionId}/`
  let bgWc = null
  for (let i = 0; i < 20 && !bgWc; i++) {
    bgWc = webContents.getAllWebContents().find(wc => wc.getURL().startsWith(bgPrefix))
    if (!bgWc) await new Promise(r => setTimeout(r, 100))
  }
  if (!bgWc) {
    console.warn('[JobApplier] Background page not found — credentials not seeded')
    return
  }

  // Merge file fields into storage; preserve secrets that are only set via options page
  await bgWc.executeJavaScript(`
    (async () => {
      const stored = await new Promise(r => chrome.storage.local.get('profile', r));
      const existing = stored.profile || {};
      const fromFile = ${JSON.stringify(flat)};
      const merged = Object.assign({}, fromFile, {
        claudeApiKey:     existing.claudeApiKey     || '',
        linkedinEmail:    existing.linkedinEmail    || fromFile.linkedinEmail || '',
        linkedinPassword: existing.linkedinPassword || '',
      });
      chrome.storage.local.set({ profile: merged });
    })()
  `)
  console.log('[JobApplier] Credentials seeded from credentials/profile.json')

  // Seed answers DB from credentials/answers.json
  const answersPath = path.join(__dirname, 'credentials', 'answers.json')
  if (fs.existsSync(answersPath)) {
    try {
      const { entries } = JSON.parse(fs.readFileSync(answersPath, 'utf8'))
      await bgWc.executeJavaScript(`chrome.storage.local.set({ answers: ${JSON.stringify(entries || [])} })`)
      console.log('[JobApplier] Answers DB seeded from credentials/answers.json')
    } catch (e) {
      console.warn('[JobApplier] credentials/answers.json parse error:', e.message)
    }
  }
}

async function createWindow() {
  patchUserAgent()
  await loadExtension()
  startSheetsServer()
  seedCredentialsToStorage() // fire-and-forget — don't block window creation

  // Primary tab — LinkedIn
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 900,
    tabbingIdentifier: TAB_ID,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  mainWindow.loadURL('https://www.linkedin.com/jobs/search/?f_E=1&f_JT=I&keywords=software+engineer+intern')
  mainWindow.on('closed', () => { mainWindow = null })

  Menu.setApplicationMenu(buildMenu())

  // Additional tabs — open and attach to the same window
  const internshipsTab = makeTab('https://github.com/SimplifyJobs/Summer2026-Internships#-software-engineering-internship-roles')
  mainWindow.addTabbedWindow(internshipsTab)

  const claudeTab = makeTab('https://claude.ai/project/019ead72-f6d6-74aa-84ee-5c652fd866d0')
  mainWindow.addTabbedWindow(claudeTab)

  // Control panel — always on top, small, for the auto-matcher
  const controlWindow = new BrowserWindow({
    width: 360,
    height: 410,
    title: 'JobApplier — Control',
    alwaysOnTop: true,
    resizable: false,
    minimizable: false,
    webPreferences: { nodeIntegration: false, contextIsolation: true },
  })
  controlWindow.loadURL(`chrome-extension://${extensionId}/control/control.html`)

  // Return focus to the LinkedIn tab
  mainWindow.focus()
}

app.whenReady().then(createWindow)

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow()
})
