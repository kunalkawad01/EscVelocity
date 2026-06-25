/**
 * TradeDecisionPage — Live Trade Intelligence
 *
 * Two modes:
 *   Scan Mode  → surfaces best setups from NIFTY 50 universe (scan panel left)
 *   Analyze Mode → user types symbol + direction for on-demand deep-dive
 *
 * Right panel always shows the full TradeBrief research report when a setup
 * is active: verdict, market context, instrument analysis, signal matrix,
 * risk parameters, historical context, and LLM narrative.
 */

import { useState, useCallback } from 'react'
import {
  Box, Grid, Typography, CircularProgress, Alert,
  ToggleButton, ToggleButtonGroup, Chip, Divider,
  Table, TableBody, TableRow, TableCell, TableHead,
  OutlinedInput, Select, MenuItem, InputAdornment,
  LinearProgress, Tooltip,
} from '@mui/material'
import Navbar        from '../components/Navbar'
import { Footer }    from '../components/Footer'
import SectionHead   from '../components/shared/SectionHead'
import SearchBox     from '../components/shared/SearchBox'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode }          from '../contexts/ThemeModeContext'
import { tradeDecisionApi }      from '../api/tradeDecisionApi'
import type {
  TradeBriefResponse, ScanSetupOut, ScanResponse,
  Direction, InstrumentType,
} from '../types/trade_decision'

// ── Fonts ─────────────────────────────────────────────────────────────────────
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ── Verdict config ─────────────────────────────────────────────────────────────
const VERDICT_CONFIG: Record<string, { glyph: string; bg: string; label: string }> = {
  'STRONG GO':    { glyph: '◆◆', bg: '#16a34a', label: 'STRONG GO' },
  'GO':           { glyph: '◆',  bg: '#22c55e', label: 'GO' },
  'WEAK GO':      { glyph: '◇',  bg: '#d97706', label: 'WEAK GO' },
  'NO-GO':        { glyph: '✕',  bg: '#ea580c', label: 'NO-GO' },
  'STRONG NO-GO': { glyph: '✕✕', bg: '#dc2626', label: 'STRONG NO-GO' },
}

// ── Score ring ─────────────────────────────────────────────────────────────────
function ScoreRing({ score, color, size = 64 }: { score: number; color: string; size?: number }) {
  const r   = (size - 8) / 2
  const circ = 2 * Math.PI * r
  const dash = (score / 100) * circ
  return (
    <Box sx={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={6} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color}
          strokeWidth={6} strokeDasharray={`${dash} ${circ}`} strokeLinecap="round" />
      </svg>
      <Box sx={{
        position: 'absolute', inset: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ ...MONO, fontSize: size > 56 ? '0.9rem' : '0.72rem', fontWeight: 700, color }}>
          {score.toFixed(0)}
        </Typography>
      </Box>
    </Box>
  )
}

// ── Signal pill ────────────────────────────────────────────────────────────────
function SignalPill({ text, type }: { text: string; type: 'confirm' | 'contra' | 'neutral' }) {
  const bg = type === 'confirm' ? 'rgba(34,197,94,0.12)' :
             type === 'contra'  ? 'rgba(239,68,68,0.12)'  :
             'rgba(148,163,184,0.12)'
  const color = type === 'confirm' ? '#22c55e' :
                type === 'contra'  ? '#ef4444'  : '#94a3b8'
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      px: 1.25, py: 0.4, borderRadius: '20px',
      bgcolor: bg, border: `1px solid ${color}22`, mr: 0.75, mb: 0.75,
    }}>
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ ...SANS, fontSize: '0.68rem', color, fontWeight: 600 }}>
        {text}
      </Typography>
    </Box>
  )
}

// ── Sub-section card ──────────────────────────────────────────────────────────
function SubCard({ title, accent, score, insight, children }: {
  title: string; accent: string; score?: number; insight?: string; children?: React.ReactNode
}) {
  const { PAPER2, BORDER, INK3 } = usePalette()
  return (
    <Box sx={{ bgcolor: PAPER2, borderRadius: '12px', border: `1px solid ${BORDER}`, p: 2, mb: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1.25 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ width: 3, height: 16, borderRadius: '2px', bgcolor: accent }} />
          <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 800, color: accent }}>
            {title}
          </Typography>
        </Box>
        {score !== undefined && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <LinearProgress
              variant="determinate" value={score}
              sx={{
                width: 64, height: 5, borderRadius: 3,
                bgcolor: `${accent}22`,
                '& .MuiLinearProgress-bar': { bgcolor: accent, borderRadius: 3 },
              }}
            />
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: accent, fontWeight: 700 }}>
              {score.toFixed(0)}
            </Typography>
          </Box>
        )}
      </Box>
      {insight && (
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, mb: children ? 1.25 : 0, lineHeight: 1.5 }}>
          {insight}
        </Typography>
      )}
      {children}
    </Box>
  )
}

// ── Metric row ─────────────────────────────────────────────────────────────────
function MetricRow({ label, value, unit = '', color }: {
  label: string; value: string | number | null; unit?: string; color?: string
}) {
  const { INK, INK2, INK3, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      py: 0.6, borderBottom: `1px solid ${BORDER}22` }}>
      <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>{label}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 600,
        color: color || (value === null ? INK3 : INK) }}>
        {value !== null && value !== undefined ? `${value}${unit}` : '—'}
      </Typography>
    </Box>
  )
}

// ── Confidence gauge ───────────────────────────────────────────────────────────
function ConfidenceGauge({ score, verdict, color }: { score: number; verdict: string; color: string }) {
  const cfg = VERDICT_CONFIG[verdict] || VERDICT_CONFIG['NO-GO']
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1 }}>
      <ScoreRing score={score} color={color} size={88} />
      <Box sx={{
        px: 2, py: 0.5, borderRadius: '20px',
        bgcolor: `${color}20`, border: `1px solid ${color}44`,
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 800, color }}>
          {cfg.glyph} {cfg.label}
        </Typography>
      </Box>
    </Box>
  )
}

// ── Scan row ───────────────────────────────────────────────────────────────────
function ScanRow({
  setup, active, onClick,
}: { setup: ScanSetupOut; active: boolean; onClick: () => void }) {
  const { PAPER2, BORDER, INK, INK2, INK3, CYAN } = usePalette()
  const cfg = VERDICT_CONFIG[setup.verdict] || VERDICT_CONFIG['NO-GO']
  return (
    <Box onClick={onClick} sx={{
      display: 'flex', alignItems: 'center', gap: 1.5,
      px: 1.75, py: 1.25, cursor: 'pointer', borderRadius: '10px',
      bgcolor: active ? `${CYAN}12` : 'transparent',
      border: `1px solid ${active ? CYAN : 'transparent'}`,
      mb: 0.5, transition: 'all 0.15s',
      '&:hover': { bgcolor: PAPER2 },
    }}>
      {/* Direction badge */}
      <Box sx={{
        width: 32, height: 32, borderRadius: '8px', flexShrink: 0,
        bgcolor: setup.direction === 'LONG' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800,
          color: setup.direction === 'LONG' ? '#22c55e' : '#ef4444' }}>
          {setup.direction === 'LONG' ? '▲' : '▼'}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.25 }}>
          <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: INK }}>
            {setup.symbol}
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3,
            bgcolor: `${INK3}15`, px: 0.75, py: 0.1, borderRadius: '4px' }}>
            {setup.instrument_type}
          </Typography>
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK2,
          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {setup.one_liner}
        </Typography>
      </Box>

      <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 0.25, flexShrink: 0 }}>
        <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: setup.verdict_color }}>
          {setup.confidence.toFixed(0)}
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.6rem', color: setup.verdict_color }}>
          {cfg.label}
        </Typography>
      </Box>
    </Box>
  )
}

// ── Research Brief ─────────────────────────────────────────────────────────────
function ResearchBrief({ brief }: { brief: TradeBriefResponse }) {
  const { INK, INK2, INK3, BORDER, PAPER, PAPER2, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const mc  = brief.market_context
  const ia  = brief.instrument_analysis
  const sc  = brief.signal_convergence
  const rc  = brief.risk_calibration
  const hc  = brief.historical_context

  return (
    <Box>
      {/* ── Verdict header ─────────────────────────────────────────────────── */}
      <Box sx={{
        ...CARD, mb: 2,
        background: mode === 'dark'
          ? `linear-gradient(135deg, ${brief.verdict_color}18 0%, ${PAPER} 60%)`
          : `linear-gradient(135deg, ${brief.verdict_color}10 0%, ${PAPER} 60%)`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, flexWrap: 'wrap' }}>
          {/* Left: symbol + direction */}
          <Box sx={{ flex: 1, minWidth: 200 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75 }}>
              <Typography sx={{
                ...MONO, fontSize: '1.6rem', fontWeight: 800,
                color: brief.direction === 'LONG' ? '#22c55e' : '#ef4444',
              }}>
                {brief.direction === 'LONG' ? '▲' : '▼'}
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '1.4rem', fontWeight: 800, color: INK }}>
                {brief.symbol}
              </Typography>
              <Chip
                label={brief.instrument_type}
                size="small"
                sx={{ ...SANS, fontSize: '0.62rem', fontWeight: 700,
                  bgcolor: `${CYAN}18`, color: CYAN, border: `1px solid ${CYAN}33` }}
              />
            </Box>

            {/* Narrative */}
            <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, lineHeight: 1.6, mb: 1.5 }}>
              {brief.narrative}
            </Typography>

            {/* Checklist */}
            <Box>
              {brief.trade_checklist.map((item, i) => (
                <Typography key={i} sx={{
                  ...SANS, fontSize: '0.7rem', color: item.startsWith('✅') ? '#22c55e' : '#ef4444',
                  mb: 0.4, lineHeight: 1.4,
                }}>
                  {item}
                </Typography>
              ))}
            </Box>
          </Box>

          {/* Right: confidence gauge */}
          <ConfidenceGauge
            score={brief.confidence}
            verdict={brief.verdict}
            color={brief.verdict_color}
          />
        </Box>
      </Box>

      {/* ── 2-col grid for sub-agent cards ─────────────────────────────────── */}
      <Grid container spacing={1.5}>
        {/* Market Context */}
        <Grid item xs={12} md={6}>
          <SubCard title="01 · MARKET CONTEXT" accent="#6366f1"
            score={mc.market_score} insight={mc.key_insight}>
            <MetricRow label="Regime Score"  value={mc.regime_score.toFixed(0)}  unit="/100" />
            <MetricRow label="Breadth Score" value={mc.breadth_score.toFixed(0)} unit="/100" />
            <MetricRow label="Market Posture" value={mc.posture}
              color={mc.posture === 'BULL' ? '#22c55e' : mc.posture === 'BEAR' ? '#ef4444' : '#fbbf24'} />
            {mc.vix_level && <MetricRow label="India VIX" value={mc.vix_level.toFixed(1)} />}
          </SubCard>
        </Grid>

        {/* Instrument Analysis */}
        <Grid item xs={12} md={6}>
          <SubCard title="02 · INSTRUMENT ANALYSIS" accent="#a855f7"
            score={ia.instrument_score} insight={ia.key_insight}>
            {ia.dna_score   !== null && <MetricRow label="DNA Score"       value={ia.dna_score?.toFixed(0)}   unit="/100" />}
            {ia.regime_score !== null && <MetricRow label="Regime Score"    value={ia.regime_score?.toFixed(0)} unit="/100" />}
            {ia.rs_score    !== null && <MetricRow label="Relative Strength" value={ia.rs_score?.toFixed(0)}    unit="/100" />}
            {ia.iv_rank     !== null && <MetricRow label="IV Rank"          value={ia.iv_rank?.toFixed(0)}      unit="th pct" />}
            {ia.oi_trend    !== null && <MetricRow label="OI Trend"         value={ia.oi_trend} />}
            {ia.delivery_signal && <MetricRow label="Delivery Signal" value={ia.delivery_signal} color="#fbbf24" />}
          </SubCard>
        </Grid>

        {/* Signal Convergence */}
        <Grid item xs={12}>
          <SubCard title="03 · SIGNAL CONVERGENCE" accent="#f59e0b"
            score={sc.alignment_score} insight={sc.key_insight}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', mt: 0.5 }}>
              {sc.confirming_signals.map(s =>
                <SignalPill key={s} text={s} type="confirm" />
              )}
              {sc.contradicting_signals.map(s =>
                <SignalPill key={s} text={s} type="contra" />
              )}
              {sc.neutral_signals.map(s =>
                <SignalPill key={s} text={s} type="neutral" />
              )}
              {sc.confirming_signals.length + sc.contradicting_signals.length + sc.neutral_signals.length === 0 && (
                <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>
                  No signals loaded — start backend prewarm to populate.
                </Typography>
              )}
            </Box>
          </SubCard>
        </Grid>

        {/* Risk Calibration */}
        <Grid item xs={12} md={6}>
          <SubCard title="04 · RISK CALIBRATION" accent="#10b981"
            score={rc.risk_score} insight={rc.key_insight}>
            {rc.risk_reward_ratio !== null && (
              <MetricRow label="Risk / Reward" value={`${rc.risk_reward_ratio}:1`}
                color={rc.risk_reward_ratio >= 2 ? '#22c55e' : '#fbbf24'} />
            )}
            {rc.stop_loss    !== null && <MetricRow label="Stop Loss"  value={`₹${rc.stop_loss}`}  color="#ef4444" />}
            {rc.target_1     !== null && <MetricRow label="Target 1"   value={`₹${rc.target_1}`}   color="#22c55e" />}
            {rc.target_2     !== null && <MetricRow label="Target 2"   value={`₹${rc.target_2}`}   color="#4ade80" />}
            {rc.position_size_pct !== null && (
              <MetricRow label="Position Size" value={rc.position_size_pct.toFixed(1)} unit="% of capital" />
            )}
            {rc.max_risk_pct !== null && (
              <MetricRow label="Max Risk" value={rc.max_risk_pct.toFixed(1)} unit="% of capital" color="#f97316" />
            )}
            {rc.atr_20 !== null && <MetricRow label="ATR (20)" value={rc.atr_20?.toFixed(1)} />}
          </SubCard>
        </Grid>

        {/* Historical Context */}
        <Grid item xs={12} md={6}>
          <SubCard title="05 · HISTORICAL CONTEXT" accent="#06b6d4"
            score={hc.historical_score} insight={hc.key_insight}>
            {hc.win_rate_similar !== null && (
              <MetricRow label="Signal Win Rate" value={hc.win_rate_similar.toFixed(0)} unit="%"
                color={hc.win_rate_similar >= 60 ? '#22c55e' : hc.win_rate_similar >= 50 ? '#fbbf24' : '#ef4444'} />
            )}
            {hc.regime_win_rate !== null && (
              <MetricRow label="Regime-Conditioned WR" value={hc.regime_win_rate.toFixed(0)} unit="%" />
            )}
            {hc.comparable_setups_count > 0 && (
              <MetricRow label="Historical Setups" value={hc.comparable_setups_count} />
            )}
            {hc.avg_gain_on_wins !== null && (
              <MetricRow label="Avg Gain (wins)" value={`+${(hc.avg_gain_on_wins * 100).toFixed(1)}`} unit="%" color="#22c55e" />
            )}
            {hc.avg_loss_on_losses !== null && (
              <MetricRow label="Avg Loss (losses)" value={`${(hc.avg_loss_on_losses * 100).toFixed(1)}`} unit="%" color="#ef4444" />
            )}
            {hc.win_rate_similar === null && hc.comparable_setups_count === 0 && (
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3 }}>
                No historical data — signal not yet active for this stock.
              </Typography>
            )}
          </SubCard>
        </Grid>
      </Grid>
    </Box>
  )
}

// ── Main Page ──────────────────────────────────────────────────────────────────
export default function TradeDecisionPage() {
  const { BG, PAPER, PAPER2, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { CARD, INPUT_SX, TH, TD }                             = useTokens()
  const { mode }                                               = useThemeMode()

  // ── Mode toggle ──────────────────────────────────────────────────────────────
  const [pageMode, setPageMode] = useState<'scan' | 'analyze'>('analyze')

  // ── Analyze state ────────────────────────────────────────────────────────────
  const [symbol,         setSymbol]         = useState('')
  const [direction,      setDirection]      = useState<Direction>('LONG')
  const [instrumentType, setInstrumentType] = useState<InstrumentType>('EQUITY')
  const [entryPrice,     setEntryPrice]     = useState('')
  const [accountSize,    setAccountSize]    = useState('')

  const [brief,        setBrief]        = useState<TradeBriefResponse | null>(null)
  const [analyzing,    setAnalyzing]    = useState(false)
  const [analyzeError, setAnalyzeError] = useState<string | null>(null)

  // ── Scan state ───────────────────────────────────────────────────────────────
  const [scanData,    setScanData]    = useState<ScanResponse | null>(null)
  const [scanning,    setScanning]    = useState(false)
  const [scanError,   setScanError]   = useState<string | null>(null)
  const [activeSetup, setActiveSetup] = useState<ScanSetupOut | null>(null)

  // ── Analyze handler ──────────────────────────────────────────────────────────
  const handleAnalyze = useCallback(async () => {
    if (!symbol.trim()) return
    setAnalyzing(true)
    setAnalyzeError(null)
    setBrief(null)
    try {
      const result = await tradeDecisionApi.analyze({
        symbol:          symbol.trim().toUpperCase(),
        direction,
        instrument_type: instrumentType,
        entry_price:     entryPrice ? parseFloat(entryPrice) : undefined,
        account_size:    accountSize ? parseFloat(accountSize) : undefined,
      })
      setBrief(result)
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }, [symbol, direction, instrumentType, entryPrice, accountSize])

  // ── Scan handler ─────────────────────────────────────────────────────────────
  const handleScan = useCallback(async () => {
    setScanning(true)
    setScanError(null)
    setScanData(null)
    setActiveSetup(null)
    setBrief(null)
    try {
      const result = await tradeDecisionApi.scan({ min_confidence: 55, max_results: 25 })
      setScanData(result)
    } catch (e: unknown) {
      setScanError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setScanning(false)
    }
  }, [])

  // ── Drill into scan setup ────────────────────────────────────────────────────
  const handleSetupClick = useCallback(async (setup: ScanSetupOut) => {
    setActiveSetup(setup)
    setAnalyzing(true)
    setBrief(null)
    setAnalyzeError(null)
    try {
      const result = await tradeDecisionApi.analyze({
        symbol:          setup.symbol,
        direction:       setup.direction,
        instrument_type: setup.instrument_type,
      })
      setBrief(result)
    } catch (e: unknown) {
      setAnalyzeError(e instanceof Error ? e.message : 'Analysis failed')
    } finally {
      setAnalyzing(false)
    }
  }, [])

  // ── Hero gradient ─────────────────────────────────────────────────────────────
  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* ── Hero ────────────────────────────────────────────────────────────── */}
      <Box sx={{ background: heroBg, pt: 10, pb: 5, px: { xs: 2, md: 4 } }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto' }}>

          {/* Eyebrow badge */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e',
              boxShadow: '0 0 0 3px rgba(34,197,94,0.25)',
              animation: 'pulse 2s ease-in-out infinite',
              '@keyframes pulse': {
                '0%, 100%': { opacity: 1 },
                '50%':      { opacity: 0.4 },
              },
            }} />
            <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700,
              color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
              Live Intelligence
            </Typography>
          </Box>

          {/* Headline */}
          <Typography sx={{ ...SANS, fontWeight: 900, lineHeight: 1.1, mb: 1.5,
            fontSize: { xs: '2rem', md: '2.8rem' }, color: INK }}>
            Trade Decision<br />
            <Box component="span" sx={{ color: CYAN }}>Agent</Box>
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.88rem', color: INK2, mb: 3, maxWidth: 520, lineHeight: 1.6 }}>
            5 sub-agents analyze market context, instrument strength, signal alignment,
            risk/reward, and historical win-rate — then deliver a GO / NO-GO verdict
            with a full research brief.
          </Typography>

          {/* Mode toggle */}
          <ToggleButtonGroup
            value={pageMode}
            exclusive
            onChange={(_, v) => v && setPageMode(v)}
            size="small"
            sx={{
              bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: '10px',
              '& .MuiToggleButton-root': {
                ...SANS, fontSize: '0.72rem', fontWeight: 700, px: 2, py: 0.75,
                color: INK3, border: 'none', borderRadius: '8px !important',
                textTransform: 'none',
                '&.Mui-selected': { bgcolor: CYAN, color: '#000', },
              },
            }}
          >
            <ToggleButton value="analyze">⚡ Analyze Symbol</ToggleButton>
            <ToggleButton value="scan">⬛ Best Setups</ToggleButton>
          </ToggleButtonGroup>
        </Box>
      </Box>

      {/* ── Main layout ─────────────────────────────────────────────────────── */}
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2, md: 4 }, py: 4 }}>
        <Grid container spacing={3}>

          {/* ── Left panel ──────────────────────────────────────────────────── */}
          <Grid item xs={12} lg={4}>
            <Box sx={{ ...CARD, position: { lg: 'sticky' }, top: 80 }}>

              {/* ── ANALYZE MODE ─────────────────────────────────────────────── */}
              {pageMode === 'analyze' && (
                <>
                  <SectionHead title="Trade Setup" accent={CYAN} />

                  {/* Symbol */}
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Symbol
                    </Typography>
                    <OutlinedInput
                      fullWidth
                      placeholder="e.g. RELIANCE"
                      value={symbol}
                      onChange={e => setSymbol(e.target.value.toUpperCase())}
                      onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
                      sx={{ ...INPUT_SX, height: 40 }}
                    />
                  </Box>

                  {/* Direction */}
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Direction
                    </Typography>
                    <ToggleButtonGroup
                      value={direction} exclusive
                      onChange={(_, v) => v && setDirection(v)}
                      fullWidth size="small"
                      sx={{
                        '& .MuiToggleButton-root': {
                          ...SANS, fontSize: '0.72rem', fontWeight: 700,
                          flex: 1, textTransform: 'none', py: 0.75,
                          color: INK3, border: `1px solid ${BORDER}`,
                          '&.Mui-selected[value="LONG"]': { bgcolor: 'rgba(34,197,94,0.15)', color: '#22c55e', borderColor: '#22c55e44' },
                          '&.Mui-selected[value="SHORT"]': { bgcolor: 'rgba(239,68,68,0.15)', color: '#ef4444', borderColor: '#ef444444' },
                        },
                      }}
                    >
                      <ToggleButton value="LONG">▲ LONG</ToggleButton>
                      <ToggleButton value="SHORT">▼ SHORT</ToggleButton>
                    </ToggleButtonGroup>
                  </Box>

                  {/* Instrument type */}
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Instrument
                    </Typography>
                    <Select
                      fullWidth value={instrumentType}
                      onChange={e => setInstrumentType(e.target.value as InstrumentType)}
                      input={<OutlinedInput sx={{ ...INPUT_SX, height: 40 }} />}
                      MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}` } } }}
                    >
                      <MenuItem value="EQUITY"  sx={{ ...SANS, fontSize: '0.78rem' }}>Equity (Cash)</MenuItem>
                      <MenuItem value="OPTIONS" sx={{ ...SANS, fontSize: '0.78rem' }}>Options (F&O)</MenuItem>
                      <MenuItem value="FUTURES" sx={{ ...SANS, fontSize: '0.78rem' }}>Futures</MenuItem>
                    </Select>
                  </Box>

                  {/* Entry price */}
                  <Box sx={{ mb: 1.5 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Entry Price (optional)
                    </Typography>
                    <OutlinedInput
                      fullWidth type="number"
                      placeholder="e.g. 2950"
                      value={entryPrice}
                      onChange={e => setEntryPrice(e.target.value)}
                      startAdornment={<InputAdornment position="start"><Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>₹</Typography></InputAdornment>}
                      sx={{ ...INPUT_SX, height: 40 }}
                    />
                  </Box>

                  {/* Account size */}
                  <Box sx={{ mb: 2 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Capital (optional — for position sizing)
                    </Typography>
                    <OutlinedInput
                      fullWidth type="number"
                      placeholder="e.g. 500000"
                      value={accountSize}
                      onChange={e => setAccountSize(e.target.value)}
                      startAdornment={<InputAdornment position="start"><Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>₹</Typography></InputAdornment>}
                      sx={{ ...INPUT_SX, height: 40 }}
                    />
                  </Box>

                  {/* CTA */}
                  <Box
                    component="button"
                    onClick={handleAnalyze}
                    disabled={!symbol.trim() || analyzing}
                    sx={{
                      width: '100%', py: 1.25, borderRadius: '10px',
                      bgcolor: CYAN, color: '#000',
                      border: 'none', cursor: symbol.trim() && !analyzing ? 'pointer' : 'not-allowed',
                      opacity: !symbol.trim() || analyzing ? 0.5 : 1,
                      ...SANS, fontSize: '0.82rem', fontWeight: 800,
                      transition: 'all 0.15s',
                      '&:hover:not(:disabled)': { filter: 'brightness(1.1)' },
                    }}
                  >
                    {analyzing ? '⟳ Analyzing…' : '⚡ Run Analysis'}
                  </Box>
                </>
              )}

              {/* ── SCAN MODE ─────────────────────────────────────────────────── */}
              {pageMode === 'scan' && (
                <>
                  <SectionHead title="Best Setups Today" accent="#f59e0b"
                    meta={scanData ? `${scanData.setups.length} setups · ${scanData.generated_at}` : undefined} />

                  {!scanData && !scanning && (
                    <Box sx={{ textAlign: 'center', py: 3 }}>
                      <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3, mb: 2 }}>
                        Scan NIFTY 50 universe for high-confidence setups.
                        Takes 30–90 seconds.
                      </Typography>
                      <Box
                        component="button"
                        onClick={handleScan}
                        sx={{
                          px: 3, py: 1, borderRadius: '10px',
                          bgcolor: '#f59e0b', color: '#000',
                          border: 'none', cursor: 'pointer',
                          ...SANS, fontSize: '0.78rem', fontWeight: 800,
                        }}
                      >
                        ⬛ Run Scan
                      </Box>
                    </Box>
                  )}

                  {scanning && (
                    <Box sx={{ py: 4, textAlign: 'center' }}>
                      <CircularProgress size={28} sx={{ color: '#f59e0b', mb: 1.5 }} />
                      <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK3 }}>
                        Scanning universe — up to 90 seconds…
                      </Typography>
                    </Box>
                  )}

                  {scanError && (
                    <Alert severity="error" sx={{ ...SANS, fontSize: '0.72rem' }}>{scanError}</Alert>
                  )}

                  {scanData && (
                    <Box>
                      {scanData.setups.map(s => (
                        <ScanRow
                          key={`${s.symbol}-${s.direction}`}
                          setup={s}
                          active={activeSetup?.symbol === s.symbol && activeSetup?.direction === s.direction}
                          onClick={() => handleSetupClick(s)}
                        />
                      ))}
                      {scanData.setups.length === 0 && (
                        <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK3, textAlign: 'center', py: 3 }}>
                          No setups above confidence threshold today.
                        </Typography>
                      )}
                    </Box>
                  )}
                </>
              )}

            </Box>
          </Grid>

          {/* ── Right panel — Research Brief ──────────────────────────────── */}
          <Grid item xs={12} lg={8}>
            {!brief && !analyzing && !analyzeError && (
              <Box sx={{
                ...CARD,
                display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center',
                minHeight: 420, textAlign: 'center',
              }}>
                {/* Agent diagram */}
                <Box sx={{ mb: 3 }}>
                  {[
                    { label: 'Market Context',     color: '#6366f1', w: 25 },
                    { label: 'Instrument Analysis', color: '#a855f7', w: 35 },
                    { label: 'Signal Convergence',  color: '#f59e0b', w: 20 },
                    { label: 'Risk Calibration',    color: '#10b981', w: 10 },
                    { label: 'Historical Context',  color: '#06b6d4', w: 10 },
                  ].map((a, i) => (
                    <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, justifyContent: 'center' }}>
                      <Box sx={{
                        width: 8, height: 8, borderRadius: '50%', bgcolor: a.color,
                        boxShadow: `0 0 8px ${a.color}66`,
                      }} />
                      <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, width: 160, textAlign: 'left' }}>
                        {a.label}
                      </Typography>
                      <Box sx={{ width: 80, height: 4, borderRadius: 2, bgcolor: `${a.color}22` }}>
                        <Box sx={{ width: `${a.w * 2}%`, height: '100%', borderRadius: 2, bgcolor: a.color, opacity: 0.6 }} />
                      </Box>
                      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: a.color }}>
                        {a.w}%
                      </Typography>
                    </Box>
                  ))}
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 700, color: INK, mb: 0.75 }}>
                  Ready to analyze
                </Typography>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
                  {pageMode === 'analyze'
                    ? 'Enter a symbol and click Run Analysis'
                    : 'Run the scan and click any setup'}
                </Typography>
              </Box>
            )}

            {analyzing && (
              <Box sx={{
                ...CARD, display: 'flex', flexDirection: 'column',
                alignItems: 'center', justifyContent: 'center', minHeight: 420,
              }}>
                <CircularProgress size={36} sx={{ color: CYAN, mb: 2 }} />
                <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK2, fontWeight: 600, mb: 0.5 }}>
                  Running 5 sub-agents in parallel…
                </Typography>
                {[
                  'MarketContext checking regime & breadth',
                  'InstrumentAnalysis scoring DNA & IV',
                  'SignalConvergence aligning indicators',
                  'RiskCalibration computing ATR stops',
                  'HistoricalContext pulling win-rates',
                ].map((msg, i) => (
                  <Typography key={i} sx={{ ...SANS, fontSize: '0.68rem', color: INK3, mb: 0.25 }}>
                    ⟳ {msg}
                  </Typography>
                ))}
              </Box>
            )}

            {analyzeError && (
              <Alert severity="error" sx={{ mb: 2, ...SANS, fontSize: '0.78rem' }}>
                {analyzeError}
              </Alert>
            )}

            {brief && !analyzing && (
              <ResearchBrief brief={brief} />
            )}
          </Grid>
        </Grid>
      </Box>

      <Footer />
    </Box>
  )
}
