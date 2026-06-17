// Auto-fills the LinkedIn login form using saved credentials.
(async function () {
  const result = await chrome.storage.local.get('profile')
  const profile = result.profile || {}
  const email = profile.linkedinEmail
  const password = profile.linkedinPassword
  if (!email || !password) return

  try {
    await waitForElement('#username', 6000)
  } catch {
    return
  }

  const emailField = document.querySelector('#username')
  const passwordField = document.querySelector('#password')
  if (!emailField || !passwordField) return

  await delay(600)
  fillInput(emailField, email)
  await delay(400)
  fillInput(passwordField, password)
  await delay(350)

  const submitBtn =
    document.querySelector('[data-litms-control-urn="login-submit"]') ||
    document.querySelector('button[type="submit"]')
  if (submitBtn) submitBtn.click()

  function fillInput(el, value) {
    el.focus()
    el.value = value
    el.dispatchEvent(new Event('input', { bubbles: true }))
    el.dispatchEvent(new Event('change', { bubbles: true }))
    el.blur()
  }

  function delay(ms) {
    return new Promise((r) => setTimeout(r, ms))
  }

  function waitForElement(selector, timeout) {
    return new Promise((resolve, reject) => {
      const el = document.querySelector(selector)
      if (el) return resolve(el)
      const observer = new MutationObserver(() => {
        const found = document.querySelector(selector)
        if (found) { observer.disconnect(); resolve(found) }
      })
      observer.observe(document.documentElement, { childList: true, subtree: true })
      setTimeout(() => { observer.disconnect(); reject() }, timeout)
    })
  }
})()
