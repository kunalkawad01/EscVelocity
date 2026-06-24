# SKILL: marketdna:intraday-race-intelligence

version: 1.0.0
author: MarketDNA
stack: Kite Connect API → DuckDB → Chart.js → React/Flask

## PURPOSE

Real-time intraday intelligence dashboard for NSE/BSE f&o universe .
Four visual modules, all normalized to 9:15 AM open, refreshing every 1 minute.

---

## MODULE 1 — Bar Race (4 panels)

### Data contract

Poll: GET /api/returns
Response: { [symbol]: { ltp, prev_close, return_pct, timestamp } }
Rank = sorted index by return_pct descending (rank 1 = best return)

### Panels

A. Top 10 by return — rank 1 = highest return_pct. Bar width = magnitude.
B. Bottom 10 by return — rank 1 = worst return_pct. Bar width = magnitude.
C. Declining stocks — filter: current_rank > prev_rank. Bar = current_rank − prev_rank. Show rank-diff badge.
D. Recovering stocks — filter: current_rank < prev_rank. Bar = prev_rank − current_rank. Show rank-diff badge.

### Color rules

Positive return → #1D9E75 (green)
Negative return → #E24B4A (red)
Declining panel bars → always red
Recovering panel bars → always green

### Refresh

Market open → all 4 panels refresh every 60 seconds
Market closed → freeze all panels to 15:30 snapshot
→ show replay bar (3:25 PM → 3:30 PM, 6 frames, 1 frame per minute, stop at 3:30)

---

## MODULE 2 — Return vs ATR(2) Scatter

### Data contract

Same /api/returns endpoint + price tick history per symbol

### ATR(2) calculation

candles = last N minute candles per symbol from kite.historical_data()
tr_list = [max(c.high, prev.close) - min(c.low, prev.close) for each consecutive pair]
atr2 = mean(tr_list[-2:])

### Chart spec

X axis: ATR(2) ← low volatility · high volatility →
Y axis: return_pct (%)
One dot per stock, colored by category (see category rules below)
Dashed crosshair at X = median ATR, Y = 0

### Quadrant interpretation (show as footer labels)

Top-left Low ATR · High return → steady outperformers
Top-right High ATR · High return → strong trending movers
Bottom-left Low ATR · Low return → quiet laggards
Bottom-right High ATR · Low return → volatile decliners (avoid)

### Tooltip

Ticker | Return % | ATR(2) | Category

### Refresh: 60 seconds

---

## MODULE 3 — Normalized Return Progression (9:15 baseline)

### Data contract

price_at_915[symbol] = first tick LTP at 09:15:00 from kite WebSocket or historical
norm_return[symbol][t] = (ltp[t] / price_at_915[symbol] - 1) \* 100

### Chart spec

Type: multi-line chart
X axis: IST time labels (9:15, 9:16, 9:17 … 15:30), one point per minute
Y axis: normalized return from 9:15 (%)
All 40 stocks start at exactly 0% at 9:15
Dashed horizontal line at Y=0 labeled "0% baseline (9:15)"
End-of-line label: ticker + current return % (right edge of chart)
Line color: by category (see category rules)
Tooltip: stock name · time · return from 9:15

### Refresh: 60 seconds (append new point, do not reset)

---

## MODULE 4 — Mini Sparkline Grid (40 stocks, 4 rows)

### Layout

Row 1 Top 10 & runners-up border-top: #1D9E75
Row 2 Recovering border-top: #378ADD
Row 3 Declining border-top: #D85A30
Row 4 Bottom 10 & laggards border-top: #E24B4A

### Per card

Ticker (9px bold)
Current return % (color = green if positive, red if negative)
Sparkline of norm_return history (last 30 ticks)
Border-top color encodes row category

### Refresh: 60 seconds. Rebuild category assignment every tick

(stocks migrate between rows as ranks change)

---

## CATEGORY RULES (shared across all modules)

cat[symbol] = classify by:
top → rank 1–10 by return_pct
bot → rank 41–50 (bottom 10)
rec → current_rank < prev_rank AND not in top/bot
(sort by rank_gain descending, take top 10)
dec → current_rank > prev_rank AND not in top/bot
(sort by rank_drop descending, take top 10)
neu → remainder

### Category colors

top #1D9E75 (teal-green)
rec #378ADD (blue)
dec #D85A30 (coral)
bot #E24B4A (red)
neu #888780 (gray)

---

## MARKET STATE

isOpen = True between 09:15 and 15:30 IST on trading days
isOpen = False otherwise

When open:
→ All modules refresh every 60 seconds via setInterval(fetchReturns, 60000)
→ norm_return history grows one point per minute

When closed:
→ Freeze all modules to 15:30 snapshot
→ Show replay controls:
frames = [3:25, 3:26, 3:27, 3:28, 3:29, 3:30] (6 snapshots)
replay_interval = 60 seconds per frame
loop = False (stop at 3:30 frame)
replay_trail = rebuild per-stock history for scatter + sparklines during replay
→ "Play replay" button starts sequence
→ "Replay again" resets to frame 0

---

## BACKEND ENDPOINTS (Flask)

GET /api/returns
→ { symbol: { ltp, prev_close, return_pct, rank, prev_rank, atr2, timestamp } }

GET /api/history?symbol=RELIANCE&from=09:15&to=current
→ { symbol: "RELIANCE", points: [ { time: "09:15", price, norm_return }, … ] }

GET /api/snapshot?time=15:30
→ same shape as /api/returns but for a historical moment

### DuckDB storage

CREATE TABLE intraday_ticks (
symbol VARCHAR,
time TIMESTAMP,
ltp DOUBLE,
price_915 DOUBLE,
norm_return DOUBLE,
atr2 DOUBLE,
rank INTEGER,
prev_rank INTEGER,
category VARCHAR
);

---

## KITE CONNECT WIRING

from kiteconnect import KiteTicker, KiteConnect

kite = KiteConnect(api_key=API_KEY)
kws = KiteTicker(api_key=API_KEY, access_token=ACCESS_TOKEN)

# Seed 9:15 baseline

def on_connect(ws, response):
ws.subscribe(instrument_tokens)
ws.set_mode(ws.MODE_QUOTE, instrument_tokens)

# On every tick

def on_ticks(ws, ticks):
for tick in ticks:
symbol = token_map[tick['instrument_token']]
ltp = tick['last_price']
norm_ret = (ltp / price_at_915[symbol] - 1) \* 100
tr = tick['ohlc']['high'] - tick['ohlc']['low'] # store to DuckDB, update rank, broadcast to Flask SSE

# ATR(2) per minute candle flush

def flush_minute_candles():
for symbol in universe:
candles = last_2_minute_candles[symbol]
trs = [max(c.high, p.close) - min(c.low, p.close)
for c, p in zip(candles[1:], candles)]
atr2 = sum(trs) / max(len(trs), 1)
update_atr2(symbol, atr2)

---

## FRONTEND REFRESH PATTERN (React)

useEffect(() => {
fetchAndRender(); // immediate on mount
const id = setInterval(fetchAndRender, 60_000);
return () => clearInterval(id);
}, [isOpen]);

async function fetchAndRender() {
const data = await fetch('/api/returns').then(r => r.json());
updateBarRace(data);
updateScatter(data);
updateNormChart(data);
updateMiniGrid(data);
}
