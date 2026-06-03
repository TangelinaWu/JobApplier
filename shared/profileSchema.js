// Profile defaults — flat object stored under "profile" key in storage.local
const PROFILE_DEFAULTS = {
  // Personal
  firstName: "",
  lastName: "",
  email: "",
  phone: "",
  address: "",
  city: "",
  state: "",
  zipCode: "",
  country: "United States",

  // Online presence
  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",
  websiteUrl: "",

  // Resume — stored as base64 Data URL (PDF, typically 50–200KB)
  resumeFileName: "",
  resumeDataUrl: "",

  // Work
  currentTitle: "",
  yearsOfExperience: "",
  desiredSalary: "",
  workAuthorization: "US Citizen",
  requiresSponsorship: false,

  // Education
  highestDegree: "Bachelor's",
  fieldOfStudy: "",
  university: "",
  graduationYear: "",

  // EEOC / demographics (optional — defaults to "prefer not to answer")
  gender: "Decline to self-identify",
  ethnicity: "Decline to self-identify",
  veteranStatus: "I am not a protected veteran",
  disabilityStatus: "I don't wish to answer",

  // Preferences
  canWorkRemote: true,
  willingToRelocate: false,

  // Text used by Claude when generating answers for open-ended questions
  professionalSummary: "",
  skills: "",
  coverLetterTemplate: "",

  // App settings
  claudeApiKey: "",
  autoSubmit: false,
  confirmUnknownQuestions: true,
  pauseOnEachStep: false,
};

// Maps lowercased label text patterns to profile field keys.
// formFiller.js iterates this to look up a value for a given field label.
const FIELD_MAP = [
  { patterns: ["first name", "given name", "first"], key: "firstName" },
  { patterns: ["last name", "family name", "surname", "last"], key: "lastName" },
  { patterns: ["full name", "legal name"], key: "__fullName" },
  { patterns: ["email", "e-mail", "email address"], key: "email" },
  { patterns: ["phone", "mobile", "telephone", "cell"], key: "phone" },
  { patterns: ["address", "street"], key: "address" },
  { patterns: ["city", "town"], key: "city" },
  { patterns: ["state", "province", "region"], key: "state" },
  { patterns: ["zip", "postal code", "zip code"], key: "zipCode" },
  { patterns: ["country"], key: "country" },
  { patterns: ["linkedin", "linkedin url", "linkedin profile"], key: "linkedinUrl" },
  { patterns: ["github", "github url", "github profile"], key: "githubUrl" },
  { patterns: ["portfolio", "personal website", "website url", "personal site"], key: "portfolioUrl" },
  { patterns: ["website", "personal url"], key: "websiteUrl" },
  { patterns: ["current title", "job title", "current position", "title"], key: "currentTitle" },
  { patterns: ["years of experience", "years experience", "how many years"], key: "yearsOfExperience" },
  { patterns: ["salary", "compensation", "expected salary", "desired salary"], key: "desiredSalary" },
  { patterns: ["work authorization", "authorized to work", "eligible to work", "legally authorized"], key: "workAuthorization" },
  { patterns: ["require sponsorship", "visa sponsorship", "sponsorship", "require visa"], key: "__sponsorship" },
  { patterns: ["degree", "highest education", "highest degree", "education level"], key: "highestDegree" },
  { patterns: ["university", "college", "school", "institution"], key: "university" },
  { patterns: ["field of study", "major", "area of study", "discipline"], key: "fieldOfStudy" },
  { patterns: ["graduation year", "grad year", "year of graduation"], key: "graduationYear" },
  { patterns: ["gender"], key: "gender" },
  { patterns: ["race", "ethnicity", "racial"], key: "ethnicity" },
  { patterns: ["veteran", "military", "protected veteran"], key: "veteranStatus" },
  { patterns: ["disability", "disabled", "accommodation"], key: "disabilityStatus" },
  { patterns: ["cover letter"], key: "coverLetterTemplate" },
  { patterns: ["relocate", "willing to relocate", "open to relocation"], key: "__relocate" },
  { patterns: ["remote", "work remotely", "work from home"], key: "__remote" },
];

// Resolve special computed keys to actual string values
function resolveProfileValue(key, profile) {
  if (key === "__fullName") {
    return `${profile.firstName} ${profile.lastName}`.trim();
  }
  if (key === "__sponsorship") {
    return profile.requiresSponsorship ? "Yes" : "No";
  }
  if (key === "__relocate") {
    return profile.willingToRelocate ? "Yes" : "No";
  }
  if (key === "__remote") {
    return profile.canWorkRemote ? "Yes" : "No";
  }
  return profile[key] !== undefined ? String(profile[key]) : null;
}

// Look up a profile value given a form field's label text.
// Returns null if no match is found (triggers Claude overlay).
function lookupProfileValue(labelText, profile) {
  const lower = (labelText || "").toLowerCase().trim();
  for (const entry of FIELD_MAP) {
    if (entry.patterns.some((p) => lower.includes(p))) {
      return resolveProfileValue(entry.key, profile);
    }
  }
  return null;
}
