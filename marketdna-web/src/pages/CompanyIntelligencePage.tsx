import { useState, useCallback, useEffect } from 'react'
import {
  Box, Typography, Grid, CircularProgress, Alert, Chip,
  Accordion, AccordionSummary, AccordionDetails,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
  OutlinedInput,
} from '@mui/material'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { intelligenceApi } from '../api/intelligenceApi'
import type { IntelligenceData, LiveQuote, Fundamentals } from '../types/intelligence'
import { useParams, useNavigate } from 'react-router-dom'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ── colour helpers ────────────────────────────────────────────────────────────
function scoreColor(s: number) {
  if (s <= 3) return '#22c55e'
  if (s <= 6) return '#fbbf24'
  return '#ef4444'
}
function retColor(v: number | null) {
  if (v === null) return '#94a3b8'
  return v >= 0 ? '#22c55e' : '#ef4444'
}
function severityColor(s: string) {
  if (s === 'HIGH')   return '#ef4444'
  if (s === 'MEDIUM') return '#fbbf24'
  return '#22c55e'
}
function concentrationColor(c: string) {
  if (c === 'CONCENTRATED') return '#ef4444'
  if (c === 'MODERATE')     return '#fbbf24'
  return '#22c55e'
}
function stageColor(s: string) {
  if (s === 'EARLY')    return '#a855f7'
  if (s === 'GROWTH')   return '#22c55e'
  if (s === 'MATURE')   return '#fbbf24'
  return '#ef4444'
}
function fmtNum(v: number | null, dp = 2) {
  if (v === null || v === undefined) return '—'
  return v.toFixed(dp)
}
function fmtVol(v: number | null) {
  if (!v) return '—'
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`
  return v.toLocaleString('en-IN')
}

// ── Section heading ────────────────────────────────────────────────────────────
function SHead({ title, accent }: { title: string; accent: string }) {
  const { INK } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK, letterSpacing: '0.04em' }}>
        {title}
      </Typography>
    </Box>
  )
}

// ── Accordion wrapper ─────────────────────────────────────────────────────────
function Panel({
  id, title, accent, children, defaultOpen = false,
}: {
  id: string; title: string; accent: string; children: React.ReactNode; defaultOpen?: boolean
}) {
  const { PAPER, PAPER2, BORDER, INK2 } = usePalette()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <Accordion
      expanded={open}
      onChange={() => setOpen(p => !p)}
      disableGutters
      elevation={0}
      sx={{
        bgcolor: PAPER, border: `1px solid ${BORDER}`, borderRadius: '12px !important',
        mb: 1.5, overflow: 'hidden',
        '&:before': { display: 'none' },
      }}
    >
      <AccordionSummary
        expandIcon={
          <Box sx={{ ...MONO, fontSize: '0.6rem', color: INK2, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }}>▼</Box>
        }
        sx={{ px: 2.5, py: 1.5, bgcolor: PAPER2, minHeight: 52, '& .MuiAccordionSummary-content': { m: 0 } }}
      >
        <SHead title={title} accent={accent} />
      </AccordionSummary>
      <AccordionDetails sx={{ p: 2.5 }}>
        {children}
      </AccordionDetails>
    </Accordion>
  )
}

// ── Porter force bar ──────────────────────────────────────────────────────────
function PorterBar({ label, score, desc }: { label: string; score: number; desc: string }) {
  const { INK, INK3, BORDER, PAPER2 } = usePalette()
  const color = scoreColor(score)
  return (
    <Tooltip title={desc} placement="top" arrow>
      <Box sx={{ mb: 1.5, cursor: 'help' }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 600, color: INK }}>{label}</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.72rem', color, fontWeight: 700 }}>{score}/10</Typography>
        </Box>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: PAPER2, border: `1px solid ${BORDER}`, overflow: 'hidden' }}>
          <Box sx={{ width: `${score * 10}%`, height: '100%', bgcolor: color, borderRadius: 3, transition: 'width 0.6s ease' }} />
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3, mt: 0.4, lineHeight: 1.4 }}>
          {desc}
        </Typography>
      </Box>
    </Tooltip>
  )
}

// ── Market share visual ───────────────────────────────────────────────────────
function MarketShareBar({
  ticker, share, competitors,
}: {
  ticker: string; share: number; competitors: { name: string; share_pct: number }[]
}) {
  const { INK, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const COLORS = ['#a855f7', '#f97316', '#3b82f6', '#94a3b8']
  const all = [
    { name: ticker, pct: share, co: CYAN },
    ...competitors.map((c, i) => ({ name: c.name, pct: c.share_pct, co: COLORS[i] ?? '#64748b' })),
  ]
  return (
    <Box>
      <Box sx={{ display: 'flex', height: 24, borderRadius: 2, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
        {all.map(seg => (
          <Tooltip key={seg.name} title={`${seg.name}: ${seg.pct}%`} arrow>
            <Box sx={{ width: `${seg.pct}%`, bgcolor: seg.co, transition: 'width 0.6s ease', cursor: 'help' }} />
          </Tooltip>
        ))}
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mt: 1 }}>
        {all.map(seg => (
          <Box key={seg.name} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: seg.co, flexShrink: 0 }} />
            <Typography sx={{ ...SANS, fontSize: '0.65rem', color: INK3 }}>
              {seg.name} <Box component="span" sx={{ color: INK, fontWeight: 700 }}>{seg.pct}%</Box>
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Margin row ────────────────────────────────────────────────────────────────
function MarginRow({
  label, co, industry, market,
}: {
  label: string; co: number; industry: number; market: number
}) {
  const { INK, INK2, INK3, CYAN, BORDER } = usePalette()
  const max = Math.max(co, industry, market, 1)
  function Bar({ val, color }: { val: number; color: string }) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Box sx={{ flex: 1, height: 5, borderRadius: 2, bgcolor: `${color}22`, overflow: 'hidden' }}>
          <Box sx={{ width: `${(val / max) * 100}%`, height: '100%', bgcolor: color, borderRadius: 2 }} />
        </Box>
        <Typography sx={{ ...MONO, fontSize: '0.7rem', color, fontWeight: 700, minWidth: 32, textAlign: 'right' }}>
          {val}%
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ mb: 2 }}>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 0.75 }}>{label}</Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.6 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, width: 58, flexShrink: 0 }}>Company</Typography>
          <Bar val={co} color={CYAN} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, width: 58, flexShrink: 0 }}>Industry</Typography>
          <Bar val={industry} color={INK2} />
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, width: 58, flexShrink: 0 }}>Market</Typography>
          <Bar val={market} color='#475569' />
        </Box>
      </Box>
    </Box>
  )
}

// ── Quote card ─────────────────────────────────────────────────────────────────
function QuoteCard({ q }: { q: LiveQuote | null }) {
  const { CARD, t1, t2, t3, BORDER } = useTokens()
  const { INK, INK3, PAPER2 } = usePalette()
  const chg = q?.pct_change ?? null
  const color = retColor(chg)

  function Row({ label, val }: { label: string; val: string }) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.6, borderBottom: `1px solid ${BORDER}` }}>
        <Typography sx={{ ...t3, ...SANS }}>{label}</Typography>
        <Typography sx={{ ...t2, ...MONO }}>{val}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ ...CARD }}>
      <SHead title="Live Quote" accent="#22c55e" />
      {!q ? (
        <Typography sx={{ ...t3, ...SANS, mt: 1.5 }}>Kite quote unavailable — check access token or market hours.</Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography sx={{ ...MONO, fontSize: '1.5rem', fontWeight: 700, color: INK }}>
              ₹{fmtNum(q.last_price)}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color }}>
              {chg !== null ? `${chg >= 0 ? '+' : ''}${fmtNum(chg)}%` : ''}
            </Typography>
          </Box>
          <Row label="Open / Close"     val={`₹${fmtNum(q.open)} / ₹${fmtNum(q.close)}`} />
          <Row label="Day H / L"        val={`₹${fmtNum(q.high)} / ₹${fmtNum(q.low)}`} />
          <Row label="Volume"           val={fmtVol(q.volume)} />
          <Row label="Bid / Ask"        val={`₹${fmtNum(q.bid)} / ₹${fmtNum(q.ask)}`} />
          {q.oi !== null && <Row label="Open Interest" val={fmtVol(q.oi)} />}
          <Row label="Circuit ↑ / ↓"   val={`₹${fmtNum(q.upper_circuit)} / ₹${fmtNum(q.lower_circuit)}`} />
        </Box>
      )}
    </Box>
  )
}

// ── Fundamentals card ──────────────────────────────────────────────────────────
function FundamentalsCard({ f }: { f: Fundamentals | null }) {
  const { CARD, t2, t3, BORDER, TH } = useTokens()
  const { INK, INK2, INK3, CYAN } = usePalette()

  function Row({ label, val, color }: { label: string; val: string; color?: string }) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.6, borderBottom: `1px solid ${BORDER}` }}>
        <Typography sx={{ ...t3, ...SANS }}>{label}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: color ?? INK2 }}>{val}</Typography>
      </Box>
    )
  }

  return (
    <Box sx={{ ...CARD }}>
      <SHead title="Historical Metrics" accent="#6366f1" />
      {!f ? (
        <Typography sx={{ ...t3, ...SANS, mt: 1.5 }}>Loading…</Typography>
      ) : f.error ? (
        <Typography sx={{ ...t3, ...SANS, mt: 1.5, color: '#ef4444' }}>{f.error}</Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <Row label="52W High"        val={f.high_52w ? `₹${fmtNum(f.high_52w)}` : '—'} />
          <Row label="52W Low"         val={f.low_52w  ? `₹${fmtNum(f.low_52w)}`  : '—'} />
          <Row label="Last Close"      val={f.last_close ? `₹${fmtNum(f.last_close)}` : '—'} />
          <Row
            label="1Y Return"
            val={f.ret_1y_pct !== null ? `${f.ret_1y_pct >= 0 ? '+' : ''}${fmtNum(f.ret_1y_pct)}%` : '—'}
            color={retColor(f.ret_1y_pct)}
          />
          <Row label="Realised Vol"    val={f.realised_vol_pct ? `${fmtNum(f.realised_vol_pct, 1)}%` : '—'} />
          <Row label="Avg Volume (1Y)" val={fmtVol(f.avg_vol)} />
        </Box>
      )}
    </Box>
  )
}

// ── Loading animation ─────────────────────────────────────────────────────────
function Analyzing() {
  const [dots, setDots] = useState('')
  const { CYAN } = usePalette()
  useEffect(() => {
    const id = setInterval(() => setDots(d => d.length >= 3 ? '' : d + '.'), 400)
    return () => clearInterval(id)
  }, [])
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', py: 8, gap: 2 }}>
      <CircularProgress size={36} sx={{ color: CYAN }} />
      <Typography sx={{ ...MONO, fontSize: '0.82rem', color: CYAN }}>
        Claude is analyzing{dots}
      </Typography>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: '#64748b' }}>
        Fetching company intelligence — first call takes 3–6 seconds
      </Typography>
    </Box>
  )
}

// ── Supply chain flow ─────────────────────────────────────────────────────────
function SupplyFlow({ stages, position }: { stages: { stage: string; players: string }[]; position: string }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  return (
    <Box>
      <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1, mb: 2 }}>
        {stages.map((s, i) => (
          <Box key={i} sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <Box sx={{
              flex: 1, p: 1.5, borderRadius: '8px',
              bgcolor: PAPER2, border: `1px solid ${BORDER}`,
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, fontWeight: 700, mb: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {s.stage}
              </Typography>
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.4 }}>
                {s.players}
              </Typography>
            </Box>
            {i < stages.length - 1 && (
              <Box sx={{ px: 0.5, color: INK3, fontSize: '0.7rem', flexShrink: 0, display: { xs: 'none', md: 'block' } }}>→</Box>
            )}
          </Box>
        ))}
      </Box>
      <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: `${CYAN}12`, border: `1px solid ${CYAN}30` }}>
        <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK, lineHeight: 1.5 }}>
          <Box component="span" sx={{ ...MONO, fontSize: '0.62rem', color: CYAN, fontWeight: 700, mr: 0.75 }}>POSITION</Box>
          {position}
        </Typography>
      </Box>
    </Box>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CompanyIntelligencePage() {
  const { symbol: urlSymbol } = useParams<{ symbol?: string }>()
  const navigate = useNavigate()

  const { BG, PAPER, PAPER2, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { CARD, TH, TD, t1, t2, t3, INPUT_SX } = useTokens()
  const { mode } = useThemeMode()

  const [ticker,  setTicker]  = useState(urlSymbol?.toUpperCase() ?? '')
  const [input,   setInput]   = useState(urlSymbol?.toUpperCase() ?? '')
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<IntelligenceData | null>(null)
  const [quote,   setQuote]   = useState<LiveQuote | null>(null)
  const [fundam,  setFundam]  = useState<Fundamentals | null>(null)
  const [cacheHit, setCacheHit] = useState<boolean | null>(null)

  const analyze = useCallback(async (sym: string) => {
    if (!sym.trim()) return
    const t = sym.trim().toUpperCase()
    setLoading(true); setError(null); setData(null); setQuote(null); setFundam(null)
    navigate(`/company-intelligence/${t}`, { replace: true })

    // Fire quote + fundamentals in parallel while Claude is thinking
    intelligenceApi.getFundamentals(t).then(setFundam).catch(() => setFundam(null))
    intelligenceApi.getQuote(t).then(setQuote).catch(() => setQuote(null))

    try {
      const result = await intelligenceApi.analyze(t)
      setData(result)
      setCacheHit(result._cache === 'hit')
    } catch (e: any) {
      setError(e?.message ?? 'Analysis failed')
    } finally {
      setLoading(false)
    }
  }, [navigate])

  // Auto-run when navigated to with a symbol
  useEffect(() => {
    if (urlSymbol && !data && !loading) {
      setInput(urlSymbol.toUpperCase())
      analyze(urlSymbol)
    }
  }, [urlSymbol]) // eslint-disable-line react-hooks/exhaustive-deps

  const heroGrad = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* ── Hero ──────────────────────────────────────────────────────────── */}
      <Box sx={{ background: heroGrad, px: { xs: 2, md: 5 }, pt: 5, pb: 4 }}>
        {/* Eyebrow */}
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 2,
          px: 1.5, py: 0.4, borderRadius: '20px', bgcolor: `${CYAN}14`, border: `1px solid ${CYAN}30` }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } } }} />
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Company Intelligence
          </Typography>
        </Box>

        {/* Headline */}
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 800, color: INK, lineHeight: 1.15, mb: 0.75 }}>
          Deep<Box component="span" sx={{ color: CYAN }}> Company</Box> Research
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK2, mb: 3, maxWidth: 520 }}>
          Claude-powered qualitative intelligence — supply chain, Porter's forces, margin profile, sector dynamics, and revenue predictors for any Nifty 500 company.
        </Typography>

        {/* Search bar */}
        <Box sx={{ display: 'flex', gap: 1, maxWidth: 420 }}>
          <OutlinedInput
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && analyze(input)}
            placeholder="NSE ticker — e.g. RELIANCE"
            size="small"
            sx={{ ...INPUT_SX, flex: 1, height: 40, textTransform: 'uppercase', ...MONO }}
          />
          <Box
            component="button"
            onClick={() => analyze(input)}
            disabled={loading || !input.trim()}
            sx={{
              px: 2.5, height: 40, borderRadius: '8px', border: 'none', cursor: 'pointer',
              bgcolor: CYAN, color: '#000', ...MONO, fontSize: '0.75rem', fontWeight: 700,
              letterSpacing: '0.06em', textTransform: 'uppercase', flexShrink: 0,
              transition: 'opacity 0.15s',
              '&:hover': { opacity: 0.85 },
              '&:disabled': { opacity: 0.4, cursor: 'not-allowed' },
            }}
          >
            {loading ? '…' : 'Analyze'}
          </Box>
          {data && (
            <Tooltip title="Clear cache and re-analyze">
              <Box
                component="button"
                onClick={async () => {
                  await intelligenceApi.invalidateCache(ticker || input)
                  analyze(ticker || input)
                }}
                sx={{
                  px: 1.75, height: 40, borderRadius: '8px', border: `1px solid ${BORDER}`,
                  cursor: 'pointer', bgcolor: 'transparent', color: INK2,
                  ...MONO, fontSize: '0.7rem', flexShrink: 0,
                  '&:hover': { borderColor: CYAN, color: CYAN },
                }}
              >
                ↺
              </Box>
            </Tooltip>
          )}
        </Box>

        {/* Cache status */}
        {data && cacheHit !== null && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: cacheHit ? '#22c55e' : '#fbbf24' }} />
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>
              {cacheHit ? 'CACHE HIT — served from 24 h cache' : 'CACHE MISS — fresh from Claude'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Content ───────────────────────────────────────────────────────── */}
      <Box sx={{ px: { xs: 2, md: 5 }, py: 3, maxWidth: 1200, mx: 'auto' }}>

        {/* Error */}
        {error && (
          <Alert severity="error" sx={{ mb: 2, ...SANS, fontSize: '0.8rem' }}>
            {error}
          </Alert>
        )}

        {/* Loading */}
        {loading && <Analyzing />}

        {/* Results */}
        {data && !loading && (
          <>
            {/* ── Identity banner ─────────────────────────────────────────── */}
            <Box sx={{
              p: 2.5, mb: 2.5, borderRadius: '12px',
              bgcolor: PAPER, border: `1px solid ${BORDER}`,
              borderLeft: `4px solid ${CYAN}`,
            }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2, justifyContent: 'space-between' }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
                    <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: INK }}>
                      {data.ticker}
                    </Typography>
                    {data.market_leader && (
                      <Chip label="Market Leader" size="small"
                        sx={{ bgcolor: `${CYAN}18`, color: CYAN, border: `1px solid ${CYAN}40`, ...MONO, fontSize: '0.6rem', fontWeight: 700, height: 20 }} />
                    )}
                    <Chip label={data.sector} size="small"
                      sx={{ bgcolor: '#6366f118', color: '#818cf8', border: '1px solid #6366f130', ...SANS, fontSize: '0.62rem', height: 20 }} />
                    <Chip label={data.sector_stage} size="small"
                      sx={{ bgcolor: `${stageColor(data.sector_stage)}18`, color: stageColor(data.sector_stage), border: `1px solid ${stageColor(data.sector_stage)}30`, ...MONO, fontSize: '0.6rem', height: 20 }} />
                  </Box>
                  <Typography sx={{ ...SANS, fontSize: '1rem', fontWeight: 700, color: INK, mb: 0.5 }}>
                    {data.company}
                  </Typography>
                  <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, fontStyle: 'italic' }}>
                    "{data.tagline}"
                  </Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, mb: 0.25 }}>MARKET POSITION</Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.82rem', fontWeight: 700, color: INK }}>{data.market_rank}</Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN }}>{data.market_share_pct}% share</Typography>
                </Box>
              </Box>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1.5 }}>
                {data.industry_keywords.map(kw => (
                  <Chip key={kw} label={kw} size="small"
                    sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, ...MONO, fontSize: '0.58rem', height: 18 }} />
                ))}
              </Box>
            </Box>

            {/* ── Quote + Fundamentals row ─────────────────────────────────── */}
            <Grid container spacing={2} sx={{ mb: 2 }}>
              <Grid item xs={12} md={6}>
                <QuoteCard q={quote} />
              </Grid>
              <Grid item xs={12} md={6}>
                <FundamentalsCard f={fundam} />
              </Grid>
            </Grid>

            {/* ── Overview ─────────────────────────────────────────────────── */}
            <Panel id="overview" title="Company Overview" accent="#6366f1" defaultOpen>
              <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, lineHeight: 1.7, mb: 2 }}>
                {data.what_they_do}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {[
                  { label: 'Sector',       val: data.sector },
                  { label: 'Industry',     val: data.industry },
                  { label: 'Sub-Industry', val: data.sub_industry },
                ].map(({ label, val }) => (
                  <Box key={label} sx={{ p: 1.25, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 120 }}>
                    <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25 }}>{label}</Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 700, color: INK }}>{val}</Typography>
                  </Box>
                ))}
              </Box>
            </Panel>

            {/* ── Supply chain ──────────────────────────────────────────────── */}
            <Panel id="supply" title="Supply Chain & Risks" accent="#f59e0b">
              <SupplyFlow stages={data.supply_chain} position={data.company_position_in_sc} />
              <Box sx={{ mt: 2 }}>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 1 }}>Supply Chain Risks</Typography>
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                  {data.sc_risks.map((r, i) => (
                    <Box key={i} sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 1.25, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                      <Chip
                        label={r.severity} size="small"
                        sx={{ bgcolor: `${severityColor(r.severity)}18`, color: severityColor(r.severity), border: `1px solid ${severityColor(r.severity)}30`, ...MONO, fontSize: '0.58rem', fontWeight: 700, height: 18, flexShrink: 0 }}
                      />
                      <Box>
                        <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK }}>{r.risk}</Typography>
                        <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK2, mt: 0.25 }}>{r.desc}</Typography>
                      </Box>
                    </Box>
                  ))}
                </Box>
              </Box>
            </Panel>

            {/* ── Competitive position ──────────────────────────────────────── */}
            <Panel id="competitive" title="Competitive Position" accent="#a855f7" defaultOpen>
              <Grid container spacing={3}>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 1.5 }}>Porter's Five Forces</Typography>
                  <PorterBar label="Competitive Rivalry"    score={data.porter.rivalry.score}        desc={data.porter.rivalry.desc} />
                  <PorterBar label="Buyer Power"            score={data.porter.buyer_power.score}    desc={data.porter.buyer_power.desc} />
                  <PorterBar label="Supplier Power"         score={data.porter.supplier_power.score} desc={data.porter.supplier_power.desc} />
                  <PorterBar label="Threat of New Entrants" score={data.porter.new_entrants.score}   desc={data.porter.new_entrants.desc} />
                  <PorterBar label="Threat of Substitutes"  score={data.porter.substitutes.score}    desc={data.porter.substitutes.desc} />
                  <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mt: 0.5 }}>
                    Hover each bar for detail · Score 1–3 = Low threat · 4–6 = Moderate · 7–10 = High
                  </Typography>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 1.5 }}>Market Share</Typography>
                  <MarketShareBar ticker={data.ticker} share={data.market_share_pct} competitors={data.main_competitors} />
                  <Box sx={{ mt: 2 }}>
                    <Table size="small">
                      <TableHead>
                        <TableRow>
                          <TableCell sx={{ ...TH }}>Competitor</TableCell>
                          <TableCell sx={{ ...TH, textAlign: 'right' }}>Est. Share</TableCell>
                        </TableRow>
                      </TableHead>
                      <TableBody>
                        <TableRow>
                          <TableCell sx={{ ...TD, ...MONO, fontSize: '0.72rem', color: CYAN, fontWeight: 700 }}>{data.ticker} (this co.)</TableCell>
                          <TableCell sx={{ ...TD, ...MONO, fontSize: '0.72rem', textAlign: 'right', color: CYAN, fontWeight: 700 }}>{data.market_share_pct}%</TableCell>
                        </TableRow>
                        {data.main_competitors.map((c, i) => (
                          <TableRow key={i}>
                            <TableCell sx={{ ...TD, ...SANS, fontSize: '0.72rem', color: INK }}>{c.name}</TableCell>
                            <TableCell sx={{ ...TD, ...MONO, fontSize: '0.72rem', textAlign: 'right', color: INK2 }}>{c.share_pct}%</TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </Box>
                </Grid>
              </Grid>
            </Panel>

            {/* ── Client base ──────────────────────────────────────────────── */}
            <Panel id="clients" title="Client Base & Concentration" accent="#14b8a6">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap' }}>
                <Chip
                  label={data.client_concentration} size="small"
                  sx={{ bgcolor: `${concentrationColor(data.client_concentration)}18`, color: concentrationColor(data.client_concentration), border: `1px solid ${concentrationColor(data.client_concentration)}30`, ...MONO, fontSize: '0.68rem', fontWeight: 700 }}
                />
                <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2 }}>
                  {data.client_concentration_note}
                </Typography>
              </Box>

              {/* Client type bars */}
              <Box sx={{ mb: 2 }}>
                {data.client_types.map((c, i) => {
                  const COLORS = [CYAN, '#a855f7', '#f97316', '#3b82f6', '#14b8a6']
                  const color = COLORS[i % COLORS.length]
                  return (
                    <Box key={i} sx={{ mb: 1.25 }}>
                      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK }}>{c.name}</Typography>
                        <Typography sx={{ ...MONO, fontSize: '0.72rem', color, fontWeight: 700 }}>{c.pct}%</Typography>
                      </Box>
                      <Box sx={{ height: 6, borderRadius: 3, bgcolor: PAPER2, overflow: 'hidden' }}>
                        <Box sx={{ width: `${c.pct}%`, height: '100%', bgcolor: color, borderRadius: 3 }} />
                      </Box>
                    </Box>
                  )
                })}
              </Box>

              <Box>
                <Typography sx={{ ...SANS, fontSize: '0.7rem', fontWeight: 700, color: INK, mb: 0.75 }}>Top Client Examples</Typography>
                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
                  {data.top_clients_examples.map((c, i) => (
                    <Chip key={i} label={c} size="small"
                      sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, ...SANS, fontSize: '0.65rem', height: 22 }} />
                  ))}
                </Box>
              </Box>
            </Panel>

            {/* ── Margin profile ────────────────────────────────────────────── */}
            <Panel id="margins" title="Margin Profile" accent="#f97316">
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, mb: 2 }}>
                Company vs industry peer average vs broad market — approximate, from Claude analysis
              </Typography>
              <Grid container spacing={3}>
                <Grid item xs={12} md={4}>
                  <MarginRow
                    label="Gross Margin"
                    co={data.margins.gross_margin_co}
                    industry={data.margins.gross_margin_industry}
                    market={data.margins.gross_margin_market}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <MarginRow
                    label="EBITDA Margin"
                    co={data.margins.ebitda_margin_co}
                    industry={data.margins.ebitda_margin_industry}
                    market={data.margins.ebitda_margin_market}
                  />
                </Grid>
                <Grid item xs={12} md={4}>
                  <MarginRow
                    label="PAT Margin"
                    co={data.margins.pat_margin_co}
                    industry={data.margins.pat_margin_industry}
                    market={data.margins.pat_margin_market}
                  />
                </Grid>
              </Grid>
            </Panel>

            {/* ── Sector dynamics ───────────────────────────────────────────── */}
            <Panel id="sector" title="Sector Dynamics" accent="#22c55e">
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 2 }}>
                <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 120 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>SECTOR CAGR (EST.)</Typography>
                  <Typography sx={{ ...MONO, fontSize: '1.1rem', fontWeight: 800, color: '#22c55e' }}>
                    {data.sector_cagr_pct}%
                  </Typography>
                </Box>
                <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>STAGE</Typography>
                  <Chip label={data.sector_stage} size="small"
                    sx={{ bgcolor: `${stageColor(data.sector_stage)}18`, color: stageColor(data.sector_stage), border: `1px solid ${stageColor(data.sector_stage)}30`, ...MONO, fontSize: '0.68rem', fontWeight: 700 }} />
                </Box>
                <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>GROWING?</Typography>
                  <Chip
                    label={data.sector_growing ? 'YES' : 'NO'} size="small"
                    sx={{ bgcolor: data.sector_growing ? '#22c55e18' : '#ef444418', color: data.sector_growing ? '#22c55e' : '#ef4444', border: `1px solid ${data.sector_growing ? '#22c55e' : '#ef4444'}30`, ...MONO, fontSize: '0.68rem', fontWeight: 700 }}
                  />
                </Box>
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 0.75 }}>Growth Drivers</Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
                {data.sector_growth_drivers.map((d, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                    <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, pt: 0.15, flexShrink: 0 }}>0{i + 1}</Typography>
                    <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2 }}>{d}</Typography>
                  </Box>
                ))}
              </Box>
            </Panel>

            {/* ── Tailwinds & Headwinds ─────────────────────────────────────── */}
            <Panel id="catalysts" title="Tailwinds & Headwinds" accent="#06b6d4" defaultOpen>
              <Grid container spacing={2}>
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', flexShrink: 0 }} />
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK }}>Tailwinds</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {data.tailwinds.map((t, i) => (
                      <Box key={i} sx={{ p: 1.25, borderRadius: '8px', bgcolor: '#22c55e0d', border: '1px solid #22c55e20', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Box component="span" sx={{ color: '#22c55e', fontSize: '0.65rem', pt: 0.1, flexShrink: 0 }}>↑</Box>
                        <Typography sx={{ ...SANS, fontSize: '0.73rem', color: INK2, lineHeight: 1.5 }}>{t}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Grid>
                <Grid item xs={12} md={6}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.25 }}>
                    <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#ef4444', flexShrink: 0 }} />
                    <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK }}>Headwinds</Typography>
                  </Box>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
                    {data.headwinds.map((h, i) => (
                      <Box key={i} sx={{ p: 1.25, borderRadius: '8px', bgcolor: '#ef44440d', border: '1px solid #ef444420', display: 'flex', gap: 1, alignItems: 'flex-start' }}>
                        <Box component="span" sx={{ color: '#ef4444', fontSize: '0.65rem', pt: 0.1, flexShrink: 0 }}>↓</Box>
                        <Typography sx={{ ...SANS, fontSize: '0.73rem', color: INK2, lineHeight: 1.5 }}>{h}</Typography>
                      </Box>
                    ))}
                  </Box>
                </Grid>
              </Grid>
            </Panel>

            {/* ── Revenue predictors ───────────────────────────────────────── */}
            <Panel id="predictors" title="Revenue Predictors" accent="#f43f5e">
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, mb: 2 }}>
                Leading indicators that tend to precede revenue or margin changes by 1–3 months.
              </Typography>
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                {data.predictors.map((p, i) => (
                  <Box key={i} sx={{ display: 'flex', gap: 1.5, p: 1.5, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                    <Box sx={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}30`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, fontWeight: 700 }}>
                        {String(i + 1).padStart(2, '0')}
                      </Typography>
                    </Box>
                    <Box>
                      <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 700, color: INK, mb: 0.3 }}>{p.name}</Typography>
                      <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.5 }}>{p.why}</Typography>
                    </Box>
                  </Box>
                ))}
              </Box>
            </Panel>

          </>
        )}

        {/* Placeholder when nothing loaded yet */}
        {!loading && !data && !error && (
          <Box sx={{ textAlign: 'center', py: 10, color: INK3 }}>
            <Typography sx={{ ...MONO, fontSize: '0.8rem', mb: 1 }}>
              Enter an NSE ticker and click Analyze
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.72rem' }}>
              e.g. RELIANCE · TCS · INFY · HDFCBANK · TATAMOTORS
            </Typography>
          </Box>
        )}

      </Box>

      <Footer />
    </Box>
  )
}
