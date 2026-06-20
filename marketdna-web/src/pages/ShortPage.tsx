import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { Box, Typography, CircularProgress, Collapse } from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { SquiggleUnderline, ResearchNote } from '../components/DoodleDecor'
import { shortApi } from '../api/shortApi'
import type { ShortCandidate, SqueezeWatch, MarketContext } from '../types/short'
import { GRADE_COLOR, SQUEEZE_RISK_COLOR } from '../types/short'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import SearchBox from '../components/shared/SearchBox'

// ─── Semantic colors (not palette) ────────────────────────────────────────────

const RED    = '#EF4444'
const ORANGE = '#F97316'

// ─── Font constants ────────────────────────────────────────────────────────────

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND    = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

const pf = (v: number, d = 1) => `${v > 0 ? '+' : ''}${v.toFixed(d)}%`
const pn = (v: number) => (v > 0 ? '+' : '') + v.toFixed(2) + '%'

// ─── Micro atoms ──────────────────────────────────────────────────────────────

function ActiveDot() {
  return (
    <Box component="span" sx={{
      display: 'inline-block', width: 6, height: 6, borderRadius: '50%', bgcolor: RED,
      boxShadow: `0 0 5px ${RED}`,
      '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
      animation: 'blink 1.8s ease-in-out infinite', flexShrink: 0,
    }} />
  )
}

function GradeBadge({ grade }: { grade: string }) {
  const { INK3 } = usePalette()
  const c = GRADE_COLOR[grade] ?? INK3
  return (
    <Box component="span" sx={{
      px: 0.875, py: 0.25, fontSize: '0.6875rem', fontWeight: 700, lineHeight: 1.5,
      bgcolor: c + '20', color: c, border: `1px solid ${c}40`,
      ...COND, letterSpacing: '0.06em',
    }}>
      {grade}
    </Box>
  )
}

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.875, py: 0.25, fontSize: '0.6875rem', fontWeight: 700,
      color, bgcolor: color + '14', border: `1px solid ${color}28`, ...COND, letterSpacing: '0.05em',
    }}>
      {label}
    </Box>
  )
}

// ─── Score bar ────────────────────────────────────────────────────────────────

function ScoreBar({ value, max = 100, color }: { value: number; max?: number; color: string }) {
  const { BORDER } = usePalette()
  const pct = Math.min(100, (value / max) * 100)
  return (
    <Box sx={{ height: 3, bgcolor: BORDER, overflow: 'hidden' }}>
      <Box sx={{ height: '100%', width: `${pct}%`, bgcolor: color, transition: 'width 0.4s ease' }} />
    </Box>
  )
}

// ─── Regime indicator ─────────────────────────────────────────────────────────

function RegimeIndicator({ score }: { score: number }) {
  const { INK3 } = usePalette()
  const color = score < 25 ? RED : score < 50 ? ORANGE : score < 75 ? '#FBBF24' : '#22C55E'
  const label = score < 25 ? 'VERY WEAK' : score < 50 ? 'WEAK' : score < 75 ? 'NEUTRAL' : 'STRONG'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ flex: 1 }}>
        <ScoreBar value={score} color={color} />
      </Box>
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'baseline', flexShrink: 0 }}>
        <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color, lineHeight: 1 }}>
          {score.toFixed(0)}
        </Typography>
        <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em' }}>
          {label}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Metric chip ──────────────────────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ flex: 1, textAlign: 'center', py: 0.75 }}>
      <Typography sx={{ ...COND, fontSize: '0.55rem', color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', display: 'block', mb: 0.2 }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.92rem', fontWeight: 700, color: color ?? INK, lineHeight: 1 }}>
        {value}
      </Typography>
    </Box>
  )
}

// ─── Factor bar (algo) ────────────────────────────────────────────────────────

function FactorRow({
  name, formula, value, base = false, accent,
}: {
  name: string; formula: string; value: number; base?: boolean; accent: string
}) {
  const { INK2, INK3, BORDER } = usePalette()
  const pct  = base ? Math.min(100, (value / 10) * 100) : Math.min(100, ((value - 1) / 1.5) * 100)
  const glow = value >= 1.4 ? accent : value >= 1.15 ? '#FBBF24' : INK3
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1 }}>
      <Box sx={{ minWidth: 120, flexShrink: 0 }}>
        <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
          {name}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3 }}>
          {formula}
        </Typography>
      </Box>
      <Box sx={{ flex: 1, height: 3, bgcolor: BORDER, overflow: 'hidden' }}>
        <Box sx={{ height: '100%', width: `${Math.max(2, pct)}%`, bgcolor: glow, transition: 'width 0.4s' }} />
      </Box>
      <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 800, color: glow, minWidth: 38, textAlign: 'right' }}>
        {value.toFixed(2)}{!base && '×'}
      </Typography>
    </Box>
  )
}

// ─── Short detail panel ───────────────────────────────────────────────────────

function ShortDetailPanel({ c }: { c: ShortCandidate }) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()
  const regime_factor = 1 + Math.max(0, (50 - c.regime_score) / 50) * 0.6
  const weak_boost = (c.mkt_low_win_rate !== null && c.mkt_low_win_rate !== undefined && c.mkt_low_win_rate > c.win_rate + 5)
    ? 1 + (c.mkt_low_win_rate - c.win_rate) / 100
    : 1.0
  const convictionColor = c.short_score >= 6 ? RED : c.short_score >= 3 ? '#FBBF24' : INK2
  const convictionLevel = c.short_score >= 6 ? 'Very high' : c.short_score >= 3 ? 'Moderate' : 'Low'

  const rationale: { text: string }[] = []
  rationale.push({ text: `${c.signal_name} (Grade ${c.grade}) — ${c.win_rate.toFixed(1)}% historical win rate. Stock continues lower 1 month after signal in ${c.win_rate.toFixed(1)}% of cases.` })
  if (c.regime_score <= 50) rationale.push({ text: `Regime factor ${regime_factor.toFixed(2)}× amplifies base edge — price is below SMA100/200, structural downtrend confirmed.` })
  if (weak_boost > 1.0 && c.mkt_low_win_rate != null) rationale.push({ text: `Weak-market boost ${weak_boost.toFixed(2)}× — signal delivers ${(c.mkt_low_win_rate - c.win_rate).toFixed(1)}pp higher win rate when breadth is below 60.` })
  if (c.days_below_sma20 >= 15) rationale.push({ text: `${c.days_below_sma20} consecutive days below SMA20 — sustained institutional selling, not an intraday event.` })
  if (c.delivery_ratio > 1.3) rationale.push({ text: `Delivery ${c.delivery_ratio.toFixed(2)}× its 20-day average — confirms real shares changing hands.` })

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: `1px dashed ${BORDER}` }}>

      {/* Formula */}
      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        Score Breakdown
      </Typography>
      <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 1.5, mb: 2 }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK2, mb: 1.25 }}>
          short_score = edge × regime_factor × weak_boost
        </Typography>
        <FactorRow name="Edge" formula="WR × EV × grade_mult" value={c.edge_score} base accent={RED} />
        <FactorRow name="Regime Factor" formula={`1 + max(0,(50−${c.regime_score.toFixed(0)})/50)×0.6`} value={regime_factor} accent={ORANGE} />
        <FactorRow name="Weak Boost" formula={c.mkt_low_win_rate ? `1 + (${c.mkt_low_win_rate.toFixed(1)}−${c.win_rate.toFixed(1)})/100` : 'n/a'} value={weak_boost} accent="#FBBF24" />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1, borderTop: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Final Short Score</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.88rem', fontWeight: 900, color: convictionColor }}>
            {c.short_score.toFixed(2)}
          </Typography>
        </Box>
      </Box>

      {/* Rationale */}
      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        Why This Qualifies
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, mb: 2 }}>
        {rationale.map((r, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: RED, mt: 0.8, flexShrink: 0 }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.67rem', color: INK2, lineHeight: 1.65 }}>{r.text}</Typography>
          </Box>
        ))}
      </Box>

      {/* Interpretation */}
      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        How to Use
      </Typography>
      <Box sx={{ p: 1.5, bgcolor: `${RED}06`, border: `1px solid ${RED}18`, borderLeft: `2px solid ${RED}` }}>
        <Box sx={{ display: 'flex', gap: 1.5, mb: 1, alignItems: 'baseline' }}>
          <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>Conviction</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 800, color: convictionColor }}>{convictionLevel}</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>({c.short_score.toFixed(2)})</Typography>
        </Box>
        {[
          c.is_active ? 'Signal active today — delivery confirmed above average, highest entry confidence.' : 'Signal not active today — wait for a fresh delivery spike. Historical edge is backtested, not live.',
          `Expected value +${c.expected_value.toFixed(2)}% over 1 month.`,
          'Entry: short on close when signal fires + regime score stays below 50.',
          'Exit: cover if price reclaims SMA20 on above-average delivery or regime crosses 50.',
          c.days_below_sma20 >= 10 ? `${c.days_below_sma20}d below SMA20 — mean-reversion risk elevated, stop tight above SMA20.` : 'Stop 1–2% above SMA20.',
        ].map((line, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: `${RED}80`, mt: 0.8, flexShrink: 0 }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.67rem', color: INK2, lineHeight: 1.6 }}>{line}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Squeeze detail panel ─────────────────────────────────────────────────────

function SqueezeDetailPanel({ s }: { s: SqueezeWatch }) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()
  const decline_factor = Math.min(2.5, 1 + Math.abs(s.decline_pct_20d) / 15)
  const days_factor    = Math.min(1.8, 1 + s.days_below_sma20 / 30)
  const base_wr        = s.mkt_low_win_rate ?? s.win_rate
  const wr_factor      = (s.win_rate / 100) * (1 + base_wr / 150)
  const riskColor      = SQUEEZE_RISK_COLOR[s.squeeze_risk]

  return (
    <Box sx={{ mt: 2, pt: 2, borderTop: `1px dashed ${BORDER}` }}>

      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        Squeeze Score Breakdown
      </Typography>
      <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, p: 1.5, mb: 2 }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK2, mb: 1.25 }}>
          squeeze = edge × decline_factor × days_factor × wr_factor
        </Typography>
        <FactorRow name="Edge" formula="signal strength" value={s.edge_score} base accent={riskColor} />
        <FactorRow name="Decline Factor" formula={`1 + ${Math.abs(s.decline_pct_20d).toFixed(1)}% / 15`} value={decline_factor} accent={RED} />
        <FactorRow name="Days Factor" formula={`1 + ${s.days_below_sma20}d / 30`} value={days_factor} accent={ORANGE} />
        <FactorRow name="WR Factor" formula={`(${s.win_rate.toFixed(0)}%/100) × boost`} value={wr_factor} accent="#FBBF24" />
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1.5, pt: 1, borderTop: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase' }}>Final Squeeze Score</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.88rem', fontWeight: 900, color: riskColor }}>
            {s.squeeze_score.toFixed(2)}
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        Why Squeeze Risk Exists
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6, mb: 2 }}>
        {[
          `${s.symbol} has fallen ${Math.abs(s.decline_pct_20d).toFixed(1)}% from its 20-day high. Shorts that entered during this fall are now sitting on profits — potential fuel for a squeeze.`,
          `${s.days_below_sma20} consecutive days below SMA20 (currently ${pf(s.pct_from_sma20)}). Longer accumulation = more short positions built up in the market.`,
          `${s.trigger_signal} has appeared with ${s.win_rate.toFixed(1)}% historical win rate and ${pn(s.expected_value)} expected value — institutional delivery on up days, accumulation against the trend.`,
          ...(s.mkt_low_win_rate != null && s.mkt_low_win_rate > s.win_rate + 5
            ? [`Signal's win rate rises to ${s.mkt_low_win_rate.toFixed(1)}% in weak markets vs ${s.win_rate.toFixed(1)}% overall — the same bearish regime that attracted shorts is now amplifying the reversal signal.`]
            : []),
        ].map((text, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: riskColor, mt: 0.8, flexShrink: 0 }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.67rem', color: INK2, lineHeight: 1.65 }}>{text}</Typography>
          </Box>
        ))}
      </Box>

      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1 }}>
        What to Do
      </Typography>
      <Box sx={{ p: 1.5, bgcolor: `${riskColor}06`, border: `1px solid ${riskColor}20`, borderLeft: `2px solid ${riskColor}` }}>
        {[
          s.squeeze_risk === 'High' ? `Score ${s.squeeze_score.toFixed(2)} — HIGH priority cover signal. Large decline + prolonged accumulation + strong bullish signal = three conditions met.`
            : s.squeeze_risk === 'Medium' ? `Score ${s.squeeze_score.toFixed(2)} — Moderate risk. Setup developing but not yet at full severity. Monitor daily.`
            : `Score ${s.squeeze_score.toFixed(2)} — Early-stage setup. Risk present but not amplified.`,
          s.is_active ? 'Signal firing today — accumulation happening right now. Highest urgency to act.' : 'Signal not active today — structural risk exists, monitor for fresh delivery spike.',
          'If short: tighten stop to just above SMA20. Any close above SMA20 with delivery is a cover signal.',
          'Long entry: wait for price to close above SMA20 on above-average delivery. Do not front-run.',
        ].map((line, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, mb: 0.5, alignItems: 'flex-start' }}>
            <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: `${riskColor}80`, mt: 0.8, flexShrink: 0 }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.67rem', color: INK2, lineHeight: 1.6 }}>{line}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Algorithm guide ──────────────────────────────────────────────────────────

function AlgoGuide() {
  const { BORDER, PAPER, PAPER2, INK, INK2, INK3 } = usePalette()
  const [open, setOpen] = useState(false)

  return (
    <Box sx={{ mb: 3, border: `1px solid ${BORDER}`, bgcolor: PAPER, overflow: 'hidden' }}>
      {/* Header */}
      <Box
        onClick={() => setOpen(o => !o)}
        sx={{ display: 'flex', alignItems: 'center', gap: 2, px: 2.5, py: 1.5,
          cursor: 'pointer', userSelect: 'none',
          bgcolor: PAPER2,
          borderBottom: open ? `1px solid ${BORDER}` : 'none',
          '&:hover': { filter: 'brightness(0.97)' }, transition: 'filter 0.15s' }}
      >
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', color: INK3, textTransform: 'uppercase' }}>
            Research Note
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', fontWeight: 600, color: INK }}>
            How the Scoring Algorithm Works
          </Typography>
        </Box>
        <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
          {open ? '[ − ]' : '[ + ]'}
        </Typography>
      </Box>

      <Collapse in={open}>
        <Box sx={{ px: 2.5, pb: 2.5, pt: 2, display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>

          {/* Short Score */}
          <Box sx={{ p: 1.5, bgcolor: `${RED}05`, border: `1px solid ${RED}18`, borderLeft: `2px solid ${RED}` }}>
            <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 800, color: RED, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
              Short Score Formula
            </Typography>
            <Box sx={{ ...MONO, fontSize: '0.68rem', color: INK2, lineHeight: 2, bgcolor: PAPER2, p: 1, mb: 1.25 }}>
              <Box component="span" sx={{ color: '#FBBF24' }}>short_score</Box>{' = '}
              <Box component="span" sx={{ color: RED }}>edge</Box>{' × '}
              <Box component="span" sx={{ color: ORANGE }}>regime_factor</Box>{' × '}
              <Box component="span" sx={{ color: '#FBBF24' }}>weak_boost</Box>
            </Box>
            {[
              { name: 'edge_score', color: RED, desc: 'WR × EV × grade_mult. A+ = 1.5×, A = 1.25×, B = 1.0×' },
              { name: 'regime_factor', color: ORANGE, desc: '1 + max(0, (50−regime)/50) × 0.6 → range 1.0–1.6×' },
              { name: 'weak_boost', color: '#FBBF24', desc: 'Fires when weak-market WR is 5pp+ higher than overall WR' },
            ].map(f => (
              <Box key={f.name} sx={{ mb: 1 }}>
                <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: f.color }}>{f.name}</Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.5 }}>{f.desc}</Typography>
              </Box>
            ))}
          </Box>

          {/* Squeeze Score */}
          <Box sx={{ p: 1.5, bgcolor: `${ORANGE}05`, border: `1px solid ${ORANGE}18`, borderLeft: `2px solid ${ORANGE}` }}>
            <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 800, color: ORANGE, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
              Squeeze Score Formula
            </Typography>
            <Box sx={{ ...MONO, fontSize: '0.68rem', color: INK2, lineHeight: 2, bgcolor: PAPER2, p: 1, mb: 1.25 }}>
              <Box component="span" sx={{ color: '#FBBF24' }}>squeeze</Box>{' = '}
              <Box component="span" sx={{ color: RED }}>edge</Box>{' × '}
              <Box component="span" sx={{ color: ORANGE }}>decline</Box>{' × '}
              <Box component="span" sx={{ color: '#FBBF24' }}>days</Box>{' × '}
              <Box component="span" sx={{ color: '#22C55E' }}>wr</Box>
            </Box>
            {[
              { name: 'decline_factor', color: RED, desc: 'min(2.5, 1 + |fall_from_20d_high| / 15)' },
              { name: 'days_factor', color: ORANGE, desc: 'min(1.8, 1 + days_below_sma20 / 30)' },
              { name: 'wr_factor', color: '#22C55E', desc: '(win_rate/100) × (1 + mkt_low_wr/150)' },
            ].map(f => (
              <Box key={f.name} sx={{ mb: 1 }}>
                <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: f.color }}>{f.name}</Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.5 }}>{f.desc}</Typography>
              </Box>
            ))}
          </Box>

          {/* Grades */}
          <Box sx={{ p: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 800, color: INK2, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
              Signal Grades
            </Typography>
            {[
              { grade: 'A+', desc: 'WR ≥65% and EV ≥4%. Rarest, most reliable.' },
              { grade: 'A',  desc: 'WR ≥60% and EV ≥2.5%. Reliable under normal conditions.' },
              { grade: 'B',  desc: 'WR ≥55% and EV ≥1.5%. Valid with regime support.' },
            ].map(g => (
              <Box key={g.grade} sx={{ display: 'flex', gap: 1.25, mb: 0.75, alignItems: 'flex-start' }}>
                <GradeBadge grade={g.grade} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.5 }}>{g.desc}</Typography>
              </Box>
            ))}
          </Box>

          {/* Key terms */}
          <Box sx={{ p: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 800, color: INK2, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
              Key Concepts
            </Typography>
            {[
              { term: 'Delivery %', desc: 'Share of traded volume resulting in actual delivery. High delivery on down days = institutional selling conviction.' },
              { term: 'EV (1M)', desc: 'Expected forward return 1 month after signal. Backtested on 5yr NIFTY 50.' },
              { term: 'Regime Score', desc: '0–100 based on price vs SMA20/50/100/200. 0 = below all SMAs.' },
            ].map(c => (
              <Box key={c.term} sx={{ mb: 0.9 }}>
                <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 700, color: INK2, letterSpacing: '0.06em' }}>{c.term}</Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.5 }}>{c.desc}</Typography>
              </Box>
            ))}
          </Box>

        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Short Card ───────────────────────────────────────────────────────────────

function ShortCard({ c, expanded, onToggle }: { c: ShortCandidate; expanded: boolean; onToggle: () => void }) {
  const { PAPER, BORDER, INK, INK2, INK3, PAPER2, CYAN } = usePalette()
  const navigate = useNavigate()
  const evColor  = c.expected_value > 0 ? '#22C55E' : RED
  const wrColor  = c.win_rate >= 60 ? '#22C55E' : c.win_rate >= 50 ? '#FBBF24' : RED
  const weakBoost = c.mkt_low_win_rate != null && c.mkt_low_win_rate > c.win_rate + 5

  return (
    <Box sx={{
      bgcolor: PAPER,
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${expanded ? RED : RED + '88'}`,
      transition: 'border-color 0.2s',
    }}>
      {/* Top row */}
      <Box sx={{ px: 2, pt: 1.75, pb: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            onClick={e => { e.stopPropagation(); navigate(`/stock/${c.symbol}`) }}
            sx={{ ...MONO, fontSize: '1.05rem', fontWeight: 800, color: INK, letterSpacing: '-0.01em',
              cursor: 'pointer', '&:hover': { color: CYAN }, transition: 'color 0.12s' }}
          >
            {c.symbol}
          </Typography>
          <GradeBadge grade={c.grade} />
          {c.is_active && <ActiveDot />}
        </Box>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, color: RED, letterSpacing: '0.04em' }}>
            {c.signal_name}
          </Typography>
          {c.max_drawdown_20d < -2 && (
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>
              {pf(c.max_drawdown_20d)} from 20D high
            </Typography>
          )}
        </Box>
      </Box>

      {/* Metric strip */}
      <Box sx={{
        mx: 2, mt: 1.25, display: 'flex',
        border: `1px solid ${BORDER}`,
        overflow: 'hidden',
        '& > *:not(:last-child)': { borderRight: `1px solid ${BORDER}` },
      }}>
        <Metric label="Win Rate" value={`${c.win_rate.toFixed(1)}%`} color={wrColor} />
        <Metric label="EV 1M" value={pn(c.expected_value)} color={evColor} />
        <Metric label="Edge" value={c.edge_score.toFixed(2)} color={INK2} />
        <Metric label="Del%" value={`${c.current_delivery_pct.toFixed(1)}%`} color={ORANGE} />
      </Box>

      {/* Regime */}
      <Box sx={{ px: 2, pt: 1.25 }}>
        <Box sx={{ display: 'flex', gap: 0.75, mb: 0.6 }}>
          <Typography sx={{ ...COND, fontSize: '0.55rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Regime
          </Typography>
        </Box>
        <RegimeIndicator score={c.regime_score} />
      </Box>

      {/* SMA chips */}
      <Box sx={{ px: 2, pt: 1, pb: 0.5, display: 'flex', flexWrap: 'wrap', gap: 0.6, alignItems: 'center' }}>
        {[
          { label: `SMA20 ${pf(c.pct_from_sma20)}`, pos: c.pct_from_sma20 >= 0 },
          { label: `SMA50 ${pf(c.pct_from_sma50)}`, pos: c.pct_from_sma50 >= 0 },
        ].map((s, i) => (
          <Box key={i} sx={{
            px: 0.75, py: 0.2,
            border: `1px solid ${s.pos ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
            bgcolor: s.pos ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
          }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: s.pos ? '#22C55E' : RED }}>
              {s.label}
            </Typography>
          </Box>
        ))}
        {c.days_below_sma20 > 0 && (
          <Box sx={{ px: 0.75, py: 0.2, bgcolor: `${RED}08`, border: `1px solid ${RED}20` }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: RED }}>
              {c.days_below_sma20}d below SMA20
            </Typography>
          </Box>
        )}
        <Box sx={{ ml: 'auto', display: 'flex', gap: 1.5 }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>Del {c.delivery_ratio.toFixed(2)}×</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>Vol {c.current_vol_ratio.toFixed(2)}×</Typography>
        </Box>
      </Box>

      {/* Weak market boost */}
      {weakBoost && c.mkt_low_win_rate != null && (
        <Box sx={{ mx: 2, mb: 0.5, mt: 0.5, px: 1.25, py: 0.75, bgcolor: PAPER2, border: `1px solid ${CYAN}30`, borderLeft: `2px solid ${CYAN}` }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2, lineHeight: 1.5 }}>
            <Box component="span" sx={{ ...MONO, fontWeight: 800, color: CYAN }}>{c.mkt_low_win_rate.toFixed(1)}% WR</Box>
            {' '}in weak market vs {c.win_rate.toFixed(1)}% overall —{' '}
            <Box component="span" sx={{ fontWeight: 600, color: INK }}>signal strengthens when breadth &lt;60</Box>
          </Typography>
        </Box>
      )}

      {/* Expand toggle */}
      <Box
        onClick={onToggle}
        sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
          borderTop: `1px solid ${BORDER}`,
          bgcolor: expanded ? `${RED}06` : PAPER2,
          '&:hover': { bgcolor: `${RED}08` }, transition: 'background 0.15s' }}
      >
        <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 700, color: expanded ? RED : INK2, letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
          {expanded ? 'Collapse' : 'Algo · Rationale · Interpretation'}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: expanded ? RED : INK3 }}>
          {expanded ? '[ − ]' : '[ + ]'}
        </Typography>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          <ShortDetailPanel c={c} />
        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Squeeze Card ─────────────────────────────────────────────────────────────

function SqueezeCard({ s, expanded, onToggle }: { s: SqueezeWatch; expanded: boolean; onToggle: () => void }) {
  const { PAPER, BORDER, INK, INK2, INK3, PAPER2, CYAN } = usePalette()
  const navigate = useNavigate()
  const riskColor = SQUEEZE_RISK_COLOR[s.squeeze_risk]
  const wrColor   = s.win_rate >= 60 ? '#22C55E' : s.win_rate >= 50 ? '#FBBF24' : RED
  const weakMktDanger = s.mkt_low_win_rate != null && s.mkt_low_win_rate > s.win_rate + 5

  return (
    <Box sx={{
      bgcolor: PAPER,
      border: `1px solid ${BORDER}`,
      borderLeft: `3px solid ${expanded ? riskColor : riskColor + '88'}`,
      transition: 'border-color 0.2s',
    }}>
      {/* Header */}
      <Box sx={{ px: 2, pt: 1.75, pb: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography
            onClick={e => { e.stopPropagation(); navigate(`/stock/${s.symbol}`) }}
            sx={{ ...MONO, fontSize: '1.05rem', fontWeight: 800, color: INK, letterSpacing: '-0.01em',
              cursor: 'pointer', '&:hover': { color: CYAN }, transition: 'color 0.12s' }}
          >
            {s.symbol}
          </Typography>
          {s.is_active && <ActiveDot />}
        </Box>
        <Box sx={{ px: 0.75, py: 0.2, bgcolor: riskColor + '14', border: `1px solid ${riskColor}35` }}>
          <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 900, color: riskColor, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            {s.squeeze_risk} RISK
          </Typography>
        </Box>
      </Box>

      {/* Why it's dangerous — compact 3-row list */}
      <Box sx={{ px: 2, pt: 1.25, display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        {[
          { label: 'FALL', value: `${Math.abs(s.decline_pct_20d).toFixed(1)}% from 20D high`, color: RED },
          { label: 'SMA20', value: `${s.days_below_sma20}d below (${pf(s.pct_from_sma20)})`, color: ORANGE },
          { label: 'SIGNAL', value: s.trigger_signal, color: riskColor },
        ].map((r, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Typography sx={{ ...COND, fontSize: '0.55rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', minWidth: 46 }}>
              {r.label}
            </Typography>
            <Box sx={{ flex: 1, height: 1, bgcolor: BORDER }} />
            <Typography sx={{ ...MONO, fontSize: '0.65rem', fontWeight: 700, color: r.color }}>
              {r.value}
            </Typography>
          </Box>
        ))}
      </Box>

      {/* Metrics */}
      <Box sx={{
        mx: 2, mt: 1.25, display: 'flex',
        border: `1px solid ${BORDER}`,
        overflow: 'hidden',
        '& > *:not(:last-child)': { borderRight: `1px solid ${BORDER}` },
      }}>
        <Metric label="Grade" value={s.grade} color={GRADE_COLOR[s.grade] ?? '#94A3B8'} />
        <Metric label="Win Rate" value={`${s.win_rate.toFixed(1)}%`} color={wrColor} />
        <Metric label="EV 1M" value={pn(s.expected_value)} color={s.expected_value > 0 ? '#22C55E' : RED} />
        <Metric label="Del%" value={`${s.current_delivery_pct.toFixed(1)}%`} color={riskColor} />
      </Box>

      {/* Regime */}
      <Box sx={{ px: 2, pt: 1.25 }}>
        <Typography sx={{ ...COND, fontSize: '0.55rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 0.6 }}>
          Regime
        </Typography>
        <RegimeIndicator score={s.regime_score} />
      </Box>

      {/* Danger callout */}
      {weakMktDanger && s.mkt_low_win_rate != null && (
        <Box sx={{ mx: 2, mt: 1, mb: 0.5, px: 1.25, py: 0.75, bgcolor: `${RED}06`, border: `1px solid ${RED}18`, borderLeft: `2px solid ${RED}` }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: INK2, lineHeight: 1.5 }}>
            <Box component="span" sx={{ ...MONO, fontWeight: 800, color: RED }}>Danger</Box>
            {' — signal has '}
            <Box component="span" sx={{ ...MONO, fontWeight: 800, color: riskColor }}>{s.mkt_low_win_rate.toFixed(1)}% WR in weak markets</Box>
            {' — exactly the regime your short is in. Cover or tighten stop.'}
          </Typography>
        </Box>
      )}

      {/* Expand toggle */}
      <Box
        onClick={onToggle}
        sx={{ px: 2, py: 1, display: 'flex', alignItems: 'center', gap: 1, cursor: 'pointer',
          borderTop: `1px solid ${BORDER}`,
          bgcolor: expanded ? `${riskColor}06` : PAPER2,
          '&:hover': { bgcolor: `${riskColor}09` }, transition: 'background 0.15s' }}
      >
        <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 700, color: expanded ? riskColor : INK2, letterSpacing: '0.08em', textTransform: 'uppercase', flex: 1 }}>
          {expanded ? 'Collapse' : 'Algo · Rationale · What to Do'}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: expanded ? riskColor : INK3 }}>
          {expanded ? '[ − ]' : '[ + ]'}
        </Typography>
      </Box>

      <Collapse in={expanded} unmountOnExit>
        <Box sx={{ px: 2, pb: 2 }}>
          <SqueezeDetailPanel s={s} />
        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Market context bar ───────────────────────────────────────────────────────

function MarketContextBar({ ctx }: { ctx: MarketContext }) {
  const { BORDER, PAPER, INK2, INK3 } = usePalette()
  const regimeColor = ctx.avg_regime_score < 30 ? RED
    : ctx.avg_regime_score < 50 ? ORANGE
    : ctx.avg_regime_score < 65 ? '#FBBF24' : '#22C55E'
  const regimeLabel = ctx.avg_regime_score < 30 ? 'VERY WEAK'
    : ctx.avg_regime_score < 50 ? 'WEAK'
    : ctx.avg_regime_score < 65 ? 'NEUTRAL' : 'STRONG'

  return (
    <Box sx={{ mb: 2.5, border: `1px solid ${BORDER}`, bgcolor: PAPER }}>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', divideX: 1 }}>
        {/* Stat 1 */}
        <Box sx={{ flex: 1, minWidth: 140, px: 2.5, py: 2, borderRight: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 0.5 }}>
            Avg Regime
          </Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: '2.25rem', fontWeight: 700, color: regimeColor, lineHeight: 1 }}>
            {ctx.avg_regime_score.toFixed(0)}
          </Typography>
          <Typography sx={{ ...COND, fontSize: '0.8125rem', fontWeight: 600, color: INK2, letterSpacing: '0.05em' }}>
            {regimeLabel} market
          </Typography>
        </Box>

        {/* Stat 2 */}
        <Box sx={{ flex: 1, minWidth: 140, px: 2.5, py: 2, borderRight: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 0.5 }}>
            Short Candidates
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
            <Typography sx={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: '2.25rem', fontWeight: 700, color: RED, lineHeight: 1 }}>
              {ctx.short_candidate_count}
            </Typography>
            {ctx.active_short_signals > 0 && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <ActiveDot />
                <Typography sx={{ ...MONO, fontSize: '0.75rem', color: RED }}>
                  {ctx.active_short_signals} live
                </Typography>
              </Box>
            )}
          </Box>
          <Typography sx={{ ...COND, fontSize: '0.8125rem', color: INK2 }}>
            {ctx.active_short_signals} active today
          </Typography>
        </Box>

        {/* Stat 3 */}
        <Box sx={{ flex: 1, minWidth: 140, px: 2.5, py: 2, borderRight: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 0.5 }}>
            Squeeze Watch
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.25 }}>
            <Typography sx={{ fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontSize: '2.25rem', fontWeight: 700, color: ORANGE, lineHeight: 1 }}>
              {ctx.squeeze_watch_count}
            </Typography>
            {ctx.active_squeeze_signals > 0 && (
              <Typography sx={{ ...MONO, fontSize: '0.75rem', color: ORANGE }}>
                {ctx.active_squeeze_signals} active
              </Typography>
            )}
          </Box>
          <Typography sx={{ ...COND, fontSize: '0.8125rem', color: INK2 }}>
            {ctx.active_squeeze_signals} signals firing
          </Typography>
        </Box>

        {/* Timestamp */}
        <Box sx={{ px: 2.5, py: 2, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', minWidth: 140 }}>
          <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>{ctx.computed_at}</Typography>
          <Typography sx={{ ...COND, fontSize: '0.75rem', color: INK3, letterSpacing: '0.06em', mt: 0.5 }}>NIFTY 50 universe</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({
  title, count, activeCount, accentColor, subtitle,
}: {
  title: string; count: number; activeCount: number; accentColor: string; subtitle: string
}) {
  const { INK, INK2, BORDER } = usePalette()
  return (
    <Box sx={{ mb: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5, mb: 0.75 }}>
        <Typography sx={{ ...COND, fontSize: '1.05rem', fontWeight: 700, color: INK, letterSpacing: '0.03em', textTransform: 'uppercase' }}>
          {title}
        </Typography>
        <Pill label={`${count}`} color={accentColor} />
        {activeCount > 0 && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <ActiveDot />
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: RED }}>
              {activeCount} live
            </Typography>
          </Box>
        )}
        <Box sx={{ flex: 1, height: 1, bgcolor: BORDER, ml: 0.5 }} />
      </Box>
      <SquiggleUnderline width={120} color={accentColor} sx={{ mb: 0.75 }} />
      <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK2, lineHeight: 1.55 }}>
        {subtitle}
      </Typography>
    </Box>
  )
}

// ─── Filter tab ───────────────────────────────────────────────────────────────

function FilterTab({
  label, value, current, onChange, accent,
}: {
  label: string; value: string; current: string; onChange: (v: string) => void; accent: string
}) {
  const { INK3 } = usePalette()
  const active = current === value
  return (
    <Box
      onClick={() => onChange(value)}
      sx={{
        px: 1.5, py: 0.6, cursor: 'pointer',
        borderBottom: active ? `2px solid ${accent}` : '2px solid transparent',
        ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
        color: active ? accent : INK3,
        '&:hover': { color: accent },
        transition: 'all 0.1s',
      }}
    >
      {label}
    </Box>
  )
}

// ─── Squeeze risk legend ──────────────────────────────────────────────────────

function SqueezeLegend() {
  const { BORDER, PAPER, INK2, INK3 } = usePalette()
  return (
    <Box sx={{ mt: 3, p: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER }}>
      <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 700, color: INK3, letterSpacing: '0.14em', textTransform: 'uppercase', mb: 1.25 }}>
        How Squeeze Risk Is Scored
      </Typography>
      {[
        { label: 'HIGH', color: RED, desc: 'Score ≥6 — large decline + strong bullish signal + weak-market amplification. Immediate cover consideration for existing shorts.' },
        { label: 'MEDIUM', color: ORANGE, desc: 'Score 2.5–6 — moderate decline + validated signal. Monitor closely and tighten stops if short.' },
        { label: 'LOW', color: '#FBBF24', desc: 'Score <2.5 — mild conditions. Signal present but squeeze setup is early-stage, not urgent.' },
      ].map(r => (
        <Box key={r.label} sx={{ display: 'flex', gap: 1.5, mb: 1, alignItems: 'flex-start' }}>
          <Box sx={{ px: 0.6, py: 0.15, bgcolor: r.color + '18', border: `1px solid ${r.color}35`, flexShrink: 0 }}>
            <Typography sx={{ ...COND, fontSize: '0.58rem', fontWeight: 800, color: r.color, letterSpacing: '0.1em' }}>
              {r.label}
            </Typography>
          </Box>
          <Typography sx={{ ...JAKARTA, fontSize: '0.62rem', color: INK2, lineHeight: 1.6 }}>
            {r.desc}
          </Typography>
        </Box>
      ))}
    </Box>
  )
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ShortPage() {
  const { BG, PAPER, BORDER, CYAN, INK, INK2, INK3 } = useTokens()
  const { mode } = useThemeMode()

  const [data, setData]       = useState<{ short_candidates: ShortCandidate[]; squeeze_watch: SqueezeWatch[]; market_context: MarketContext } | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)
  const [shortFilter, setShortFilter]   = useState<'all' | 'active'>('all')
  const [sqFilter, setSqFilter]         = useState<'all' | 'high' | 'active'>('all')
  const [expandedShort, setExpandedShort]     = useState<string | null>(null)
  const [expandedSqueeze, setExpandedSqueeze] = useState<string | null>(null)
  const [symSearch, setSymSearch] = useState('')

  useEffect(() => {
    shortApi.getIntelligence()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const shorts = useMemo(() => (data?.short_candidates ?? []).filter(c => {
    if (shortFilter === 'active' && !c.is_active) return false
    if (symSearch && !c.symbol.toUpperCase().includes(symSearch.toUpperCase())) return false
    return true
  }), [data, shortFilter, symSearch])

  const squeezes = useMemo(() => (data?.squeeze_watch ?? []).filter(s => {
    if (sqFilter === 'high'   && s.squeeze_risk !== 'High')  return false
    if (sqFilter === 'active' && !s.is_active)               return false
    if (symSearch && !s.symbol.toUpperCase().includes(symSearch.toUpperCase())) return false
    return true
  }), [data, sqFilter, symSearch])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -100, right: '10%', width: 500, height: 400, borderRadius: '50%', background: `radial-gradient(ellipse, #EF444412 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: '5%', width: 300, height: 300, borderRadius: '50%', background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5, px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid #EF444440`, bgcolor: `#EF44440D` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: '#EF4444', animation: 'hpulse 2s ease-in-out infinite', '@keyframes hpulse': { '0%,100%': { boxShadow: '0 0 4px #EF4444' }, '50%': { boxShadow: '0 0 14px #EF4444' } } }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: '#EF4444', letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Short Squeeze · Delivery Intelligence
            </Typography>
          </Box>
          <Typography sx={{ ...JAKARTA, fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5 }}>
            Short{' '}
            <Box component="span" sx={{ color: '#EF4444', textShadow: '0 0 32px #EF444470' }}>Intelligence</Box>
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, maxWidth: 520 }}>
            Systematic short candidate scanner — delivery data, squeeze risk, and statistical edge. Every signal validated. Every grade evidence-based.
          </Typography>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>

        {loading ? (
          <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 12 }}>
            <CircularProgress size={28} sx={{ color: RED }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.78rem', color: INK2 }}>
              Scanning NIFTY 50 for short opportunities…
            </Typography>
          </Box>
        ) : error ? (
          <Box sx={{ p: 3, border: `1px solid ${RED}30`, borderLeft: `3px solid ${RED}`, bgcolor: PAPER }}>
            <Typography sx={{ ...MONO, color: RED, fontSize: '0.8rem', mb: 0.5 }}>{error}</Typography>
            <Typography sx={{ ...JAKARTA, color: INK3, fontSize: '0.7rem' }}>
              Make sure the backend is running at localhost:8000
            </Typography>
          </Box>
        ) : data && (
          <>
            <MarketContextBar ctx={data.market_context} />

            {/* Research note */}
            {data.short_candidates.filter(c => c.is_active).length > 0 && (
              <ResearchNote accent={RED} sx={{ mb: 2.5 }}>
                {data.short_candidates.filter(c => c.is_active).length} signal{data.short_candidates.filter(c => c.is_active).length > 1 ? 's' : ''} firing today —{' '}
                {data.short_candidates.filter(c => c.is_active).slice(0, 4).map(c => c.symbol).join(', ')}
                {data.short_candidates.filter(c => c.is_active).length > 4 ? ` +${data.short_candidates.filter(c => c.is_active).length - 4} more` : ''}
              </ResearchNote>
            )}

            <AlgoGuide />

            {/* Search */}
            <Box sx={{ mb: 2.5 }}>
              <SearchBox
                value={symSearch}
                onChange={setSymSearch}
                placeholder="Filter by symbol…"
                width={240}
              />
            </Box>

            {/* Two-column grid */}
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 4, alignItems: 'start' }}>

              {/* ── Short Candidates ── */}
              <Box>
                <SectionHeader
                  title="Short Opportunities"
                  count={shorts.length}
                  activeCount={shorts.filter(c => c.is_active).length}
                  accentColor={RED}
                  subtitle="Bearish delivery signals (Grade A/B, positive EV) ranked by composite short score — regime context + signal quality"
                />

                {/* Filter tabs */}
                <Box sx={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, mb: 2 }}>
                  <FilterTab label="All Signals" value="all" current={shortFilter} onChange={v => setShortFilter(v as 'all' | 'active')} accent={RED} />
                  <FilterTab label="Active Today" value="active" current={shortFilter} onChange={v => setShortFilter(v as 'all' | 'active')} accent={RED} />
                </Box>

                {shorts.length === 0 ? (
                  <Box sx={{ p: 3, border: `1px solid ${BORDER}`, bgcolor: PAPER, textAlign: 'center' }}>
                    <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', color: INK3 }}>
                      No short candidates match current filters.
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {shorts.map(c => (
                      <ShortCard
                        key={c.symbol + c.signal_name}
                        c={c}
                        expanded={expandedShort === c.symbol + c.signal_name}
                        onToggle={() => setExpandedShort(
                          expandedShort === c.symbol + c.signal_name ? null : c.symbol + c.signal_name
                        )}
                      />
                    ))}
                  </Box>
                )}
              </Box>

              {/* ── Squeeze Watch ── */}
              <Box>
                <SectionHeader
                  title="Squeeze Watch"
                  count={squeezes.length}
                  activeCount={squeezes.filter(s => s.is_active).length}
                  accentColor={ORANGE}
                  subtitle="Declining stocks showing bullish delivery signals — potential short squeeze risk ranked by severity"
                />

                {/* Filter tabs */}
                <Box sx={{ display: 'flex', borderBottom: `1px solid ${BORDER}`, mb: 2 }}>
                  {([
                    { v: 'all', label: 'All' },
                    { v: 'high', label: 'High Risk' },
                    { v: 'active', label: 'Active' },
                  ] as const).map(f => (
                    <FilterTab key={f.v} label={f.label} value={f.v} current={sqFilter}
                      onChange={v => setSqFilter(v as 'all' | 'high' | 'active')} accent={ORANGE} />
                  ))}
                </Box>

                {squeezes.length === 0 ? (
                  <Box sx={{ p: 3, border: `1px solid ${BORDER}`, bgcolor: PAPER, textAlign: 'center' }}>
                    <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', color: INK3 }}>
                      No squeeze candidates match current filters.
                    </Typography>
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}>
                    {squeezes.map(s => (
                      <SqueezeCard
                        key={s.symbol}
                        s={s}
                        expanded={expandedSqueeze === s.symbol}
                        onToggle={() => setExpandedSqueeze(
                          expandedSqueeze === s.symbol ? null : s.symbol
                        )}
                      />
                    ))}
                  </Box>
                )}

                <SqueezeLegend />
              </Box>

            </Box>
          </>
        )}

      </Box>

      <Footer />
    </Box>
  )
}
