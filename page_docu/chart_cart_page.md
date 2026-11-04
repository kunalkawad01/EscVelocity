# Chart Cart Page — `/chart-cart`

The full-page view of the Charts page's persistent "chart cart" — every bookmarked
(symbol, timeframe, direction) setup, each rendered as a real live candlestick tile
(not a list row), with filters, sorting, and two layout modes.

## What It Does

- **Hero.** Headline + description, plus a live count strip: total items, bullish count
  (green), bearish count (red) — computed from the full unfiltered cart.
- **Filter bar** (hidden entirely when the cart is empty):
  - **Search** — substring match on symbol, same `SearchBox` component as `/charts`.
  - **Direction** — All / Bullish / Bearish, single-select pill row.
  - **Cart Section TF** — All + the 8 timeframe pills (1D…5Y), single-select; filters by
    which section a cart entry was *saved under* (its stored `tf`). Labeled "Cart Section
    TF" specifically to disambiguate from the indicator filter bar's own "Indicator TF"
    below it — see Business Logic for why these are two separate controls.
  - **Sort** — Newest / Oldest (by `addedAt`) / A–Z (symbol) / Change % (by the entry's
    stored `changePct`, descending).
  - **View** — "By Section" (default) groups filtered+sorted items under their
    `{Timeframe} {Direction}` heading, same grouping as the Charts page's cart drawer;
    "Flat Grid" drops the grouping and renders every filtered+sorted item in one
    3-column grid, each tile carrying its own small badge (dot + "1D BULLISH" style
    label) so direction/timeframe stay legible without a section header.
  - **Indicator filter bar (RSI / ATR% / Returns%)** — the exact same
    `IndicatorFilterBar` component as `/charts`: its own Indicator TF picker plus
    `<`/`>` + value fields for RSI, ATR %, Returns %, gated behind Apply/Re-scan. A cart
    entry's *symbol* must pass the snapshot's indicator values to stay visible — the
    entry's own saved timeframe/direction/price are unrelated to this check.
  - A `{shown} / {total}` counter sits under the controls.
- **Real charts, not placeholders.** Every cart entry renders the exact same
  `ChartTile` component used on `/charts` — live LTP, prev-close dotted line,
  candlestick/line toggle, full 8-timeframe tab strip (still switchable from the tile,
  it just *defaults* to the timeframe the entry was saved under via `initialTf`), and
  the same bullish/bearish add-to-cart icons (so a tile already in the cart shows its
  active direction filled in, and clicking it again removes that entry — same toggle
  semantics as `/charts`).
- **Per-entry badge + remove.** Above each tile: a colored dot + "{TF} {DIRECTION}"
  label, the entry's saved price/change%, and a small ✕ button that removes just that
  one cart entry (`cart.remove(symbol, tf, direction)`).
- **Empty states.** Two distinct ones: cart has zero items at all (full-width card with
  a pointer back to `/charts`), vs. cart has items but the current filters match none
  ("No cart items match the current filters.").

## Optimization

- **Shares every piece of infrastructure with `/charts` — nothing was reimplemented.**
  `ChartTile`, `useFoTicker`, `useInView`, and the chart-formatting constants
  (`TF_LABELS`, `pct`, `MONO`/`SANS`/`GREEN`/`RED`, `CART_SECTIONS`) were extracted out
  of `ChartsPage.tsx` into `src/components/charts/` and `src/hooks/` specifically so
  this page (and any future chart-grid page) could reuse them instead of duplicating
  ~250 lines of Highcharts options logic. See Lessons Learnt.
- **Same lazy-mount behavior as `/charts`.** Each `ChartTile` still defers its history
  fetch + Highcharts mount via `IntersectionObserver` — a large cart scrolls exactly as
  cheaply as the main grid does.
- **Filtering/sorting is pure client-side array work** over the already-in-memory cart
  (`localStorage`-backed, typically tens of items at most) — no backend call, no
  pagination needed at this scale.
- **One websocket connection, independent of `/charts`.** This page opens its own
  `useFoTicker()` connection (same `/ws/charts` endpoint) rather than sharing a socket
  across routes/tabs — simplest correct behavior given each page is its own React tree;
  not worth the complexity of a cross-page singleton connection for two lightweight
  research pages.
- **Indicator filtering reuses `/charts`' bulk snapshot endpoint and client-side matcher
  unmodified.** This page's `useIndicatorFilters()` is the exact same hook instance type
  as `/charts`' — a separate instance (separate `GET /api/charts/indicators` call,
  separate in-memory snapshot), but it hits the same server-side cache keyed by tf, so a
  scan already warmed from browsing `/charts` at the same timeframe returns fast here too.

## Lessons Learnt

- **Extracting `ChartTile` was necessary, not premature.** The first version of the
  bullish/bearish cart (on `/charts` alone) had the entire chart-tile implementation —
  Highcharts options, timeframe tabs, candlestick/line toggle, live-tick overlay,
  add-to-cart buttons — living as a private `ChartCard` function inside
  `ChartsPage.tsx`. Building this second page that needed to render the *same* tile
  made the duplication cost concrete (not hypothetical), so it was pulled out to
  `src/components/charts/ChartTile.tsx` with one new prop (`initialTf`) rather than
  copy-pasted. `ChartsPage.tsx` was left behaviorally identical after the extraction —
  verified by re-testing `/charts` in the browser post-refactor.
- **`initialTf` only seeds a tile's `useState`, it doesn't pin it.** A cart tile still
  lets the trader flip through all 8 timeframe tabs like on `/charts` — it just opens on
  the timeframe the entry was actually saved under, which is the only sane default when
  the same symbol can appear multiple times in the cart under different timeframes.

## Business Logic

- **Reads and writes the exact same cart as `/charts`.** Both pages call
  `useChartsCart()`, which is backed by the same `localStorage` key (`charts_cart_v1`) —
  there is no separate "cart page state"; adding/removing here is immediately visible on
  `/charts`' drawer and vice versa (same-browser, verified by navigating between the two
  pages in one tab).
  - **Not Postgres, deliberately** — see the "Cart is client-only" business-logic note in
    `page_docu/charts_page.md`; that reasoning applies identically here since this page
    is just a different view onto the same cart.
- **"By Section" iterates the same `CART_SECTIONS` constant as the Charts page drawer**
  (all 16 timeframe×direction combinations in a fixed order), so section ordering is
  consistent everywhere the cart is grouped.
- **Sort and group are independent controls** — sorting always determines item order
  within whatever container they land in (a section in "By Section" mode, or the whole
  grid in "Flat Grid" mode); it never decides *which* section/view an item appears in.
  Direction/timeframe filters are the only controls that remove items from view.
- **Two unrelated "timeframe" concepts coexist on this page, deliberately kept visually
  distinct.** "Cart Section TF" filters by which `{tf}` a cart entry was *saved under*
  (its identity, same as the grouping headings) — it's a property of the bookmark itself.
  "Indicator TF" (inside the indicator filter bar) is the timeframe the *current* RSI/
  ATR%/Returns% snapshot was computed on — a global setting applied uniformly across
  every symbol in the cart regardless of what tf each entry was saved under. Setting
  "Cart Section TF = 2D" and "Indicator TF = 1Y" is valid and meaningful: "show me my
  2D-timeframe bookmarks, filtered by their 1-year RSI." Conflating the two labels (both
  just "Timeframe") was considered and rejected — too easy to misread which one a change
  affects.
- **Indicator filtering applies to the symbol, not the saved entry.** A symbol bookmarked
  under multiple (tf, direction) combinations shares one RSI/ATR/Returns value per
  Indicator TF across all of its cart entries — filtering doesn't distinguish "this
  entry's RSI" from "that entry's RSI" because RSI isn't a property of the bookmark, it's
  a property of the symbol at the chosen Indicator TF.

## Tech Stack

- `src/pages/ChartCartPage.tsx` — the page itself: hero, filter bar (`PillRow` helper,
  a single-select pill-row component local to this file), `CartEntryTile` (badge + ✕ +
  `ChartTile` wrapper), and the By Section / Flat Grid render branches.
- Shared with `/charts` (all in `src/components/charts/` and `src/hooks/`):
  - `ChartTile.tsx` — the chart tile itself.
  - `chartsCommon.ts` — `MONO`, `SANS`, `GREEN`, `RED`, `TF_LABELS`, `pct`,
    `CART_SECTIONS`.
  - `IndicatorFilterBar.tsx` — the RSI/ATR%/Returns% filter UI, rendered a second time
    on this page with its own `useIndicatorFilters()` instance (own `tf`/thresholds/
    snapshot state, independent of `/charts`' instance — see Lessons Learnt for why they
    still share the server-side cache).
  - `useFoTicker.ts`, `useInView.ts` — websocket ticks and lazy-mount.
  - `useIndicatorFilters.ts` — filter state + `GET /api/charts/indicators` fetch +
    `passes(symbol)` matcher, folded into this page's `filtered` memo alongside search/
    direction/Cart Section TF.
  - `useChartsCart.ts` — the cart itself (`items`, `isInCart`, `toggle`, `remove`,
    `clearSection`, `clearAll`).
- No new backend code of its own — this page calls the same `chartsApi` as `/charts`
  (`getSymbols` unused here; `getHistory`/`wsUrl` used per visible cart entry;
  `getIndicators` used by the indicator filter bar).
- Route `/chart-cart`, nav entry under Signals → "Chart Cart" in `Navbar.tsx`, right
  after "Charts".

## Suggestions

- The Charts page's cart drawer now links to this page ("OPEN FULL CART PAGE →") but
  this page has no equivalent quick link back to `/charts` beyond the navbar — a small
  "Browse full F&O grid →" link in the hero would close the loop.
- No bulk actions yet (e.g., select several entries and clear them together, or export
  the filtered set to CSV) — today it's one add/remove at a time, same as the drawer.
- Sort by Change % uses each entry's *saved* `changePct` (captured at add-time), which
  goes stale as prices move — a "live change%" sort using the current `ticks` map would
  better answer "what's moved most since I saved it," but needs a decision on how to
  handle entries whose live tick hasn't arrived yet.
- Consider persisting the chosen filter/sort/view state (e.g. in the URL query string)
  so a reload or a shared link preserves the trader's current cart view.
- The two "timeframe" controls (Cart Section TF vs. Indicator TF) are functionally clear
  but visually just two pill rows with different labels — a first-time user could still
  miss the distinction. Worth a short inline hint or tooltip if this causes confusion in
  practice.
- Indicator filtering here and on `/charts` are two separate scans (two separate
  `useIndicatorFilters()` instances, two client-side snapshots) even though they can
  target the same timeframe — lifting the snapshot into shared state (e.g. a context, or
  caching the fetched snapshot client-side keyed by tf) would avoid a redundant Re-scan
  when a trader jumps between the two pages at the same Indicator TF.
