# Page Spec: [PageName]

## Identity
Route:     /route
File:      marketdna-web/src/pages/PageNamePage.tsx
Accent:    #XXXXXX   ← hex, not a variable name

---

## Data
API call:  moduleApi.method()  →  GET /api/endpoint
Response fields used:
  - field1 — what it represents
  - field2 — what it represents
Polling / refresh: [none | manual button | interval Xs]

---

## Layout
Pattern:   [single-column | two-column L=Xfr / R=Yfr]
Sections (top → bottom):
  1. Hero
  2. [Section name] — [brief purpose]
  3. [Section name] — [brief purpose]

---

## States
| State   | Trigger                  | Message shown              |
|---------|--------------------------|----------------------------|
| loading | on mount / on action     | "Loading …"                |
| empty   | data.length === 0        | "No X found."              |
| error   | API throws               | error.message              |
| data    | success                  | —                          |

---

## Illustrations
hero:    /illustrations/[filename].svg — [1-line concept]
loading: /illustrations/[filename].svg  OR  reuse kit/loading-compute.svg
empty:   /illustrations/[filename].svg  OR  reuse kit/empty-results.svg
error:   reuse kit/error-state.svg

---

## Reuse (existing components / SVGs)
- [ ] Navbar
- [ ] Footer
- [ ] SectionCard / StatCard
- [ ] LoadingCard / ErrorCard (shared)
- [ ] [Other page component if applicable]
- [ ] SVG: kit/loading-compute.svg
- [ ] SVG: kit/empty-results.svg

---

## New components needed
| Component       | Props                        | Purpose                  |
|-----------------|------------------------------|--------------------------|
| ComponentName   | prop1, prop2                 | what it renders          |

---

## Business logic (2–4 bullets max)
- What the page computes or fetches
- Key filter / sort / derived value
- Any notable constraint or edge case

---

## What NOT to build
- Features deferred to a later phase
- Anything not in this spec
