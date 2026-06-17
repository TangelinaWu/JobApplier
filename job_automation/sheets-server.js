'use strict'
const http   = require('http')
const fs     = require('fs')
const path   = require('path')
const crypto = require('crypto')

const PORT        = 3742
const CREDS_FILE  = path.join(__dirname, '..', 'credentials', 'sheets-credentials.json')
const CONFIG_FILE = path.join(__dirname, '..', 'credentials', 'sheets-config.json')

const PASSED_SHEET   = 'Passed'
const FAILED_SHEET   = 'Failed'
const PASSED_HEADERS = ['Timestamp', 'Company', 'Role', 'Description', 'Start Date', 'LinkedIn URL', 'Application Status', 'Reason']
const FAILED_HEADERS = ['Timestamp', 'Company', 'Role', 'LinkedIn URL', 'Reason']

let _creds          = null
let _spreadsheetId  = null
let _token          = null
let _tokenExpiry    = 0
let _headersEnsured = {}

function loadConfig() {
  try {
    _creds = JSON.parse(fs.readFileSync(CREDS_FILE, 'utf8'))
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'))
    _spreadsheetId = config.spreadsheetId
    console.log('[Sheets] Loaded credentials for sheet:', _spreadsheetId)
    return true
  } catch {
    console.warn('[Sheets] credentials/sheets-credentials.json or sheets-config.json not found — Sheets disabled')
    return false
  }
}

async function getAccessToken() {
  if (_token && Date.now() < _tokenExpiry) return _token

  const now     = Math.floor(Date.now() / 1000)
  const header  = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const payload = Buffer.from(JSON.stringify({
    iss:   _creds.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud:   'https://oauth2.googleapis.com/token',
    iat:   now,
    exp:   now + 3600,
  })).toString('base64url')

  const sigInput = `${header}.${payload}`
  const signer   = crypto.createSign('RSA-SHA256')
  signer.update(sigInput)
  const sig = signer.sign(_creds.private_key).toString('base64url')

  const jwt  = `${sigInput}.${sig}`
  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body:    new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion:  jwt,
    }),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Token error ${resp.status}: ${text}`)
  }

  const { access_token, expires_in } = await resp.json()
  _token       = access_token
  _tokenExpiry = Date.now() + (Number(expires_in) - 60) * 1000
  return _token
}

async function ensureSheet(token, sheetName) {
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data  = await resp.json()
  const exists = data.sheets?.some(s => s.properties?.title === sheetName)
  if (!exists) {
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}:batchUpdate`,
      {
        method:  'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ requests: [{ addSheet: { properties: { title: sheetName } } }] }),
      }
    )
    console.log(`[Sheets] Created sheet tab: ${sheetName}`)
  }
}

async function ensureHeaderRow(token, sheetName, headers) {
  if (_headersEnsured[sheetName]) return
  await ensureSheet(token, sheetName)

  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/${sheetName}!A1`,
    { headers: { Authorization: `Bearer ${token}` } }
  )
  const data = await resp.json()
  if (data.values?.[0]?.[0] !== headers[0]) {
    const endCol = String.fromCharCode(64 + headers.length)
    await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/${sheetName}!A1:${endCol}1?valueInputOption=USER_ENTERED`,
      {
        method:  'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body:    JSON.stringify({ values: [headers] }),
      }
    )
  }
  _headersEnsured[sheetName] = true
}

function extractStartDate(description) {
  if (!description) return ''
  const patterns = [
    /start\s*(?:date)?[:\s]+([A-Za-z]+\s+\d{4})/i,
    /starting\s+(?:in\s+)?([A-Za-z]+\s+\d{4})/i,
    /(?:fall|spring|summer|winter)\s+\d{4}/i,
    /(?:january|february|march|april|may|june|july|august|september|october|november|december)\s+\d{4}/i,
    /Q[1-4]\s*\d{4}/i,
  ]
  for (const p of patterns) {
    const m = description.match(p)
    if (m) return (m[1] || m[0]).trim()
  }
  return ''
}

async function appendRow(entry) {
  const token     = await getAccessToken()
  const isPassed  = entry.decision === 'APPLIED'
  const sheetName = isPassed ? PASSED_SHEET : FAILED_SHEET
  const headers   = isPassed ? PASSED_HEADERS : FAILED_HEADERS

  await ensureHeaderRow(token, sheetName, headers)

  const timestamp = new Date().toLocaleString()
  const row = isPassed
    ? [
        timestamp,
        entry.company     || '',
        entry.role        || '',
        entry.description ? entry.description.slice(0, 500) : '',
        extractStartDate(entry.description || ''),
        entry.url         || '',
        entry.decision    || '',
        entry.reason      || '',
      ]
    : [
        timestamp,
        entry.company  || '',
        entry.role     || '',
        entry.url      || '',
        entry.reason   || '',
      ]

  const endCol = String.fromCharCode(64 + row.length)
  const resp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/${sheetName}!A:${endCol}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ values: [row] }),
    }
  )

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Append error ${resp.status}: ${text}`)
  }

  console.log(`[Sheets] Logged to ${sheetName}: ${entry.decision} — ${entry.company} / ${entry.role}`)
}

async function getSeenUrls() {
  const token = await getAccessToken()
  // Pull LinkedIn URLs from both tabs to avoid reprocessing
  const results = await Promise.all([PASSED_SHEET, FAILED_SHEET].map(sheet =>
    fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/${sheet}!F2:F`,
      { headers: { Authorization: `Bearer ${token}` } }
    ).then(r => r.json()).catch(() => ({ values: [] }))
  ))
  // Passed: URL is col F (index 5). Failed: URL is col D (index 3).
  const passedUrls = (results[0].values || []).flat().filter(Boolean)
  const failedResp = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${_spreadsheetId}/values/${FAILED_SHEET}!D2:D`,
    { headers: { Authorization: `Bearer ${token}` } }
  ).then(r => r.json()).catch(() => ({ values: [] }))
  const failedUrls = (failedResp.values || []).flat().filter(Boolean)
  return [...new Set([...passedUrls, ...failedUrls])]
}

function startServer() {
  const enabled = loadConfig()

  const server = http.createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')

    if (req.method === 'OPTIONS') { res.writeHead(204); res.end(); return }

    if (!enabled) {
      res.writeHead(503, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'Sheets not configured' }))
      return
    }

    if (req.method === 'POST' && req.url === '/log') {
      let body = ''
      req.on('data', chunk => { body += chunk })
      req.on('end', () => {
        let entry
        try { entry = JSON.parse(body) } catch {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Bad JSON' }))
          return
        }
        appendRow(entry)
          .then(() => {
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true }))
          })
          .catch(e => {
            console.error('[Sheets] appendRow error:', e.message)
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: e.message }))
          })
      })
      return
    }

    if (req.method === 'GET' && req.url === '/seen') {
      getSeenUrls()
        .then(urls => {
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ urls }))
        })
        .catch(e => {
          console.error('[Sheets] getSeenUrls error:', e.message)
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: e.message }))
        })
      return
    }

    res.writeHead(404); res.end()
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(`[Sheets] Server listening on http://127.0.0.1:${PORT}`)
  })

  return server
}

module.exports = { startServer }
