"""
Natural-language → custom-portfolio rule translation.

Turns a plain-English idea ("stocks above their 50- and 200-day averages, ranked by
momentum, drop anything that falls 10% from entry") into a validated `PortfolioSpec`.

Design (respects Principles 2 & 3):
  * The LLM is a TRANSLATOR only — it emits the rule DSL strings, it never computes a
    score or picks a stock. Execution stays in the deterministic rule engine.
  * The generated spec is run through `validate_spec` (the same strict AST whitelist the
    manual builder uses). On failure the exact `RuleError` is fed back for a bounded
    number of self-repairs, so the endpoint returns only rules that actually compile.
  * Nothing is saved. The caller gets a DRAFT + a live match-count preview; the user
    reviews the generated rules before creating the portfolio via POST /custom. The
    English is an authoring aid — the saved rule is what runs, deterministically.
"""
from __future__ import annotations

import json
import logging
import os
import re

from app.models.portfolios import PortfolioSpec
from app.services import portfolios_rules as pr

log = logging.getLogger(__name__)

MODEL = os.environ.get("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001")
_MAX_REPAIRS = 2  # extra passes after the first, feeding the validation error back


class TranslationError(RuntimeError):
    """Raised when the description can't be turned into a valid spec (or the API is down)."""


# ── prompt construction ─────────────────────────────────────────────────────────
def _catalog_text() -> str:
    """Group the live field catalog into a compact, model-friendly reference."""
    fields = pr.field_catalog("eviction")          # includes position-only fields, flagged
    by_group: dict[str, list[str]] = {}
    for f in fields:
        unit = f" [{f['unit']}]" if f.get("unit") else ""
        pos = " (eviction-only)" if f.get("position_only") else ""
        line = f"{f['name']} — {f['label']}{unit} ({f['kind']}){pos}"
        by_group.setdefault(f.get("group") or "other", []).append(line)
    out = []
    for group in sorted(by_group):
        out.append(f"### {group}")
        out.extend(f"  - {ln}" for ln in sorted(by_group[group]))
    return "\n".join(out)


_SYSTEM = """You translate a plain-English stock-portfolio idea into MarketDNA's rule DSL.

You are a TRANSLATOR, not an analyst. You NEVER invent field names, compute values, or
name specific stocks. You only emit rule expressions built from the exact fields below.

## Rule DSL
- An expression combines FIELDS, numeric/boolean literals, and these operators only:
  comparisons  < <= > >= == !=  · boolean  and or not  · arithmetic  + - * /
- A boolean field is already a condition (e.g. `above_sma200`, `golden_cross`).
- A numeric field must be compared to make a condition (e.g. `rsi14 < 30`, `close > sma50`).
- No function calls, no attribute access, no other names. `price` is NOT a field — use `close`.
- `entry` and `rebalance` must be CONDITIONS (boolean). `rank_by`/`fill_rank_by` must be
  VALUES (numeric, e.g. `mom_score` or `0.6*rs_ret_6m + 0.4*mom_score`) — higher = better.
- `eviction` may additionally use the eviction-only fields (since_entry_pct, days_held).

## Available fields
{catalog}

## Output — return ONE JSON object, nothing else:
{{
  "name": "<short human title>",
  "description": "<one sentence>",
  "entry": "<boolean expr, REQUIRED>",
  "rank_by": "<numeric expr, default mom_score>",
  "max_holdings": <int 1-100, default 20>,
  "weight": {{"scheme": "equal|score|inverse_vol|by_field", "field": "<field or null>"}},
  "fill": "<boolean expr or null>",
  "fill_rank_by": "<numeric expr or null>",
  "eviction": "<boolean expr or null>",
  "eviction_weight": "redistribute|hold_cash",
  "rebalance_freq": "W|M|Q",
  "rebalance": "<boolean expr or null>",
  "rebalance_weight": {{"scheme": "equal|score|inverse_vol|by_field", "field": "<field or null>"}},
  "volatility_stars": <int 1-5>,
  "summary": "<plain-English readback of exactly what these rules do>"
}}

Guidance: prefer the simplest rule that matches the intent. Use `weight.scheme=score` when the
user wants to tilt toward the best-ranked names; `inverse_vol` for risk-parity/low-vol intent.
Only set `eviction`/`fill`/`rebalance` if the description implies them, else null. If a request
is contradictory (e.g. `close > sma200 and close < sma200`), pick the interpretation the user
most likely meant and note the change in `summary`."""


def _system_prompt() -> str:
    return _SYSTEM.replace("{catalog}", _catalog_text())


# ── json extraction ─────────────────────────────────────────────────────────────
def _extract_json(text: str) -> dict:
    """Parse the model's reply as JSON, tolerating markdown fences / surrounding prose."""
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start, end = text.find("{"), text.rfind("}")
        if start != -1 and end > start:
            return json.loads(text[start:end + 1])
        raise


# ── spec assembly ───────────────────────────────────────────────────────────────
def _slug(name: str, taken: set[str]) -> str:
    base = re.sub(r"[^a-z0-9]+", "_", (name or "custom").lower()).strip("_")[:36] or "custom"
    if len(base) < 3:
        base = f"{base}_p"
    key = base
    i = 2
    while key in taken:
        key = f"{base}_{i}"[:40]
        i += 1
    return key


def _existing_keys() -> set[str]:
    from app.services import portfolios_service as ps
    from app.services import portfolios_store as store
    keys = set(ps.PORTFOLIOS.keys())
    try:
        keys |= set(store.all_specs().keys())
    except Exception:
        pass
    return keys


def _build_spec(data: dict, universe: str) -> PortfolioSpec:
    """Assemble a PortfolioSpec from the model's JSON (drops unknown keys, slugs the key)."""
    def wspec(d):
        d = d or {}
        return {"scheme": d.get("scheme", "equal"), "field": d.get("field") or None}

    name = (data.get("name") or "Custom Portfolio").strip()[:80]
    payload = {
        "key": _slug(name, _existing_keys()),
        "name": name,
        "description": (data.get("description") or "").strip()[:400],
        "universe": universe,
        "volatility_stars": int(data.get("volatility_stars") or 3),
        "max_holdings": int(data.get("max_holdings") or 20),
        "entry": (data.get("entry") or "").strip(),
        "rank_by": (data.get("rank_by") or "mom_score").strip() or "mom_score",
        "weight": wspec(data.get("weight")),
        "fill": (data.get("fill") or None),
        "fill_rank_by": (data.get("fill_rank_by") or None),
        "eviction": (data.get("eviction") or None),
        "eviction_weight": data.get("eviction_weight") or "redistribute",
        "rebalance_freq": data.get("rebalance_freq") or "M",
        "rebalance": (data.get("rebalance") or None),
        "rebalance_weight": wspec(data.get("rebalance_weight")),
    }
    return PortfolioSpec(**payload)


# ── preview (real determinism check: how many names match right now) ─────────────
def _preview(spec: PortfolioSpec) -> tuple[int, list[str]]:
    from app.services import portfolios_service as ps
    try:
        feats = ps.build_features(universe=spec.universe)
        if feats.empty:
            return 0, []
        port = pr.build_custom(spec)
        picks = port.select(feats)
        syms = list(picks.index)[:8]
        return len(picks), syms
    except Exception as exc:                       # preview is best-effort, never fatal
        log.warning("nl-draft: preview failed for %s (%s)", spec.key, exc)
        return 0, []


# ── public API ──────────────────────────────────────────────────────────────────
def draft_from_text(description: str, universe: str = "nifty500") -> dict:
    """Translate `description` into a validated draft PortfolioSpec (not saved).

    Returns a dict matching NLDraftResponse. Raises TranslationError if the API key is
    missing/unreachable or the model cannot produce a compilable rule within the repair budget."""
    try:
        import anthropic
    except Exception as exc:                       # dependency not installed
        raise TranslationError(f"Anthropic SDK unavailable: {exc}") from exc
    if not os.environ.get("ANTHROPIC_API_KEY"):
        raise TranslationError("ANTHROPIC_API_KEY is not set — plain-English portfolios "
                               "need the Anthropic API. Set it in marketdna-backend/.env.")

    client = anthropic.Anthropic(api_key=os.environ.get("ANTHROPIC_API_KEY"))
    system = _system_prompt()
    messages: list[dict] = [{"role": "user", "content": description.strip()}]

    last_err = ""
    for attempt in range(1, _MAX_REPAIRS + 2):
        try:
            resp = client.messages.create(
                model=MODEL, max_tokens=1200, temperature=0,   # temp 0 for reproducibility
                system=system, messages=messages,
            )
        except Exception as exc:
            raise TranslationError(f"Anthropic request failed: {exc}") from exc

        reply = "".join(b.text for b in resp.content if getattr(b, "type", "") == "text")
        try:
            data = _extract_json(reply)
            spec = _build_spec(data, universe)
            pr.validate_spec(spec)                 # strict AST whitelist — same as manual builder
        except (json.JSONDecodeError, KeyError, ValueError, pr.RuleError) as exc:
            last_err = str(exc)
            log.info("nl-draft attempt %d failed: %s", attempt, last_err)
            # Feed the failure back so the model self-corrects on the next pass.
            messages += [
                {"role": "assistant", "content": reply},
                {"role": "user", "content":
                    f"That was rejected by the validator: {last_err}\n"
                    f"Return a corrected JSON object using only valid fields and a boolean `entry`."},
            ]
            continue

        count, syms = _preview(spec)
        warnings: list[str] = []
        if count == 0:
            warnings.append("The entry rule matches 0 stocks in the current universe — it may be "
                            "too strict or contradictory. Review the rule before saving.")
        if not spec.eviction:
            warnings.append("No stop-loss / eviction rule — holdings are only re-evaluated on rebalance.")
        return {
            "spec": spec,
            "summary": (data.get("summary") or spec.description or "").strip(),
            "warnings": warnings,
            "preview_count": count,
            "preview_symbols": syms,
            "attempts": attempt,
        }

    raise TranslationError(f"Could not produce a valid rule after {_MAX_REPAIRS + 1} attempts. "
                           f"Last error: {last_err}")
