# TradingRulesPage — `/trading-rules`

## 1. What It Is Doing

A personal, editable trading rulebook — not an analytics page. Seeded from the trader's own journal/rules dump (discipline, risk, planning, options/delta mechanics, and a handful of dated macro-context notes), organized into 9 categorized, color-accented sections. Every rule is click-to-edit inline, can be deleted, and new rules or whole new sections can be added freely. No market data — it's an editorial/CRUD page backed by its own small Postgres table, not a data-driven analytics page.

Sections (seed data): Market Sentiment & Tracking · Market Regime Reading · Trade Planning & Preparation · Discipline & Psychology · Risk Budget & Position Sizing · Options & Delta Management · The Scaling System ("27 → 67") · Macro & Market Context Notes · Mindset Mantras.

---

## 2. Optimization

- Flat `useState<TradingRuleCategory[]>` with a `useEffect` that both writes to `localStorage` and PUTs to the backend on every change — no debouncing needed, the list is small (~44 rules) and edits are infrequent (human typing speed, not a hot path).
- No virtualization — total row count is small and bounded by how much a person actually writes into a personal rulebook, not NSE 500 scale.
- Single JSONB row, not a relational schema — the whole `categories` array is replaced wholesale on every save (see `trading_rules_store.py`). Simplest possible shape for a single-document, single-user store; avoids FK/join complexity a per-rule table would need for no benefit here.

---

## 3. Lessons Learnt

- **Click-to-edit caret bug**: switching a `<Typography>` into an `autoFocus` MUI `TextField` on click does NOT preserve the click's caret position — focus always lands at index 0 by default, so typing after clicking mid-sentence inserts at the start, not where the user clicked. Fixed with an `onFocus` handler that calls `e.target.setSelectionRange(len, len)` to place the caret at the end (Notion-style "click anywhere to edit, caret goes to end" behavior). Apply this pattern anywhere a static-text-to-input toggle is used for inline editing.
- **localStorage-only → Postgres migration**: started as a pure `useChartsCart`-style localStorage CRUD page, then moved to Postgres once cross-device/durable persistence was wanted. localStorage was kept, not dropped — it now serves purely as an instant-paint cache and offline fallback, with the backend as source of truth. This two-tier pattern (local cache + authoritative remote store, reconciled once on mount) is reusable for any other page that starts as a localStorage prototype and later needs to "graduate" to a real store without a jarring rewrite.
- **Seed-on-first-load, not seed-in-the-backend**: `DEFAULT_TRADING_RULES` lives only in the frontend hook. On mount, `GET /api/trading-rules` returns `null` if nothing's been saved yet; the client then seeds its own defaults and `PUT`s them once. This means the Postgres store never needs to duplicate the default content — one source of truth for "what the defaults are."
- Destructive actions (delete a whole section, reset to defaults) use a two-click inline confirm ("Delete section? Yes/No") instead of `window.confirm` — avoids native blocking dialogs per repo convention (also noted in the Chrome-automation guidance: alerts/confirms block all further browser events).
- **Manual smoke-test footgun**: testing the PUT endpoint by hand with a throwaway `fetch(..., {body: JSON.stringify({categories: []})})` from the browser console is a real write — it immediately overwrote the live row with an empty list. Any ad-hoc request against a write endpoint during testing should use a value you're prepared to have actually persisted (or hit a `-dry-run`/staging path), not an arbitrary placeholder.

---

## 4. Business Logic

- `DEFAULT_TRADING_RULES` in `src/hooks/useTradingRules.ts` is the seed/reset target — "Reset to defaults" always restores this exact list (and pushes it to Postgres), discarding all edits. This is intentional: it's a known-good recovery point, not meant to reflect future edits.
- Rules and sections are both freely editable (add/edit/delete) — there is no fixed schema beyond `{ id, title, accent, rules: [{ id, text }] }`. New sections cycle through a fixed `ACCENTS` palette of 9 hex colors.
- **Single-document store, not per-user** — there's no auth/multi-tenancy here; `trading_rules` has exactly one row (`id='default'`). Every browser pointed at the same backend shares the same rulebook. That's intentional for a single-operator tool; it would need a real `user_id` column to support more than one person's rules.
- Reconciliation on load always prefers the backend when it has data; the local/default copy is only used to seed an empty store or as a fallback when the backend is unreachable.

---

## 5. Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React, MUI `TextField`/`Box`/`Typography`, `usePalette()`/`useTokens()` hooks |
| State | `useTradingRules()` hook (`src/hooks/useTradingRules.ts`) — React state, reconciled with the backend on mount, `localStorage` as instant-paint cache + offline fallback |
| API client | `src/api/tradingRulesApi.ts` — `GET`/`PUT /api/trading-rules` |
| Backend | FastAPI router `app/routers/trading_rules.py` → service `app/services/trading_rules_store.py` |
| Data | PostgreSQL — table `trading_rules` (single JSONB row), same `app/db.py` pool as `custom_portfolios`. Graceful degradation: `StoreUnavailable` → GET returns `null` (client falls back local), PUT → HTTP 503 (client shows "Offline — local only") |
| Charts | None |

---

## 6. Suggestions to Achieve the Objective

1. **Drag-to-reorder rules/sections** — currently append-only within a section; reordering would help as the list grows past the seed.
2. **Export/import** — a "Copy as Markdown" or JSON export button would let the rulebook be backed up independent of the DB.
3. **Tag rules by trade context** (e.g. "options-only", "pre-market checklist") so the page could later support a filtered pre-trade checklist view, not just a flat read-through.
4. **Edit history / undo** — since saves now overwrite a single Postgres row wholesale, there's no history; a lightweight `updated_at`-keyed snapshot log (even just "keep last N JSONB blobs") would make a bad edit (or another accidental manual overwrite, see Lessons Learnt) recoverable without relying on "Reset to defaults," which throws edits away rather than just undoing the last change.
