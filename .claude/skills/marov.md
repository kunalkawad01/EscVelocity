---
description: >
  Use when building or extending the MarketDNA page: regime classifier,
  Markov transition matrix, options strategy recommender, Kite Connect
  data integration, or any combination of these for NSE F&O instruments.
---

# MarketDNA — spec & build reference

## 1. Pipeline overview

```
Kite historical API (monthly candles, 3–5 yr)
  └─► compute_indicators()   ADX·DI±, RSI, SMA20/50/200, monthly_return%
        └─► classify_series()   each month → U / S / D
              └─► build_matrix()   3×3 empirical Markov matrix + Bayesian blend
                    └─► forecast()   n-step probability vector
                          └─► strategy_map[]   best/avoid/confirm per regime
```

Live current-state: Kite quote API → LTP vs cached SMAs → classify_row().
Historical matrix: Kite `interval="month"`, 3–5 years per instrument.

---

## 4. Indicators

```python
# services/indicators.py
import pandas as pd, pandas_ta as ta

def compute(df: pd.DataFrame, thr=None) -> pd.DataFrame:
    """
    Input:  df with open/high/low/close/volume columns
    Output: df + adx, dmp, dmn, rsi, sma20/50/200,
              monthly_return_pct, sma20/50/200_pct, sma_bull_score
    Uses pandas rolling(min_periods=5) for SMAs so short histories work.
    """
    mp = 5
    df = df.copy(); df.columns = [c.lower() for c in df.columns]
    df["sma20"]  = df["close"].rolling(20,  min_periods=mp).mean()
    df["sma50"]  = df["close"].rolling(50,  min_periods=mp).mean()
    df["sma200"] = df["close"].rolling(200, min_periods=mp).mean()
    df["rsi"]    = ta.rsi(df["close"], length=14)

    adx = ta.adx(df["high"], df["low"], df["close"], length=14)
    df["adx"] = adx["ADX_14"]; df["dmp"] = adx["DMP_14"]; df["dmn"] = adx["DMN_14"]

    df["monthly_return_pct"] = df["close"].pct_change() * 100
    for col, base in [("sma20", "sma20"), ("sma50", "sma50"), ("sma200", "sma200")]:
        df[f"{col}_pct"] = (df["close"] - df[base]) / df[base] * 100

    # SMA bull score 0–5: price>SMA20, >SMA50, >SMA200, SMA20>SMA50, SMA50>SMA200
    checks = ["close>sma20","close>sma50","close>sma200","sma20>sma50","sma50>sma200"]
    def _safe(a, b): return (a.notna() & b.notna()) & (a > b)
    df["sma_bull_score"] = (
        _safe(df["close"],df["sma20"]).astype(int) +
        _safe(df["close"],df["sma50"]).astype(int) +
        _safe(df["close"],df["sma200"]).astype(int) +
        _safe(df["sma20"], df["sma50"]).astype(int) +
        _safe(df["sma50"], df["sma200"]).astype(int)
    )
    return df
```

---

## 5. Classifier — 6-rule decision tree

Rules fire in priority order. First match wins.

```python
# services/classifier.py
from config import THR
REGIME = {0:"Uptrend", 1:"Sideways", 2:"Downtrend"}
LABEL  = {0:"U", 1:"S", 2:"D"}

def classify_row(row, return_reason=False):
    """
    row: pandas Series with indicator columns from compute()
    Returns: int (0/1/2)  or  (int, rule_str) if return_reason=True
    """
    for col in ["adx","rsi","sma50_pct","monthly_return_pct","sma_bull_score"]:
        if row.get(col) is None or (isinstance(row[col], float) and row[col] != row[col]):
            return (1,"insufficient_data") if return_reason else 1

    t  = THR
    sc = int(row["sma_bull_score"])
    tr = row["adx"] >= t["adx_trend"];  wk = row["adx"] < t["adx_range"]
    db = row["dmp"] > row["dmn"];       dn = row["dmn"] > row["dmp"]
    rb = row["rsi"] >= t["rsi_bull"];   rn = row["rsi"] <= t["rsi_bear"]
    sb = sc >= t["sma_min"];            sn = (5-sc) >= t["sma_min"]
    xb = row["monthly_return_pct"] >= t["ret_bull"]
    xn = row["monthly_return_pct"] <= -t["ret_bull"]
    buf= t["rsi_buf"]

    # Rule 1 — strong uptrend: all 5 signals aligned bull
    if tr and db and rb and sb and xb:                        r,rule = 0,"strong_uptrend"
    # Rule 2 — strong downtrend: all 5 signals aligned bear
    elif tr and dn and rn and sn and xn:                      r,rule = 2,"strong_downtrend"
    # Rule 3 — weak ADX: no trend regardless of price
    elif wk:                                                   r,rule = 1,"weak_adx"
    # Rule 4 — soft uptrend: partial bull alignment (ADX 20–25 zone)
    elif sb and row["sma50_pct"]>=t["sma50_bull"] and row["rsi"]>=t["rsi_bull"]-buf and xb:
                                                               r,rule = 0,"soft_uptrend"
    # Rule 5 — soft downtrend
    elif sn and row["sma50_pct"]<=-t["sma50_bull"] and row["rsi"]<=t["rsi_bear"]+buf and xn:
                                                               r,rule = 2,"soft_downtrend"
    # Rule 6 — default
    else:                                                      r,rule = 1,"default_sideways"

    return (r, rule) if return_reason else r

def classify_series(df) -> pd.DataFrame:
    df = df.copy()
    results = [classify_row(row, return_reason=True) for _, row in df.iterrows()]
    df["regime"]       = [r for r,_ in results]
    df["regime_label"] = [LABEL[r] for r,_ in results]
    df["regime_name"]  = [REGIME[r] for r,_ in results]
    df["rule"]         = [rule for _,rule in results]
    return df
```

**Example output for 3 months:**

```
date     close   adx    rsi   sma50_pct  ret%   sma_sc  regime_name   rule
2023-06  19189   31.2   63.4   +8.1      +3.5    4      Uptrend       strong_uptrend
2023-10  19046   18.7   47.2   +2.1      -0.3    3      Sideways      weak_adx
2022-06  15780   28.9   38.1   -6.4      -4.8    1      Downtrend     strong_downtrend
```

---

## 6. Markov engine

```python
# services/markov.py
import numpy as np
from config import PRIOR, ALPHA

def build_matrix(regimes: list[int]) -> dict:
    """
    Builds 3×3 transition matrix with Bayesian smoothing.
    Example: regimes = [0,0,1,0,2,2,1] → counts then normalize.
    Returns {"matrix": [[...],[...],[...]], "counts": [[...]], "n_obs": int}
    """
    counts = [[0,0,0],[0,0,0],[0,0,0]]
    for i in range(len(regimes)-1):
        counts[regimes[i]][regimes[i+1]] += 1
    matrix = []
    for i, row in enumerate(counts):
        tot = sum(row)
        blended = [(c/tot if tot else PRIOR[j])*(1-ALPHA)+PRIOR[j]*ALPHA
                   for j,c in enumerate(row)]
        s = sum(blended)
        matrix.append([v/s for v in blended])
    return {"matrix": matrix, "counts": counts, "n_obs": sum(sum(r) for r in counts)}

def mat_pow(M, n):
    R = np.eye(3); B = np.array(M)
    while n > 0:
        if n & 1: R = R @ B
        B = B @ B; n >>= 1
    return R.tolist()

def forecast(matrix, current_state, months=1) -> list:
    """Returns [p_up, p_sw, p_dn] for months steps from current_state."""
    return mat_pow(matrix, months)[current_state]

def top_paths(matrix, start, steps=3) -> list:
    """Top 6 regime sequences by probability. Each: {path:[0,1,0], prob:0.31}"""
    paths = []
    def dfs(s, path, p):
        if len(path)==steps+1: paths.append({"path":path,"prob":p}); return
        for j in range(3): dfs(j, path+[j], p*matrix[s][j])
    dfs(start, [start], 1.0)
    return sorted(paths, key=lambda x: -x["prob"])[:6]
```

**Example matrix output for Nifty (Uptrend-heavy history):**

```
         → U     → S     → D
From U:  62%     28%     10%
From S:  38%     47%     15%
From D:  22%     41%     37%
```

From Uptrend, next-month forecast = [62%, 28%, 10%].

---

## 7. Strategy map

```python
# services/strategy.py
STRATS = {
    0: {  # Uptrend
        "best":  ["Bull call spread","Sell OTM put","Call ratio backspread","Buy ATM call"],
        "avoid": ["Naked short call","Bear put spread","Short straddle"],
        "conf":  ["PCR 0.7–1.0","India VIX < 16","FII net buyers","OI: put writing at support"],
        "tail":  {1:"ADX < 20 exit signal. Reduce directional exposure.",
                  2:"Reversal risk. Add OTM put hedge."}
    },
    1: {  # Sideways
        "best":  ["Short straddle / strangle","Iron condor","Iron butterfly","Calendar spread"],
        "avoid": ["Naked long call/put","Long straddle","Directional debit spreads"],
        "conf":  ["PCR 0.9–1.2","VIX stable 12–16","IV rank > 40","Max pain near spot"],
        "tail":  {0:"Upside breakout possible. Widen condor wings.",
                  2:"Breakdown risk. Tighten short side of condor."}
    },
    2: {  # Downtrend
        "best":  ["Bear put spread","Sell OTM call spread","Put ratio backspread","Buy ATM put"],
        "avoid": ["Sell puts (falling knife)","Bull call spread","Short straddle"],
        "conf":  ["PCR < 0.7","India VIX > 18 rising","FII net sellers","OI: call writing"],
        "tail":  {0:"Sharp reversal possible. Use spread, not naked put.",
                  1:"Sideways consolidation likely. Reduce lot size."}
    }
}

def get_strategy(dominant: int, forecast_vec: list) -> dict:
    s = dict(STRATS[dominant])
    second_state = sorted(enumerate(forecast_vec), key=lambda x:-x[1])[1]
    s["tail_risk"] = None
    if second_state[1] > 0.25 and second_state[0] in s["tail"]:
        s["tail_risk"] = {"state": second_state[0],
                          "prob": round(second_state[1]*100),
                          "note": s["tail"][second_state[0]]}
    return s
```

---

## 8. API routes

### GET /api/regime

```python
# routes/regime.py  (full pipeline endpoint)
@bp.route("/api/regime")
def regime():
    symbol  = request.args.get("symbol", "NIFTY 50")
    years   = int(request.args.get("years", 4))
    months  = int(request.args.get("months", 1))
    token   = FNO_UNIVERSE.get(symbol)
    if not token: return jsonify({"error": f"Unknown: {symbol}"}), 400

    df      = get_monthly_ohlcv(token, years=years)   # data_service
    df      = compute(df)                              # indicators
    df      = classify_series(df)                     # classifier
    regimes = df["regime"].tolist()

    result  = build_matrix(regimes)
    fcast   = forecast(result["matrix"], regimes[-1], months)
    dom     = int(np.argmax(fcast))
    strat   = get_strategy(dom, fcast)

    return jsonify({
        "symbol": symbol,
        "timeline": df[["date","regime","regime_label","regime_name","rule"]].to_dict("records"),
        "current_state": regimes[-1],
        "matrix": result["matrix"], "counts": result["counts"], "n_obs": result["n_obs"],
        "forecast": fcast, "dominant": dom,
        "top_paths": top_paths(result["matrix"], regimes[-1], steps=min(months+1,4)),
        "strategy": strat
    })
```

### GET /api/stream/live (SSE)

```python
@bp.route("/api/stream/live")
def live():
    symbol = request.args.get("symbol","NIFTY 50")
    token  = FNO_UNIVERSE.get(symbol)
    def generate():
        while True:
            q = kite.quote([token])[str(token)]
            yield f"data: {json.dumps({'ltp':q['last_price'],'ts':int(time.time())})}\n\n"
            time.sleep(30)
    return Response(generate(), mimetype="text/event-stream",
                    headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
```

---

## 9. React — key hooks

```js
// hooks/useRegimeData.js
export function useRegimeData(symbol, years = 4, months = 1) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (!symbol) return;
    setLoading(true);
    fetch(
      `http://localhost:5050/api/regime?symbol=${encodeURIComponent(symbol)}&years=${years}&months=${months}`,
    )
      .then((r) => r.json())
      .then(setData)
      .finally(() => setLoading(false));
  }, [symbol, years, months]);
  return { data, loading };
}

// hooks/useLiveState.js
export function useLiveState(symbol) {
  const [live, setLive] = useState(null);
  useEffect(() => {
    if (!symbol) return;
    const es = new EventSource(
      `http://localhost:5050/api/stream/live?symbol=${encodeURIComponent(symbol)}`,
    );
    es.onmessage = (e) => {
      try {
        setLive(JSON.parse(e.data));
      } catch {}
    };
    return () => es.close();
  }, [symbol]);
  return live;
}
```

---

## 10. Colour constants (single source of truth)

```js
// utils/regimeColors.js
export const REGIME = {
  0: {
    label: "U",
    name: "Uptrend",
    bg: "#E1F5EE",
    text: "#085041",
    dot: "#1D9E75",
  },
  1: {
    label: "S",
    name: "Sideways",
    bg: "#F1EFE8",
    text: "#444441",
    dot: "#888780",
  },
  2: {
    label: "D",
    name: "Downtrend",
    bg: "#FAECE7",
    text: "#712B13",
    dot: "#D85A30",
  },
};
```

Always import from here — never hardcode colours in components.

---
