import { useState, useEffect } from 'react'
import { useParams } from 'react-router-dom'
import {
  Box, Select, MenuItem, Typography, Alert, Grid, Stack,
} from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import type {
  StockSummary, OHLCVResponse, RelativeStrengthResponse, ReturnsResponse,
  RiskResponse, DrawdownResponse, PercentilesResponse,
  RegimeResponse, TrendPersistenceResponse, InsightsResponse,
  AnalogResponse,
  ZScoreResponse, DualMomentumResponse,
  StatisticalSignalsResponse, VolatilityLabResponse,
  RegimeClustersResponse, PatternMatchResponse, MarketDynamicsResponse,
  OIAnalysis,
} from '../types/stock'
import { stockApi } from '../api/stockApi'
import Navbar from '../components/Navbar'
import PriceChart from '../components/stock/PriceChart'
import RelativeStrengthSection from '../components/stock/RelativeStrengthSection'
import ReturnIntelligence from '../components/stock/ReturnIntelligence'
import RiskIntelligence from '../components/stock/RiskIntelligence'
import DrawdownSection from '../components/stock/DrawdownSection'
import PercentileDashboard from '../components/stock/PercentileDashboard'
import AIResearchAssistant from '../components/stock/AIResearchAssistant'
import WhatChangedToday from '../components/stock/WhatChangedToday'
import MarketStructure from '../components/stock/MarketStructure'
import TrendPersistence from '../components/stock/TrendPersistence'
import OpportunityDashboard from '../components/stock/OpportunityDashboard'
import ResearchInsights from '../components/stock/ResearchInsights'
import HistoricalAnalog from '../components/stock/HistoricalAnalog'
import ZScore from '../components/stock/ZScore'
import DualMomentum from '../components/stock/DualMomentum'
import StatisticalSignals from '../components/stock/StatisticalSignals'
import VolatilityLab from '../components/stock/VolatilityLab'
import RegimeClusters from '../components/stock/RegimeClusters'
import PatternMatch from '../components/stock/PatternMatch'
import MarketDynamics from '../components/stock/MarketDynamics'
import OptionsIntelligence from '../components/stock/OptionsIntelligence'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { Footer } from '../components/Footer'

const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND    = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// Navbar (48px) + jump strip (38px)
const NAV_H = 86

function formatVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`
  return v.toLocaleString('en-IN')
}

// ─── Section index ────────────────────────────────────────────────────────────

const SECTION_INDEX = [
  { id: 's-today',       label: 'Today',        accent: '#3B82F6' },
  { id: 's-chart',       label: 'Chart',         accent: '#3B82F6' },
  { id: 's-structure',   label: 'Structure',     accent: '#3B82F6' },
  { id: 's-rs',          label: 'Rel Strength',  accent: '#22C55E' },
  { id: 's-returns',     label: 'Returns',       accent: '#3B82F6' },
  { id: 's-risk',        label: 'Risk',          accent: '#F59E0B' },
  { id: 's-drawdown',    label: 'Drawdown',      accent: '#EF4444' },
  { id: 's-opportunity', label: 'Opportunity',   accent: '#FBBF24' },
  { id: 's-percentiles', label: 'Percentiles',   accent: '#3B82F6' },
  { id: 's-insights',    label: 'Insights',      accent: '#8B5CF6' },
  { id: 's-analogs',     label: 'Analogs',       accent: '#14B8A6' },
  { id: 's-zscore',      label: 'Z-Score',       accent: '#3B82F6' },
  { id: 's-momentum',    label: 'Momentum',      accent: '#22C55E' },
  { id: 's-stat',        label: 'Stat Risk',     accent: '#8B5CF6' },
  { id: 's-vol',         label: 'Volatility',    accent: '#F59E0B' },
  { id: 's-clusters',    label: 'Clusters',      accent: '#14B8A6' },
  { id: 's-patterns',    label: 'Patterns',      accent: '#F59E0B' },
  { id: 's-dynamics',    label: 'Dynamics',      accent: '#22C55E' },
  { id: 's-options',     label: 'Options / F&O', accent: '#A855F7' },
  { id: 's-ai',          label: 'AI Copilot',    accent: '#8B5CF6' },
]

// ─── Types ────────────────────────────────────────────────────────────────────

interface StockData {
  summary: StockSummary | null
  ohlcv: OHLCVResponse | null
  rs: RelativeStrengthResponse | null
  returns: ReturnsResponse | null
  risk: RiskResponse | null
  drawdown: DrawdownResponse | null
  percentiles: PercentilesResponse | null
  regime: RegimeResponse | null
  persistence: TrendPersistenceResponse | null
  insights: InsightsResponse | null
  analogs: AnalogResponse | null
  zscore: ZScoreResponse | null
  dualMomentum: DualMomentumResponse | null
  statSignals: StatisticalSignalsResponse | null
  volLab: VolatilityLabResponse | null
  regimeClusters: RegimeClustersResponse | null
  patternMatch: PatternMatchResponse | null
  marketDynamics: MarketDynamicsResponse | null
  oiAnalysis: OIAnalysis | null
}

const INITIAL: StockData = {
  summary: null, ohlcv: null, rs: null, returns: null,
  risk: null, drawdown: null, percentiles: null,
  regime: null, persistence: null, insights: null, analogs: null,
  zscore: null, dualMomentum: null,
  statSignals: null, volLab: null, regimeClusters: null, patternMatch: null, marketDynamics: null,
  oiAnalysis: null,
}

type LoadState = { [K in keyof StockData]: boolean }
const INIT_LOAD: LoadState = {
  summary: false, ohlcv: false, rs: false, returns: false,
  risk: false, drawdown: false, percentiles: false,
  regime: false, persistence: false, insights: false, analogs: false,
  zscore: false, dualMomentum: false,
  statSignals: false, volLab: false, regimeClusters: false, patternMatch: false, marketDynamics: false,
  oiAnalysis: false,
}

// ─── Section card ─────────────────────────────────────────────────────────────

function Section({ id, title, accent, num, children }: {
  id: string; title: string; accent?: string; num: number; children: React.ReactNode
}) {
  const { PAPER2, BORDER, INK2, INK3, CYAN } = usePalette()
  const { CARD } = useTokens()
  const sectionAccent = accent ?? CYAN
  return (
    <Box id={id} sx={{ ...CARD, mb: 3, overflow: 'hidden', scrollMarginTop: NAV_H + 10 }}>
      <Box sx={{
        height: '2px',
        background: `linear-gradient(90deg, ${sectionAccent} 0%, ${sectionAccent}60 40%, transparent 100%)`,
      }} />
      <Box sx={{
        px: { xs: 3, md: 4 }, py: 1.5,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 2,
        bgcolor: PAPER2,
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.6875rem', color: INK3, minWidth: 24, userSelect: 'none', fontWeight: 600 }}>
          {num.toString().padStart(2, '0')}
        </Typography>
        <Box sx={{ width: 2, height: 16, bgcolor: sectionAccent, opacity: 0.85, flexShrink: 0 }} />
        <Typography sx={{
          ...COND, fontSize: '0.875rem', fontWeight: 700,
          letterSpacing: '0.12em', color: INK2, textTransform: 'uppercase', flex: 1,
        }}>
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: { xs: 3, md: 4 }, py: 3 }}>
        {children}
      </Box>
    </Box>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function StockPage() {
  const { BG, PAPER, PAPER2, BORDER, INK, INK2, INK3, CYAN } = usePalette()
  const { mode } = useThemeMode()
  const { symbol: urlSymbol } = useParams<{ symbol: string }>()
  const [symbols, setSymbols]   = useState<string[]>([])
  const [symbol, setSymbol]     = useState<string>(urlSymbol?.toUpperCase() ?? 'RELIANCE')
  const [data, setData]         = useState<StockData>(INITIAL)
  const [loading, setLoading]   = useState<LoadState>(INIT_LOAD)
  const [error, setError]       = useState<string | null>(null)
  const [activeSection, setActiveSection] = useState<string>('')

  useEffect(() => {
    stockApi.getSymbols().then(r => setSymbols(r.symbols)).catch(console.error)
  }, [])

  useEffect(() => {
    const observer = new IntersectionObserver(
      entries => {
        const visible = entries.filter(e => e.isIntersecting)
        if (visible.length > 0) {
          const topmost = visible.reduce((a, b) =>
            a.boundingClientRect.top < b.boundingClientRect.top ? a : b
          )
          setActiveSection(topmost.target.id)
        }
      },
      { rootMargin: `-${NAV_H + 8}px 0px -60% 0px`, threshold: 0 }
    )
    SECTION_INDEX.forEach(s => {
      const el = document.getElementById(s.id)
      if (el) observer.observe(el)
    })
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!symbol) return
    setData(INITIAL)
    setError(null)

    const setLoad = (k: keyof LoadState, v: boolean) =>
      setLoading(prev => ({ ...prev, [k]: v }))

    const load = async <K extends keyof StockData>(key: K, fn: () => Promise<StockData[K]>) => {
      setLoad(key, true)
      try {
        const result = await fn()
        setData(prev => ({ ...prev, [key]: result }))
      } catch (e) {
        setError(`Failed to load ${key}: ${(e as Error).message}`)
      } finally {
        setLoad(key, false)
      }
    }

    load('summary',        () => stockApi.getSummary(symbol))
    load('ohlcv',          () => stockApi.getOHLCV(symbol))
    load('percentiles',    () => stockApi.getPercentiles(symbol))
    load('drawdown',       () => stockApi.getDrawdown(symbol))
    load('risk',           () => stockApi.getRisk(symbol))
    load('regime',         () => stockApi.getRegime(symbol))
    load('persistence',    () => stockApi.getTrendPersistence(symbol))
    load('returns',        () => stockApi.getReturns(symbol))
    load('rs',             () => stockApi.getRelativeStrength(symbol))
    load('insights',       () => stockApi.getInsights(symbol))
    load('analogs',        () => stockApi.getAnalogs(symbol))
    load('zscore',         () => stockApi.getZScore(symbol))
    load('dualMomentum',   () => stockApi.getDualMomentum(symbol))
    load('statSignals',    () => stockApi.getStatisticalSignals(symbol))
    load('volLab',         () => stockApi.getVolatilityLab(symbol))
    load('regimeClusters', () => stockApi.getRegimeClusters(symbol))
    load('patternMatch',   () => stockApi.getPatternMatch(symbol))
    load('marketDynamics', () => stockApi.getMarketDynamics(symbol))
    setLoad('oiAnalysis', true)
    stockApi.getOIAnalysis(symbol)
      .then(r => setData(prev => ({ ...prev, oiAnalysis: r })))
      .catch(() => {/* non-F&O — leave oiAnalysis null */})
      .finally(() => setLoad('oiAnalysis', false))
  }, [symbol])

  const summary = data.summary
  const isUp        = summary ? summary.change_pct >= 0 : true
  const changeColor = isUp ? '#22c55e' : '#ef4444'
  const regimeColor = summary?.regime === 'Bullish' ? '#22c55e'
    : summary?.regime === 'Bearish' ? '#ef4444' : '#f59e0b'
  const rangePct = summary
    ? Math.max(2, Math.min(98,
        ((summary.close - summary.low_52w) / (summary.high_52w - summary.low_52w)) * 100
      ))
    : 50

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>

      {/* ── Standard navbar ─────────────────────────────────────────────────── */}
      <Navbar />

      {/* ── Sticky section nav bar ───────────────────────────────────────────── */}
      {(() => {
        const active = SECTION_INDEX.find(s => s.id === activeSection)
        return (
          <Box sx={{
            position: 'sticky', top: 48, zIndex: 100,
            width: '100%',
            bgcolor: PAPER2,
            borderBottom: `1px solid ${BORDER}`,
          }}>
            <Box sx={{
              maxWidth: 1280, mx: 'auto',
              px: { xs: 2, md: 4, lg: 8 },
              height: 40, display: 'flex', alignItems: 'center', gap: 2,
            }}>
              {/* Active section label */}
              <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 1.25, minWidth: 0 }}>
                {active ? (
                  <>
                    <Box sx={{
                      width: 6, height: 6, borderRadius: '50%',
                      bgcolor: active.accent, flexShrink: 0,
                      boxShadow: `0 0 6px ${active.accent}80`,
                    }} />
                    <Typography sx={{
                      ...MONO, fontSize: '0.7rem', fontWeight: 700,
                      color: INK2, letterSpacing: '0.06em', textTransform: 'uppercase',
                    }} noWrap>
                      {active.label}
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
                      {(SECTION_INDEX.findIndex(s => s.id === activeSection) + 1)
                        .toString().padStart(2, '0')} / {SECTION_INDEX.length}
                    </Typography>
                  </>
                ) : (
                  <Typography sx={{ ...COND, fontSize: '0.7rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Stock DNA
                  </Typography>
                )}
              </Box>

              {/* Section dots — compact clickable progress row */}
              <Box sx={{
                display: { xs: 'none', md: 'flex' },
                alignItems: 'center', gap: 0.5,
              }}>
                {SECTION_INDEX.map(s => {
                  const isActive = activeSection === s.id
                  return (
                    <Box
                      key={s.id}
                      component="a"
                      href={`#${s.id}`}
                      title={s.label}
                      sx={{
                        width: isActive ? 18 : 6,
                        height: 6, borderRadius: 3,
                        bgcolor: isActive ? s.accent : BORDER,
                        transition: 'all 0.2s ease',
                        cursor: 'pointer',
                        textDecoration: 'none',
                        '&:hover': { bgcolor: s.accent, opacity: 0.85 },
                      }}
                    />
                  )
                })}
              </Box>

              {/* Jump-to dropdown */}
              <Select
                value={activeSection || ''}
                displayEmpty
                size="small"
                renderValue={() => (
                  <Typography sx={{ ...COND, fontSize: '0.72rem', fontWeight: 700, color: INK2, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                    Jump to ▾
                  </Typography>
                )}
                onChange={e => {
                  const el = document.getElementById(e.target.value as string)
                  if (el) el.scrollIntoView({ behavior: 'smooth' })
                }}
                sx={{
                  height: 28, minWidth: 100, flexShrink: 0,
                  bgcolor: PAPER, borderRadius: 1.5,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
                  '& .MuiSelect-select': { py: '4px !important', pr: '28px !important' },
                  '& .MuiSvgIcon-root': { display: 'none' },
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: PAPER2, border: `1px solid ${BORDER}`,
                      borderRadius: 2, mt: 0.5, maxHeight: 360,
                      '& .MuiMenuItem-root': {
                        ...COND, fontSize: '0.78rem', color: INK2, py: 0.75,
                        '&:hover': { bgcolor: BORDER, color: INK },
                        '&.Mui-selected': { bgcolor: `${CYAN}14`, color: CYAN },
                      },
                    },
                  },
                }}
              >
                {SECTION_INDEX.map((s, i) => (
                  <MenuItem key={s.id} value={s.id}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                      <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: s.accent, flexShrink: 0 }} />
                      <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, minWidth: 20 }}>
                        {(i + 1).toString().padStart(2, '0')}
                      </Typography>
                      {s.label}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </Box>
          </Box>
        )
      })()}

      {/* ── Hero ─────────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Ambient glows */}
        <Box sx={{
          position: 'absolute', top: -100, right: '10%', width: 500, height: 400,
          borderRadius: '50%',
          background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <Box sx={{
          position: 'absolute', bottom: -60, left: '5%', width: 300, height: 300,
          borderRadius: '50%',
          background: 'radial-gradient(ellipse, #6366f118 0%, transparent 70%)',
          pointerEvents: 'none',
        }} />

        <Box sx={{
          maxWidth: 1280, mx: 'auto',
          px: { xs: 3, md: 8, lg: 12 },
          py: { xs: 5, md: 8 },
          position: 'relative',
        }}>
          {/* Pulsing eyebrow badge */}
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 3,
            px: 1.5, py: 0.5, borderRadius: '20px',
            border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D`,
          }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
              animation: 'hpulse 2s ease-in-out infinite',
              '@keyframes hpulse': {
                '0%,100%': { boxShadow: `0 0 4px ${CYAN}` },
                '50%':     { boxShadow: `0 0 14px ${CYAN}` },
              },
            }} />
            <Typography sx={{
              ...COND, fontSize: '0.68rem', fontWeight: 700, color: CYAN,
              letterSpacing: '0.14em', textTransform: 'uppercase',
            }}>
              Stock DNA · Quantitative Research
            </Typography>
          </Box>

          <Stack
            direction={{ xs: 'column', lg: 'row' }}
            spacing={5}
            alignItems={{ lg: 'flex-start' }}
            justifyContent="space-between"
          >
            {/* Left — symbol identity */}
            <Box sx={{ flex: 1 }}>
              <Typography sx={{
                ...MONO, fontWeight: 700, color: INK,
                fontSize: { xs: '2.75rem', sm: '3.5rem', md: '4.5rem' },
                lineHeight: 1, letterSpacing: '-0.02em', mb: 0.75,
              }}>
                {symbol}
                <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}> ·</Box>
              </Typography>

              <Typography sx={{
                ...JAKARTA, fontSize: '0.9375rem', color: INK2,
                lineHeight: 1.75, mb: 3, maxWidth: 440,
              }}>
                20-section deep dive — regime, returns, volatility, patterns, AI copilot
              </Typography>

              {/* Badges row */}
              {summary && (
                <Box sx={{ display: 'flex', gap: 1, mb: 2.5, flexWrap: 'wrap', alignItems: 'center' }}>
                  <Box sx={{
                    px: 1, py: 0.35, borderRadius: 1,
                    border: '1px solid rgba(59,130,246,0.25)', bgcolor: 'rgba(59,130,246,0.06)',
                  }}>
                    <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.12em', color: '#3B82F6', textTransform: 'uppercase' }}>
                      NSE · EQUITY
                    </Typography>
                  </Box>
                  <Box sx={{
                    px: 1, py: 0.35, borderRadius: 1,
                    border: `1px solid ${regimeColor}30`, bgcolor: `${regimeColor}07`,
                  }}>
                    <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: regimeColor, textTransform: 'uppercase' }}>
                      {summary.regime}
                    </Typography>
                  </Box>
                  <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK3 }}>
                    {summary.date}
                  </Typography>
                </Box>
              )}

              {/* SMA position chips */}
              {summary && (
                <Box sx={{ display: 'flex', gap: 0.75, mb: 3.5, flexWrap: 'wrap' }}>
                  {[
                    { label: 'SMA 20',  active: summary.above_sma20 },
                    { label: 'SMA 50',  active: summary.above_sma50 },
                    { label: 'SMA 200', active: summary.above_sma200 },
                  ].map(s => {
                    const c = s.active ? '#22c55e' : '#ef4444'
                    return (
                      <Box key={s.label} sx={{
                        display: 'flex', alignItems: 'center', gap: 0.6,
                        px: 1, py: 0.35, borderRadius: 1,
                        border: `1px solid ${c}28`, bgcolor: `${c}07`,
                      }}>
                        <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: c }} />
                        <Typography sx={{ ...COND, fontSize: '0.72rem', fontWeight: 700, color: c, letterSpacing: '0.05em' }}>
                          {s.active ? '▲' : '▼'} {s.label}
                        </Typography>
                      </Box>
                    )
                  })}
                </Box>
              )}

              {/* Symbol selector */}
              <Select
                value={symbol}
                onChange={e => setSymbol(e.target.value)}
                size="small"
                sx={{
                  ...MONO, fontSize: '0.875rem', fontWeight: 600,
                  color: INK, height: 36, minWidth: 180,
                  borderRadius: 1.5,
                  '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
                  '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
                  '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
                  '& .MuiSvgIcon-root': { color: INK3 },
                  '& .MuiSelect-select': { py: '7px !important' },
                }}
                MenuProps={{
                  PaperProps: {
                    sx: {
                      bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 2,
                      '& .MuiMenuItem-root': {
                        ...MONO, fontSize: '0.875rem', color: INK2, py: 1,
                        '&:hover': { bgcolor: BORDER, color: INK },
                        '&.Mui-selected': { bgcolor: BORDER, color: CYAN },
                      },
                    },
                  },
                }}
              >
                {symbols.map(s => <MenuItem key={s} value={s}>{s}</MenuItem>)}
              </Select>
            </Box>

            {/* Right — price panel */}
            {summary ? (
              <Box sx={{ minWidth: { lg: 320 }, flexShrink: 0 }}>
                <Typography sx={{
                  ...COND, fontSize: '0.72rem', fontWeight: 700,
                  letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5,
                }}>
                  Last Price
                </Typography>
                <Typography sx={{
                  ...MONO, fontWeight: 700, color: CYAN, lineHeight: 1,
                  fontSize: { xs: '2.5rem', md: '3.25rem' },
                  letterSpacing: '-0.02em',
                }}>
                  ₹{summary.close.toLocaleString('en-IN')}
                </Typography>

                <Box sx={{
                  display: 'inline-flex', alignItems: 'center', gap: 0.75,
                  mt: 1.25, mb: 2.5, px: 1.5, py: 0.6, borderRadius: 1,
                  border: `1px solid ${changeColor}28`, bgcolor: `${changeColor}07`,
                }}>
                  {isUp
                    ? <TrendingUpIcon sx={{ color: changeColor, fontSize: 16 }} />
                    : <TrendingDownIcon sx={{ color: changeColor, fontSize: 16 }} />
                  }
                  <Typography sx={{ ...MONO, color: changeColor, fontWeight: 700, fontSize: '1.05rem', letterSpacing: '-0.02em' }}>
                    {isUp ? '+' : ''}{summary.change_pct.toFixed(2)}%
                  </Typography>
                </Box>

                {/* 52W metrics */}
                <Box sx={{
                  display: 'flex', mb: 2, borderRadius: 2, overflow: 'hidden',
                  border: `1px solid ${BORDER}`,
                  '& > *:not(:last-child)': { borderRight: `1px solid ${BORDER}` },
                }}>
                  {[
                    { label: '52W High', value: `₹${summary.high_52w.toLocaleString('en-IN')}`, color: CYAN },
                    { label: '52W Low',  value: `₹${summary.low_52w.toLocaleString('en-IN')}`,  color: INK2 },
                    { label: 'Vol 20D',  value: formatVolume(summary.avg_volume_20d),             color: '#3B82F6' },
                  ].map(m => (
                    <Box key={m.label} sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center', bgcolor: PAPER }}>
                      <Typography sx={{ ...COND, fontSize: '0.65rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, mb: 0.4 }}>
                        {m.label}
                      </Typography>
                      <Typography sx={{ ...MONO, fontSize: '0.875rem', fontWeight: 700, color: m.color, lineHeight: 1 }}>
                        {m.value}
                      </Typography>
                    </Box>
                  ))}
                </Box>

                {/* 52W range bar */}
                <Box>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
                      ₹{summary.low_52w.toLocaleString('en-IN')}
                    </Typography>
                    <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', color: INK3, textTransform: 'uppercase' }}>
                      52-week range
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
                      ₹{summary.high_52w.toLocaleString('en-IN')}
                    </Typography>
                  </Box>
                  <Box sx={{ height: 4, bgcolor: BORDER, borderRadius: 2, position: 'relative', overflow: 'visible' }}>
                    <Box sx={{
                      position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 2,
                      width: `${rangePct}%`,
                      background: `linear-gradient(90deg, ${BORDER}, ${CYAN})`,
                    }} />
                    <Box sx={{
                      position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                      left: `${rangePct}%`,
                      width: 10, height: 10, borderRadius: '50%',
                      bgcolor: CYAN, border: `2px solid ${BG}`,
                      boxShadow: `0 0 6px ${CYAN}80`,
                    }} />
                  </Box>
                </Box>
              </Box>
            ) : (
              <Box sx={{ minWidth: { lg: 320 }, flexShrink: 0 }}>
                <Box sx={{
                  height: 140, bgcolor: PAPER, borderRadius: 2,
                  border: `1px solid ${BORDER}`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Typography sx={{ ...COND, color: INK3, fontSize: '0.8rem', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    Loading…
                  </Typography>
                </Box>
              </Box>
            )}
          </Stack>
        </Box>
      </Box>

      {/* ── Content ───────────────────────────────────────────────────────────── */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 4, lg: 8 }, py: 3 }}>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}
            sx={{ mb: 3, borderRadius: 2, border: '1px solid rgba(239,68,68,0.3)' }}>
            {error}
          </Alert>
        )}

        {summary && (
          <Section id="s-today" title="What Changed Today" accent="#3B82F6" num={1}>
            <WhatChangedToday summary={summary} rs={data.rs} risk={data.risk} drawdown={data.drawdown} percentiles={data.percentiles} />
          </Section>
        )}

        <Section id="s-chart" title="Price Chart" accent="#3B82F6" num={2}>
          <PriceChart data={data.ohlcv} loading={loading.ohlcv} />
        </Section>

        <Section id="s-structure" title="Market Structure & Trend" accent="#3B82F6" num={3}>
          <Grid container spacing={3}>
            <Grid item xs={12} md={7}>
              <MarketStructure data={data.regime} loading={loading.regime} />
            </Grid>
            <Grid item xs={12} md={5}>
              <TrendPersistence data={data.persistence} loading={loading.persistence} />
            </Grid>
          </Grid>
        </Section>

        <Section id="s-rs" title="Relative Strength" accent="#22C55E" num={4}>
          <RelativeStrengthSection data={data.rs} loading={loading.rs} />
        </Section>

        <Section id="s-returns" title="Return Intelligence" accent="#3B82F6" num={5}>
          <ReturnIntelligence data={data.returns} loading={loading.returns} />
        </Section>

        <Section id="s-risk" title="Risk Intelligence" accent="#F59E0B" num={6}>
          <RiskIntelligence data={data.risk} loading={loading.risk} />
        </Section>

        <Section id="s-drawdown" title="Drawdown Intelligence" accent="#EF4444" num={7}>
          <DrawdownSection data={data.drawdown} loading={loading.drawdown} />
        </Section>

        {(summary || data.rs || data.risk || data.drawdown) && (
          <Section id="s-opportunity" title="Opportunity Score" accent="#FBBF24" num={8}>
            <OpportunityDashboard summary={summary} rs={data.rs} risk={data.risk} drawdown={data.drawdown} />
          </Section>
        )}

        <Section id="s-percentiles" title="Percentile Overview" accent="#3B82F6" num={9}>
          <PercentileDashboard data={data.percentiles} loading={loading.percentiles} />
        </Section>

        <Section id="s-insights" title="Research Insights" accent="#8B5CF6" num={10}>
          <ResearchInsights data={data.insights} loading={loading.insights} />
        </Section>

        <Section id="s-analogs" title="Historical Analogs" accent="#14B8A6" num={11}>
          <HistoricalAnalog data={data.analogs} loading={loading.analogs} />
        </Section>

        <Section id="s-zscore" title="Z-Score Mean Reversion" accent="#3B82F6" num={12}>
          <ZScore data={data.zscore} loading={loading.zscore} />
        </Section>

        <Section id="s-momentum" title="Dual Momentum" accent="#22C55E" num={13}>
          <DualMomentum data={data.dualMomentum} loading={loading.dualMomentum} />
        </Section>

        <Section id="s-stat" title="Statistical Risk" accent="#8B5CF6" num={14}>
          <StatisticalSignals data={data.statSignals} loading={loading.statSignals} />
        </Section>

        <Section id="s-vol" title="Volatility Lab" accent="#F59E0B" num={15}>
          <VolatilityLab data={data.volLab} loading={loading.volLab} />
        </Section>

        <Section id="s-clusters" title="Regime Clusters" accent="#14B8A6" num={16}>
          <RegimeClusters data={data.regimeClusters} loading={loading.regimeClusters} />
        </Section>

        <Section id="s-patterns" title="Pattern Match Engine" accent="#F59E0B" num={17}>
          <PatternMatch data={data.patternMatch} loading={loading.patternMatch} />
        </Section>

        <Section id="s-dynamics" title="Market Dynamics" accent="#22C55E" num={18}>
          <MarketDynamics data={data.marketDynamics} loading={loading.marketDynamics} />
        </Section>

        <Section id="s-options" title="Options & Futures Intelligence" accent="#A855F7" num={19}>
          <OptionsIntelligence data={data.oiAnalysis} loading={loading.oiAnalysis} />
        </Section>

        <Section id="s-ai" title="AI Research Assistant" accent="#8B5CF6" num={20}>
          <AIResearchAssistant symbol={symbol} />
        </Section>

      </Box>
      <Footer />
    </Box>
  )
}
