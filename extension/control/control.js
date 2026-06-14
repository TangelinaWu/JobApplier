// Control panel for the LinkedIn auto-matcher.
// Sends Start/Pause/Stop commands to the background, which forwards them to the LinkedIn tab.
// Receives status and result messages forwarded back from the background.

let totalAnalyzed = 0
let goodMatches = 0
let isPaused = false
let pendingRequestId = null

// ── Tab switching ─────────────────────────────────────────────────────────────

const tabJobs   = document.getElementById('tab-jobs')
const tabAi     = document.getElementById('tab-ai')
const paneJobs  = document.getElementById('pane-jobs')
const paneAi    = document.getElementById('pane-ai')
const aiBadge   = document.getElementById('ai-badge')
const jobsBadge = document.getElementById('jobs-badge')
const aiEmpty   = document.getElementById('ai-empty')
const aiForm    = document.getElementById('ai-form')
const aiQuestion = document.getElementById('ai-question')
const aiAnswer  = document.getElementById('ai-answer')
const aiLoading = document.getElementById('ai-loading')
const aiUse     = document.getElementById('ai-use')
const aiSkip    = document.getElementById('ai-skip')

tabJobs.addEventListener('click', () => switchTab('jobs'))
tabAi.addEventListener('click',   () => switchTab('ai'))

function switchTab(which) {
  if (which === 'jobs') {
    tabJobs.classList.add('tab-active')
    tabAi.classList.remove('tab-active')
    paneJobs.classList.remove('hidden')
    paneAi.classList.add('hidden')
    jobsBadge.classList.add('hidden')
  } else {
    tabAi.classList.add('tab-active')
    tabJobs.classList.remove('tab-active')
    paneAi.classList.remove('hidden')
    paneJobs.classList.add('hidden')
  }
}

// ── AI panel actions ──────────────────────────────────────────────────────────

aiSkip.addEventListener('click', () => {
  if (!pendingRequestId) return
  chrome.runtime.sendMessage({
    type: MSG.OVERLAY_ANSWER,
    payload: { requestId: pendingRequestId, accepted: false, value: null },
  })
  clearAiPanel()
  switchTab('jobs')
})

aiUse.addEventListener('click', () => {
  if (!pendingRequestId) return
  chrome.runtime.sendMessage({
    type: MSG.OVERLAY_ANSWER,
    payload: { requestId: pendingRequestId, accepted: true, value: aiAnswer.value },
  })
  clearAiPanel()
  switchTab('jobs')
})

function clearAiPanel() {
  pendingRequestId = null
  aiForm.classList.add('hidden')
  aiEmpty.classList.remove('hidden')
  aiBadge.classList.add('hidden')
  aiAnswer.value = ''
  aiQuestion.textContent = ''
}

// ── Existing controls ─────────────────────────────────────────────────────────

const dot        = document.getElementById('status-dot')
const statusText = document.getElementById('status-text')
const counterAnalyzed = document.getElementById('counter-analyzed')
const counterMatches  = document.getElementById('counter-matches')
const currentJobEl    = document.getElementById('current-job')
const stepDetailEl    = document.getElementById('step-detail')
const resultsList     = document.getElementById('results')
const logEl           = document.getElementById('log')
const btnStart = document.getElementById('btn-start')
const btnPause = document.getElementById('btn-pause')
const btnStop  = document.getElementById('btn-stop')

// ── Activity log ─────────────────────────────────────────────────────────────

function addLog(text, type = 'info') {
  const now  = new Date()
  const time = now.toTimeString().slice(0, 8)
  const entry = document.createElement('div')
  entry.className = `log-entry ${type}`
  entry.innerHTML = `<span class="log-time">${time}</span><span class="log-msg">${esc(text)}</span>`
  logEl.appendChild(entry)
  logEl.scrollTop = logEl.scrollHeight
  // Cap at 200 entries
  while (logEl.children.length > 200) logEl.removeChild(logEl.firstChild)
}

document.getElementById('btn-clear-log').addEventListener('click', () => {
  logEl.innerHTML = ''
})

function setStatus(state, text) {
  dot.className = 'dot ' + state
  statusText.textContent = text
}

function setRunning() {
  btnStart.disabled = true
  btnPause.disabled = false
  btnStop.disabled  = false
  btnPause.textContent = '⏸ Pause'
}

function setStep(text) {
  stepDetailEl.textContent = text || ''
}

function setIdle() {
  btnStart.disabled = false
  btnPause.disabled = true
  btnStop.disabled  = true
  isPaused = false
  currentJobEl.textContent = ''
  stepDetailEl.textContent = ''
}

btnStart.addEventListener('click', () => {
  if (isPaused) {
    chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_RESUME })
    isPaused = false
    btnPause.textContent = '⏸ Pause'
    setStatus('running', 'Running…')
    addLog('Resumed', 'system')
    return
  }
  totalAnalyzed = 0
  goodMatches   = 0
  counterAnalyzed.textContent = '0 analyzed'
  counterMatches.textContent  = '0 matches'
  resultsList.innerHTML = ''
  chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_START })
  setRunning()
  setStatus('running', 'Starting…')
  addLog('Auto-matcher started', 'system')
})

btnPause.addEventListener('click', () => {
  if (isPaused) {
    chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_RESUME })
    isPaused = false
    btnPause.textContent = '⏸ Pause'
    setStatus('running', 'Running…')
    addLog('Resumed', 'system')
  } else {
    chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_PAUSE })
    isPaused = true
    btnPause.textContent = '▶ Resume'
    setStatus('paused', 'Paused')
    addLog('Paused', 'system')
  }
})

btnStop.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_STOP })
  setIdle()
  setStatus('done', 'Stopped')
  addLog('Stopped by user', 'system')
})

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === MSG.OVERLAY_QUESTION) {
    const { requestId, question, suggestion } = msg.payload || {}
    pendingRequestId = requestId
    aiQuestion.textContent = question || ''

    // The background sends the processed message with a 'suggestion' key (may be '').
    // The initial relay from the content script has no 'suggestion' key at all.
    // Only enable input once the background has processed the question.
    const processed = 'suggestion' in (msg.payload || {})
    if (processed) {
      aiLoading.classList.add('hidden')
      aiAnswer.classList.remove('hidden')
      aiAnswer.value = suggestion || ''
      aiUse.disabled = false
    } else {
      aiLoading.classList.remove('hidden')
      aiAnswer.classList.add('hidden')
      aiAnswer.value = ''
      aiUse.disabled = true
    }

    aiEmpty.classList.add('hidden')
    aiForm.classList.remove('hidden')
    aiBadge.classList.remove('hidden')
    switchTab('ai')
  }

  if (msg.type === MSG.AUTO_MATCH_STATUS) {
    const { text, job } = msg.payload || {}
    setStatus('running', text || 'Running…')
    if (job) currentJobEl.textContent = [job.company, job.title].filter(Boolean).join(' · ')
    setStep('')

    // Route status text to the log with appropriate colour
    const t = text || ''
    if (/asking claude/i.test(t))          addLog(t, 'claude')
    else if (/criteria met|applying to/i.test(t)) addLog(t, 'apply')
    else if (/applied.*✓/i.test(t))        addLog(t, 'success')
    else if (/skipped|timed out|no.*apply link/i.test(t)) addLog(t, 'skip')
    else if (/waiting|checking|attempt/i.test(t)) addLog(t, 'claude')
    else                                   addLog(t, 'info')
  }

  if (msg.type === MSG.AUTO_MATCH_RESULT) {
    const { title, company, decision, reason, skipReason } = msg.payload || {}
    totalAnalyzed++
    if (decision === 'APPLY') goodMatches++
    counterAnalyzed.textContent = `${totalAnalyzed} analyzed`
    counterMatches.textContent  = `${goodMatches} match${goodMatches !== 1 ? 'es' : ''}`

    const el = document.createElement('div')
    if (skipReason) {
      el.className = 'result skipped'
      el.innerHTML = `
        <span class="result-score">—</span>
        <span class="result-text"><strong>${esc(title)}</strong> · ${esc(company)}</span>
        <span class="result-skip" title="${esc(skipReason)}">✕ skip</span>
      `
      addLog(`Hard filter — ${company}: ${skipReason}`, 'skip')
    } else if (decision === 'APPLY') {
      el.className = 'result good'
      el.innerHTML = `
        <span class="result-score">✓</span>
        <span class="result-text" title="${esc(reason)}"><strong>${esc(title)}</strong> · ${esc(company)}</span>
        <span class="result-applying">→ applying</span>
      `
      addLog(`Claude said YES — ${company} · ${reason}`, 'success')
    } else {
      el.className = 'result weak'
      el.innerHTML = `
        <span class="result-score">✗</span>
        <span class="result-text" title="${esc(reason)}"><strong>${esc(title)}</strong> · ${esc(company)}</span>
        <span class="result-skip" title="${esc(reason)}">skip</span>
      `
      addLog(`Claude said NO — ${company} · ${reason}`, 'skip')
    }
    resultsList.prepend(el)
  }

  if (msg.type === MSG.AUTO_APPLY_STARTED) {
    const { title, company } = msg.payload || {}
    currentJobEl.textContent = [company, title].filter(Boolean).join(' · ')
    setStep('Opening application…')
    setStatus('running', `Applying to ${esc(company || 'company')}…`)
    addLog(`Clicking apply — ${company || 'company'} · returning to LinkedIn`, 'apply')
  }

  if (msg.type === MSG.AUTO_APPLY_FILLING) {
    const { company } = msg.payload || {}
    setStep(`Filling form at ${esc(company || 'company site')}…`)
    setStatus('running', 'Filling application form…')
    addLog(`Filling form — ${company || 'company site'}`, 'apply')
  }

  if (msg.type === MSG.AUTO_APPLY_COMPLETE) {
    const { company } = msg.payload || {}
    setStep(`✓ Applied to ${esc(company || 'company')}`)
    setStatus('running', 'Applied — moving to next job…')
    addLog(`Application submitted — ${company || 'company'} ✓`, 'success')
  }

  if (msg.type === MSG.AUTO_MATCH_DONE) {
    setIdle()
    setStatus('done', `Done — ${totalAnalyzed} analyzed, ${goodMatches} applied`)
    addLog(`Session complete — ${totalAnalyzed} analyzed, ${goodMatches} applied`, 'system')
  }

  if (msg.type === MSG.FILL_LOG) {
    const { severity, text } = msg.payload || {}
    addLog(text, severity === 'warn' ? 'warn' : 'info')
    if (severity === 'warn') {
      jobsBadge.classList.remove('hidden')
    }
  }
})

function esc(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}
