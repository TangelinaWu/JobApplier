// ── State ──────────────────────────────────────────────────────────────────
let masterResume = null
let editState = null
let lastPdfPath = null

// ── DOM refs ───────────────────────────────────────────────────────────────
const jobDescEl   = document.getElementById('job-desc')
const tailorBtn   = document.getElementById('tailor-btn')
const resultsEl   = document.getElementById('results-section')
const fitBadgeEl  = document.getElementById('fit-badge')
const fitReasonEl = document.getElementById('fit-reason')
const expListEl   = document.getElementById('exp-list')
const projListEl  = document.getElementById('proj-list')
const skillsEl    = document.getElementById('skills-area')
const statusEl    = document.getElementById('status-msg')
const genPdfBtn   = document.getElementById('gen-pdf-btn')
const openPdfBtn  = document.getElementById('open-pdf-btn')
const previewEl   = document.getElementById('preview-frame')

// ── Init ───────────────────────────────────────────────────────────────────
async function init() {
  masterResume = await window.tailor.loadMasterResume()
  if (!masterResume) {
    setStatus('error', 'credentials/master_resume.json not found — please create it first.')
  }
  renderEmptyPreview()
}

// ── Tailor button ──────────────────────────────────────────────────────────
tailorBtn.addEventListener('click', async () => {
  const jobDescription = jobDescEl.value.trim()
  if (!jobDescription) return setStatus('error', 'Paste a job description first.')
  if (!masterResume)   return setStatus('error', 'master_resume.json not found in credentials/.')

  setLoading(true)
  setStatus('loading', 'Opening Claude.ai — pasting prompt… this takes 30–60 seconds.')

  try {
    const result = await window.tailor.tailorResume({ jobDescription, masterResume })
    buildEditState(result)
    renderResults()
    updatePreview()
    genPdfBtn.disabled = false
    setStatus('success', `Done! Fit score: ${result.fitScore}%. Toggle or edit bullets, then Generate PDF.`)
  } catch (err) {
    setStatus('error', err.message)
  } finally {
    setLoading(false)
  }
})

// ── Build editable state from Claude result ────────────────────────────────
function buildEditState(result) {
  editState = {
    header:     masterResume.header,
    education:  masterResume.education,
    experience: result.selectedExperience.map(exp => ({
      ...exp,
      bullets: exp.bullets.map(text => ({ text, on: true })),
    })),
    projects: result.selectedProjects.map(proj => ({
      ...proj,
      bullets: proj.bullets.map(text => ({ text, on: true })),
    })),
    skills: Object.fromEntries(
      Object.entries(result.selectedSkills).map(([cat, items]) => [
        cat,
        items.map(text => ({ text, on: true })),
      ])
    ),
    fitScore:  result.fitScore,
    fitReason: result.fitReason,
  }
}

// ── Render left-panel results ──────────────────────────────────────────────
function renderResults() {
  const score = editState.fitScore
  const cls   = score >= 75 ? 'high' : score >= 50 ? 'medium' : 'low'
  fitBadgeEl.className = `fit-badge ${cls}`
  fitBadgeEl.textContent = `${score}% Match`
  fitReasonEl.textContent = editState.fitReason

  expListEl.innerHTML = ''
  editState.experience.forEach((exp, ei) => {
    expListEl.appendChild(makeBlock(
      `${exp.company} — ${exp.title}`,
      `${exp.startDate} – ${exp.endDate}`,
      exp.bullets,
      (bi, on)   => { editState.experience[ei].bullets[bi].on   = on;   updatePreview() },
      (bi, text) => { editState.experience[ei].bullets[bi].text = text; updatePreview() },
    ))
  })

  projListEl.innerHTML = ''
  editState.projects.forEach((proj, pi) => {
    projListEl.appendChild(makeBlock(
      proj.name,
      proj.technologies.join(', '),
      proj.bullets,
      (bi, on)   => { editState.projects[pi].bullets[bi].on   = on;   updatePreview() },
      (bi, text) => { editState.projects[pi].bullets[bi].text = text; updatePreview() },
    ))
  })

  skillsEl.innerHTML = ''
  Object.entries(editState.skills).forEach(([cat, items]) => {
    if (!items.length) return
    const row = document.createElement('div')
    row.className = 'skill-row'

    const label = document.createElement('div')
    label.className = 'skill-cat'
    label.textContent = cat
    row.appendChild(label)

    const tags = document.createElement('div')
    tags.className = 'skill-tags'
    items.forEach((item, ii) => {
      const tag = document.createElement('span')
      tag.className = 'skill-tag' + (item.on ? '' : ' off')
      tag.textContent = item.text
      tag.title = 'Click to toggle'
      tag.addEventListener('click', () => {
        editState.skills[cat][ii].on = !editState.skills[cat][ii].on
        tag.classList.toggle('off')
        updatePreview()
      })
      tags.appendChild(tag)
    })
    row.appendChild(tags)
    skillsEl.appendChild(row)
  })

  resultsEl.style.display = 'flex'
}

// ── Make a bullet block (experience or project) ────────────────────────────
function makeBlock(title, subtitle, bullets, onToggle, onEdit) {
  const wrap = document.createElement('div')
  wrap.className = 'block'

  const header = document.createElement('div')
  header.className = 'block-header'
  header.innerHTML = `<span>${title}</span><span class="dates">${subtitle}</span>`
  wrap.appendChild(header)

  const list = document.createElement('div')
  list.className = 'bullets-list'

  bullets.forEach((bullet, bi) => {
    const row = document.createElement('div')
    row.className = 'bullet-row'

    const cb = document.createElement('input')
    cb.type    = 'checkbox'
    cb.checked = bullet.on
    cb.addEventListener('change', () => {
      onToggle(bi, cb.checked)
      txt.toggleAttribute('data-unchecked', !cb.checked)
    })

    const txt = document.createElement('span')
    txt.className       = 'bullet-text'
    txt.contentEditable = 'true'
    txt.textContent     = bullet.text
    if (!bullet.on) txt.setAttribute('data-unchecked', '')
    txt.addEventListener('input', () => onEdit(bi, txt.textContent.trim()))
    txt.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); txt.blur() }
    })

    row.appendChild(cb)
    row.appendChild(txt)
    list.appendChild(row)
  })

  wrap.appendChild(list)
  return wrap
}

// ── Generate PDF ───────────────────────────────────────────────────────────
genPdfBtn.addEventListener('click', async () => {
  if (!editState) return
  const html = buildJakesHTML(editState)
  genPdfBtn.disabled = true
  setStatus('loading', 'Generating PDF…')
  try {
    lastPdfPath = await window.tailor.generatePdf(html)
    setStatus('success', 'PDF saved to credentials/tailored_resume.pdf')
    openPdfBtn.style.display = 'inline-block'
  } catch (err) {
    setStatus('error', err.message)
  } finally {
    genPdfBtn.disabled = false
  }
})

openPdfBtn.addEventListener('click', () => {
  if (lastPdfPath) window.tailor.openFile(lastPdfPath)
})

// ── Live preview ───────────────────────────────────────────────────────────
function updatePreview() {
  if (!editState) return
  previewEl.srcdoc = buildJakesHTML(editState)
}

function renderEmptyPreview() {
  previewEl.srcdoc = `<!DOCTYPE html><html><body style="
    display:flex;align-items:center;justify-content:center;
    height:100vh;font-family:sans-serif;color:#bbb;font-size:14px;
    background:white;text-align:center;
  ">Your tailored resume will appear here</body></html>`
}

// ── Helpers ────────────────────────────────────────────────────────────────
function setStatus(type, msg) {
  statusEl.textContent = msg
  statusEl.className   = type
}

function setLoading(on) {
  tailorBtn.disabled  = on
  tailorBtn.innerHTML = on
    ? '<span class="spinner"></span>Asking Claude…'
    : 'Tailor Resume'
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1)
}

// ── Jake's Resume HTML template ────────────────────────────────────────────
function buildJakesHTML(state) {
  const { header, education, experience, projects, skills } = state

  const activeBullets = arr => arr.filter(b => b.on).map(b => esc(b.text))
  const activeSkills  = arr => arr.filter(s => s.on).map(s => esc(s.text))

  const eduHTML = (education || []).map(edu => `
    <div class="entry">
      <div class="entry-row">
        <span class="bold">${esc(edu.school)}</span>
        <span class="date">${esc(edu.location || '')}</span>
      </div>
      <div class="entry-row">
        <span class="italic">${esc(edu.degree)} in ${esc(edu.major)}${edu.gpa ? ' — GPA: ' + esc(String(edu.gpa)) : ''}</span>
        <span class="date">${esc(edu.graduationDate)}</span>
      </div>
      ${edu.coursework && edu.coursework.length ? `<div class="sub-line"><span class="bold">Coursework:</span> ${edu.coursework.map(esc).join(', ')}</div>` : ''}
    </div>
  `).join('')

  const expHTML = (experience || []).map(exp => {
    const bullets = activeBullets(exp.bullets)
    if (!bullets.length) return ''
    return `
      <div class="entry">
        <div class="entry-row">
          <span><span class="bold">${esc(exp.company)}</span>${exp.title ? ` — ${esc(exp.title)}` : ''}</span>
          <span class="date">${esc(exp.startDate)} – ${esc(exp.endDate)}</span>
        </div>
        ${exp.location ? `<div class="entry-row"><span class="italic">${esc(exp.location)}</span></div>` : ''}
        <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
    `
  }).join('')

  const projHTML = (projects || []).map(proj => {
    const bullets = activeBullets(proj.bullets)
    if (!bullets.length) return ''
    const techs = proj.technologies ? proj.technologies.map(esc).join(', ') : ''
    return `
      <div class="entry">
        <div class="entry-row">
          <span><span class="bold">${esc(proj.name)}</span>${techs ? ` <span class="italic">| ${techs}</span>` : ''}</span>
          ${proj.date ? `<span class="date">${esc(proj.date)}</span>` : ''}
        </div>
        <ul>${bullets.map(b => `<li>${b}</li>`).join('')}</ul>
      </div>
    `
  }).join('')

  const skillsHTML = Object.entries(skills || {})
    .filter(([, items]) => activeSkills(items).length)
    .map(([cat, items]) => `<div class="skill-line"><span class="bold">${capitalize(esc(cat))}:</span> ${activeSkills(items).join(', ')}</div>`)
    .join('')

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
* { box-sizing: border-box; margin: 0; padding: 0; }
body {
  font-family: 'Cambria', 'Georgia', 'Times New Roman', serif;
  font-size: 10.5pt;
  line-height: 1.35;
  color: #000;
  padding: 0.45in 0.65in;
  background: white;
  -webkit-print-color-adjust: exact;
}
h1 { font-size: 23pt; font-weight: 700; text-align: center; margin-bottom: 5px; letter-spacing: 0.01em; }
.contact { text-align: center; font-size: 10pt; margin-bottom: 10px; }
.contact a { color: #000; text-decoration: none; }
.pipe { margin: 0 5px; color: #555; }
.section-title {
  font-size: 11pt; font-weight: 700; text-transform: uppercase;
  letter-spacing: 0.08em; border-bottom: 1.2px solid #000;
  margin-top: 9px; margin-bottom: 5px; padding-bottom: 2px;
}
.entry { margin-bottom: 6px; }
.entry-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 1px; font-size: 10.5pt; }
.date { font-size: 10pt; white-space: nowrap; padding-left: 8px; }
.sub-line { font-size: 10pt; margin-bottom: 2px; }
.bold { font-weight: 700; }
.italic { font-style: italic; }
ul { padding-left: 14px; margin-top: 2px; }
li { margin-bottom: 1.5px; font-size: 10.5pt; }
.skill-line { font-size: 10.5pt; margin-bottom: 2px; }
</style>
</head>
<body>
<h1>${esc(header.name)}</h1>
<div class="contact">
  ${esc(header.phone)}
  <span class="pipe">|</span>
  <a href="mailto:${esc(header.email)}">${esc(header.email)}</a>
  <span class="pipe">|</span>
  <a href="https://${esc(header.linkedin)}">${esc(header.linkedin)}</a>
  <span class="pipe">|</span>
  <a href="https://${esc(header.github)}">${esc(header.github)}</a>
</div>
<div class="section-title">Education</div>
${eduHTML}
<div class="section-title">Experience</div>
${expHTML}
<div class="section-title">Projects</div>
${projHTML}
<div class="section-title">Technical Skills</div>
${skillsHTML}
</body>
</html>`
}

function esc(str) {
  if (str == null) return ''
  return String(str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

// ── Boot ───────────────────────────────────────────────────────────────────
init()
