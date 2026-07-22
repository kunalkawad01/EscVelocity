---
name: drivers-author
description: Author or refresh Stock Drivers dossiers (content/drivers/<SYMBOL>.yaml) for F&O symbols — two-pass generation with web research, shared forecast blocks, and validation. Usage - /drivers-author SYMBOL [SYMBOL2 ...] to draft new dossiers, /drivers-author refresh SYMBOL to diff-update an existing one.
---

# Stock Drivers — Authoring Skill

Produces dossier drafts for `marketdna-backend/content/drivers/<SYMBOL>.yaml`, validated
against `app/models/drivers.py`. Feature plan: `fundamental.md` at repo root.
Coverage target: the 211 symbols in `marketdna-data/FO.csv` (column `Ticker`).

**Every draft is a DRAFT until the human review pass.** Facts you cannot source get a
`verify_note`. Never mark `last_reviewed` as "reviewed" quality — set it to the draft date;
the reviewer confirms or fixes before it counts as reviewed.

## Process per symbol — two passes, in order

### Pass 1 — narrative + simple_english (sources first, then web)

1. **Primary sources first.** Web-search for the company's latest investor presentation,
   annual report highlights, and last two concall summaries. These anchor: segment mix,
   export share, order book, management's own stated drivers. Record each consulted
   document in the dossier's `sources[]`.
2. Identify 5–9 drivers. Aim for 2–3 `primary`, 2–3 `secondary`, 1–3 `background`.
   Always include an `ownership` driver (shareholding structure) as background.
3. Write `narrative` (analyst-grade) and `simple_english` for each.
   **simple_english is a causal chain, not a summary**: "company sells X to Y; when Z
   happens, Y buys more/less X; that's why the stock reacts to Z." If it just restates
   the narrative in shorter words, rewrite it.
4. Dated `events`: only include events you can date to at least month precision AND tie
   to an observed price reaction. Month-only dates are fine (`"2026-02"`); the chart
   snaps them to the first trading bar. Add a `verify_note` if dates are approximate.

### Pass 2 — forecast blocks (separate web-search focus: "what leads this indicator")

1. **Check the shared library first**: `content/drivers/_library/forecast_blocks.yaml`.
   If the driver matches an archetype (bank credit cycle, IT spend, steel cycle, US truck
   cycle, defence orders, …), copy the block and adapt the specifics. If you build a new
   archetype-worthy block, ADD it to the library so the next dossier inherits it.
2. Every leading indicator must be a **real, named, publicly checkable** series or event
   type with source and cadence. "Watch industry sentiment" → delete.
3. `rule_of_thumb` must be threshold-shaped (falsifiable): "X above N = cycle peaking."
4. **Unforecastable is a valid answer.** Event-driven drivers get
   `how: "Not forecastable — event-driven."` plus the earliest visible footprint to track.

## Schema essentials

Top level: `symbol` (must match filename stem and NSE symbol), `company`, `sector`,
`last_reviewed` (draft date), `review_cadence` (default `quarterly`), `sources[]`
(`doc_type`: annual_report | investor_presentation | concall_transcript | filing | other),
`drivers[]`.

Per driver: `title`, `category` (demand | policy | orders | input_costs | competition |
ownership | catalyst), `weight` (primary | secondary | background), `narrative`,
`simple_english`, `forecast` (`how`, `leading_indicators[]` of name/source/cadence/lead,
optional `rule_of_thumb`), optional `events[]` (`event_date`, `label`, `observed_move`),
`watch`, `direction`, `verify_note`, `as_of`.

Reference dossier: `content/drivers/BHARATFORG.yaml` — match its tone and depth.

## After writing

1. **Validate** (from `marketdna-backend/`):
   ```powershell
   .\.venv\Scripts\python.exe -m jobs.drivers_status
   ```
   Zero validation errors required.
2. **Reload the running backend** (no restart needed):
   `POST http://localhost:8000/api/drivers/invalidate`
3. Spot-check in the app: `http://localhost:5173/stock/<SYMBOL>` section 03.

## Refresh mode (`refresh SYMBOL`)

Read the existing dossier, note its `sources[]` editions and `last_reviewed`. Web-search
only for what changed since (new results, new orders, policy shifts, shareholding moves).
Produce a **diff**, not a rewrite: update stale numbers, add new events, re-date `as_of`
fields, update `sources[]`, bump `last_reviewed`. Never silently delete a driver — if one
died (e.g. a divestment), say so in the summary and remove it explicitly.

## Review discipline (human pass — do not skip)

The reviewer: fixes numbers, deletes anything unsourced, clears or keeps `verify_note`s,
sets `last_reviewed`. A dossier with unreviewed AI-drafted numbers must keep its
`verify_note`s — they render as amber warnings in the UI by design.
