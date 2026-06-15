import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  Box, Select, MenuItem, Typography, Alert, Grid,
} from '@mui/material'
import type {
  StockSummary, OHLCVResponse, RelativeStrengthResponse, ReturnsResponse,
  RiskResponse, DrawdownResponse, PercentilesResponse,
  RegimeResponse, TrendPersistenceResponse, InsightsResponse,
  AnalogResponse,
  ZScoreResponse, DualMomentumResponse,
  StatisticalSignalsResponse, VolatilityLabResponse,
  RegimeClustersResponse, PatternMatchResponse, MarketDynamicsResponse,
} from '../types/stock'
import { stockApi } from '../api/stockApi'
import HeroSection from '../components/stock/HeroSection'
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
import { usePalette } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { Footer } from '../components/Footer'

const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND    = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const DISPLAY = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// Height of the sticky nav (both rows)
const NAV_H = 86

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
}

const INITIAL: StockData = {
  summary: null, ohlcv: null, rs: null, returns: null,
  risk: null, drawdown: null, percentiles: null,
  regime: null, persistence: null, insights: null, analogs: null,
  zscore: null, dualMomentum: null,
  statSignals: null, volLab: null, regimeClusters: null, patternMatch: null, marketDynamics: null,
}

type LoadState = { [K in keyof StockData]: boolean }
const INIT_LOAD: LoadState = {
  summary: false, ohlcv: false, rs: false, returns: false,
  risk: false, drawdown: false, percentiles: false,
  regime: false, persistence: false, insights: false, analogs: false,
  zscore: false, dualMomentum: false,
  statSignals: false, volLab: false, regimeClusters: false, patternMatch: false, marketDynamics: false,
}

// ─── Section component (light editorial) ─────────────────────────────────────

function Section({ id, title, accent, num, children }: {
  id: string; title: string; accent?: string; num: number; children: React.ReactNode
}) {
  const { PAPER, PAPER2, BORDER, INK2, INK3, CYAN } = usePalette()
  const sectionAccent = accent ?? CYAN
  return (
    <Box id={id} sx={{
      mb: 1.5, bgcolor: PAPER, border: `1px solid ${BORDER}`,
      overflow: 'hidden', scrollMarginTop: NAV_H + 10,
    }}>
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

  useEffect(() => {
    stockApi.getSymbols().then(r => setSymbols(r.symbols)).catch(console.error)
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

    load('summary',       () => stockApi.getSummary(symbol))
    load('ohlcv',         () => stockApi.getOHLCV(symbol))
    load('percentiles',   () => stockApi.getPercentiles(symbol))
    load('drawdown',      () => stockApi.getDrawdown(symbol))
    load('risk',          () => stockApi.getRisk(symbol))
    load('regime',        () => stockApi.getRegime(symbol))
    load('persistence',   () => stockApi.getTrendPersistence(symbol))
    load('returns',       () => stockApi.getReturns(symbol))
    load('rs',            () => stockApi.getRelativeStrength(symbol))
    load('insights',      () => stockApi.getInsights(symbol))
    load('analogs',       () => stockApi.getAnalogs(symbol))
    load('zscore',        () => stockApi.getZScore(symbol))
    load('dualMomentum',  () => stockApi.getDualMomentum(symbol))
    load('statSignals',   () => stockApi.getStatisticalSignals(symbol))
    load('volLab',        () => stockApi.getVolatilityLab(symbol))
    load('regimeClusters',() => stockApi.getRegimeClusters(symbol))
    load('patternMatch',  () => stockApi.getPatternMatch(symbol))
    load('marketDynamics',() => stockApi.getMarketDynamics(symbol))
  }, [symbol])

  const summary = data.summary

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>

      {/* ── Sticky two-row nav ─────────────────────────────────────────────── */}
      <Box sx={{
        position: 'sticky', top: 0, zIndex: 200,
        bgcolor: mode === 'dark' ? 'rgba(6,12,26,0.96)' : 'rgba(247,249,252,0.96)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${BORDER}`,
      }}>

        {/* Row 1 — identity + selector */}
        <Box sx={{
          px: { xs: 2.5, md: 4 }, height: 54,
          display: 'flex', alignItems: 'center', gap: 2.5,
          borderBottom: `1px solid ${BORDER}`,
        }}>
          {/* Logo */}
          <Link to="/" style={{ textDecoration: 'none' }}>
            <Typography sx={{
              ...DISPLAY, fontSize: '1.1875rem', letterSpacing: '0.04em',
              color: INK, lineHeight: 1,
              '& span': { color: CYAN },
            }}>
              Market<span>DNA</span>
            </Typography>
          </Link>

          <Box sx={{ width: 1, height: 22, bgcolor: BORDER, flexShrink: 0 }} />

          {/* Symbol + price */}
          {summary ? (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1.5 }}>
              <Typography sx={{ ...MONO, fontSize: '1.0625rem', fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>
                {symbol}
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.9375rem', color: CYAN, fontWeight: 600 }}>
                ₹{summary.close.toLocaleString('en-IN', { maximumFractionDigits: 2 })}
              </Typography>
              <Typography sx={{
                ...MONO, fontSize: '0.875rem', fontWeight: 700,
                color: summary.change_pct >= 0 ? '#16A34A' : '#DC2626',
              }}>
                {summary.change_pct >= 0 ? '+' : ''}{summary.change_pct.toFixed(2)}%
              </Typography>
            </Box>
          ) : (
            <Typography sx={{ ...MONO, fontSize: '1.0625rem', fontWeight: 700, color: INK }}>{symbol}</Typography>
          )}

          {/* Regime chip */}
          {summary && (
            <Box sx={{
              px: 1, py: 0.35, flexShrink: 0,
              border: `1px solid ${summary.regime === 'Bullish' ? 'rgba(22,163,74,0.3)' : summary.regime === 'Bearish' ? 'rgba(220,38,38,0.3)' : 'rgba(245,158,11,0.3)'}`,
              bgcolor: summary.regime === 'Bullish' ? 'rgba(22,163,74,0.07)' : summary.regime === 'Bearish' ? 'rgba(220,38,38,0.07)' : 'rgba(245,158,11,0.07)',
            }}>
              <Typography sx={{
                ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
                color: summary.regime === 'Bullish' ? '#16A34A' : summary.regime === 'Bearish' ? '#DC2626' : '#D97706',
              }}>
                {summary.regime}
              </Typography>
            </Box>
          )}

          <Box sx={{ flex: 1 }} />

          {/* Pattern DNA link */}
          <Link to="/pattern-dna" style={{ textDecoration: 'none' }}>
            <Typography sx={{
              ...COND, fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.09em',
              textTransform: 'uppercase', color: '#8B5CF6',
              '&:hover': { color: '#6D28D9' }, transition: 'color 0.15s',
            }}>
              Pattern DNA ↗
            </Typography>
          </Link>

          {/* Symbol selector */}
          <Select
            value={symbol}
            onChange={e => setSymbol(e.target.value)}
            size="small"
            sx={{
              ...MONO, fontSize: '0.875rem', fontWeight: 600,
              color: INK, height: 34, minWidth: 150,
              borderRadius: 0,
              '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
              '& .MuiSvgIcon-root': { color: INK3 },
              '& .MuiSelect-select': { py: '6px !important' },
            }}
            MenuProps={{
              PaperProps: {
                sx: {
                  bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: 0,
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

        {/* Row 2 — section jump strip */}
        <Box sx={{
          display: 'flex', alignItems: 'center',
          px: { xs: 1.5, md: 2.5 }, height: 38,
          overflowX: 'auto', scrollbarWidth: 'none',
          '&::-webkit-scrollbar': { display: 'none' },
        }}>
          {SECTION_INDEX.map((s, i) => (
            <Box
              key={s.id}
              component="a"
              href={`#${s.id}`}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.75,
                px: 1.5, py: 0.5, textDecoration: 'none', flexShrink: 0, cursor: 'pointer',
                borderRight: i < SECTION_INDEX.length - 1 ? `1px solid ${BORDER}` : 'none',
                '&:hover .dot': { bgcolor: s.accent },
                '&:hover .lbl': { color: INK },
              }}
            >
              <Box className="dot" sx={{
                width: 5, height: 5, borderRadius: '50%',
                bgcolor: BORDER, transition: 'background 0.15s',
              }} />
              <Typography className="lbl" sx={{
                ...COND, fontSize: '0.75rem', fontWeight: 700,
                letterSpacing: '0.07em', textTransform: 'uppercase',
                color: INK3, transition: 'color 0.15s', whiteSpace: 'nowrap',
              }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── Hero ──────────────────────────────────────────────────────────────── */}
      {summary && <HeroSection summary={summary} />}

      {/* ── Content ───────────────────────────────────────────────────────────── */}
      <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2, md: 4, lg: 6 }, py: 2 }}>

        {error && (
          <Alert severity="error" onClose={() => setError(null)}
            sx={{ mb: 2, borderRadius: 0, border: '1px solid rgba(239,68,68,0.3)' }}>
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

        <Section id="s-ai" title="AI Research Assistant" accent="#8B5CF6" num={19}>
          <AIResearchAssistant symbol={symbol} />
        </Section>

      </Box>
      <Footer />
    </Box>
  )
}
