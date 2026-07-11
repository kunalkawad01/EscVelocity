import { useState, useEffect, useCallback } from 'react'
import { useParams, useSearchParams, Link } from 'react-router-dom'
import { Box, Typography, CircularProgress, Collapse } from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import SectionHead from '../components/shared/SectionHead'
import { portfoliosApi } from '../api/portfoliosApi'
import type { TrackResponse, LiveResponse, TrackHolding, Universe } from '../types/portfolios'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const
const GREEN = '#22C55E'
const RED   = '#EF4444'
const AMBER = '#FBBF24'

const pf = (v: number | null | undefined, d = 2) =>
  v === null || v === undefined ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(d)}%`
const rupee = (v: number | null | undefined, d = 2) => (v === null || v === undefined ? '—' : `₹${v.toFixed(d)}`)

const UNIVERSES: { key: Universe; label: string }[] = [
  { key: 'nifty200', label: 'Nifty 200' },
  { key: 'nifty500', label: 'Nifty 500' },
]

const RET_COLS: { key: keyof TrackHolding; rank: keyof TrackHolding; label: string }[] = [
  { key: 'ret_1d', rank: 'ret_1d_rank', label: '1D' },
  { key: 'ret_5d', rank: 'ret_5d_rank', label: '5D' },
  { key: 'ret_1m', rank: 'ret_1m_rank', label: '1M' },
  { key: 'ret_3m', rank: 'ret_3m_rank', label: '3M' },
  { key: 'ret_6m', rank: 'ret_6m_rank', label: '6M' },
  { key: 'ret_1y', rank: 'ret_1y_rank', label: '1Y' },
]

function UniverseToggle({ value, onChange }: { value: Universe; onChange: (u: Universe) => void }) {
  const { INK, INK3, CYAN, BORDER, PAPER } = usePalette()
  return (
    <Box sx={{ display: 'inline-flex', border: `1px solid ${BORDER}`, borderRadius: '10px', overflow: 'hidden', bgcolor: PAPER }}>
      {UNIVERSES.map(u => {
        const active = u.key === value
        return (
          <Box key={u.key} onClick={() => onChange(u.key)} sx={{
            px: 2, py: 0.7, cursor: 'pointer', ...MONO, fontSize: '0.68rem', fontWeight: 700,
            color: active ? '#04121F' : INK3, bgcolor: active ? CYAN : 'transparent',
            '&:hover': { color: active ? '#04121F' : INK },
          }}>{u.label.toUpperCase()}</Box>
        )
      })}
    </Box>
  )
}

// ─── Forward growth-of-₹100 curve (inception-marked) ───────────────────────────
function ForwardCurve({ t }: { t: TrackResponse }) {
  const { CYAN, INK, INK3, BORDER } = usePalette()
  const pts = t.equity_curve
  if (pts.length < 2) {
    return (
      <Box sx={{ border: `1px dashed ${BORDER}`, borderRadius: '10px', p: 3, textAlign: 'center' }}>
        <Typography sx={{ ...JAKARTA, fontSize: '0.85rem', color: INK }}>
          Tracking begins {t.inception_date} at ₹100.
        </Typography>
        <Typography sx={{ ...JAKARTA, fontSize: '0.76rem', color: INK3, mt: 0.5 }}>
          The forward curve builds one point per trading day — check back tomorrow.
        </Typography>
      </Box>
    )
  }
  const vals = pts.map(p => p.nav)
  const lo = Math.min(100, ...vals), hi = Math.max(100, ...vals), W = 640, H = 160
  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (v: number) => H - ((v - lo) / (hi - lo || 1)) * H
  const line = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.nav)}`).join(' ')
  const y100 = y(100)
  return (
    <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: '10px', p: 2 }}>
      <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, letterSpacing: '0.08em', mb: 1 }}>
        GROWTH OF ₹100 · FORWARD FROM {t.inception_date.toUpperCase()}
      </Typography>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <line x1={0} y1={y100} x2={W} y2={y100} stroke={INK3} strokeWidth={1} strokeDasharray="3 4" opacity={0.5} />
        <path d={line} fill="none" stroke={CYAN} strokeWidth={2} />
        <circle cx={x(0)} cy={y(pts[0].nav)} r={3.5} fill={CYAN} />
      </svg>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>◦ Inception {t.inception_date} · ₹100</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: t.current_nav >= 100 ? GREEN : RED }}>
          {t.as_of} · {rupee(t.current_nav)}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Return cell (value + percentile rank) ─────────────────────────────────────
function RetCell({ val, rank }: { val: number | null; rank: number | null }) {
  const { INK3, BORDER } = usePalette()
  const color = val === null ? INK3 : val >= 0 ? GREEN : RED
  const rankColor = rank === null ? INK3 : rank >= 80 ? GREEN : rank <= 20 ? RED : AMBER
  return (
    <Box sx={{ textAlign: 'right', minWidth: 66 }}>
      <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color }}>{pf(val, 1)}</Typography>
      {rank !== null && (
        <Typography sx={{ ...MONO, fontSize: '0.56rem', color: rankColor, border: `1px solid ${BORDER}`, borderRadius: '4px', px: 0.4, display: 'inline-block', mt: 0.2 }}>
          P{rank.toFixed(0)}
        </Typography>
      )}
    </Box>
  )
}

// ─── Holding row (expandable rationale) ────────────────────────────────────────
function HoldingRow({ h, idx }: { h: TrackHolding; idx: number }) {
  const [open, setOpen] = useState(false)
  const { INK, INK2, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  const se = h.since_entry_pct
  return (
    <Box sx={{ borderBottom: `1px solid ${BORDER}` }}>
      <Box onClick={() => setOpen(o => !o)} sx={{
        display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1.1, cursor: 'pointer',
        '&:hover': { bgcolor: PAPER2 }, minWidth: 780,
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK3, width: 22 }}>{idx + 1}</Typography>
        <Box sx={{ minWidth: 150 }}>
          <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color: INK }}>{h.symbol}</Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.64rem', color: INK3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 150 }}>
            {h.name ?? ''}
          </Typography>
        </Box>
        <Box sx={{ minWidth: 62, textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3 }}>SINCE ENTRY</Typography>
          <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: se === null ? INK3 : se >= 0 ? GREEN : RED }}>{pf(se, 1)}</Typography>
        </Box>
        {RET_COLS.map(c => (
          <RetCell key={c.label} val={h[c.key] as number | null} rank={h[c.rank] as number | null} />
        ))}
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, width: 14, ml: 0.5 }}>{open ? '▾' : '▸'}</Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ px: 3, py: 1.25, bgcolor: PAPER2 }}>
          <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3, mb: 0.5 }}>WEIGHT {h.weight_pct}% · ENTRY {rupee(h.entry_close)} · LTP {rupee(h.ltp)}</Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.74rem', color: INK2 }}>
            {h.rationale ? `Selected because: ${h.rationale}.` : 'No stored rationale.'}
          </Typography>
        </Box>
      </Collapse>
    </Box>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────
export default function PortfolioDetailPage() {
  const { key = '' } = useParams()
  const [sp, setSp] = useSearchParams()
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BG, BORDER, PAPER2 } = usePalette()
  const { CARD, TH } = useTokens()

  const universe = (sp.get('universe') === 'nifty200' ? 'nifty200' : 'nifty500') as Universe
  const [t, setT] = useState<TrackResponse | null>(null)
  const [live, setLive] = useState<LiveResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const setUniverse = useCallback((u: Universe) => {
    const next = new URLSearchParams(sp); next.set('universe', u); setSp(next, { replace: true })
  }, [sp, setSp])

  useEffect(() => {
    setLoading(true); setError(null); setT(null)
    portfoliosApi.getTrack(key, universe)
      .then(setT).catch(e => setError(String(e))).finally(() => setLoading(false))
  }, [key, universe])

  // While the market is LIVE, refresh the track (NAV, curve tip, since-entry) every 8s.
  useEffect(() => {
    if (!t?.is_live) return
    const id = setInterval(() => {
      portfoliosApi.getTrack(key, universe).then(setT).catch(() => {})
    }, 8000)
    return () => clearInterval(id)
  }, [t?.is_live, key, universe])

  // Live basket ticker: poll while market is LIVE.
  useEffect(() => {
    if (!key) return
    let timer: ReturnType<typeof setInterval> | undefined
    let cancelled = false
    const tick = () => {
      portfoliosApi.getLive(key, universe).then(r => {
        if (cancelled) return
        setLive(r)
        if (!r.is_live && timer) { clearInterval(timer); timer = undefined }
      }).catch(() => {})
    }
    setLive(null); tick(); timer = setInterval(tick, 5000)
    return () => { cancelled = true; if (timer) clearInterval(timer) }
  }, [key, universe])

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar sections={[{ label: 'Overview', anchor: 'overview' }, { label: 'Holdings', anchor: 'holdings' }, { label: 'Log', anchor: 'log' }]} />

      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 5 }, pt: 5, pb: 4 }}>
        <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
          <Link to="/portfolios" style={{ textDecoration: 'none' }}>
            <Typography sx={{ ...MONO, fontSize: '0.66rem', color: CYAN, mb: 1.5 }}>← ALL PORTFOLIOS</Typography>
          </Link>
          {loading && <CircularProgress size={24} sx={{ color: CYAN }} />}
          {error && <Typography sx={{ ...JAKARTA, color: RED, fontSize: '0.85rem' }}>{error}</Typography>}
          {t && (
            <>
              <Box sx={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2 }}>
                <Box>
                  <Typography sx={{ ...JAKARTA, fontSize: { xs: '1.7rem', md: '2.2rem' }, fontWeight: 800, color: INK, lineHeight: 1.05 }}>
                    {t.name}
                  </Typography>
                  <Typography sx={{ ...JAKARTA, fontSize: '0.86rem', color: INK2, maxWidth: 560, mt: 1 }}>{t.description}</Typography>
                  <Box sx={{ display: 'flex', gap: 1.5, mt: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
                    <UniverseToggle value={universe} onChange={setUniverse} />
                    <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3 }}>REBAL {t.rebalance.toUpperCase()}</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3 }}>HOLD {t.expected_holding}</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3 }}>INCEPTION {t.inception_date}</Typography>
                  </Box>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, justifyContent: 'flex-end' }}>
                    {t.is_live && (
                      <Box sx={{
                        width: 6, height: 6, borderRadius: '50%', bgcolor: GREEN,
                        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                        animation: 'pulse 1.5s ease-in-out infinite',
                      }} />
                    )}
                    <Typography sx={{ ...MONO, fontSize: '0.6rem', color: t.is_live ? GREEN : INK3 }}>
                      GROWTH OF ₹100{t.is_live ? ' · LIVE' : ''}
                    </Typography>
                  </Box>
                  <Typography sx={{ ...JAKARTA, fontSize: '2.4rem', fontWeight: 800, color: t.current_nav >= 100 ? GREEN : RED, lineHeight: 1 }}>
                    {rupee(t.current_nav)}
                  </Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color: t.total_return_pct >= 0 ? GREEN : RED }}>
                    {pf(t.total_return_pct)} · {t.days_live}d live
                  </Typography>
                </Box>
              </Box>
            </>
          )}
        </Box>
      </Box>

      {t && (
        <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 2, md: 5 }, py: 4 }}>
          {/* Live ticker */}
          {live && (
            <Box sx={{ ...CARD, p: 1.5, mb: 3, display: 'flex', alignItems: 'center', gap: 2.5, flexWrap: 'wrap', border: `1px solid ${live.is_live ? CYAN : BORDER}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                {live.is_live && <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: GREEN, '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } }, animation: 'pulse 1.5s ease-in-out infinite' }} />}
                <Typography sx={{ ...MONO, fontSize: '0.62rem', color: live.is_live ? GREEN : INK3 }}>{live.state_label}</Typography>
              </Box>
              <Box>
                <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3 }}>BASKET {live.is_live ? 'LIVE (vs prev close)' : 'LAST SESSION'}</Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '1.1rem', fontWeight: 800, color: (live.basket_return_pct ?? 0) >= 0 ? GREEN : RED }}>{pf(live.basket_return_pct)}</Typography>
              </Box>
              <Typography sx={{ ...MONO, fontSize: '0.68rem' }}>
                <span style={{ color: GREEN }}>▲ {live.advancers}</span><span style={{ color: INK3 }}>{'  ·  '}</span><span style={{ color: RED }}>▼ {live.decliners}</span>
              </Typography>
            </Box>
          )}

          {/* Forward curve */}
          <Box id="overview" sx={{ mb: 4 }}>
            <SectionHead title="Forward Performance" accent={CYAN} meta={`${t.days_live} trading day${t.days_live === 1 ? '' : 's'} live`} />
            <ForwardCurve t={t} />
          </Box>

          {/* Holdings */}
          <Box id="holdings" sx={{ mb: 4 }}>
            <SectionHead title="Holdings" accent="#8B5CF6" meta={`${t.count} names · ranked by since-entry return · percentile ranks vs ${universe === 'nifty200' ? 'Nifty 200' : 'Nifty 500'}`} />
            <Box sx={{ ...CARD, overflowX: 'auto' }}>
              <Box sx={{ minWidth: 780 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, px: 1.5, py: 1, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
                  <Typography sx={{ ...TH, width: 22 }}>#</Typography>
                  <Typography sx={{ ...TH, minWidth: 150 }}>SYMBOL</Typography>
                  <Typography sx={{ ...TH, minWidth: 62, textAlign: 'right' }}>ENTRY</Typography>
                  {RET_COLS.map(c => <Typography key={c.label} sx={{ ...TH, minWidth: 66, textAlign: 'right' }}>{c.label}</Typography>)}
                  <Box sx={{ width: 14, ml: 0.5 }} />
                </Box>
                {t.holdings.map((h, i) => <HoldingRow key={h.symbol} h={h} idx={i} />)}
                {t.holdings.length === 0 && (
                  <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK3, p: 3, textAlign: 'center' }}>
                    No holdings — this basket was empty at inception (strict screen in a calm market).
                  </Typography>
                )}
              </Box>
            </Box>
          </Box>

          {/* Rebalance log */}
          <Box id="log">
            <SectionHead title="Rebalance Log" accent="#F59E0B" meta={`${t.rebalance_log.length} events`} />
            <Box sx={{ ...CARD, overflow: 'hidden' }}>
              {t.rebalance_log.map((e, i) => {
                const c = e.action === 'ADD' ? GREEN : e.action === 'DROP' ? RED : CYAN
                return (
                  <Box key={i} sx={{ display: 'flex', gap: 1.5, px: 2, py: 1, borderBottom: `1px solid ${BORDER}`, alignItems: 'baseline' }}>
                    <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK3, minWidth: 84 }}>{e.date}</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: c, minWidth: 78 }}>{e.action}</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK, minWidth: 96 }}>{e.symbol}</Typography>
                    <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK2 }}>{e.rationale}</Typography>
                  </Box>
                )
              })}
              {t.rebalance_log.length === 0 && (
                <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK3, p: 3, textAlign: 'center' }}>No events yet.</Typography>
              )}
            </Box>
          </Box>
        </Box>
      )}
      <Footer />
    </Box>
  )
}
