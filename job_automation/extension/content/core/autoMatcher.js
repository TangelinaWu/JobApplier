// Auto-matcher — iterates LinkedIn job listings and evaluates each one against five criteria via Claude.
// Controlled by background-forwarded messages from the control panel.

const autoMatcher = (() => {
  let _running = false
  let _paused  = false
  let _index   = 0
  const MAX_JOBS = 4

  // ── Hard filters — instant disqualifiers, checked before scoring ────────────

  const HARD_FILTERS = [
    {
      label: "requires Master's/PhD (no Bachelor's option)",
      test(text) {
        // Detect master's/PhD as a requirement
        const needsGrad = /(master'?s?|m\.?s\.?c?\.?|ph\.?d\.?|doctorate)\s{0,10}(degree\s{0,5})?(is\s{0,5})?(required|only|minimum|must)|(required|must\s+have)\s{0,10}(a\s{0,5})?(master'?s?|ph\.?d\.?|doctorate)/i.test(text)
        if (!needsGrad) return false
        // Allow if bachelor's is explicitly also accepted
        const bachelorOk = /bachelor'?s?\s{0,10}(or|\/|and)\s{0,10}(master|higher|above|advanced)/i.test(text) ||
          /(bs|ba|b\.s\.|b\.a\.)\s{0,5}(or|\/)\s{0,5}(ms|ma|m\.s\.)/i.test(text) ||
          /bachelor'?s?.{0,30}(acceptable|accepted|sufficient|considered)/i.test(text)
        return !bachelorOk
      },
    },
    {
      label: 'requires more experience than applicant has',
      test(text, profile) {
        const m = text.match(/(\d+)\+?\s*(?:to\s*\d+\s*)?years?\s+(?:of\s+)?(?:professional\s+|work\s+|relevant\s+|industry\s+)?experience/i)
        if (!m) return false
        const required = parseInt(m[1])
        const have = parseInt(profile.yearsOfExperience) || 0
        return required > have
      },
    },
    {
      label: 'unpaid / academic credit only',
      test(text) {
        return /\bunpaid\s+(intern(ship)?|position|role|opportunit)/i.test(text) ||
          /\bfor\s+(academic\s+)?credit\s+only\b/i.test(text) ||
          /\bno\s+(monetary\s+)?(compensation|stipend|pay\b|salary)/i.test(text) ||
          /\bvolunteer\s+(intern(ship)?|position|role)\b/i.test(text)
      },
    },
    {
      label: 'age requirement',
      test(text) {
        return /\bage\s*(requirement|restriction|limit|range)\b/i.test(text) ||
          /\bmust\s+be\s+(at\s+least\s+)?\d+(\s*(to|-|and)\s*\d+)?\s*years?\s+old\b/i.test(text) ||
          /\b(minimum|maximum|min|max)\.?\s+age\b/i.test(text)
      },
    },
    {
      label: 'requires non-STEM degree only',
      test(text) {
        // Extract "degree in X" or "X degree required" phrases
        const STEM = /computer\s*science|software\s*eng|computer\s*eng|electrical\s*eng|data\s*science|machine\s*learning|artificial\s*intelligence|information\s*(technology|systems)|mathematics|statistics|physics|chemistry|biology|stem|engineering|technical|cs\b/i
        // If any STEM is mentioned → fine
        if (STEM.test(text)) return false
        // Non-STEM specifics that would disqualify
        const NON_STEM = /degree\s+in\s+(accounting|finance|marketing|journalism|law|legal|human\s+resources|business\s+administration|communications|english|history|political\s+science|sociology|nursing|pharmacy)\b/i
        return NON_STEM.test(text)
      },
    },
  ]

  function checkHardFilters(jobText, profile) {
    for (const f of HARD_FILTERS) {
      if (f.test(jobText, profile)) return f.label
    }
    return null
  }

  // ── Claude evaluation ────────────────────────────────────────────────────────
  // Sends each job to the Claude.ai project tab and waits for a structured reply.
  // Apply only if all four criteria pass: FIELD, DEGREE, PAID, EXPERIENCE.

  function buildClaudeAnalysisPrompt(profile, description, jobInfo) {
    const years = profile.yearsOfExperience || '2'
    const name  = [profile.firstName, profile.lastName].filter(Boolean).join(' ') || 'Candidate'
    return `Evaluate this job. The VERY FIRST LINE of your reply must be a standalone YES or NO — nothing else on that line. YES only if ALL four criteria pass. Then list each criterion:

YES
FIELD: YES — [brief phrase]
DEGREE: YES — [brief phrase]
PAID: YES — [brief phrase]
EXPERIENCE: YES — [brief phrase]
REASON: [one sentence]

(Replace YES with NO on line 1 if any criterion fails, and mark failing criteria NO.)

CRITERIA:
- FIELD: is this a software, CS, data, AI/ML, or any STEM-adjacent role?
- DEGREE: does a Bachelor's degree qualify (not Master's/PhD exclusively)?
- PAID: is this a paid position (not unpaid/credit only)?
- EXPERIENCE: does ${years} year(s) of internship experience qualify?

APPLICANT: ${name} | NYU CS + Economics | GPA 3.8 | ${years} yr(s) internship experience
SKILLS: ${(profile.skills || '').slice(0, 300)}

ROLE: ${jobInfo.title} at ${jobInfo.company}
JD:
${description.slice(0, 2500)}`
  }

  async function getClaudeScore(profile, description, jobInfo) {
    const prompt = buildClaudeAnalysisPrompt(profile, description, jobInfo)

    // Ask background to send the prompt to Claude in job-analysis mode (no tab focus)
    await new Promise(resolve => {
      chrome.storage.local.set({ pendingClaudeJobAnalysis: prompt }, resolve)
    })
    chrome.runtime.sendMessage({
      type: MSG.SEND_TO_CLAUDE,
      payload: { isJobAnalysis: true },
    }).catch(() => {})

    // Wait for claude.js to parse the response and write it back to storage
    return await waitForClaudeJobResult(90000)
  }

  function waitForClaudeJobResult(timeoutMs) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        clearInterval(stopPoll)
        chrome.storage.onChanged.removeListener(listener)
        resolve(null)
      }, timeoutMs)
      const stopPoll = setInterval(() => {
        if (!_running) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.storage.onChanged.removeListener(listener)
          resolve(null)
        }
      }, 200)
      function listener(changes, area) {
        if (area === 'local' && changes.claudeJobResult?.newValue) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.storage.onChanged.removeListener(listener)
          const result = changes.claudeJobResult.newValue
          chrome.storage.local.remove('claudeJobResult')
          resolve(result)
        }
      }
      chrome.storage.onChanged.addListener(listener)
    })
  }

  // ── DOM helpers ──────────────────────────────────────────────────────────────

  function getJobCards() {
    // Use a Set to deduplicate — both selectors can match the same elements
    const seen = new Set()
    const result = []
    for (const sel of ['.jobs-search-results__list-item', '.scaffold-layout__list-item']) {
      for (const el of document.querySelectorAll(sel)) {
        if (!seen.has(el) && el.querySelector('[class*="job-card"]')) {
          seen.add(el)
          result.push(el)
        }
      }
    }
    return result
  }

  function extractDescription() {
    const selectors = [
      '#job-details',
      '.jobs-description-content__text',
      '.jobs-description__container',
      '.jobs-box__html-content',
      '.jobs-description',
    ]
    for (const sel of selectors) {
      const el = document.querySelector(sel)
      if (el?.textContent.trim().length > 100) return el.textContent.trim().slice(0, 4000)
    }
    return null
  }

  function extractCurrentJobInfo() {
    return {
      title: document.querySelector(
        '.job-details-jobs-unified-top-card__job-title, h1.t-24'
      )?.textContent.trim() || '(unknown)',
      company: document.querySelector(
        '.job-details-jobs-unified-top-card__company-name, ' +
        '.jobs-unified-top-card__company-name'
      )?.textContent.trim() || '',
      url: normalizeLinkedInJobUrl(window.location.href),
    }
  }

  function normalizeLinkedInJobUrl(url) {
    try {
      const u = new URL(url)
      const m = u.pathname.match(/\/jobs\/view\/(\d+)/)
      if (m) return `https://www.linkedin.com/jobs/view/${m[1]}/`
      const id = u.searchParams.get('currentJobId')
      if (id) return `https://www.linkedin.com/jobs/view/${id}/`
    } catch {}
    return url
  }

  function extractCardInfo(card) {
    const linkEl = card.querySelector('a[href*="/jobs/view/"]')
    let url = null
    if (linkEl?.href) url = normalizeLinkedInJobUrl(linkEl.href)

    return {
      title: card.querySelector(
        '[class*="job-card-list__title"], [class*="job-card-container__link"]'
      )?.textContent.trim() || '(unknown)',
      company: card.querySelector(
        '[class*="company-name"], [class*="primary-description"]'
      )?.textContent.trim() || '',
      url,
    }
  }

  // ── Main loop ────────────────────────────────────────────────────────────────

  async function runLoop(profile) {
    const cards = getJobCards()
    if (cards.length === 0) {
      sendStatus('No job listings found on this page.', null)
      finish()
      return
    }

    while (_running && _index < Math.min(cards.length, MAX_JOBS)) {
      if (_paused) { await wait(300); continue }

      const card     = cards[_index]
      const cardInfo = extractCardInfo(card)

      // Skip jobs we've already processed in a previous run
      if (cardInfo.url) {
        const seen = await getSeenJobs()
        if (seen.has(cardInfo.url)) {
          sendStatus(`Already processed — skipping ${cardInfo.title}`, cardInfo)
          _index++
          await wait(200)
          continue
        }
      }

      sendStatus(`Analyzing ${_index + 1} of ${Math.min(cards.length, MAX_JOBS)}…`, cardInfo)

      const clickTarget =
        card.querySelector('[class*="job-card-container__link"], [class*="job-card-list__title"]') ||
        card
      clickTarget.click()

      await wait(1800)

      const description = extractDescription()
      if (description) {
        const info = extractCurrentJobInfo()

        // Hard filters — instant disqualifiers before asking Claude
        const skipReason = checkHardFilters(description, profile)
        if (skipReason) {
          sendStatus(`Filtered: ${skipReason}`, info)
          chrome.runtime.sendMessage({
            type: MSG.AUTO_MATCH_RESULT,
            payload: { ...cardInfo, ...info, decision: 'SKIP', skipReason },
          }).catch(() => {})
          sendLog(info, 'FILTERED', skipReason, description)
          _index++
          await wait(500)
          continue
        }

        sendStatus(`Asking Claude about ${info.company}…`, info)
        const claudeResult = await getClaudeScore(profile, description, info)

        const decision = claudeResult?.decision ?? 'SKIP'
        const reason   = claudeResult?.reason   ?? 'No response from Claude'
        const criteria = claudeResult?.criteria  ?? {}

        chrome.runtime.sendMessage({
          type: MSG.AUTO_MATCH_RESULT,
          payload: { ...cardInfo, ...info, decision, reason, criteria },
        }).catch(() => {})

        if (decision === 'APPLY') {
          sendStatus(`Criteria met — Applying to ${info.company}…`, info)
          chrome.runtime.sendMessage({ type: MSG.FOCUS_TAB }).catch(() => {})
          await wait(400)
          const clicked = await attemptAutoApply(info)
          if (clicked) {
            sendStatus(`Opening ${info.company} application…`, info)
            const outcome = await waitForAutoApplyComplete(120000)
            if (outcome === 'complete') {
              sendStatus(`Applied to ${info.company} ✓ — continuing…`, null)
              sendLog(info, 'APPLIED', reason, description)
            } else {
              sendStatus(`${info.company} form timed out — moving on…`, null)
              sendLog(info, 'APPLY_FAILED', 'Form timed out', description)
              await new Promise(r => chrome.storage.local.remove('pendingAutoApply', r))
            }
            await wait(2000)
          } else {
            sendStatus(`No external apply link for ${info.company} — skipping`, null)
            sendLog(info, 'APPLY_FAILED', 'No apply button found', description)
          }
        } else {
          sendLog(info, 'SKIP', reason, description)
        }
      }

      _index++
      await wait(700)
    }

    if (_running) finish()
  }

  // ── Auto-apply helpers ───────────────────────────────────────────────────────

  async function attemptAutoApply(jobInfo) {
    // Set flag so the ATS tab's content script knows to auto-fill
    await new Promise(r => chrome.storage.local.set({ pendingAutoApply: jobInfo }, r))

    let btn = await findExternalApplyButton()
    if (!btn) {
      // Pause and prompt user in the control panel, then try once more
      sendStatus(`Apply button not found for ${jobInfo.company} — waiting for your input…`, jobInfo)
      chrome.runtime.sendMessage({
        type: MSG.APPLY_BTN_NOT_FOUND,
        payload: jobInfo,
      }).catch(() => {})

      await waitForRetrySignal(120000)

      btn = await findExternalApplyButton(1, 0)
    }

    if (!btn) {
      await new Promise(r => chrome.storage.local.remove('pendingAutoApply', r))
      return false
    }

    chrome.runtime.sendMessage({
      type: MSG.AUTO_APPLY_STARTED,
      payload: jobInfo,
    }).catch(() => {})

    btn.click()
    return true
  }

  function waitForRetrySignal(timeoutMs) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        clearInterval(stopPoll)
        chrome.runtime.onMessage.removeListener(listener)
        resolve()
      }, timeoutMs)
      const stopPoll = setInterval(() => {
        if (!_running) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.runtime.onMessage.removeListener(listener)
          resolve()
        }
      }, 200)
      function listener(msg) {
        if (msg.type === MSG.APPLY_BTN_RETRY) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.runtime.onMessage.removeListener(listener)
          resolve()
        }
      }
      chrome.runtime.onMessage.addListener(listener)
    })
  }

  async function findExternalApplyButton(retries = 10, delayMs = 500) {
    for (let i = 0; i < retries; i++) {
      if (!_running) return null
      const btn =
        document.querySelector('.jobs-apply-button:not(.jobs-easy-apply-button)') ||
        document.querySelector('a.jobs-apply-button[href]') ||
        document.querySelector('.jobs-unified-top-card__apply-btn a[href]') ||
        [...document.querySelectorAll('button, a')].find(
          el => /^apply$/i.test(el.textContent.trim()) && !el.textContent.includes('Easy')
        )
      if (btn) return btn
      await wait(delayMs)
    }
    return null
  }

  function waitForAutoApplyComplete(timeoutMs) {
    return new Promise(resolve => {
      const timer = setTimeout(() => {
        clearInterval(stopPoll)
        chrome.runtime.onMessage.removeListener(listener)
        resolve('timeout')
      }, timeoutMs)
      const stopPoll = setInterval(() => {
        if (!_running) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.runtime.onMessage.removeListener(listener)
          resolve('stopped')
        }
      }, 200)
      function listener(msg) {
        if (msg.type === MSG.AUTO_APPLY_COMPLETE) {
          clearTimeout(timer)
          clearInterval(stopPoll)
          chrome.runtime.onMessage.removeListener(listener)
          resolve('complete')
        }
      }
      chrome.runtime.onMessage.addListener(listener)
    })
  }

  function sendLog(info, decision, reason, description) {
    chrome.runtime.sendMessage({
      type:    MSG.LOG_APPLICATION,
      payload: {
        site:        'linkedin',
        company:     info.company || '',
        role:        info.title   || '',
        url:         info.url     || '',
        decision,
        reason,
        description: description ? description.slice(0, 500) : '',
      },
    }).catch(() => {})
  }

  function finish() {
    _running = false
    chrome.runtime.sendMessage({ type: MSG.AUTO_MATCH_DONE, payload: {} }).catch(() => {})
  }

  function sendStatus(text, job) {
    chrome.runtime.sendMessage({
      type: MSG.AUTO_MATCH_STATUS,
      payload: { text, job },
    }).catch(() => {})
  }

  // ── Message listener ─────────────────────────────────────────────────────────

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === MSG.AUTO_MATCH_START) {
      if (_running) return  // prevent double-start
      _running = true
      _paused  = false
      _index   = 0
      getProfile().then(profile => runLoop(profile))
    }
    if (msg.type === MSG.AUTO_MATCH_PAUSE)  { _paused = true }
    if (msg.type === MSG.AUTO_MATCH_RESUME) { _paused = false }
    if (msg.type === MSG.AUTO_MATCH_STOP)   { _running = false; _paused = false }
  })

  // ── Utilities ────────────────────────────────────────────────────────────────

  function wait(ms) { return new Promise(r => setTimeout(r, ms)) }

  return { isRunning: () => _running }
})()
