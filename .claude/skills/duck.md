---
name: druckenmiller-roc
description: >
  Use this skill when the user asks to "implement Druckenmiller ROC", "add rate of change
  framework", "second derivative ROC", "ROC² signal", "momentum acceleration", "early cycle
  detection", "add ROC to my app", "Druckenmiller chart system", or any request to detect
  momentum inflection points before fundamentals confirm using Stan Druckenmiller's second
  derivative rate-of-change framework on OHLCV data.
metadata:
  version: "1.0.0"
  stack: "DuckDB · pandas · numpy · Flask · Highcharts/Highstock"
  data: "6Y daily OHLCV (date, open, high, low, close, volume)"
  theme: "dark background #0a0a0f · gold accent #ffd700"
---

# MarketDNA: Druckenmiller Rate-of-Change (ROC²) Framework

Implement Stan Druckenmiller's **Second Derivative ROC** system — detect momentum inflection
points 6–18 months before fundamentals confirm.

> _"Because it used second derivative rate of change, these things will often bottom a year
> to a year and a half before the fundamentals."_ — Stan Druckenmiller

---

## Concept in One Paragraph

**ROC (first derivative)** = how much price has changed (momentum level).
**ROC² (second derivative)** = how fast ROC itself is changing (momentum acceleration).
The critical signal: when **price is still falling** but **ROC² turns positive** — deceleration
of decline — that is the early bottom Druckenmiller's system was designed to catch.

---

## Step 1 — DuckDB Schema

Ensure the `ohlcv` table exists. If the user's data is in CSV, load it first.

```python
# load_data.py — run once to set up DuckDB from CSV
import duckdb, pandas as pd

con = duckdb.connect("market.db")
con.execute("""
    CREATE TABLE IF NOT EXISTS ohlcv (
        date    DATE,
        symbol  VARCHAR,
        open    DOUBLE,
        high    DOUBLE,
        low     DOUBLE,
        close   DOUBLE,
        volume  BIGINT,
        PRIMARY KEY (date, symbol)
    )
""")

# If loading from CSV:
# df = pd.read_csv("RELIANCE_6Y.csv", parse_dates=["date"])
# df["symbol"] = "RELIANCE"
# con.execute("INSERT OR REPLACE INTO ohlcv SELECT * FROM df")

# Create signal storage table
con.execute("""
    CREATE TABLE IF NOT EXISTS roc2_signals (
        date      DATE,
        symbol    VARCHAR,
        timeframe VARCHAR,
        roc       DOUBLE,
        roc2      DOUBLE,
        phase     VARCHAR,
        lead      BOOLEAN,
        score     INTEGER,
        composite DOUBLE,
        PRIMARY KEY (date, symbol, timeframe)
    )
""")
con.close()
print("Schema ready.")
```

---

## Step 2 — Core Engine

Create `roc_engine.py` in the project root (same level as `app.py`).

```python
# roc_engine.py
"""
Druckenmiller Second Derivative ROC Engine
Timeframes:
  Macro:        ROC(252d), ROC²(63d)   — major cycle, Druckenmiller's primary signal
  Intermediate: ROC(63d),  ROC²(21d)   — swing trade setup
  Short:        ROC(21d),  ROC²(5d)    — tactical entry
"""
import duckdb
import pandas as pd
import numpy as np

# ── Config ────────────────────────────────────────────────────────────────────
TIMEFRAMES = {
    "macro":        {"roc_n": 252, "roc2_m": 63,  "label": "Macro (1Y|1Q)",       "weight": 3},
    "intermediate": {"roc_n": 63,  "roc2_m": 21,  "label": "Intermediate (1Q|1M)", "weight": 2},
    "short":        {"roc_n": 21,  "roc2_m": 5,   "label": "Short (1M|1W)",        "weight": 1},
}

PHASE_SCORES = {
    "early_bottom":      +2,   # ★ Price falling, ROC² rising — Druckenmiller lead signal
    "bottom_inflection": +2,   # ★ ROC² just crossed zero up while price weak
    "bottom_confirmed":  +1,
    "strong_uptrend":    +1,
    "neutral":            0,
    "early_top":         -2,   # ★ Price rising, ROC² falling — early distribution
    "top_inflection":    -2,   # ★ ROC² just crossed zero down while price strong
    "top_confirmed":     -1,
    "strong_downtrend":  -1,
}

PHASE_COLORS = {
    "early_bottom":      "#00ff88",
    "bottom_inflection": "#66ffaa",
    "bottom_confirmed":  "#44cc66",
    "strong_uptrend":    "#22aa44",
    "neutral":           "#888888",
    "early_top":         "#ff4444",
    "top_inflection":    "#ff8888",
    "top_confirmed":     "#cc3333",
    "strong_downtrend":  "#aa2222",
}

# ── Math ──────────────────────────────────────────────────────────────────────
def compute_roc(series: pd.Series, n: int) -> pd.Series:
    """ROC(n) = (P_t − P_{t-n}) / P_{t-n} × 100"""
    return (series - series.shift(n)) / series.shift(n) * 100

def compute_roc2(roc: pd.Series, m: int) -> pd.Series:
    """ROC²(m) = ROC_t − ROC_{t-m}  ← Druckenmiller's signal"""
    return roc - roc.shift(m)

def classify_phase(roc: float, roc2: float, roc2_prev: float) -> tuple[str, bool]:
    """
    Returns (phase, is_lead_signal).
    Lead signal = price direction and ROC² direction diverging.
    """
    crossed_up   = (roc2 > 0) and (roc2_prev <= 0)
    crossed_down = (roc2 < 0) and (roc2_prev >= 0)

    if roc < 0 and roc2 > 0:        return "early_bottom",      True   # THE signal
    if roc < 0 and crossed_up:      return "bottom_inflection",  True
    if 0 <= roc < 5 and roc2 > 0:   return "bottom_confirmed",   False
    if roc >= 5 and roc2 > 0:       return "strong_uptrend",     False
    if roc > 0 and roc2 < 0:        return "early_top",          True   # Early distribution
    if roc > 0 and crossed_down:    return "top_inflection",     True
    if -5 < roc <= 0 and roc2 < 0:  return "top_confirmed",      False
    if roc <= -5 and roc2 < 0:      return "strong_downtrend",   False
    return "neutral", False

# ── Data ──────────────────────────────────────────────────────────────────────
def load_ohlcv(db_path: str, symbol: str) -> pd.DataFrame:
    con = duckdb.connect(db_path, read_only=True)
    df  = con.execute(
        f"SELECT date, close, volume FROM ohlcv WHERE symbol='{symbol}' ORDER BY date"
    ).df()
    con.close()
    if df.empty:
        raise ValueError(f"No data for {symbol}")
    df["date"] = pd.to_datetime(df["date"])
    return df.set_index("date")

# ── Analysis ──────────────────────────────────────────────────────────────────
def analyze(symbol: str, db_path: str) -> dict:
    """
    Full ROC² analysis. Returns dict ready for jsonify() in Flask.
    """
    df = load_ohlcv(db_path, symbol)
    if len(df) < 330:
        raise ValueError(f"Need 330+ rows, got {len(df)}")

    result   = {"symbol": symbol, "timeframes": {}}
    scores   = []
    weights  = []

    for tf, cfg in TIMEFRAMES.items():
        n, m      = cfg["roc_n"], cfg["roc2_m"]
        roc_s     = compute_roc(df["close"], n)
        roc2_s    = compute_roc2(roc_s, m)
        valid     = roc_s.dropna().index           # align both series

        roc_val   = float(roc_s.iloc[-1])
        roc2_val  = float(roc2_s.iloc[-1])
        roc2_prev = float(roc2_s.iloc[-2]) if len(roc2_s) > 1 else 0.0

        phase, lead = classify_phase(roc_val, roc2_val, roc2_prev)
        score = PHASE_SCORES.get(phase, 0)
        scores.append(score)
        weights.append(cfg["weight"])

        # Last 5 zero crossings (for chart annotations)
        r2 = roc2_s.iloc[-252:]
        cx_up   = [r2.index[i].strftime("%Y-%m-%d")
                   for i in range(1, len(r2)) if r2.iloc[i-1] <= 0 < r2.iloc[i]][-5:]
        cx_down = [r2.index[i].strftime("%Y-%m-%d")
                   for i in range(1, len(r2)) if r2.iloc[i-1] >= 0 > r2.iloc[i]][-5:]

        result["timeframes"][tf] = {
            "label":       cfg["label"],
            "roc":         round(roc_val, 3),
            "roc2":        round(roc2_val, 3),
            "phase":       phase,
            "color":       PHASE_COLORS[phase],
            "lead_signal": lead,
            "score":       score,
            "crosses_up":  cx_up,
            "crosses_down":cx_down,
            "series": {
                "dates":  roc_s.dropna().index.strftime("%Y-%m-%d").tolist(),
                "close":  df["close"].reindex(valid).round(2).tolist(),
                "roc":    roc_s.dropna().round(3).tolist(),
                "roc2":   roc2_s.reindex(valid).round(3).tolist(),
                "volume": df["volume"].reindex(valid).tolist(),
            },
        }

    composite = round(float(np.average(scores, weights=weights)), 3)
    result["composite"] = {
        "score":        composite,
        "bias":         _bias(composite),
        "as_of":        df.index[-1].strftime("%Y-%m-%d"),
        "lead_count":   sum(1 for v in result["timeframes"].values() if v["lead_signal"]),
    }
    return result

def _bias(score: float) -> str:
    if score >= 1.5:  return "STRONG BULL — Early Accumulation"
    if score >= 0.5:  return "MILD BULL"
    if score >= -0.5: return "NEUTRAL"
    if score >= -1.5: return "MILD BEAR"
    return "STRONG BEAR — Early Distribution"

# ── Scanner ───────────────────────────────────────────────────────────────────
def scan(symbols: list[str], db_path: str) -> pd.DataFrame:
    """Rank a universe of symbols by composite ROC² score."""
    rows = []
    for sym in symbols:
        try:
            r = analyze(sym, db_path)
            c = r["composite"]
            rows.append({
                "symbol":     sym,
                "score":      c["score"],
                "bias":       c["bias"],
                "lead":       c["lead_count"],
                "macro_phase":r["timeframes"]["macro"]["phase"],
                "macro_roc":  r["timeframes"]["macro"]["roc"],
                "macro_roc2": r["timeframes"]["macro"]["roc2"],
            })
        except Exception as e:
            rows.append({"symbol": sym, "score": None, "error": str(e)})
    df = pd.DataFrame(rows).dropna(subset=["score"])
    return df.sort_values("score", ascending=False).reset_index(drop=True)

# ── DuckDB persistence ────────────────────────────────────────────────────────
def save_signals(result: dict, db_path: str):
    con  = duckdb.connect(db_path)
    sym  = result["symbol"]
    date = result["composite"]["as_of"]
    comp = result["composite"]["score"]
    for tf, d in result["timeframes"].items():
        con.execute("""
            INSERT OR REPLACE INTO roc2_signals
            VALUES (?,?,?,?,?,?,?,?,?)
        """, [date, sym, tf, d["roc"], d["roc2"], d["phase"], d["lead_signal"], d["score"], comp])
    con.close()
```

---

## Step 3 — Flask Routes

Add these two routes to `app.py` (or the relevant Blueprint file).

```python
# In app.py (add after existing imports)
from roc_engine import analyze, scan

DB_PATH = "market.db"   # adjust to your actual path

@app.route("/api/roc/<symbol>")
def roc_analyze(symbol):
    try:
        result = analyze(symbol.upper(), DB_PATH)
        return jsonify({"status": "ok", "data": result})
    except Exception as e:
        return jsonify({"status": "error", "message": str(e)}), 400

@app.route("/api/roc/scan", methods=["POST"])
def roc_scan():
    symbols = request.json.get("symbols", [])
    df      = scan(symbols, DB_PATH)
    return jsonify(df.to_dict(orient="records"))
```

**Test the endpoints:**

```bash
# Single symbol
curl http://localhost:5000/api/roc/RELIANCE

# Universe scan
curl -X POST http://localhost:5000/api/roc/scan \
  -H "Content-Type: application/json" \
  -d '{"symbols": ["RELIANCE","TCS","HDFCBANK","INFY","ICICIBANK"]}'
```

---

## Step 4 — Highcharts Frontend

Add this to your frontend JS. Call `buildROCChart(data, 'container-id')` with the
API response from `/api/roc/<symbol>`.

```javascript
// roc_chart.js
const C = {
  bg: "#0a0a0f",
  panel: "#0f0f1a",
  grid: "#1a1a2e",
  text: "#c0c0c0",
  gold: "#ffd700",
  macro: "#ffd700",
  inter: "#00bfff",
  short: "#ff6b35",
  green: "#00ff88",
  red: "#ff4444",
};

function buildROCChart(data, containerId) {
  const tf = data.timeframes;
  const comp = data.composite;
  const m = tf.macro;

  const toTS = (arr) => arr.map((d) => +new Date(d));
  const zip = (dates, vals) => toTS(dates).map((t, i) => [t, vals[i]]);

  // Bias color
  const biasColor =
    comp.score >= 0.5 ? C.green : comp.score <= -0.5 ? C.red : C.text;

  // ROC² zero-crossing vertical lines for annotation
  const crossLines = [
    ...m.crosses_up.map((d) => ({
      value: +new Date(d),
      color: C.green,
      width: 1,
      dashStyle: "ShortDash",
      label: {
        text: "ROC²↑",
        style: { color: C.green, fontSize: "9px" },
        rotation: 90,
      },
    })),
    ...m.crosses_down.map((d) => ({
      value: +new Date(d),
      color: C.red,
      width: 1,
      dashStyle: "ShortDash",
      label: {
        text: "ROC²↓",
        style: { color: C.red, fontSize: "9px" },
        rotation: 90,
      },
    })),
  ];

  Highcharts.stockChart(containerId, {
    chart: { backgroundColor: C.bg },
    rangeSelector: {
      selected: 3,
      buttons: [
        { type: "month", count: 3, text: "3M" },
        { type: "month", count: 6, text: "6M" },
        { type: "year", count: 1, text: "1Y" },
        { type: "year", count: 2, text: "2Y" },
        { type: "all", text: "All" },
      ],
      buttonTheme: {
        fill: C.grid,
        stroke: C.gold,
        style: { color: C.text },
        states: {
          hover: { fill: C.gold, style: { color: "#000" } },
          select: { fill: C.gold, style: { color: "#000" } },
        },
      },
      inputStyle: { color: C.text, background: C.panel },
      labelStyle: { color: C.text },
    },
    title: {
      text: `${data.symbol} — Druckenmiller ROC²`,
      style: { color: C.gold, fontSize: "15px" },
    },
    subtitle: {
      useHTML: true,
      text: `Score: <b style="color:${biasColor}">${comp.score.toFixed(2)} — ${comp.bias}</b>
             &nbsp;|&nbsp; Lead Signals: ${comp.lead_count}/3
             &nbsp;|&nbsp; As of: ${comp.as_of}`,
      style: { color: C.text },
    },
    tooltip: {
      shared: true,
      backgroundColor: "rgba(15,15,26,0.95)",
      borderColor: C.gold,
      style: { color: C.text },
    },
    legend: { enabled: true, itemStyle: { color: C.text } },
    xAxis: {
      gridLineColor: C.grid,
      lineColor: C.grid,
      tickColor: C.grid,
      labels: { style: { color: C.text } },
      crosshair: { color: "rgba(255,215,0,0.3)", dashStyle: "Dot" },
    },
    yAxis: [
      // Panel 1: Price (60%)
      {
        height: "60%",
        gridLineColor: C.grid,
        labels: { align: "left", style: { color: C.text } },
        title: { text: "Price", style: { color: C.text } },
      },
      // Panel 2: ROC (20%)
      {
        top: "62%",
        height: "18%",
        offset: 0,
        gridLineColor: C.grid,
        labels: { align: "left", style: { color: C.text } },
        title: { text: "ROC %", style: { color: C.text } },
        plotLines: [{ value: 0, color: C.text, width: 1, dashStyle: "Dot" }],
      },
      // Panel 3: ROC² — Druckenmiller Signal (20%)
      {
        top: "82%",
        height: "18%",
        offset: 0,
        gridLineColor: C.grid,
        labels: { align: "left", style: { color: C.gold } },
        title: { text: "ROC² ★", style: { color: C.gold, fontWeight: "700" } },
        plotLines: [
          {
            value: 0,
            color: C.gold,
            width: 2,
            label: {
              text: "Zero",
              align: "right",
              style: { color: C.gold, fontSize: "10px" },
            },
          },
          ...crossLines,
        ],
      },
    ],
    series: [
      // Price
      {
        name: `${data.symbol}`,
        data: zip(m.series.dates, m.series.close),
        color: C.gold,
        lineWidth: 1.5,
        yAxis: 0,
        marker: { enabled: false },
        tooltip: { valueDecimals: 2 },
      },
      // ROC lines (Panel 2)
      {
        name: "ROC Macro (252d)",
        yAxis: 1,
        color: C.macro,
        lineWidth: 2,
        data: zip(m.series.dates, m.series.roc),
        marker: { enabled: false },
        tooltip: { valueSuffix: "%", valueDecimals: 2 },
      },
      {
        name: "ROC Inter (63d)",
        yAxis: 1,
        color: C.inter,
        lineWidth: 1.5,
        data: zip(tf.intermediate.series.dates, tf.intermediate.series.roc),
        marker: { enabled: false },
        tooltip: { valueSuffix: "%", valueDecimals: 2 },
      },
      {
        name: "ROC Short (21d)",
        yAxis: 1,
        color: C.short,
        lineWidth: 1,
        data: zip(tf.short.series.dates, tf.short.series.roc),
        marker: { enabled: false },
        tooltip: { valueSuffix: "%", valueDecimals: 2 },
      },
      // ROC² lines (Panel 3) — the Druckenmiller signal
      {
        name: "ROC² Macro ★",
        yAxis: 2,
        color: C.macro,
        lineWidth: 2.5,
        data: zip(m.series.dates, m.series.roc2),
        marker: { enabled: false },
        tooltip: { valueDecimals: 3 },
        // Green above zero, red below zero
        zones: [{ value: 0, color: C.red }, { color: C.green }],
        zoneAxis: "y",
      },
      {
        name: "ROC² Inter",
        yAxis: 2,
        color: C.inter,
        lineWidth: 1.5,
        data: zip(tf.intermediate.series.dates, tf.intermediate.series.roc2),
        marker: { enabled: false },
        tooltip: { valueDecimals: 3 },
      },
      {
        name: "ROC² Short",
        yAxis: 2,
        color: C.short,
        lineWidth: 1,
        data: zip(tf.short.series.dates, tf.short.series.roc2),
        marker: { enabled: false },
        tooltip: { valueDecimals: 3 },
      },
    ],
    credits: { enabled: false },
  });
}
```

---

## Step 5 — Stock Intelligence Card Badge

Drop this into your existing SIC component to show the ROC² signal inline.

```javascript
// Inject into your SIC render function
function renderROC2Badge(data) {
  const { composite, timeframes } = data;
  const biasColor =
    composite.score >= 0.5
      ? "#00ff88"
      : composite.score <= -0.5
        ? "#ff4444"
        : "#888";

  const rows = Object.values(timeframes)
    .map(
      (tf) => `
    <tr style="border-bottom:1px solid #1a1a2e">
      <td style="padding:4px 8px;color:#888;font-size:11px">${tf.label}</td>
      <td style="padding:4px 8px;color:${tf.roc >= 0 ? "#00ff88" : "#ff4444"};text-align:right;font-size:11px">
        ${tf.roc >= 0 ? "+" : ""}${tf.roc.toFixed(1)}%
      </td>
      <td style="padding:4px 8px;color:${tf.roc2 >= 0 ? "#00ff88" : "#ff4444"};text-align:right;font-size:11px">
        ${tf.roc2 >= 0 ? "+" : ""}${tf.roc2.toFixed(3)}
      </td>
      <td style="padding:4px 8px;font-size:10px;color:${tf.lead_signal ? "#ffd700" : "#888"}">
        ${tf.lead_signal ? "★ LEAD" : tf.phase.replace(/_/g, " ")}
      </td>
    </tr>
  `,
    )
    .join("");

  return `
    <div style="background:#0f0f1a;border:1px solid #1a1a2e;border-radius:6px;padding:12px;margin-top:8px">
      <div style="color:#ffd700;font-size:11px;font-weight:700;letter-spacing:1px;margin-bottom:6px">
        ROC² · DRUCKENMILLER
      </div>
      <div style="color:${biasColor};font-size:17px;font-weight:700;margin-bottom:8px">
        ${composite.score.toFixed(2)} — ${composite.bias}
      </div>
      <table style="width:100%;border-collapse:collapse">
        <thead>
          <tr style="font-size:10px;color:#444">
            <th style="text-align:left;padding:2px 8px">TF</th>
            <th style="text-align:right;padding:2px 8px">ROC</th>
            <th style="text-align:right;padding:2px 8px">ROC²</th>
            <th style="text-align:center;padding:2px 8px">Signal</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      ${
        composite.lead_count > 0
          ? `
        <div style="margin-top:8px;padding:5px 8px;background:rgba(255,215,0,0.06);
                    border-radius:3px;color:#ffd700;font-size:11px">
          ★ ${composite.lead_count} Lead Signal — Price & ROC² diverging
        </div>`
          : ""
      }
    </div>
  `;
}
```

**Wire it up in React (if using JSX):**

```jsx
// In your StockIntelligenceCard component
const [rocData, setRocData] = useState(null);

useEffect(() => {
  fetch(`/api/roc/${symbol}`)
    .then((r) => r.json())
    .then((json) => setRocData(json.data));
}, [symbol]);

// In JSX:
{
  rocData && (
    <div dangerouslySetInnerHTML={{ __html: renderROC2Badge(rocData) }} />
  );
}
```

---

## Step 6 — Signal Priority Matrix Integration

Add ROC² scores into your existing Signal Priority Matrix weights table:

| Signal                           | Weight       | Trigger Condition        |
| -------------------------------- | ------------ | ------------------------ |
| ROC² Macro Lead (`early_bottom`) | **+3**       | Price < 0, ROC² > 0      |
| ROC² Macro Lead (`early_top`)    | **−3**       | Price > 0, ROC² < 0      |
| ROC² Intermediate confirmation   | **+2 / −2**  | Same logic, 63d window   |
| ROC² Zero Cross (macro)          | **+1 / −1**  | Crossing event this week |
| All 3 timeframes aligned         | **+1 bonus** | `lead_count == 3`        |

```python
# In your existing signal aggregator:
from roc_engine import analyze

def get_roc2_signal_weight(symbol: str, db_path: str) -> int:
    try:
        r    = analyze(symbol, db_path)
        comp = r["composite"]
        # Map composite score (−2 to +2) to signal weight (−6 to +6)
        weight = round(comp["score"] * 3)
        if comp["lead_count"] == 3:
            weight += (1 if weight > 0 else -1)   # bonus for full confluence
        return weight
    except:
        return 0
```

---

## Reading the Signal — Cheat Sheet

| Macro ROC | Macro ROC²    | Phase               | Action                                             |
| --------- | ------------- | ------------------- | -------------------------------------------------- |
| Negative  | **Positive**  | `early_bottom` ★    | **Buy / Accumulate** — Druckenmiller's lead signal |
| Negative  | Crossing up   | `bottom_inflection` | Start scaling in                                   |
| Positive  | Positive      | `bottom_confirmed`  | Add to position                                    |
| Positive  | Positive      | `strong_uptrend`    | Hold / trail SL                                    |
| Positive  | **Negative**  | `early_top` ★       | **Reduce / Hedge** — early distribution            |
| Positive  | Crossing down | `top_inflection`    | Start trimming                                     |
| Negative  | Negative      | `strong_downtrend`  | Stay out / short                                   |

**Highest conviction setup:** `early_bottom` on macro + `bottom_inflection` on intermediate
= price still weak, but both timeframes accelerating up. This typically leads fundamental
recovery by 6–18 months as Druckenmiller described.

## Common Pitfalls

1. **Don't trade ROC² in isolation** — use as a regime filter, not a standalone entry signal.
2. **Whipsaws in sideways markets** — ROC² crosses zero frequently when price is flat; require
   macro ROC magnitude > 5% before acting on a cross.
3. **Volume confirmation** — apply `compute_roc(volume, 63)` to check if volume ROC is also
   recovering. Bottoms with improving volume ROC² are more reliable.
4. **Minimum data** — need 330 trading days minimum (252 ROC + 63 ROC² warmup + buffer).
   With 6Y data you have ~1500 days — more than enough.

## References

See `references/druckenmiller-roc.md` for:

- Original Druckenmiller quote source and interview context
- Academic papers on momentum second derivatives
- Integration notes for the 9-layer MarketDNA algo pipeline
