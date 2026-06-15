# PatternDNAGuidePage — `/pattern-dna-guide`

## 1. What It Is Doing

Static documentation page for the PatternDNA module (~477 lines). No API calls. Purely educational.

Covers 12 sections with a Table of Contents (jump links):
1. What is Pattern DNA?
2. The 9 core patterns (with geometry description, typical bar count, confirmation criteria)
3. DNA Scoring methodology
4. Confidence rings explained
5. Pattern stages (Forming → Maturing → Breakout Watch → Confirmed)
6. Validation methodology (4-step suite)
7. How to use the scanner
8. How to use the screener
9. How to interpret forward return tables
10. Risk management with patterns
11. Limitations and caveats
12. Glossary

Uses standalone `SectionCard`, `TableCard`, `StatusChip`, `Note` components. Has its own Navbar (not the main app Navbar).

---

## 2. Optimization

- Static page — no API optimization needed.
- 12 sections render fully on load. With long content, virtual scrolling or collapsible sections would improve readability.
- TOC jump links use anchor `#id` — ensure IDs are consistent with section headers. Currently manually maintained (fragile).
- The standalone Navbar is duplicated from AgentsPage guide patterns. Consider a shared `<DocNavbar>` component.
- No search within the guide — for a 12-section document, a `Ctrl+F` equivalent search filter on section titles would improve findability.

---

## 3. Lessons Learnt

- Standalone documentation pages (no app Navbar, no auth) serve a different user — someone reading about the platform before committing to use it. The editorial tone here should be closer to LandingPage than to the analytics terminal.
- `Note` components (callout boxes) are the most effective format for surfacing caveats ("Pattern DNA does not predict reversals, only describes historical tendencies"). These caveats are legally and ethically important to display prominently.
- The guide is linked from PatternDNAPage but is not indexed by the main Navbar. This means users who encounter patterns they don't understand cannot easily find help. Add a `?` icon in PatternDNAPage that links here.

---

## 4. Business Logic

None — purely presentational. Future additions:
- Interactive examples: show a live pattern instance as an illustration (from the current Feature Store) rather than a static description.
- Dynamic glossary: link every technical term in the glossary to the section that uses it, and link from usage back to definition.

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, Material UI |
| Design | Custom `SectionCard`, `TableCard`, `StatusChip`, `Note` components — partially follow design system |
| Charts | None |
| State | None |
| API | None |
| Nav | Standalone `<DocNavbar>` (not main app Navbar) |

---

## 6. Suggestions to Achieve the Objective

1. **Embed live examples**: pull one current confirmed pattern from the Feature Store and render a live `PatternFormationChart` within the guide as a worked example. This makes the documentation immediately practical rather than purely theoretical.
2. **Pattern performance summary table**: add a table showing DNA scores and win rates for all 9 patterns in the current year's data. Users can immediately see which patterns have been working — actionable context alongside methodology.
3. **Link to validation results**: each pattern description should link to its latest validation report (OOS split, decile analysis). Transparency about what passed and what barely passed builds researcher trust.
4. **Expand to cover all modules**: the platform currently has a guide only for PatternDNA. Create equivalent guides for Delivery Intelligence, Markov Options, and Quant Strategies. A consistent documentation layer across all modules signals a mature research platform.
5. **Move into the main Navbar**: add a "Guide" or "Docs" link to the main Navbar that renders the relevant module guide based on the current page. Context-sensitive documentation reduces friction for researchers learning a new module.
