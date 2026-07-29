# Live Market Agent — `/live-agent`

Phase 5 of the Research Copilot / Live Agent programme. Read-only EOD market
observer. Full architecture in `RESEARCH_COPILOT_SPEC.md` §5.

## What It Does

Answers "what is changing that matters?" over end-of-day data. Deterministic
detectors compute the market state; a state store diffs today's snapshot vs the
last so **alerts fire on meaningful change** (regime flip, breadth shift, new
leadership, new-high surge) — not every tick. An agent (AICredits/`claude-sonnet-5`)
narrates and forms hypotheses, but every hypothesis is **validation-gated**: the
agent must confirm any historical claim via the Research Agent's `event_study`
(or `ranking`/`screen`) before presenting it as more than an unverified hypothesis.

**Read-only by construction** — there is no order-placement tool anywhere in the
Live Agent's toolset.

**Adaptive data source.** During NSE market hours it overlays live Kite LTPs (via
`live_trading_service._quotes`) as a synthetic current bar on the EOD series; outside
hours, or if Kite is unavailable, it falls back to the DuckDB EOD lake. Every response
carries a `source` field ("live"/"eod"), surfaced as a badge on the page.

**Sector rotation is wired.** A symbol→sector map (from `sector_heatmap_service`)
drives a sector-strength component in the opportunity board, a ranked sector list in
`market_state`, a dedicated `sector_rotation` tool, and a leadership-rotation change event.

## Optimization

- Detectors reuse `research_tools` bulk-load (`_load_universe_frames`) — one DuckDB
  query per universe, numpy per symbol. Cached by `(tool, input, data_version)`.
- `market_state`, `opportunity_board` cached; `POST /invalidate` clears them after
  ingestion. Default universe NIFTY 50 (fast); NSE 500 available.
- State + event memory persist to `data_lake/derived/live_agent/` (`state.json`,
  `events.jsonl`) so change-detection survives restarts (parquet-first analog).

## Lessons Learnt

- **Alerts must be change-based, not level-based.** `detect_changes` only emits when
  the snapshot's trading date advances AND a real transition occurred (regime label
  change, |breadth Δ| ≥ 10, new top-5 leader, +3 new highs). First run records a
  baseline; a same-day re-run emits zero — verified.
- **Validation-gating is a prompt + toolset contract.** The agent is given
  `event_study`/`ranking`/`screen` precisely so a hypothesis ("banking leadership →
  momentum continues") can be checked against history; the SYSTEM prompt forbids
  presenting an unvalidated hypothesis as a conclusion.
- **Detectors on EOD, not live.** Consistent with the decision to skip intraday
  plumbing. `why_move` is explicitly labeled "EOD attribution from price/volume/trend
  — not news or fundamentals" so it is never mistaken for a fundamental catalyst.
- **Read-only is structural, not just prompted.** No order tool exists in the
  dispatch, so even a jailbroken prompt cannot place a trade.
- **Intraday cache freeze (fixed).** `market_state`/`opportunity_board` cache by
  `data_version()` (COUNT+MAX date), which is constant during the session, so the first
  call froze the live snapshot all day. Fix: `_intraday_bucket()` adds a per-minute token
  to the cache key while `_market_is_open()`, so detectors recompute each minute with fresh
  Kite quotes (and still coalesce within the minute to protect the rate limit); outside
  hours the token is None → normal daily cache. The frontend also auto-polls `/scan` every
  30s while `source === 'live'`. Classic CLAUDE.md caveat: a date-keyed cache is wrong for
  intraday data.
- **If it still shows EOD during market hours**, the live path isn't the cache — check
  the source badge and the Kite session: `_quotes()` returns `{}` on an expired access
  token, so `_live_prices` falls back to `source=eod` (yesterday's close). Refresh the
  Kite token; the badge flips to LIVE.

## Business Logic

- **market_state**: breadth = %>SMA20·0.30 + %>SMA50·0.40 + %>SMA200·0.30 (project
  formula); regime label bands 70/55/40/25. Advancers/decliners from last-bar returns;
  new highs = within 0.1% of 252-day high; breakouts = close ≥ prior 20-day high on
  >1.5× volume; leaders/laggards by 20-day return.
- **opportunity_board**: weighted score = trend 0.25 + relative-strength 0.20 +
  volume-expansion 0.15 + vol-breakout 0.10 + **sector-strength 0.15** + breadth 0.15
  (weights overridable, sum 1.0). Sector-strength = percentile rank of the symbol's
  sector by average 20-day return. (Pattern-quality remains deferred.)
- **sector_rotation**: sectors ranked by average 20-day return of constituents; exposes
  leading/lagging sector. Sector map comes from `sector_heatmap_service._build_sector_list`.
- **detect_changes**: persists the current snapshot and appends events to memory.
- **Agent toolset**: live detectors (market_state, detect_changes, opportunity_board,
  why_move, recall_events) + borrowed research validators (event_study, ranking, screen).

## Tech Stack

- Backend: `app/services/live_agent_service.py` (detectors, state store, memory),
  `app/services/live_agent_copilot.py` (agent loop, read-only toolset),
  `app/routers/live_agent.py` (`/api/live-agent/*`), `app/models/live_agent.py`.
  OpenAI SDK → AICredits; DuckDB; numpy. Reuses `research_tools` + `event_study`.
- Frontend: `src/pages/LiveAgentPage.tsx`, `src/api/liveAgentApi.ts`. State strip
  (regime/breadth gauge/adv-dec/new-highs/breakouts), opportunity board table,
  change feed (severity-colored), agent chat with observation manifest.
- Route: `/live-agent` in `App.tsx`.

## API

- `GET  /api/live-agent/scan?universe=` → `{state, changes, board}` (persists snapshot)
- `GET  /api/live-agent/state` · `/board` · `/why/{symbol}` · `/events`
- `POST /api/live-agent/chat` `{question, universe}` → `{answer, manifest, artifacts}`
- `POST /api/live-agent/invalidate`

## Suggestions (backlog)

1. **Live volume for intraday breakouts.** The live overlay appends the last EOD volume
   to the synthetic bar (Kite `_quotes` LTP path doesn't carry cumulative volume here), so
   the breakout volume filter is relaxed intraday. Wire live volume for a stricter intraday
   breakout signal.
2. **Scheduled daily scan** — run `/scan` post-close via the scheduler so `detect_changes`
   builds a real day-over-day narrative automatically.
3. **5c/5e polish** — live setup-tracker tiles (each board row tied to a researched setup)
   and per-setup realized-vs-expected monitoring.
4. Add `/api/live-agent/invalidate` to the CLAUDE.md post-market invalidation loop.
