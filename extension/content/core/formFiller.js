// Generic form fill engine.
// Handles: text inputs, textareas, <select>, radio groups, checkboxes, file uploads,
// and ARIA comboboxes (custom dropdowns used by LinkedIn/Greenhouse).
//
// profileSchema.js and humanDelay.js must be loaded before this file.

const formFiller = {
  // Set a value on a React-controlled or plain input/textarea.
  // Direct .value assignment is ignored by React; we must go through the native setter.
  setInputValue(element, value) {
    const isTextArea = element.tagName.toLowerCase() === "textarea";
    const proto = isTextArea ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
    nativeSetter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  },

  // Fill a native <select> by matching option text or value
  fillSelect(element, value) {
    const lower = value.toLowerCase();
    for (const option of element.options) {
      if (
        option.value.toLowerCase() === lower ||
        option.text.toLowerCase().includes(lower)
      ) {
        element.value = option.value;
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false; // no matching option found
  },

  // Fill a radio group — find the radio whose label matches the value
  fillRadioGroup(radios, value) {
    const lower = value.toLowerCase();
    for (const radio of radios) {
      const label = this.getLabelText(radio).toLowerCase();
      const val = radio.value.toLowerCase();
      if (label.includes(lower) || val.includes(lower)) {
        radio.click();
        radio.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  },

  // Fill a checkbox to the desired boolean state
  fillCheckbox(element, value) {
    const desired = value === true || value === "true" || value === "yes" || value === "1";
    if (element.checked !== desired) {
      element.click();
    }
  },

  // Fill a file input from a base64 Data URL stored in the profile
  async fillFileInput(element, dataUrl, fileName) {
    if (!dataUrl) return false;
    try {
      const res = await fetch(dataUrl);
      const blob = await res.blob();
      const file = new File([blob], fileName || "resume.pdf", { type: "application/pdf" });
      const dt = new DataTransfer();
      dt.items.add(file);
      element.files = dt.files;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    } catch {
      return false;
    }
  },

  // Fill an ARIA combobox (custom dropdown): click → type filter → pick option.
  // Used by LinkedIn, Greenhouse, and others that avoid native <select>.
  async fillCombobox(container, value) {
    const input = container.querySelector("input") || container;
    container.click();
    await humanDelay.short();

    this.setInputValue(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
    await humanDelay.short();

    // Wait up to 2 seconds for the listbox to appear
    const listbox = await this.waitForSelector('[role="listbox"], [role="option"]', 2000, container.getRootNode());
    if (!listbox) return false;

    // The listbox may be the element itself or a descendant
    const scope = listbox.getAttribute("role") === "listbox" ? listbox : document;
    const options = scope.querySelectorAll('[role="option"]');
    const lower = value.toLowerCase();

    for (const option of options) {
      if (option.textContent.trim().toLowerCase().includes(lower)) {
        option.click();
        return true;
      }
    }
    return false;
  },

  // Classify a form element into a fill strategy
  classifyElement(element) {
    const tag = element.tagName.toLowerCase();
    const type = (element.type || "").toLowerCase();
    const role = (element.getAttribute("role") || "").toLowerCase();

    if (tag === "input") {
      if (type === "file") return "file";
      if (type === "radio") return "radio";
      if (type === "checkbox") return "checkbox";
      if (type === "hidden") return "hidden";
      if (type === "submit" || type === "button" || type === "reset") return "button";
      return "text"; // text, email, tel, number, url, date, search, etc.
    }
    if (tag === "select") return "select";
    if (tag === "textarea") return "textarea";
    if (role === "combobox") return "combobox";
    if (element.contentEditable === "true") return "richtext";
    return "unknown";
  },

  // Extract visible label text for a form element.
  // Checks: aria-label, aria-labelledby, associated <label>, placeholder, name.
  getLabelText(element) {
    // aria-label takes priority
    const ariaLabel = element.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel;

    // aria-labelledby
    const labelledBy = element.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl) return labelEl.textContent.trim();
    }

    // Associated <label for="id">
    if (element.id) {
      const label = document.querySelector(`label[for="${element.id}"]`);
      if (label) return label.textContent.trim();
    }

    // Closest wrapping <label>
    const wrappingLabel = element.closest("label");
    if (wrappingLabel) {
      return wrappingLabel.textContent.replace(element.value || "", "").trim();
    }

    // Placeholder or name as last resort
    return element.placeholder || element.name || "";
  },

  // Wait for a selector to appear in the DOM (optional scope).
  waitForSelector(selector, timeoutMs, scope) {
    const root = scope || document;
    return new Promise((resolve) => {
      const existing = root.querySelector(selector);
      if (existing) return resolve(existing);

      const observer = new MutationObserver(() => {
        const found = root.querySelector(selector);
        if (found) {
          observer.disconnect();
          resolve(found);
        }
      });

      observer.observe(root.nodeType === 9 ? root.body || root : root, {
        childList: true,
        subtree: true,
      });

      setTimeout(() => {
        observer.disconnect();
        resolve(null);
      }, timeoutMs);
    });
  },

  // Fill a single visible form field.
  // Returns: "filled" | "skipped" | "unknown" (unknown = needs Claude overlay)
  async fillField(element, profile) {
    const type = this.classifyElement(element);
    if (type === "hidden" || type === "button" || type === "unknown") return "skipped";

    // Find label text to look up in profile
    let labelText = this.getLabelText(element);

    // For radio inputs, use the group's fieldset legend or surrounding label
    if (type === "radio") {
      const fieldset = element.closest("fieldset");
      if (fieldset) {
        const legend = fieldset.querySelector("legend");
        if (legend) labelText = legend.textContent.trim();
      }
    }

    const profileValue = lookupProfileValue(labelText, profile);

    if (type === "file") {
      // Only fill if it looks like a resume upload
      const isResume = /resume|cv|curriculum/i.test(labelText);
      if (isResume && profile.resumeDataUrl) {
        await this.fillFileInput(element, profile.resumeDataUrl, profile.resumeFileName);
        return "filled";
      }
      return "skipped";
    }

    if (profileValue === null || profileValue === "") {
      return "unknown"; // Trigger Claude overlay
    }

    await humanDelay.short();

    if (type === "select") {
      const filled = this.fillSelect(element, profileValue);
      return filled ? "filled" : "unknown";
    }

    if (type === "radio") {
      const fieldset = element.closest("fieldset");
      const radios = fieldset
        ? fieldset.querySelectorAll('input[type="radio"]')
        : document.querySelectorAll(`input[type="radio"][name="${element.name}"]`);
      const filled = this.fillRadioGroup(radios, profileValue);
      return filled ? "filled" : "unknown";
    }

    if (type === "checkbox") {
      this.fillCheckbox(element, profileValue);
      return "filled";
    }

    if (type === "combobox") {
      const filled = await this.fillCombobox(element, profileValue);
      return filled ? "filled" : "unknown";
    }

    if (type === "text" || type === "textarea" || type === "richtext") {
      this.setInputValue(element, profileValue);
      return "filled";
    }

    return "unknown";
  },

  // Scan a container for fillable fields and fill them.
  // Returns an array of { element, labelText, status } for each field found.
  async fillContainer(container, profile, onUnknown) {
    const results = [];

    // Gather all interactive elements, deduplicate radio groups by name
    const seenRadioNames = new Set();
    const elements = [];

    for (const el of container.querySelectorAll(
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]), ' +
      "select, textarea, [role='combobox']"
    )) {
      if (!this.isVisible(el)) continue;

      if (el.type === "radio") {
        if (seenRadioNames.has(el.name)) continue;
        seenRadioNames.add(el.name);
      }

      elements.push(el);
    }

    for (const el of elements) {
      const labelText = this.getLabelText(el);
      let status = await this.fillField(el, profile);

      if (status === "unknown" && typeof onUnknown === "function") {
        status = await onUnknown(el, labelText);
      }

      results.push({ element: el, labelText, status });
      await humanDelay.betweenFields();
    }

    return results;
  },

  // Check if an element is visible in the viewport
  isVisible(element) {
    if (!element.offsetParent && element.style.display === "none") return false;
    const style = window.getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0") return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  },
};
