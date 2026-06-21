"""Company Intelligence Service — Kite + DuckDB (Claude integration stubbed out)."""
from __future__ import annotations

import logging
import threading
from datetime import datetime, timedelta
from typing import Any

from app.services.duckdb_client import get_connection

log = logging.getLogger(__name__)

# ── In-process cache (24 h TTL) ───────────────────────────────────────────────
TTL_HOURS = 24
_cache: dict[str, tuple[datetime, dict]] = {}
_cache_lock = threading.Lock()


def _get_cached(ticker: str) -> dict | None:
    with _cache_lock:
        entry = _cache.get(ticker)
        if entry and datetime.now() - entry[0] < timedelta(hours=TTL_HOURS):
            return entry[1]
        _cache.pop(ticker, None)
    return None


def _set_cache(ticker: str, data: dict) -> None:
    with _cache_lock:
        _cache[ticker] = (datetime.now(), data)


def clear_cache(ticker: str | None = None) -> None:
    with _cache_lock:
        if ticker:
            _cache.pop(ticker.upper(), None)
        else:
            _cache.clear()


def cache_status(ticker: str) -> dict:
    with _cache_lock:
        entry = _cache.get(ticker.upper())
        if not entry:
            return {"ticker": ticker, "cached": False, "fresh": False, "fetched_at": None}
        ts, _ = entry
        fresh = datetime.now() - ts < timedelta(hours=TTL_HOURS)
        return {"ticker": ticker, "cached": True, "fresh": fresh, "fetched_at": ts.isoformat()}


# ── Mock intelligence data (used until Anthropic API subscription is active) ──
# Keyed by NSE ticker. Falls back to a generic template for unknown tickers.
_MOCK_DB: dict[str, dict] = {
    "RELIANCE": {
        "company": "Reliance Industries Limited",
        "ticker": "RELIANCE",
        "tagline": "India's largest conglomerate spanning energy, retail, and telecom.",
        "what_they_do": "Reliance Industries operates across oil refining, petrochemicals, retail (Reliance Retail), and digital services (Jio). It earns revenue from fuel sales and petrochemical exports (O2C segment), subscription and data revenue from Jio, and retail sales across grocery, fashion, and electronics.",
        "sector": "Energy & Consumer",
        "industry": "Integrated Oil & Gas / Telecom",
        "sub_industry": "Refining + Digital Services + Organized Retail",
        "industry_keywords": ["refining", "petrochemicals", "telecom", "retail", "Jio"],
        "supply_chain": [
            {"stage": "Raw Material",  "players": "Crude oil imports (Middle East, Africa); natural gas from KG-D6 basin"},
            {"stage": "Manufacturing", "players": "Jamnagar refinery (world's largest single-site); Hazira petrochemical complex"},
            {"stage": "Distribution",  "players": "Jio fiber/wireless network; Reliance Retail stores nationwide"},
            {"stage": "End Customer",  "players": "Industrial buyers (O2C); 450M+ Jio subscribers; 18,000+ retail stores"},
        ],
        "company_position_in_sc": "Refining & midstream (O2C) — captures refining margin spread. In Jio, owns network infrastructure — captures ARPU uplift directly.",
        "sc_risks": [
            {"risk": "Crude price volatility", "severity": "HIGH",   "desc": "Refining margins compress when crude-product spread narrows, directly impacting O2C EBITDA."},
            {"risk": "Regulatory risk on Jio",  "severity": "HIGH",   "desc": "TRAI tariff interventions or spectrum fee hikes could suppress Jio ARPU growth."},
            {"risk": "Retail execution risk",   "severity": "MEDIUM", "desc": "Rapid store rollout in tier-2/3 cities strains supply chain and inventory management."},
            {"risk": "Refinery turnaround",     "severity": "LOW",    "desc": "Planned maintenance shutdowns at Jamnagar cause temporary throughput dips."},
        ],
        "client_types": [
            {"name": "Industrial / Export (O2C)", "pct": 55},
            {"name": "Telecom subscribers (Jio)", "pct": 25},
            {"name": "Retail consumers",          "pct": 20},
        ],
        "client_concentration": "DIVERSIFIED",
        "client_concentration_note": "No single client exceeds 5% of revenue — O2C is commodity-priced, Jio has 450M+ retail subscribers.",
        "top_clients_examples": ["Jio subscribers (450M+)", "Global petrochem traders", "Reliance Retail shoppers"],
        "market_leader": True,
        "market_rank": "#1 by revenue in India",
        "market_share_pct": 38,
        "main_competitors": [
            {"name": "BPCL + IOC (O2C)",  "share_pct": 30},
            {"name": "Airtel (Telecom)",   "share_pct": 20},
            {"name": "D-Mart / Others",    "share_pct": 12},
        ],
        "porter": {
            "rivalry":        {"score": 6, "desc": "Moderate rivalry in O2C (commodity pricing); high rivalry in telecom (Airtel vs Jio duopoly)."},
            "buyer_power":    {"score": 4, "desc": "Industrial O2C buyers have alternatives but Jio's low tariffs reduce churn meaningfully."},
            "supplier_power": {"score": 5, "desc": "OPEC+ controls crude supply — Reliance partially hedges via long-term contracts and domestic gas."},
            "new_entrants":   {"score": 2, "desc": "Refinery capex >$10B and spectrum costs create near-impenetrable entry barriers."},
            "substitutes":    {"score": 4, "desc": "EV adoption threatens long-term fuel demand; 5G fiber alternatives emerging slowly."},
        },
        "sector_growing": True,
        "sector_cagr_pct": 11,
        "sector_growth_drivers": [
            "India's rising per-capita energy consumption (2.5× global average growth rate)",
            "Jio's ARPU expansion from 4G→5G upgrade cycle",
            "Organized retail penetration still <15% in India",
        ],
        "sector_stage": "GROWTH",
        "margins": {
            "gross_margin_co": 18, "gross_margin_industry": 14, "gross_margin_market": 35,
            "ebitda_margin_co": 16, "ebitda_margin_industry": 12, "ebitda_margin_market": 18,
            "pat_margin_co": 8,  "pat_margin_industry": 6,  "pat_margin_market": 9,
        },
        "tailwinds": [
            "Jio's 5G rollout enabling ARPU upgrade from ~₹180 to ₹250+ over 3 years",
            "New Energy (solar, green hydrogen) investments creating long-duration growth optionality",
            "India's refining capacity shortage keeping GRMs elevated vs global peers",
            "Reliance Retail's digitization of kirana supply chain scaling store count rapidly",
        ],
        "headwinds": [
            "Crude price spike compresses refining spreads and raises working capital needs",
            "Jio tariff wars with Airtel cap near-term ARPU upside",
            "Regulatory scrutiny on FDI structure of Jio and Retail arms",
        ],
        "predictors": [
            {"name": "Singapore GRM (Gross Refining Margin)", "why": "Singapore complex GRM is the benchmark for Reliance's O2C profitability — it leads quarterly EBITDA by 4–6 weeks."},
            {"name": "Jio subscriber net adds (monthly)",     "why": "Monthly TRAI data on net subscriber adds predicts next-quarter Jio revenue growth 2 months ahead."},
            {"name": "India crude oil import bill",           "why": "Rising import bill signals input cost pressure before it hits P&L — watch this for margin compression risk."},
            {"name": "Retail footfall index (metro cities)",  "why": "Mall footfall and festive season spending data lead Reliance Retail revenue by 6–8 weeks."},
            {"name": "Polypropylene / PX-PTA spread",        "why": "Petrochemical product spreads are the swing factor in O2C margins — widen when downstream demand outpaces feedstock."},
        ],
    },
    "TCS": {
        "company": "Tata Consultancy Services Limited",
        "ticker": "TCS",
        "tagline": "India's largest IT services company serving global enterprises.",
        "what_they_do": "TCS delivers IT services, consulting, and business process outsourcing to enterprises across BFSI, retail, telecom, and manufacturing verticals. Revenue comes from multi-year managed services contracts, digital transformation projects, and product licensing through platforms like BaNCS and Ignio.",
        "sector": "Information Technology",
        "industry": "IT Services & Consulting",
        "sub_industry": "Enterprise IT Outsourcing / Digital Transformation",
        "industry_keywords": ["IT outsourcing", "cloud", "BFSI tech", "digital transformation", "BPO"],
        "supply_chain": [
            {"stage": "Raw Material",  "players": "Engineering talent from Indian universities (IITs, NITs, tier-2 colleges); cloud infrastructure from AWS/Azure/GCP"},
            {"stage": "Manufacturing", "players": "Delivery centers in India (Chennai, Pune, Hyderabad, Bangalore); offshore delivery model"},
            {"stage": "Distribution",  "players": "On-site teams at client locations (US, UK, Europe); TCS offices in 55 countries"},
            {"stage": "End Customer",  "players": "Banks, insurers, retailers, telecom operators, and manufacturers globally"},
        ],
        "company_position_in_sc": "Sits at the service delivery stage — earns revenue on time-and-material and fixed-price contracts with high gross margins (~37%) due to India labor arbitrage.",
        "sc_risks": [
            {"risk": "Attrition / talent war",   "severity": "HIGH",   "desc": "IT talent attrition above 12% strains delivery and raises wage costs, compressing margins."},
            {"risk": "USD/INR currency risk",    "severity": "HIGH",   "desc": "80%+ revenue is USD-denominated — INR appreciation erodes reported margins by ~50bps per 1% move."},
            {"risk": "Client concentration",     "severity": "MEDIUM", "desc": "Top 10 clients contribute ~35% of revenue — loss of a single large account is material."},
            {"risk": "Visa policy (H-1B)",       "severity": "LOW",    "desc": "US visa restrictions increase onsite staffing costs but TCS has steadily increased local hiring."},
        ],
        "client_types": [
            {"name": "BFSI",          "pct": 31},
            {"name": "Retail & CPG",  "pct": 16},
            {"name": "Manufacturing", "pct": 12},
            {"name": "Telecom & Media","pct": 11},
            {"name": "Others",        "pct": 30},
        ],
        "client_concentration": "MODERATE",
        "client_concentration_note": "Top 5 clients account for ~18% of revenue; BFSI vertical alone is 31% — vertical concentration is the key risk.",
        "top_clients_examples": ["Citigroup", "ABN AMRO", "Nielsen", "Marks & Spencer", "Walgreens Boots"],
        "market_leader": True,
        "market_rank": "#1 IT services company in India by revenue",
        "market_share_pct": 22,
        "main_competitors": [
            {"name": "Infosys",  "share_pct": 14},
            {"name": "Wipro",    "share_pct": 9},
            {"name": "HCLTech",  "share_pct": 10},
            {"name": "Others",   "share_pct": 45},
        ],
        "porter": {
            "rivalry":        {"score": 7, "desc": "Intense competition among Tier-1 IT firms on deal pricing, especially for large multi-year contracts."},
            "buyer_power":    {"score": 6, "desc": "Large enterprise clients run competitive RFPs — switching costs exist but clients regularly multi-vendor."},
            "supplier_power": {"score": 4, "desc": "Talent supply is abundant from Indian campuses; hyper-scalers (AWS/Azure) have moderate leverage on cloud infra pricing."},
            "new_entrants":   {"score": 3, "desc": "Scale, client relationships, and certifications create strong barriers — GCC in-sourcing is the real threat, not new IT firms."},
            "substitutes":    {"score": 5, "desc": "AI-driven automation and GCCs (captives) are structural substitutes that could displace 10–20% of traditional outsourcing demand."},
        },
        "sector_growing": True,
        "sector_cagr_pct": 9,
        "sector_growth_drivers": [
            "Cloud migration wave: enterprises moving 40–60% of workloads to cloud by 2027",
            "AI/GenAI integration creating a new wave of consulting and implementation demand",
            "Financial services digital core modernisation (banking core replacement cycle)",
        ],
        "sector_stage": "GROWTH",
        "margins": {
            "gross_margin_co": 37, "gross_margin_industry": 33, "gross_margin_market": 35,
            "ebitda_margin_co": 25, "ebitda_margin_industry": 22, "ebitda_margin_market": 18,
            "pat_margin_co": 19,  "pat_margin_industry": 16,  "pat_margin_market": 9,
        },
        "tailwinds": [
            "GenAI implementation wave — enterprises need TCS to integrate AI into legacy systems",
            "BFSI digital core modernisation: banking core replacements are 3–7 year contracts",
            "Europe IT spending recovery after cost-cutting phase of 2022–23",
            "TCS BaNCS platform gaining traction as a SaaS offering in mid-market banks",
        ],
        "headwinds": [
            "Discretionary IT spend freeze by clients in a high-rate macro environment",
            "GCC (Global Capability Centre) in-sourcing trend — clients building captive India teams",
            "Generative AI may reduce headcount needed per project, pressuring volume-based revenue",
        ],
        "predictors": [
            {"name": "US ISM Services PMI",          "why": "US PMI leads TCS deal signings by 2–3 quarters — above 52 historically correlates with IT budget expansion."},
            {"name": "BFSI deal pipeline (quarterly)","why": "TCS's order book disclosures for BFSI segment lead revenue growth by 1–2 quarters."},
            {"name": "INR/USD exchange rate",         "why": "Every 1% INR depreciation adds ~50bps to TCS operating margin — a key short-term earnings driver."},
            {"name": "US 10Y treasury yield",         "why": "Higher rates increase US client borrowing costs, reducing IT discretionary budgets within 6–9 months."},
            {"name": "TCS attrition rate (TTM)",      "why": "Rising attrition precedes margin compression by 1–2 quarters as replacement costs and fresher training ramp up."},
        ],
    },
    "HDFCBANK": {
        "company": "HDFC Bank Limited",
        "ticker": "HDFCBANK",
        "tagline": "India's largest private sector bank by assets and market cap.",
        "what_they_do": "HDFC Bank provides retail banking, corporate banking, treasury, and wealth management services across India. It earns revenue primarily through net interest income (loan-deposit spread) and fee income from credit cards, insurance distribution, and transaction banking.",
        "sector": "Financials",
        "industry": "Banking",
        "sub_industry": "Private Sector Retail & Corporate Banking",
        "industry_keywords": ["retail banking", "NIM", "CASA", "credit cards", "home loans"],
        "supply_chain": [
            {"stage": "Raw Material",  "players": "Deposits: CASA (current + savings) and term deposits from 90M+ customers"},
            {"stage": "Manufacturing", "players": "Credit underwriting, risk assessment, digital lending platforms (HDFCBank app, PayZapp)"},
            {"stage": "Distribution",  "players": "8,700+ branches, 20,000+ ATMs, digital channels (80%+ transactions now digital)"},
            {"stage": "End Customer",  "players": "Retail borrowers (home, auto, personal loans), SMEs, and large corporates"},
        ],
        "company_position_in_sc": "Intermediary — borrows at deposit rates, lends at higher rates. NIM (net interest margin) of ~3.5% is the core value capture mechanism.",
        "sc_risks": [
            {"risk": "Asset quality deterioration", "severity": "HIGH",   "desc": "Unsecured retail loan stress (personal loans, credit cards) could spike NPAs if employment weakens."},
            {"risk": "Deposit cost pressure",       "severity": "HIGH",   "desc": "Rising term deposit rates squeeze NIM as liabilities reprice faster than assets in a rate hike cycle."},
            {"risk": "Regulatory risk",             "severity": "MEDIUM", "desc": "RBI directives on LCR, PSL, and credit card rules periodically constrain growth levers."},
            {"risk": "Integration risk (HDFC Ltd)", "severity": "LOW",    "desc": "Post-merger integration of HDFC Ltd's mortgage book is largely complete but margin dilution lingers."},
        ],
        "client_types": [
            {"name": "Retail borrowers",    "pct": 52},
            {"name": "Corporate clients",   "pct": 30},
            {"name": "SME / MSME",          "pct": 18},
        ],
        "client_concentration": "DIVERSIFIED",
        "client_concentration_note": "Retail book is highly granular — no single borrower exceeds 0.1% of loan book; corporate segment is more concentrated.",
        "top_clients_examples": ["Retail home loan customers", "Top 500 Indian corporates", "Government PSUs"],
        "market_leader": True,
        "market_rank": "#1 private bank by assets (₹35L Cr+)",
        "market_share_pct": 11,
        "main_competitors": [
            {"name": "ICICI Bank",  "share_pct": 8},
            {"name": "SBI (PSU)",   "share_pct": 22},
            {"name": "Kotak Bank",  "share_pct": 4},
            {"name": "Others",      "share_pct": 55},
        ],
        "porter": {
            "rivalry":        {"score": 7, "desc": "Intense competition from ICICI Bank and Kotak on retail loans and savings rates; PSBs compete on corporate credit pricing."},
            "buyer_power":    {"score": 5, "desc": "Retail depositors have moderate power — easy to switch via UPI; corporate treasuries negotiate aggressively on rates."},
            "supplier_power": {"score": 3, "desc": "RBI sets policy rates as the primary input cost lever; HDFC Bank's CASA franchise reduces dependence on costly bulk deposits."},
            "new_entrants":   {"score": 2, "desc": "RBI banking licence is a near-impenetrable barrier; fintechs can partner but cannot replicate full banking services."},
            "substitutes":    {"score": 4, "desc": "Mutual funds and UPI wallets are substitutes for savings products; NBFCs compete on personal loans."},
        },
        "sector_growing": True,
        "sector_cagr_pct": 14,
        "sector_growth_drivers": [
            "India credit-to-GDP at 57% vs 100%+ in developed markets — structural runway for loan growth",
            "Formalization of the economy driving MSME credit demand into the banking system",
            "Digital banking reducing cost-to-serve and enabling credit access in tier-3+ cities",
        ],
        "sector_stage": "GROWTH",
        "margins": {
            "gross_margin_co": 64, "gross_margin_industry": 58, "gross_margin_market": 35,
            "ebitda_margin_co": 38, "ebitda_margin_industry": 32, "ebitda_margin_market": 18,
            "pat_margin_co": 26,  "pat_margin_industry": 20,  "pat_margin_market": 9,
        },
        "tailwinds": [
            "India's credit upcycle: retail credit growing 18–20% YoY driven by middle-class expansion",
            "HDFC Bank's rural branch rollout unlocking 200M+ under-banked customers",
            "Cross-selling insurance, mutual funds, and wealth management to 90M customer base",
            "UPI transaction dominance driving CASA float and low-cost deposit growth",
        ],
        "headwinds": [
            "RBI's stance on unsecured loans — restrictions on personal loan growth cap near-term book expansion",
            "NIM compression post-HDFC Ltd merger as higher-cost wholesale funding gets digested",
            "Slower deposit growth vs credit demand creating LDR pressure industrywide",
        ],
        "predictors": [
            {"name": "RBI repo rate decision",          "why": "Rate cuts directly expand NIM within 1 quarter as MCLR-linked loans reprice faster than fixed deposits."},
            {"name": "India PMI Manufacturing (HSBC)",  "why": "PMI above 55 leads to working capital loan demand growth in SME segment by 2–3 months."},
            {"name": "HDFC Bank CASA ratio (quarterly)","why": "Rising CASA ratio is the single best predictor of NIM expansion — every 1% CASA improvement = ~5bps NIM uplift."},
            {"name": "Credit card spend data (RBI)",    "why": "Monthly credit card outstanding from RBI leads HDFC fee income (interchange + interest) by 6 weeks."},
            {"name": "GNP (Gross NPA) ratio trend",    "why": "Early stress in retail book shows up in slippages 2 quarters before provisioning hits PAT."},
        ],
    },
}


def _mock_for(ticker: str) -> dict[str, Any]:
    """Return a pre-seeded mock or generate a generic placeholder."""
    if ticker in _MOCK_DB:
        return _MOCK_DB[ticker]
    # Generic fallback for any other ticker
    return {
        "company": f"{ticker} Limited",
        "ticker": ticker,
        "tagline": f"A Nifty 500 listed company — enable Anthropic API for real analysis.",
        "what_they_do": (
            f"[MOCK DATA] {ticker} is a listed Indian company. "
            "Subscribe to the Anthropic API and set ANTHROPIC_API_KEY in .env "
            "to generate real qualitative intelligence for any Nifty 500 ticker."
        ),
        "sector": "Unknown — enable API",
        "industry": "Unknown — enable API",
        "sub_industry": "Unknown — enable API",
        "industry_keywords": ["mock", "placeholder", "enable-api"],
        "supply_chain": [
            {"stage": "Raw Material",  "players": "— enable Anthropic API for real data —"},
            {"stage": "Manufacturing", "players": "— enable Anthropic API for real data —"},
            {"stage": "Distribution",  "players": "— enable Anthropic API for real data —"},
            {"stage": "End Customer",  "players": "— enable Anthropic API for real data —"},
        ],
        "company_position_in_sc": "Enable Anthropic API to generate supply chain position analysis.",
        "sc_risks": [
            {"risk": "API not configured", "severity": "HIGH", "desc": "Set ANTHROPIC_API_KEY in marketdna-backend/.env to enable live intelligence."},
        ],
        "client_types": [{"name": "Unknown", "pct": 100}],
        "client_concentration": "MODERATE",
        "client_concentration_note": "Enable Anthropic API for real client concentration data.",
        "top_clients_examples": ["—", "—", "—"],
        "market_leader": False,
        "market_rank": "Unknown — enable API",
        "market_share_pct": 0,
        "main_competitors": [{"name": "Unknown", "share_pct": 100}],
        "porter": {
            "rivalry":        {"score": 5, "desc": "Enable Anthropic API for Porter analysis."},
            "buyer_power":    {"score": 5, "desc": "Enable Anthropic API for Porter analysis."},
            "supplier_power": {"score": 5, "desc": "Enable Anthropic API for Porter analysis."},
            "new_entrants":   {"score": 5, "desc": "Enable Anthropic API for Porter analysis."},
            "substitutes":    {"score": 5, "desc": "Enable Anthropic API for Porter analysis."},
        },
        "sector_growing": True,
        "sector_cagr_pct": 10,
        "sector_growth_drivers": ["Enable Anthropic API for sector data"],
        "sector_stage": "GROWTH",
        "margins": {
            "gross_margin_co": 0, "gross_margin_industry": 0, "gross_margin_market": 0,
            "ebitda_margin_co": 0, "ebitda_margin_industry": 0, "ebitda_margin_market": 0,
            "pat_margin_co": 0, "pat_margin_industry": 0, "pat_margin_market": 0,
        },
        "tailwinds": ["Enable Anthropic API for tailwind analysis"],
        "headwinds": ["Enable Anthropic API for headwind analysis"],
        "predictors": [
            {"name": "Enable Anthropic API", "why": "Set ANTHROPIC_API_KEY in .env to get real revenue predictors for this company."},
        ],
    }


async def get_intelligence(ticker: str) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    cached = _get_cached(ticker)
    if cached:
        return {**cached, "_cache": "hit"}
    data = _mock_for(ticker)
    _set_cache(ticker, data)
    return {**data, "_cache": "miss"}


# ── Kite live quote ───────────────────────────────────────────────────────────
def get_live_quote(ticker: str) -> dict[str, Any] | None:
    try:
        from app.services.kite_client import get_kite
        kite = get_kite()
        symbol = f"NSE:{ticker}"
        q = kite.quote(symbol)[symbol]
        ohlc = q.get("ohlc", {})
        depth = q.get("depth", {})
        return {
            "ticker":        ticker,
            "last_price":    q.get("last_price"),
            "open":          ohlc.get("open"),
            "high":          ohlc.get("high"),
            "low":           ohlc.get("low"),
            "close":         ohlc.get("close"),
            "net_change":    round(q.get("net_change", 0), 2),
            "pct_change":    round(
                (q.get("net_change", 0) / max(ohlc.get("close", 1), 1)) * 100, 2
            ),
            "volume":        q.get("volume"),
            "avg_price":     q.get("average_price"),
            "oi":            q.get("oi"),
            "oi_day_high":   q.get("oi_day_high"),
            "oi_day_low":    q.get("oi_day_low"),
            "buy_qty":       q.get("buy_quantity"),
            "sell_qty":      q.get("sell_quantity"),
            "upper_circuit": q.get("upper_circuit_limit"),
            "lower_circuit": q.get("lower_circuit_limit"),
            "bid":  depth.get("buy",  [{}])[0].get("price") if depth.get("buy")  else None,
            "ask":  depth.get("sell", [{}])[0].get("price") if depth.get("sell") else None,
        }
    except Exception as exc:
        log.warning("Kite quote failed for %s: %s", ticker, exc)
        return None


# ── DuckDB historical fundamentals ────────────────────────────────────────────
def get_fundamentals(ticker: str) -> dict[str, Any]:
    ticker = ticker.upper().strip()
    con = get_connection()
    try:
        row = con.execute("""
            SELECT
                MAX(high)                               AS high_52w,
                MIN(low)                                AS low_52w,
                AVG(volume)                             AS avg_vol,
                MAX_BY(close, CAST(date AS DATE))       AS last_close,
                MIN_BY(close, CAST(date AS DATE))       AS first_close,
                COUNT(*)                                AS bar_count
            FROM equities_prices
            WHERE symbol = ?
              AND CAST(date AS DATE) >= CURRENT_DATE - INTERVAL '365 days'
        """, [ticker]).fetchone()

        if not row or row[3] is None:
            return {"ticker": ticker, "error": "No OHLCV data found"}

        high_52w, low_52w, avg_vol, last_close, first_close, bar_count = row
        ret_1y = round((last_close / first_close - 1) * 100, 2) if first_close else None

        vol_row = con.execute("""
            SELECT STDDEV(daily_ret) * SQRT(252) * 100
            FROM (
                SELECT
                    (close - LAG(close) OVER (ORDER BY date))
                    / NULLIF(LAG(close) OVER (ORDER BY date), 0) AS daily_ret
                FROM equities_prices
                WHERE symbol = ?
                  AND CAST(date AS DATE) >= CURRENT_DATE - INTERVAL '365 days'
            ) t
            WHERE daily_ret IS NOT NULL
        """, [ticker]).fetchone()

        realised_vol = round(vol_row[0], 1) if vol_row and vol_row[0] else None

        return {
            "ticker":           ticker,
            "high_52w":         round(high_52w, 2)  if high_52w  else None,
            "low_52w":          round(low_52w, 2)   if low_52w   else None,
            "avg_vol":          int(avg_vol)         if avg_vol   else None,
            "last_close":       round(last_close, 2) if last_close else None,
            "ret_1y_pct":       ret_1y,
            "realised_vol_pct": realised_vol,
            "trading_days_1y":  bar_count,
        }
    except Exception as exc:
        log.error("Fundamentals query failed for %s: %s", ticker, exc)
        return {"ticker": ticker, "error": str(exc)}
