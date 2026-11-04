# TradingRulesPage — `/trading-rules`

## 1. What It Is Doing

A personal, editable trading rulebook — not an analytics page. Seeded from the trader's own journal/rules dump (discipline, risk, planning, options/delta mechanics, and a handful of dated macro-context notes), organized into 9 categorized, color-accented sections. Every rule is click-to-edit inline, can be deleted, and new rules or whole new sections can be added freely. No API calls — it's a static editorial/CRUD page, not a data-driven one.

Sections (seed data): Market Sentiment & Tracking · Market Regime Reading · Trade Planning & Preparation · Discipline & Psychology · Risk Budget & Position Sizing · Options & Delta Management · The Scaling System ("27 → 67") · Macro & Market Context Notes · Mindset Mantras.

---

## 2. Optimization

- Flat `useState<TradingRuleCategory[]>` with a single `useEffect` writing to `localStorage` on every change — no debouncing needed, the list is small (~44 rules) and edits are infrequent (human typing speed, not a hot path).
- No virtualization — total row count is small and bounded by how much a person actually writes into a personal rulebook, not NSE 500 scale.

---

## 3. Lessons Learnt

- **Click-to-edit caret bug**: switching a `<Typography>` into an `autoFocus` MUI `TextField` on click does NOT preserve the click's caret position — focus always lands at index 0 by default, so typing after clicking mid-sentence inserts at the start, not where the user clicked. Fixed with an `onFocus` handler that calls `e.target.setSelectionRange(len, len)` to place the caret at the end (Notion-style "click anywhere to edit, caret goes to end" behavior). Apply this pattern anywhere a static-text-to-input toggle is used for inline editing.
- Followed the `useChartsCart` pattern exactly (see `src/hooks/useChartsCart.ts`) for localStorage CRUD — single-user scratchpad data doesn't need a Postgres table or API route. Reuse this pattern before reaching for a backend for any future "personal, editable list" page.
- Destructive actions (delete a whole section, reset to defaults) use a two-click inline confirm ("Delete section? Yes/No") instead of `window.confirm` — avoids native blocking dialogs per repo convention (also noted in the Chrome-automation guidance: alerts/confirms block all further browser events).

---

## 4. Business Logic

- `DEFAULT_TRADING_RULES` in `src/hooks/useTradingRules.ts` is the seed/reset target — "Reset to defaults" always restores this exact list, discarding all edits. This is intentional: it's a known-good recovery point, not meant to reflect future edits.
- Rules and sections are both freely editable (add/edit/delete) — there is no fixed schema beyond `{ id, title, accent, rules: [{ id, text }] }`. New sections cycle through a fixed `ACCENTS` palette of 9 hex colors.
- No sync across devices/browsers — this is `localStorage`-scoped to one browser, consistent with Chart Cart's "personal watchlist, not shared data" rationale.

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, MUI `TextField`/`Box`/`Typography`, `usePalette()`/`useTokens()` hooks |
| State | `useTradingRules()` hook (`src/hooks/useTradingRules.ts`) — local React state + localStorage persistence |
| Data | None (client-only, no backend) |
| Charts | None |

---

## 6. Suggestions to Achieve the Objective

1. **Drag-to-reorder rules/sections** — currently append-only within a section; reordering would help as the list grows past the seed.
2. **Export/import** — a "Copy as Markdown" or JSON export button would let the rulebook be backed up outside browser storage (currently the only persistence is `localStorage`, which is lost on browser data clear).
3. **Tag rules by trade context** (e.g. "options-only", "pre-market checklist") so the page could later support a filtered pre-trade checklist view, not just a flat read-through.
4. **Optional Postgres sync** — if cross-device access becomes important, migrate to the `custom_portfolios`-style Postgres pattern (`app/db.py`) instead of localStorage; not needed today.
