"""
Daily F&O Returns Report generator.

Produces one PDF per run: one page per F&O underlying symbol (marketdna-data/FO.csv),
each with 6 charts (Yesterday / Today / 5-Day live intraday, Monthly / Quarterly /
Yearly EOD), each annotated with Open/High/Low/LTP and its own return vs. the
prior trading day's close (gap-inclusive) — plus daily returns for the last 5
sessions, period high/low (5D/20D/60D/360D), and, at the bottom of that same
symbol's page: a News line (only for symbols covered by the movers research
pass) and a Links line (official NSE filings, Screener.in investor-presentations/
concalls, a scoped brokerage-research search link) for every symbol.

Modes
-----
1. Movers only (fast, no backend needed — pure DuckDB over local EOD parquet):
     python generate_fno_pdf_report.py --movers-only
   Writes reports/today_movers.csv (every symbol's gap-inclusive 1D return,
   sorted) so a caller can pick today's top gainers/losers before paying the
   cost of the full report.

2. Full report (needs the backend running on :8000 for live Today/Yesterday/
   5-Day intraday data via Kite):
     python generate_fno_pdf_report.py [--movers-json path/to/findings.json]
   Writes reports/FNO_Returns_Report_<date>.pdf. If --movers-json is given,
   each covered symbol's own page gets a News line built from it (see
   MOVERS_JSON_SCHEMA below) in addition to the Links line every symbol
   always gets — this file does not get built by this script; a separate
   process (e.g. a scheduled Claude Code agent doing real web research)
   produces it, since finding today's actual news requires live web search,
   which this plain script cannot do on its own.

MOVERS_JSON_SCHEMA = {
  "date": "YYYY-MM-DD",
  "movers": [
    {
      "symbol": "DABUR", "pct": -2.27,
      "note": "<one-line, only for genuinely verified same-day/yesterday items>",
      "source_title": "DSIJ", "source_url": "https://...",
      "confirmed": true | false   # false => just show the move %, no fabricated note
    }, ...
  ]
}

Run (from anywhere, using the backend venv python):
  C:/Users/amitk/EscVel/marketdna-backend/.venv/Scripts/python.exe scripts/generate_fno_pdf_report.py
"""
import argparse
import json
import os
import time
import datetime as dt
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

import duckdb
import pandas as pd
import numpy as np
import requests
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.platypus import (
    SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer, Image, KeepTogether,
)

BACKEND = "http://127.0.0.1:8000"

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BACKEND_DIR = os.path.dirname(SCRIPT_DIR)          # marketdna-backend/
REPO = os.path.dirname(BACKEND_DIR)                 # EscVel/
FO_CSV = os.path.join(REPO, "marketdna-data", "FO.csv")
EQUITIES_GLOB = os.path.join(
    REPO, "marketdna-data", "data_lake", "raw", "equities", "**", "*.parquet"
).replace("\\", "/")
REPORTS_DIR = os.path.join(BACKEND_DIR, "reports")
CHART_DIR = os.path.join(REPORTS_DIR, ".cache", "charts")
MOVERS_CSV = os.path.join(REPORTS_DIR, "today_movers.csv")

GREEN = colors.HexColor("#1a9850")
RED = colors.HexColor("#d73027")
INK = colors.HexColor("#111827")
INK3 = colors.HexColor("#6b7280")
BORDER = colors.HexColor("#d1d5db")

TILE_W = 186  # mm, usable page width


# ---------------------------------------------------------------- symbols --

def load_symbols() -> list[str]:
    df = pd.read_csv(FO_CSV)
    col = "Ticker" if "Ticker" in df.columns else df.columns[-1]
    return sorted(df[col].dropna().astype(str).str.strip().unique().tolist())


# ------------------------------------------------------------- EOD prices --

def load_prices(symbols: list[str]) -> pd.DataFrame:
    con = duckdb.connect(":memory:")
    con.execute(
        f"CREATE VIEW equities_prices AS "
        f"SELECT * FROM read_parquet('{EQUITIES_GLOB}', hive_partitioning=1)"
    )
    placeholders = ",".join(f"'{s}'" for s in symbols)
    q = f"""
        SELECT symbol,
               STRFTIME('%Y-%m-%d', CAST(date AS DATE)) AS date,
               open, high, low, close
        FROM equities_prices
        WHERE symbol IN ({placeholders})
          AND CAST(date AS DATE) >= CURRENT_DATE - INTERVAL 620 DAY
        ORDER BY symbol, date
    """
    df = con.execute(q).fetchdf()
    con.close()
    return df


def pct_return(closes: np.ndarray, n: int):
    if len(closes) > n:
        base = closes[-1 - n]
        if base and base != 0:
            return float(closes[-1] / base - 1.0) * 100.0
    return None


def window_high_low(highs: np.ndarray, lows: np.ndarray, n: int):
    if len(highs) == 0:
        return None, None
    return float(np.max(highs[-n:])), float(np.min(lows[-n:]))


def last_5_daily_returns(closes: np.ndarray, dates: list[str]):
    """Each of the last 5 sessions' own day-over-day % change, oldest to newest."""
    n = len(closes)
    out = []
    for k in range(5):
        idx = n - 5 + k
        if idx >= 1:
            prev, cur = closes[idx - 1], closes[idx]
            ret = (cur / prev - 1.0) * 100.0 if prev else None
            out.append((dates[idx], ret))
        else:
            out.append((None, None))
    return out


def find_movers(symbols: list[str]) -> pd.DataFrame:
    """Fast path: today's gap-inclusive 1D return for every symbol, pure
    DuckDB over local EOD parquet — no backend/Kite call needed."""
    prices = load_prices(symbols)
    rows = []
    for symbol in symbols:
        sdf = prices[prices["symbol"] == symbol]
        if sdf.empty:
            continue
        closes = sdf["close"].to_numpy(dtype=float)
        dates = sdf["date"].tolist()
        daily5 = last_5_daily_returns(closes, dates)
        rows.append((symbol, daily5[4][1]))
    df = pd.DataFrame(rows, columns=["symbol", "ret_1d"]).dropna()
    return df.sort_values("ret_1d", ascending=False)


# --------------------------------------------------------- live intraday --

def fetch_tf(symbol: str, tf: str, session: requests.Session, retries: int = 3):
    """Fetch one (symbol, tf) of live intraday candles, retrying on failure/empty
    result -- Kite's historical API rate-limits around ~3 req/s and with 209
    symbols x 3 live timeframes per PDF run, some individual calls always get
    throttled or time out. The backend itself catches Kite exceptions and
    returns HTTP 200 with an empty candles list + an "error" field rather than
    a non-2xx status, so a transient hiccup must be detected from the payload,
    not just from raise_for_status(). Without retrying here, a single throttled
    call permanently blanks that symbol's chart tile."""
    last_err = None
    for attempt in range(retries):
        try:
            r = session.get(
                f"{BACKEND}/api/charts/history",
                params={"symbol": symbol, "tf": tf},
                timeout=20,
            )
            r.raise_for_status()
            body = r.json()
            candles = body.get("candles") or []
            if candles:
                return symbol, tf, candles
            last_err = body.get("error")
        except Exception as exc:
            last_err = str(exc)
        if attempt < retries - 1:
            time.sleep(1.5 * (attempt + 1))
    if last_err:
        print(f"  WARN {symbol} {tf}: no candles after {retries} attempts ({last_err})")
    return symbol, tf, None


def fetch_all_intraday(symbols: list[str]) -> dict:
    """{symbol: {'1d': candles, 'yesterday': candles, '5d': candles}}"""
    out = {s: {} for s in symbols}
    tasks = [(s, tf) for s in symbols for tf in ("1d", "yesterday", "5d")]
    session = requests.Session()
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = {pool.submit(fetch_tf, s, tf, session): (s, tf) for s, tf in tasks}
        done = 0
        for fut in as_completed(futures):
            symbol, tf, candles = fut.result()
            out[symbol][tf] = candles
            done += 1
            if done % 100 == 0:
                print(f"  intraday fetched {done}/{len(tasks)}")
    return out


def closes_of(candles):
    if not candles:
        return None
    return np.array([c["close"] for c in candles], dtype=float)


# -------------------------------------------------------------- charting --

def fmt_price(v):
    if v is None:
        return "N/A"
    if v >= 1000:
        return f"{v:,.0f}"
    if v >= 100:
        return f"{v:.1f}"
    return f"{v:.2f}"


def fmt_ret(v):
    if v is None:
        return "N/A"
    sign = "+" if v > 0 else ""
    return f"{sign}{v:.2f}%"


def ret_color(v):
    if v is None:
        return INK3
    if v > 0:
        return GREEN
    if v < 0:
        return RED
    return INK3


def make_chart(path: str, closes: np.ndarray, pct: float = None):
    """Annotated chart: Open top-left, High top-right, Low bottom-left, Last bold bottom-right.
    Color follows `pct` (the prior-close-based return) when given, so the chart's
    green/red matches the return label under it even on a gap day; falls back to
    the window's own first-vs-last move only if `pct` isn't available."""
    window = closes
    o, hi, lo, last = window[0], float(window.max()), float(window.min()), window[-1]
    up = (pct >= 0) if pct is not None else (last >= o)
    line_color = "#22c55e" if up else "#ef4444"

    fig, ax = plt.subplots(figsize=(2.6, 1.5), dpi=150)
    x = np.arange(len(window))
    ax.plot(x, window, color=line_color, linewidth=1.1)
    ax.fill_between(x, window, lo, color=line_color, alpha=0.12)
    pad = (hi - lo) * 0.3 if hi > lo else max(hi * 0.01, 1)
    ax.set_ylim(lo - pad * 0.14, hi + pad)
    ax.set_xlim(0, max(len(window) - 1, 1))
    ax.axis("off")

    lbl = dict(fontsize=6.6, color="#6b7280", transform=ax.transAxes)
    ax.text(0.015, 0.97, f"O {fmt_price(o)}", ha="left", va="top", **lbl)
    ax.text(0.985, 0.97, f"H {fmt_price(hi)}", ha="right", va="top", **lbl)
    ax.text(0.015, 0.03, f"L {fmt_price(lo)}", ha="left", va="bottom", **lbl)
    ax.text(
        0.985, 0.03, f"LTP {fmt_price(last)}", ha="right", va="bottom",
        fontsize=8.0, color=line_color, fontweight="bold", transform=ax.transAxes,
    )

    fig.patch.set_facecolor("white")
    ax.set_facecolor("white")
    fig.subplots_adjust(left=0.01, right=0.99, top=0.99, bottom=0.01)
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    return path


def make_blank_chart(path: str, msg: str = "N/A"):
    fig, ax = plt.subplots(figsize=(2.6, 1.5), dpi=150)
    ax.axis("off")
    ax.text(0.5, 0.5, msg, ha="center", va="center", fontsize=9,
             color="#9ca3af", transform=ax.transAxes)
    fig.patch.set_facecolor("white")
    fig.savefig(path, facecolor="white")
    plt.close(fig)
    return path


def xml_escape(s: str) -> str:
    """Symbols like M&M / GVT&D contain '&', which breaks ReportLab's
    Paragraph mini-XML parsing unless escaped first."""
    return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")


def short_date(d):
    if d is None:
        return ""
    y, m, day = d.split("-")
    return f"{day}-{['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][int(m)]}"


# ------------------------------------------------------------ research links --

def nse_filings_url(symbol: str) -> str:
    """Official NSE exchange-filings/announcements page, keyed directly by symbol."""
    return (
        "https://www.nseindia.com/companies-listing/corporate-filings-announcements"
        f"?symbol={urllib.parse.quote(symbol)}"
    )


def screener_url(symbol: str) -> str:
    """Screener.in company page: Documents section carries exchange
    announcements (incl. investor presentations/roadshow decks) and concalls
    (transcript + presentation + recording), keyed directly by NSE symbol."""
    return f"https://www.screener.in/company/{urllib.parse.quote(symbol)}/consolidated/"


def brokerage_search_url(symbol: str) -> str:
    """No single reliable per-symbol URL exists for third-party brokerage
    notes, so this is a scoped search link (finance sites only) rather than
    a verified individual report."""
    q = f'"{symbol}" brokerage report target price site:moneycontrol.com OR site:trendlyne.com OR site:business-standard.com'
    return f"https://www.google.com/search?q={urllib.parse.quote(q)}"


def build_research_row(symbol: str, mover_info: dict | None, styles):
    """Per-symbol research strip appended to that symbol's own tile: an
    optional News line (only for symbols that were part of the movers
    research pass — confirmed same-day/yesterday note, or an honest "none
    found"), plus the standing Links line (NSE filings, Screener investor
    presentations/concalls, brokerage search) for every symbol."""
    label_style = ParagraphStyle(
        "rl", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.4,
        textColor=INK3,
    )
    news_style = ParagraphStyle(
        "rn", parent=styles["Normal"], fontName="Helvetica", fontSize=7.2,
        textColor=INK,
    )
    faint_style = ParagraphStyle(
        "rf", parent=styles["Normal"], fontName="Helvetica-Oblique", fontSize=7.0,
        textColor=INK3,
    )
    link_style = ParagraphStyle(
        "rlk", parent=styles["Normal"], fontName="Helvetica", fontSize=7.2,
        textColor=colors.HexColor("#1d4ed8"),
    )

    rows = []
    if mover_info is not None:
        if mover_info.get("confirmed") and mover_info.get("note"):
            note_text = xml_escape(mover_info["note"])
            src = mover_info.get("source_url")
            if src:
                note_text += f' <link href="{src}"><u>[source]</u></link>'
            news_p = Paragraph(note_text, news_style)
        else:
            news_p = Paragraph("No dated news found for today's session", faint_style)
        rows.append([Paragraph("News:", label_style), news_p])

    links_p = Paragraph(
        f'<link href="{nse_filings_url(symbol)}"><u>NSE Filings</u></link> &middot; '
        f'<link href="{screener_url(symbol)}"><u>Screener (Investor Pres. / Concalls)</u></link> &middot; '
        f'<link href="{brokerage_search_url(symbol)}"><u>Brokerage Search</u></link>',
        link_style,
    )
    rows.append([Paragraph("Links:", label_style), links_p])

    tbl = Table(rows, colWidths=[11 * mm, (TILE_W - 11) * mm])
    tbl.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
    ]))
    return tbl


# ------------------------------------------------------------------ tile --

CHART_ROW1 = ["Yday", "1D", "5D"]
CHART_ROW2 = ["1M", "3M", "1Y"]
CHART_TITLES = {
    "Yday": "Yesterday", "1D": "Today", "5D": "5-Day",
    "1M": "Monthly", "3M": "Quarterly", "1Y": "Yearly",
}


def _chart_row(symbol: str, keys: list, chart_closes: dict, chart_pct: dict, styles, cell_w: float):
    label_row, img_row, pct_row = [], [], []
    for key in keys:
        closes = chart_closes.get(key)
        path = os.path.join(CHART_DIR, f"{symbol}_{key}.png")
        if closes is not None and len(closes) >= 2:
            make_chart(path, closes, pct=chart_pct.get(key))
        else:
            make_blank_chart(path)
        label_row.append(Paragraph(CHART_TITLES[key], ParagraphStyle(
            f"cl{symbol}{key}", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=9.5, textColor=INK, alignment=1,
        )))
        img_row.append(Image(path, width=cell_w * mm, height=(cell_w * 0.577) * mm))
        v = chart_pct.get(key)
        pct_row.append(Paragraph(fmt_ret(v), ParagraphStyle(
            f"cp{symbol}{key}", parent=styles["Normal"], fontName="Helvetica-Bold",
            fontSize=8.2, textColor=ret_color(v), alignment=1,
        )))
    row_table = Table([label_row, img_row, pct_row], colWidths=[cell_w * mm] * 3)
    row_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 1.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 1.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 2),
        ("RIGHTPADDING", (0, 0), (-1, -1), 2),
        ("BOX", (0, 0), (-1, -1), 0.4, BORDER),
        ("LINEAFTER", (0, 0), (-2, -1), 0.3, BORDER),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
    ]))
    return row_table


def build_tile(symbol: str, chart_closes: dict, chart_pct: dict, daily5, hilo, mover_info, styles):
    sym_style = ParagraphStyle(
        "sym", parent=styles["Normal"], fontName="Helvetica-Bold",
        fontSize=12.5, textColor=INK, leading=14,
    )

    cell_w = TILE_W / 3 - 2  # mm, minus small outer gutter
    chart_row1 = _chart_row(symbol, CHART_ROW1, chart_closes, chart_pct, styles, cell_w)
    chart_row2 = _chart_row(symbol, CHART_ROW2, chart_closes, chart_pct, styles, cell_w)

    # --- Daily (last 5 sessions) table ---
    daily_hdr = Paragraph("Daily (last 5 sessions)", ParagraphStyle(
        "dh", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.0,
        textColor=INK3, alignment=1,
    ))
    date_row = [Paragraph(short_date(d), ParagraphStyle(
        f"dd{i}", parent=styles["Normal"], fontName="Helvetica", fontSize=5.6,
        textColor=INK3, alignment=1,
    )) for i, (d, v) in enumerate(daily5)]
    daily_val_row = [Paragraph(fmt_ret(v), ParagraphStyle(
        f"dv{i}", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.4,
        textColor=ret_color(v), alignment=1,
    )) for i, (d, v) in enumerate(daily5)]
    daily_table = Table([date_row, daily_val_row], colWidths=[11.6 * mm] * 5)
    daily_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 0.5),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.5),
        ("LEFTPADDING", (0, 0), (-1, -1), 0.3),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0.3),
        ("LINEABOVE", (0, 1), (-1, 1), 0.4, BORDER),
    ]))
    daily_block = Table([[daily_hdr], [daily_table]], colWidths=[60 * mm])
    daily_block.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    # --- Period High/Low table ---
    hilo_hdr = Paragraph("Period High / Low", ParagraphStyle(
        "hh", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.0,
        textColor=INK3, alignment=1,
    ))
    hilo_labels = ["5D", "20D", "60D", "360D"]
    hilo_label_row = [Paragraph(l, ParagraphStyle(
        "hlbl", parent=styles["Normal"], fontName="Helvetica", fontSize=6.3,
        textColor=INK3, alignment=1,
    )) for l in hilo_labels]
    hi_row = [Paragraph(fmt_price(h), ParagraphStyle(
        f"hiv{i}", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.6,
        textColor=GREEN, alignment=1,
    )) for i, (h, l) in enumerate(hilo)]
    lo_row = [Paragraph(fmt_price(l), ParagraphStyle(
        f"lov{i}", parent=styles["Normal"], fontName="Helvetica-Bold", fontSize=6.6,
        textColor=RED, alignment=1,
    )) for i, (h, l) in enumerate(hilo)]
    hilo_table = Table([hilo_label_row, hi_row, lo_row], colWidths=[14.5 * mm] * 4)
    hilo_table.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 0.8),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 0.8),
        ("LEFTPADDING", (0, 0), (-1, -1), 0.5),
        ("RIGHTPADDING", (0, 0), (-1, -1), 0.5),
        ("LINEABOVE", (0, 1), (-1, 1), 0.4, BORDER),
    ]))
    hilo_block = Table([[hilo_hdr], [hilo_table]], colWidths=[58 * mm])
    hilo_block.setStyle(TableStyle([
        ("TOPPADDING", (0, 0), (-1, -1), 1), ("BOTTOMPADDING", (0, 0), (-1, -1), 1),
    ]))

    metrics_row = Table([[daily_block, hilo_block]], colWidths=[93 * mm, 93 * mm])
    metrics_row.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("ALIGN", (0, 0), (0, 0), "LEFT"),
        ("ALIGN", (1, 0), (1, 0), "RIGHT"),
    ]))

    research_row = build_research_row(symbol, mover_info, styles)

    tile = Table(
        [
            [Paragraph(xml_escape(symbol), sym_style)],
            [chart_row1],
            [Spacer(1, 2)],
            [chart_row2],
            [Spacer(1, 3)],
            [metrics_row],
            [Spacer(1, 2)],
            [research_row],
        ],
        colWidths=[TILE_W * mm],
    )
    tile.setStyle(TableStyle([
        ("BOX", (0, 0), (-1, -1), 0.7, BORDER),
        ("TOPPADDING", (0, 0), (-1, 0), 4),
        ("BOTTOMPADDING", (0, 0), (-1, 0), 2),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("LINEABOVE", (0, 7), (-1, 7), 0.4, BORDER),
        ("TOPPADDING", (0, 7), (-1, 7), 3),
        ("BOTTOMPADDING", (0, 7), (-1, 7), 5),
    ]))
    return tile


# ------------------------------------------------------------------ main --

def parse_args():
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--movers-only", action="store_true",
                    help="Just write reports/today_movers.csv (fast, no backend needed) and exit.")
    p.add_argument("--movers-json", default=None,
                    help="Path to pre-researched movers findings JSON (see MOVERS_JSON_SCHEMA "
                         "in this file's docstring) to add a News line to each covered symbol's own page.")
    p.add_argument("--limit", type=int, default=None,
                    help="Only process the first N symbols (testing).")
    p.add_argument("--out", default=None,
                    help="Output PDF path. Defaults to reports/FNO_Returns_Report_<date>.pdf")
    return p.parse_args()


def main():
    args = parse_args()
    os.makedirs(REPORTS_DIR, exist_ok=True)
    os.makedirs(CHART_DIR, exist_ok=True)

    print("Loading F&O symbol list...")
    symbols = load_symbols()
    if args.limit:
        symbols = symbols[: args.limit]
    print(f"{len(symbols)} symbols")

    if args.movers_only:
        print("Movers-only mode: computing today's gap-inclusive 1D returns (DuckDB only)...")
        movers_df = find_movers(symbols)
        movers_df.to_csv(MOVERS_CSV, index=False)
        print(f"Wrote {MOVERS_CSV} ({len(movers_df)} symbols)")
        return

    print("Querying DuckDB for EOD price history...")
    prices = load_prices(symbols)
    print(f"{len(prices)} rows fetched")

    print("Fetching live intraday candles (1D/Yesterday/5D) from backend...")
    intraday = fetch_all_intraday(symbols)

    movers_lookup = {}
    movers_json_date = None
    if args.movers_json and os.path.exists(args.movers_json):
        with open(args.movers_json, "r", encoding="utf-8") as f:
            movers_json = json.load(f)
        movers_json_date = movers_json.get("date")
        movers_lookup = {m["symbol"]: m for m in movers_json.get("movers", [])}
        print(f"Loaded movers research for {len(movers_lookup)} symbols from {args.movers_json}")

    styles = getSampleStyleSheet()
    story_blocks = []
    missing = []
    movers = []

    for i, symbol in enumerate(symbols):
        sdf = prices[prices["symbol"] == symbol]
        if sdf.empty:
            missing.append(symbol)
            continue
        closes = sdf["close"].to_numpy(dtype=float)
        highs = sdf["high"].to_numpy(dtype=float)
        lows = sdf["low"].to_numpy(dtype=float)
        dates = sdf["date"].tolist()

        daily5 = last_5_daily_returns(closes, dates)
        hilo = [window_high_low(highs, lows, n) for n in (5, 20, 60, 360)]

        itd = intraday.get(symbol, {})
        c_today = closes_of(itd.get("1d"))
        c_yday = closes_of(itd.get("yesterday"))
        c_5d = closes_of(itd.get("5d"))
        c_1m = closes[-21:] if len(closes) >= 2 else None
        c_3m = closes[-63:] if len(closes) >= 2 else None
        c_1y = closes[-252:] if len(closes) >= 2 else None

        chart_closes = {
            "1D": c_today, "Yday": c_yday, "5D": c_5d,
            "1M": c_1m, "3M": c_3m, "1Y": c_1y,
        }
        # Gap-inclusive returns: vs the prior trading day's close, not the
        # session's own first intraday price (see CLAUDE.md "Lessons Learned").
        chart_pct = {
            "1D": daily5[4][1],              # today's close/LTP vs yesterday's close
            "Yday": daily5[3][1],            # yesterday's close vs day-before's close
            "5D": pct_return(closes, 5),     # latest close vs close 5 trading days ago
            "1M": pct_return(closes, 21),
            "3M": pct_return(closes, 63),
            "1Y": pct_return(closes, 252),
        }

        mover_info = movers_lookup.get(symbol)
        tile = build_tile(symbol, chart_closes, chart_pct, daily5, hilo, mover_info, styles)
        story_blocks.append(KeepTogether(tile))
        story_blocks.append(Spacer(1, 3 * mm))
        movers.append((symbol, chart_pct["1D"]))

        if (i + 1) % 25 == 0:
            print(f"  {i + 1}/{len(symbols)} tiles built")

    print(f"Missing price data for {len(missing)} symbols: {missing[:20]}")

    movers_df = pd.DataFrame(movers, columns=["symbol", "ret_1d"]).dropna()
    movers_df.sort_values("ret_1d", ascending=False).to_csv(MOVERS_CSV, index=False)
    print(f"Today's movers CSV written ({len(movers_df)} symbols with data)")

    report_date = dt.date.today().isoformat()
    out_pdf = args.out or os.path.join(REPORTS_DIR, f"FNO_Returns_Report_{report_date}.pdf")

    title_style = ParagraphStyle("title", parent=styles["Title"], fontSize=18, textColor=INK)
    sub_style = ParagraphStyle("sub", parent=styles["Normal"], fontSize=9.2, textColor=INK3)

    doc = SimpleDocTemplate(
        out_pdf, pagesize=A4,
        leftMargin=12 * mm, rightMargin=12 * mm,
        topMargin=14 * mm, bottomMargin=12 * mm,
        title="F&O Returns Report",
    )

    story = [
        Paragraph("MarketDNA &mdash; F&amp;O Universe Returns Report", title_style),
        Spacer(1, 3 * mm),
        Paragraph(
            f"Generated {report_date} &middot; "
            f"{len(symbols) - len(missing)} of {len(symbols)} F&amp;O symbols &middot; "
            "6 charts per symbol, 3 per row: Yesterday / Today / 5-Day (live intraday), "
            "then Monthly(21d) / Quarterly(63d) / Yearly(252d) (EOD) &middot; "
            "each annotated Open/High/Low/LTP and its own return vs. the prior "
            "trading day's close (gap-inclusive) &middot; "
            "plus daily returns for the last 5 sessions, period high/low "
            "(5D/20D/60D/360D), and per-symbol research links (NSE filings, "
            "Screener investor presentations/concalls, brokerage search) "
            + (
                f"&middot; movers research for {movers_json_date} included for "
                f"{len(movers_lookup)} symbols"
                if movers_lookup else ""
            ),
            sub_style,
        ),
        Spacer(1, 5 * mm),
    ]
    story.extend(story_blocks)

    doc.build(story)
    print(f"PDF written to {out_pdf}")


if __name__ == "__main__":
    main()
