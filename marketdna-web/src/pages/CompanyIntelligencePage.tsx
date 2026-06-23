import { useState, useCallback, useEffect } from 'react'
import {
  Box, Typography, Grid, CircularProgress, Alert, Chip,
  Table, TableBody, TableCell, TableHead, TableRow, Tooltip,
  OutlinedInput, Drawer,
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

// ── helpers ───────────────────────────────────────────────────────────────────
function threatColor(s: number) { return s <= 3 ? '#22c55e' : s <= 6 ? '#fbbf24' : '#ef4444' }
function retColor(v: number | null) { return v === null ? '#94a3b8' : v >= 0 ? '#22c55e' : '#ef4444' }
function concColor(c: string) { return c === 'CONCENTRATED' ? '#ef4444' : c === 'MODERATE' ? '#fbbf24' : '#22c55e' }
function durColor(d: string) { return d === 'STRONG' ? '#22c55e' : d === 'MODERATE' ? '#fbbf24' : '#ef4444' }
function powerColor(v: string) { return v === 'HIGH' ? '#22c55e' : v === 'MODERATE' ? '#fbbf24' : '#ef4444' }
function stageColor(s: string) { return s === 'EARLY' ? '#a855f7' : s === 'GROWTH' ? '#22c55e' : s === 'MATURE' ? '#fbbf24' : '#ef4444' }
function fmtNum(v: number | null, dp = 2) { return v === null || v === undefined ? '—' : v.toFixed(dp) }
function fmtVol(v: number | null) {
  if (!v) return '—'
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`
  return v.toLocaleString('en-IN')
}

// ── Reusable impact table ─────────────────────────────────────────────────────
type ImpactRow = { metric: string; level: 'HIGH' | 'MEDIUM' | 'LOW'; reason: string }
function ImpactTable({ rows }: { rows: ImpactRow[] }) {
  const { INK, INK2, INK3, PAPER2, BORDER } = usePalette()
  const { TH, TD } = useTokens()
  const lc = (l: string) => l === 'HIGH' ? '#ef4444' : l === 'MEDIUM' ? '#fbbf24' : '#22c55e'
  return (
    <Table size="small">
      <TableHead>
        <TableRow>
          <TableCell sx={{ ...TH }}>Financial Metric</TableCell>
          <TableCell sx={{ ...TH }}>Impact</TableCell>
          <TableCell sx={{ ...TH }}>How it connects</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {rows.map((r, i) => (
          <TableRow key={i}>
            <TableCell sx={{ ...TD, ...SANS, fontWeight: 600, color: INK }}>{r.metric}</TableCell>
            <TableCell sx={{ ...TD }}>
              <Chip label={r.level} size="small"
                sx={{ bgcolor: `${lc(r.level)}14`, color: lc(r.level), border: `1px solid ${lc(r.level)}30`, ...MONO, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
            </TableCell>
            <TableCell sx={{ ...TD, ...SANS, color: INK2, lineHeight: 1.5 }}>{r.reason}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )
}

// ── Key takeaways ─────────────────────────────────────────────────────────────
function KeyTakeaways({ points, accent }: { points: string[]; accent: string }) {
  const { INK, INK2, PAPER2, BORDER } = usePalette()
  return (
    <Box sx={{ p: 2, borderRadius: '10px', bgcolor: `${accent}0a`, border: `1px solid ${accent}25` }}>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: accent, fontWeight: 700, letterSpacing: '0.1em', mb: 1.25 }}>
        KEY TAKEAWAYS
      </Typography>
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {points.map((p, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1, alignItems: 'flex-start' }}>
            <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: accent, mt: 0.6, flexShrink: 0 }} />
            <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK2, lineHeight: 1.6 }}>{p}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Section heading inside drawer ─────────────────────────────────────────────
function DSHead({ title, accent }: { title: string; accent: string }) {
  const { INK } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
      <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK, letterSpacing: '0.04em' }}>
        {title}
      </Typography>
    </Box>
  )
}

// ── SVG: Porter's Five Forces ─────────────────────────────────────────────────
function PorterSVG({ porter }: { porter: IntelligenceData['porter'] }) {
  const { PAPER2, BORDER, INK, INK3 } = usePalette()
  const forces = [
    { label: 'New Entrants',   score: porter.new_entrants.score,   x: 175, y: 8,   w: 130, h: 52, cx: 240, cy: 60 },
    { label: 'Supplier Power', score: porter.supplier_power.score, x: 10,  y: 118, w: 130, h: 52, cx: 140, cy: 144 },
    { label: 'Buyer Power',    score: porter.buyer_power.score,    x: 340, y: 118, w: 130, h: 52, cx: 340, cy: 144 },
    { label: 'Substitutes',    score: porter.substitutes.score,    x: 175, y: 228, w: 130, h: 52, cx: 240, cy: 228 },
  ]
  const rivalryScore = porter.rivalry.score
  const rc = threatColor(rivalryScore)
  return (
    <svg viewBox="0 0 480 290" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* connecting lines */}
      <line x1="240" y1="60" x2="240" y2="116" stroke={BORDER} strokeWidth="1.5" strokeDasharray="5,3" />
      <line x1="140" y1="144" x2="188" y2="144" stroke={BORDER} strokeWidth="1.5" strokeDasharray="5,3" />
      <line x1="340" y1="144" x2="292" y2="144" stroke={BORDER} strokeWidth="1.5" strokeDasharray="5,3" />
      <line x1="240" y1="228" x2="240" y2="174" stroke={BORDER} strokeWidth="1.5" strokeDasharray="5,3" />
      {/* rivalry center */}
      <rect x="188" y="116" width="104" height="58" rx="10" fill={`${rc}22`} stroke={rc} strokeWidth="2" />
      <text x="240" y="139" textAnchor="middle" fontFamily="'IBM Plex Sans'" fontSize="11" fontWeight="800" fill={rc}>RIVALRY</text>
      <text x="240" y="157" textAnchor="middle" fontFamily="'IBM Plex Mono'" fontSize="15" fontWeight="800" fill={rc}>{rivalryScore}/10</text>
      {/* outer forces */}
      {forces.map(f => {
        const fc = threatColor(f.score)
        return (
          <g key={f.label}>
            <rect x={f.x} y={f.y} width={f.w} height={f.h} rx="8" fill={`${fc}14`} stroke={`${fc}50`} strokeWidth="1.5" />
            <text x={f.x + f.w / 2} y={f.y + 18} textAnchor="middle" fontFamily="'IBM Plex Sans'" fontSize="10" fontWeight="700" fill={INK3}>{f.label.toUpperCase()}</text>
            <text x={f.x + f.w / 2} y={f.y + 38} textAnchor="middle" fontFamily="'IBM Plex Mono'" fontSize="16" fontWeight="800" fill={fc}>{f.score}/10</text>
          </g>
        )
      })}
      {/* legend */}
      {[['1–3 Low', '#22c55e'], ['4–6 Moderate', '#fbbf24'], ['7–10 High', '#ef4444']].map(([label, color], i) => (
        <g key={label}>
          <circle cx={16 + i * 110} cy={280} r={5} fill={color as string} />
          <text x={26 + i * 110} y={284} fontFamily="'IBM Plex Sans'" fontSize="10" fill={INK3}>{label} threat</text>
        </g>
      ))}
    </svg>
  )
}

// ── SVG: Business Model flowchart ─────────────────────────────────────────────
function BizModelSVG({ segments, cyan }: { segments: IntelligenceData['business_model']['segments']; cyan: string }) {
  const { PAPER2, BORDER, INK, INK2, INK3 } = usePalette()
  const COLORS = [cyan, '#a855f7', '#f97316', '#14b8a6', '#3b82f6']
  const total = segments.reduce((s, x) => s + x.pct, 0)
  return (
    <svg viewBox="0 0 520 180" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* segment boxes */}
      {segments.map((seg, i) => {
        const y = 18 + i * 52
        const barW = Math.round((seg.pct / total) * 220)
        const color = COLORS[i % COLORS.length]
        return (
          <g key={i}>
            <rect x="10" y={y} width={barW} height="38" rx="6" fill={`${color}22`} stroke={`${color}60`} strokeWidth="1.5" />
            <text x="20" y={y + 16} fontFamily="'IBM Plex Sans'" fontSize="10" fontWeight="700" fill={color}>{seg.name}</text>
            <text x="20" y={y + 31} fontFamily="'IBM Plex Mono'" fontSize="11" fontWeight="800" fill={color}>{seg.pct}%</text>
            {/* arrow line to funnel */}
            <line x1={barW + 10} y1={y + 19} x2="260" y2="87" stroke={`${color}60`} strokeWidth="1.5" />
          </g>
        )
      })}
      {/* funnel / company box */}
      <rect x="258" y="62" width="90" height="52" rx="10" fill={PAPER2} stroke={BORDER} strokeWidth="1.5" />
      <text x="303" y="84" textAnchor="middle" fontFamily="'IBM Plex Sans'" fontSize="10" fontWeight="700" fill={INK}>COMPANY</text>
      <text x="303" y="102" textAnchor="middle" fontFamily="'IBM Plex Mono'" fontSize="9" fill={INK3}>value capture</text>
      {/* arrow to revenue */}
      <line x1="348" y1="88" x2="378" y2="88" stroke={cyan} strokeWidth="2" markerEnd="url(#arrowC)" />
      <rect x="376" y="66" width="80" height="44" rx="8" fill={`${cyan}18`} stroke={`${cyan}50`} strokeWidth="1.5" />
      <text x="416" y="84" textAnchor="middle" fontFamily="'IBM Plex Mono'" fontSize="12" fontWeight="800" fill={cyan}>₹ REV</text>
      <text x="416" y="100" textAnchor="middle" fontFamily="'IBM Plex Sans'" fontSize="9" fill={INK3}>recurring</text>
      <defs>
        <marker id="arrowC" markerWidth="6" markerHeight="6" refX="3" refY="3" orient="auto">
          <path d="M0,0 L0,6 L6,3 Z" fill={cyan} />
        </marker>
      </defs>
    </svg>
  )
}

// ── SVG: Margin waterfall ─────────────────────────────────────────────────────
function MarginWaterfallSVG({ margins, cyan }: { margins: IntelligenceData['margins']; cyan: string }) {
  const { INK, INK3, PAPER2, BORDER } = usePalette()
  const bars = [
    { label: 'Revenue', co: 100, industry: 100, color: '#6366f1' },
    { label: 'Gross Margin', co: margins.gross_margin_co, industry: margins.gross_margin_industry, color: '#22c55e' },
    { label: 'EBITDA', co: margins.ebitda_margin_co, industry: margins.ebitda_margin_industry, color: '#f59e0b' },
    { label: 'PAT', co: margins.pat_margin_co, industry: margins.pat_margin_industry, color: '#ec4899' },
  ]
  return (
    <svg viewBox="0 0 500 180" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {bars.map((b, i) => {
        const y = 20 + i * 38
        const coW = Math.round(b.co * 3.5)
        const indW = Math.round(b.industry * 3.5)
        return (
          <g key={b.label}>
            <text x="105" y={y + 14} textAnchor="end" fontFamily="'IBM Plex Sans'" fontSize="10" fontWeight="700" fill={INK3}>{b.label}</text>
            {/* industry bar (ghost) */}
            <rect x="110" y={y} width={indW} height="14" rx="3" fill={`${b.color}20`} stroke={`${b.color}30`} />
            <text x={110 + indW + 4} y={y + 11} fontFamily="'IBM Plex Mono'" fontSize="9" fill={INK3}>{b.industry}%</text>
            {/* company bar */}
            <rect x="110" y={y + 16} width={coW} height="14" rx="3" fill={`${b.color}70`} stroke={b.color} strokeWidth="0.5" />
            <text x={110 + coW + 4} y={y + 27} fontFamily="'IBM Plex Mono'" fontSize="9" fontWeight="700" fill={b.color}>{b.co}%</text>
          </g>
        )
      })}
      {/* legend */}
      <rect x="110" y="168" width="12" height="6" rx="2" fill="#66666630" stroke="#66666650" />
      <text x="126" y="175" fontFamily="'IBM Plex Sans'" fontSize="9" fill={INK3}>Industry avg</text>
      <rect x="210" y="168" width="12" height="6" rx="2" fill="#66666680" />
      <text x="226" y="175" fontFamily="'IBM Plex Sans'" fontSize="9" fill={INK3}>This company</text>
    </svg>
  )
}

// ── SVG: Revenue streams ──────────────────────────────────────────────────────
function RevStreamSVG({ streams }: { streams: IntelligenceData['revenue_model']['streams'] }) {
  const { INK, INK3, PAPER2, BORDER } = usePalette()
  const STREAM_COLORS: Record<string, string> = {
    SUBSCRIPTION: '#6366f1', CONTRACT: '#14b8a6', TRANSACTIONAL: '#f97316', INTEREST: '#22c55e', FEE: '#a855f7',
  }
  const GROWTH_COLORS: Record<string, string> = { GROWING: '#22c55e', STABLE: '#fbbf24', DECLINING: '#ef4444' }
  return (
    <svg viewBox="0 0 500 40" style={{ width: '100%', height: 'auto', display: 'block' }}>
      {/* stacked bar */}
      {(() => {
        let x = 0
        return streams.map((s, i) => {
          const w = s.pct * 4.9
          const color = STREAM_COLORS[s.type] ?? '#64748b'
          const el = (
            <g key={i}>
              <rect x={x} y="0" width={w} height="28" rx={i === 0 ? '6 0 0 6' : i === streams.length - 1 ? '0 6 6 0' : '0'} fill={`${color}80`} stroke={color} strokeWidth="0.5" />
              <text x={x + w / 2} y="16" textAnchor="middle" fontFamily="'IBM Plex Mono'" fontSize="10" fontWeight="700" fill={color}>{s.pct}%</text>
              <text x={x + w / 2} y="37" textAnchor="middle" fontFamily="'IBM Plex Sans'" fontSize="9" fill={INK3}>{s.name.split(' ')[0]}</text>
            </g>
          )
          x += w
          return el
        })
      })()}
    </svg>
  )
}

// ── Quote card ────────────────────────────────────────────────────────────────
function QuoteCard({ q }: { q: LiveQuote | null }) {
  const { CARD, t2, t3, BORDER } = useTokens()
  const { INK, INK3 } = usePalette()
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
      <DSHead title="Live Quote" accent="#22c55e" />
      {!q ? (
        <Typography sx={{ ...t3, ...SANS, mt: 1.5 }}>Kite quote unavailable — check access token or market hours.</Typography>
      ) : (
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
            <Typography sx={{ ...MONO, fontSize: '1.5rem', fontWeight: 700, color: INK }}>₹{fmtNum(q.last_price)}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color }}>{chg !== null ? `${chg >= 0 ? '+' : ''}${fmtNum(chg)}%` : ''}</Typography>
          </Box>
          <Row label="Open / Close"   val={`₹${fmtNum(q.open)} / ₹${fmtNum(q.close)}`} />
          <Row label="Day H / L"      val={`₹${fmtNum(q.high)} / ₹${fmtNum(q.low)}`} />
          <Row label="Volume"         val={fmtVol(q.volume)} />
          <Row label="Circuit ↑ / ↓" val={`₹${fmtNum(q.upper_circuit)} / ₹${fmtNum(q.lower_circuit)}`} />
        </Box>
      )}
    </Box>
  )
}

// ── Fundamentals card ─────────────────────────────────────────────────────────
function FundamentalsCard({ f }: { f: Fundamentals | null }) {
  const { CARD, t3, t2, BORDER } = useTokens()
  const { INK2 } = usePalette()
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
      <DSHead title="Historical Metrics" accent="#6366f1" />
      {!f ? <Typography sx={{ ...t3, ...SANS, mt: 1.5 }}>Loading…</Typography>
        : f.error ? <Typography sx={{ ...t3, ...SANS, mt: 1.5, color: '#ef4444' }}>{f.error}</Typography>
        : (
          <Box sx={{ mt: 1.5 }}>
            <Row label="52W High"        val={f.high_52w ? `₹${fmtNum(f.high_52w)}` : '—'} />
            <Row label="52W Low"         val={f.low_52w  ? `₹${fmtNum(f.low_52w)}`  : '—'} />
            <Row label="Last Close"      val={f.last_close ? `₹${fmtNum(f.last_close)}` : '—'} />
            <Row label="1Y Return"
              val={f.ret_1y_pct !== null ? `${f.ret_1y_pct >= 0 ? '+' : ''}${fmtNum(f.ret_1y_pct)}%` : '—'}
              color={retColor(f.ret_1y_pct)} />
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
      <Typography sx={{ ...MONO, fontSize: '0.82rem', color: CYAN }}>Claude is analyzing{dots}</Typography>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: '#64748b' }}>First call takes 3–6 seconds</Typography>
    </Box>
  )
}

// ── Module card (closed state) ────────────────────────────────────────────────
interface ModuleStat { label: string; value: string; color?: string }
function ModuleCard({ title, accent, icon, stats, onClick }: {
  title: string; accent: string; icon: string; stats: ModuleStat[]; onClick: () => void
}) {
  const { PAPER, PAPER2, INK, INK2, INK3, BORDER } = usePalette()
  return (
    <Box
      onClick={onClick}
      sx={{
        p: 2, borderRadius: '14px', bgcolor: PAPER,
        border: `1px solid ${BORDER}`, borderTop: `3px solid ${accent}`,
        cursor: 'pointer', transition: 'transform 0.15s, box-shadow 0.15s',
        '&:hover': { transform: 'translateY(-3px)', boxShadow: `0 8px 28px ${accent}25`, borderColor: `${accent}60` },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
        <Typography sx={{ fontSize: '1.3rem', lineHeight: 1 }}>{icon}</Typography>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK }}>{title}</Typography>
      </Box>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6, mb: 1.75 }}>
        {stats.map((s, i) => (
          <Box key={i} sx={{ px: 1, py: 0.3, borderRadius: '6px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>{s.label}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 700, color: s.color ?? INK2 }}>{s.value}</Typography>
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', color: accent }}>Explore deep dive</Typography>
        <Typography sx={{ fontSize: '0.75rem', color: accent }}>→</Typography>
      </Box>
    </Box>
  )
}

// ── Drawer: section divider ───────────────────────────────────────────────────
function DrawerSection({ title, accent, children }: { title: string; accent: string; children: React.ReactNode }) {
  const { BORDER } = usePalette()
  return (
    <Box sx={{ mb: 3 }}>
      <DSHead title={title} accent={accent} />
      {children}
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// DRAWER CONTENT — one component per module
// ═══════════════════════════════════════════════════════════════════════════════

function OverviewDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  return (
    <>
      <DrawerSection title="What This Company Does" accent="#6366f1">
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, lineHeight: 1.75, mb: 2 }}>{data.what_they_do}</Typography>
        <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
          {[['Sector', data.sector], ['Industry', data.industry], ['Sub-Industry', data.sub_industry]].map(([label, val]) => (
            <Box key={label} sx={{ p: 1.25, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, minWidth: 130 }}>
              <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.25 }}>{label}</Typography>
              <Typography sx={{ ...SANS, fontSize: '0.76rem', fontWeight: 700, color: INK }}>{val}</Typography>
            </Box>
          ))}
        </Box>
      </DrawerSection>

      <DrawerSection title="Market Position" accent="#22c55e">
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 1.5 }}>
          <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>RANK</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 800, color: CYAN }}>{data.market_rank}</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>MARKET SHARE</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.9rem', fontWeight: 800, color: '#22c55e' }}>{data.market_share_pct}%</Typography>
          </Box>
          {data.market_leader && (
            <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: `${CYAN}12`, border: `1px solid ${CYAN}30` }}>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 800, color: CYAN }}>★ MARKET LEADER</Typography>
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {data.industry_keywords.map(kw => (
            <Chip key={kw} label={kw} size="small"
              sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, ...MONO, fontSize: '0.6rem', height: 20 }} />
          ))}
        </Box>
      </DrawerSection>

      <KeyTakeaways accent="#6366f1" points={[
        `${data.company} operates in ${data.sub_industry} — understanding the sub-industry dynamics is essential before analyzing financials.`,
        `With ${data.market_share_pct}% market share, ${data.market_leader ? 'it is the dominant player — pricing and margin benchmarks should be set to this company, not the industry average.' : 'it is a meaningful but not dominant player — watch competitive dynamics closely.'}`,
        `Sector stage is ${data.sector_stage} — this tells you what kind of growth is structurally achievable and what multiple the market should pay.`,
      ]} />
    </>
  )
}

function BizModelDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const bm = data.business_model
  const COLORS = [CYAN, '#a855f7', '#f97316', '#14b8a6', '#3b82f6']
  const dc = durColor(bm.moat_durability)
  return (
    <>
      <DrawerSection title="How This Business Creates Value" accent="#8b5cf6">
        <Chip label={bm.type} size="small" sx={{ bgcolor: `${CYAN}14`, color: CYAN, border: `1px solid ${CYAN}30`, ...MONO, fontSize: '0.68rem', fontWeight: 700, mb: 1.5 }} />
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, lineHeight: 1.75, mb: 2.5 }}>{bm.value_creation}</Typography>
        <BizModelSVG segments={bm.segments} cyan={CYAN} />
      </DrawerSection>

      <DrawerSection title="Business Segments — Deep Dive" accent="#a855f7">
        {bm.segments.map((s, i) => (
          <Box key={i} sx={{ mb: 1.5, p: 1.75, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${COLORS[i % COLORS.length]}` }}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
              <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK }}>{s.name}</Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Chip label={`${s.pct}% of revenue`} size="small"
                  sx={{ bgcolor: `${COLORS[i % COLORS.length]}18`, color: COLORS[i % COLORS.length], border: `1px solid ${COLORS[i % COLORS.length]}30`, ...MONO, fontSize: '0.62rem', fontWeight: 700 }} />
              </Box>
            </Box>
            <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK2, lineHeight: 1.55, mb: 0.5 }}>{s.desc}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>Margin profile: {s.margin_note}</Typography>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Competitive Moat" accent="#06b6d4">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip label={`${bm.moat_durability} MOAT`} size="small"
            sx={{ bgcolor: `${dc}14`, color: dc, border: `1px solid ${dc}30`, ...MONO, fontSize: '0.7rem', fontWeight: 800 }} />
          <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
            {bm.moat_durability === 'STRONG' ? 'Moat is durable — margin premiums and pricing power are likely to persist.' :
             bm.moat_durability === 'MODERATE' ? 'Moat is present but not impenetrable — watch for competitive incursions.' :
             'Moat is thin — competitive intensity will erode margins over time.'}
          </Typography>
        </Box>
        {bm.moat.map((m, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, p: 1.25, mb: 0.75, borderRadius: '8px', bgcolor: `${dc}0a`, border: `1px solid ${dc}20` }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: dc, pt: 0.15, flexShrink: 0 }}>▸</Typography>
            <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2, lineHeight: 1.5 }}>{m}</Typography>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Revenue Quality',     level: 'HIGH',   reason: 'Business model type determines recurring vs commodity revenue mix — directly drives valuation multiple.' },
          { metric: 'EBITDA Margin',       level: 'HIGH',   reason: 'Segment mix determines blended margin — high-margin segments (e.g. SaaS, telecom) pull the whole P&L up.' },
          { metric: 'Capital Intensity',   level: 'HIGH',   reason: 'Asset-heavy models (refining, banking) require more equity/debt to grow vs asset-light (IT services, SaaS).' },
          { metric: 'Free Cash Flow',      level: 'MEDIUM', reason: 'Capital intensity and working capital needs vary by segment — watch capex-to-revenue ratio.' },
          { metric: 'P/E & EV/EBITDA',    level: 'HIGH',   reason: 'Recurring, high-margin, asset-light models deserve 40–60% premium multiples vs cyclical commodity ones.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#8b5cf6" points={[
        `The business model type "${bm.type}" is your first filter when benchmarking margins — compare only within the same model archetype.`,
        `A ${bm.moat_durability.toLowerCase()} moat means ${bm.moat_durability === 'STRONG' ? 'margin compression from competition is unlikely in the near term — focus on growth rate instead.' : bm.moat_durability === 'MODERATE' ? 'the moat needs active management — watch for competitor moves and pricing actions.' : 'margin pressure is a real risk — cost structure and differentiation should be scrutinized every quarter.'}`,
        `Segment contribution percentages are the key to understanding earnings surprises — a 5% revenue beat in a high-margin segment has 2–3× the PAT impact of the same beat in a low-margin segment.`,
      ]} />
    </>
  )
}

function RevModelDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const rm = data.revenue_model
  const STREAM_COLORS: Record<string, string> = {
    SUBSCRIPTION: '#6366f1', CONTRACT: '#14b8a6', TRANSACTIONAL: '#f97316', INTEREST: '#22c55e', FEE: '#a855f7',
  }
  const GROWTH_INFO: Record<string, { icon: string; color: string; label: string }> = {
    GROWING:   { icon: '↑', color: '#22c55e', label: 'Growing' },
    STABLE:    { icon: '→', color: '#fbbf24', label: 'Stable' },
    DECLINING: { icon: '↓', color: '#ef4444', label: 'Declining' },
  }
  const pc = powerColor(rm.pricing_power)
  const vc = powerColor(rm.revenue_visibility)
  return (
    <>
      <DrawerSection title="Revenue Stream Architecture" accent="#ec4899">
        <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK3, mb: 1.5 }}>
          Understanding revenue stream composition is more important than the top-line number — it tells you predictability, margin quality, and growth ceiling.
        </Typography>
        <RevStreamSVG streams={rm.streams} />
        <Box sx={{ height: 12 }} />
        {rm.streams.map((s, i) => {
          const sc = STREAM_COLORS[s.type] ?? '#64748b'
          const g = GROWTH_INFO[s.growth]
          return (
            <Box key={i} sx={{ mb: 1.5, p: 1.75, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${sc}` }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.75, flexWrap: 'wrap' }}>
                <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK, flex: 1 }}>{s.name}</Typography>
                <Chip label={s.type} size="small"
                  sx={{ bgcolor: `${sc}18`, color: sc, border: `1px solid ${sc}30`, ...MONO, fontSize: '0.58rem', fontWeight: 700, height: 18 }} />
                <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 800, color: sc }}>{s.pct}%</Typography>
                <Chip label={`${g.icon} ${g.label}`} size="small"
                  sx={{ bgcolor: `${g.color}14`, color: g.color, border: `1px solid ${g.color}30`, ...MONO, fontSize: '0.6rem', fontWeight: 700, height: 18 }} />
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.73rem', color: INK2, lineHeight: 1.6 }}>{s.desc}</Typography>
            </Box>
          )
        })}
      </DrawerSection>

      <DrawerSection title="Pricing Power & Revenue Visibility" accent="#a855f7">
        <Grid container spacing={2}>
          {[
            { label: 'Pricing Power', value: rm.pricing_power, note: rm.pricing_power_note, color: pc,
              explain: 'Pricing power = ability to raise prices without losing volume. HIGH means margins expand in inflationary environments; LOW means revenue grows only with volume.' },
            { label: 'Revenue Visibility', value: rm.revenue_visibility, note: rm.revenue_visibility_note, color: vc,
              explain: 'Visibility = how much of next-quarter revenue is already contracted or recurring. HIGH visibility reduces earnings surprise risk and supports higher valuation multiples.' },
          ].map(({ label, value, note, color, explain }) => (
            <Grid item xs={12} md={6} key={label}>
              <Box sx={{ p: 2, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, height: '100%' }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 1 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 700, color: INK }}>{label}</Typography>
                  <Chip label={value} size="small"
                    sx={{ bgcolor: `${color}14`, color, border: `1px solid ${color}30`, ...MONO, fontSize: '0.68rem', fontWeight: 800 }} />
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.55, mb: 1 }}>{note}</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.68rem', color: INK3, lineHeight: 1.5, fontStyle: 'italic' }}>{explain}</Typography>
              </Box>
            </Grid>
          ))}
        </Grid>
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Revenue Predictability', level: 'HIGH',   reason: 'Subscription/contract streams give 12–18 month visibility; transactional revenue is quarter-to-quarter.' },
          { metric: 'Valuation Multiple',      level: 'HIGH',   reason: 'Recurring revenue streams trade at 3–5× higher EV/Sales vs transactional. Subscription = higher P/E.' },
          { metric: 'Working Capital Cycle',   level: 'MEDIUM', reason: 'Transactional businesses need more WC (inventory, receivables); subscription businesses have negative WC.' },
          { metric: 'Earnings Volatility',     level: 'HIGH',   reason: 'Commodity-transactional revenue creates quarterly swings; contracted revenue gives stable earnings.' },
          { metric: 'Debt Capacity',           level: 'MEDIUM', reason: 'High visibility revenue supports more debt — lenders can underwrite future cash flows with confidence.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#ec4899" points={[
        `Revenue stream type is the single biggest driver of valuation multiple — a company with 65% subscription/contract revenue deserves a structurally higher multiple than a transactional peer with the same margins.`,
        `${rm.pricing_power} pricing power means ${rm.pricing_power === 'HIGH' ? 'this company can grow revenue AND margins simultaneously during inflationary cycles — a rare and highly valued quality.' : rm.pricing_power === 'MODERATE' ? 'margin expansion requires volume growth, not just price hikes — watch volume trends closely.' : 'revenue growth is volume-dependent; margins are vulnerable to cost inflation.'}`,
        `${rm.revenue_visibility} revenue visibility means ${rm.revenue_visibility === 'HIGH' ? 'earnings surprises are unlikely — the stock is safer to hold through uncertain macro periods.' : 'quarterly revenue can surprise significantly — position sizing should account for this volatility.'}`,
      ]} />
    </>
  )
}

function SupplyDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const sevColor = (s: string) => s === 'HIGH' ? '#ef4444' : s === 'MEDIUM' ? '#fbbf24' : '#22c55e'
  return (
    <>
      <DrawerSection title="Supply Chain Flow" accent="#f59e0b">
        <Box sx={{ display: 'flex', flexDirection: { xs: 'column', md: 'row' }, gap: 1, mb: 2 }}>
          {data.supply_chain.map((s, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', flex: 1 }}>
              <Box sx={{ flex: 1, p: 1.5, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderTop: `3px solid #f59e0b` }}>
                <Typography sx={{ ...MONO, fontSize: '0.58rem', color: '#f59e0b', fontWeight: 700, mb: 0.4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Stage {i + 1} · {s.stage}
                </Typography>
                <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.4 }}>{s.players}</Typography>
              </Box>
              {i < data.supply_chain.length - 1 && (
                <Typography sx={{ px: 0.75, color: INK3, fontSize: '1rem', flexShrink: 0, display: { xs: 'none', md: 'block' } }}>→</Typography>
              )}
            </Box>
          ))}
        </Box>
        <Box sx={{ p: 1.75, borderRadius: '8px', bgcolor: `${CYAN}10`, border: `1px solid ${CYAN}25` }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: CYAN, fontWeight: 700, mb: 0.5 }}>COMPANY POSITION IN CHAIN</Typography>
          <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK, lineHeight: 1.55 }}>{data.company_position_in_sc}</Typography>
        </Box>
      </DrawerSection>

      <DrawerSection title="Supply Chain Risks — Ranked by Severity" accent="#ef4444">
        {data.sc_risks.map((r, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 1.25, p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${sevColor(r.severity)}` }}>
            <Box>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.4 }}>
                <Chip label={r.severity} size="small"
                  sx={{ bgcolor: `${sevColor(r.severity)}14`, color: sevColor(r.severity), border: `1px solid ${sevColor(r.severity)}30`, ...MONO, fontSize: '0.6rem', fontWeight: 700, height: 18 }} />
                <Typography sx={{ ...SANS, fontSize: '0.75rem', fontWeight: 800, color: INK }}>{r.risk}</Typography>
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.55 }}>{r.desc}</Typography>
            </Box>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'COGS',                  level: 'HIGH',   reason: 'Supply chain position determines what % of revenue is consumed by input costs — upstream companies have higher COGS volatility.' },
          { metric: 'Gross Margin',          level: 'HIGH',   reason: 'Where in the value chain the company sits = how much margin it captures. Downstream + branded = higher gross margin.' },
          { metric: 'Inventory / WC Cycle',  level: 'HIGH',   reason: 'Raw-material-heavy supply chains need large inventory buffers, tying up working capital and affecting cash conversion.' },
          { metric: 'Earnings Volatility',   level: 'HIGH',   reason: 'Commodity exposure at the raw material stage creates quarterly swings in input costs that directly hit gross margin.' },
          { metric: 'Operating Leverage',    level: 'MEDIUM', reason: 'Vertical integration adds fixed costs (capex-heavy plants) but improves margin at high utilization — watch capacity utilisation.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#f59e0b" points={[
        `The company's position in the supply chain is a structural determinant of gross margin — a downstream, customer-facing position captures more margin than upstream commodity processing.`,
        `For supply chain risk severity: HIGH risks require scenario modelling in your thesis (e.g. what happens to EPS if crude spikes 30%?); MEDIUM risks are watch-list items; LOW risks are disclosures to note but not model.`,
        `Working capital requirements are tied to the supply chain model — heavy raw material businesses need 60–90 days of inventory, creating a large WC drain that reduces free cash flow vs reported profits.`,
      ]} />
    </>
  )
}

function CompetitiveDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const { TH, TD } = useTokens()
  return (
    <>
      <DrawerSection title="Porter's Five Forces" accent="#a855f7">
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
          Porter's framework maps the competitive intensity of the industry. Each force scores 1–10 where <strong style={{ color: '#22c55e' }}>low score = weak force = good for the company</strong> (less pressure). Focus on forces scoring 7+ as they are active margin threats.
        </Typography>
        <PorterSVG porter={data.porter} />
        <Box sx={{ mt: 2, display: 'flex', flexDirection: 'column', gap: 1 }}>
          {Object.entries(data.porter).map(([key, force]) => {
            const labels: Record<string, string> = {
              rivalry: 'Competitive Rivalry', buyer_power: 'Buyer Power',
              supplier_power: 'Supplier Power', new_entrants: 'New Entrants', substitutes: 'Substitutes',
            }
            const tc = threatColor(force.score)
            return (
              <Box key={key} sx={{ p: 1.25, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.73rem', fontWeight: 700, color: INK }}>{labels[key]}</Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 800, color: tc }}>{force.score}/10 — {force.score <= 3 ? 'LOW THREAT' : force.score <= 6 ? 'MODERATE' : 'HIGH THREAT'}</Typography>
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.5 }}>{force.desc}</Typography>
              </Box>
            )
          })}
        </Box>
      </DrawerSection>

      <DrawerSection title="Market Share & Competitors" accent="#6366f1">
        <Box sx={{ display: 'flex', height: 24, borderRadius: 2, overflow: 'hidden', border: `1px solid ${BORDER}`, mb: 1.5 }}>
          {[{ name: data.ticker, pct: data.market_share_pct, color: CYAN },
            ...data.main_competitors.map((c, i) => ({ name: c.name, pct: c.share_pct, color: ['#a855f7', '#f97316', '#3b82f6', '#94a3b8'][i] ?? '#64748b' }))
          ].map(seg => (
            <Tooltip key={seg.name} title={`${seg.name}: ${seg.pct}%`} arrow>
              <Box sx={{ width: `${seg.pct}%`, bgcolor: seg.color, cursor: 'help' }} />
            </Tooltip>
          ))}
        </Box>
        <Table size="small">
          <TableHead>
            <TableRow>
              <TableCell sx={{ ...TH }}>Company</TableCell>
              <TableCell sx={{ ...TH, textAlign: 'right' }}>Est. Share</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={{ ...TD, ...MONO, color: CYAN, fontWeight: 700 }}>{data.ticker} (this co.)</TableCell>
              <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: CYAN, fontWeight: 700 }}>{data.market_share_pct}%</TableCell>
            </TableRow>
            {data.main_competitors.map((c, i) => (
              <TableRow key={i}>
                <TableCell sx={{ ...TD, ...SANS, color: INK }}>{c.name}</TableCell>
                <TableCell sx={{ ...TD, ...MONO, textAlign: 'right', color: INK2 }}>{c.share_pct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'EBITDA Margin',        level: 'HIGH',   reason: 'High rivalry (score 7+) compresses margins via price competition and customer acquisition spend. Low rivalry = fat margins.' },
          { metric: 'Pricing Power',        level: 'HIGH',   reason: 'Buyer power score drives ability to raise prices. High buyer power (7+) = pricing constrained = margin at risk.' },
          { metric: 'COGS Inflation Risk',  level: 'HIGH',   reason: 'High supplier power (7+) means vendors can push up input costs without the company being able to pass them on.' },
          { metric: 'Market Share Gains',   level: 'MEDIUM', reason: 'Low new entrant threat = incumbents can grow share organically; high new entrant threat = growth harder to sustain.' },
          { metric: 'Valuation Premium',    level: 'HIGH',   reason: 'Low overall Porter score (2–4 avg) = strong moat = justified premium multiple vs industry.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#a855f7" points={[
        `Average all five Porter scores — below 4.0 is excellent (strong moat), 4.0–6.0 is normal industry competition, above 6.0 means margin pressure is a structural risk that will not go away.`,
        `The most dangerous combination: high rivalry (7+) + high buyer power (7+) — this is a double squeeze on margins. The company can neither raise prices nor cut competition.`,
        `New entrant threat below 3 is a structural advantage — it means capital barriers or regulation protect the existing players, creating a stable competitive environment that supports consistent returns.`,
      ]} />
    </>
  )
}

function ClientDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const cc = concColor(data.client_concentration)
  const COLORS = [CYAN, '#a855f7', '#f97316', '#3b82f6', '#14b8a6']
  return (
    <>
      <DrawerSection title="Client Concentration Analysis" accent="#14b8a6">
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
          <Chip label={data.client_concentration} size="small"
            sx={{ bgcolor: `${cc}14`, color: cc, border: `1px solid ${cc}30`, ...MONO, fontSize: '0.72rem', fontWeight: 800 }} />
          <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2 }}>{data.client_concentration_note}</Typography>
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
          {data.client_concentration === 'CONCENTRATED'
            ? '⚠ Concentrated client base = high revenue at-risk from single client churn. One large client loss can cause a revenue cliff — model the top-3 concentration risk explicitly.'
            : data.client_concentration === 'MODERATE'
            ? 'Moderate concentration — top clients matter but the revenue base is spread enough to absorb a single client loss without a major P&L shock.'
            : '✓ Diversified client base — no single client creates a cliff risk. Revenue is highly resilient to churn.'}
        </Typography>
        <Box sx={{ mb: 2 }}>
          {data.client_types.map((c, i) => (
            <Box key={i} sx={{ mb: 1.25 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
                <Typography sx={{ ...SANS, fontSize: '0.73rem', color: INK }}>{c.name}</Typography>
                <Typography sx={{ ...MONO, fontSize: '0.72rem', color: COLORS[i % COLORS.length], fontWeight: 700 }}>{c.pct}%</Typography>
              </Box>
              <Box sx={{ height: 7, borderRadius: 3, bgcolor: PAPER2, overflow: 'hidden' }}>
                <Box sx={{ width: `${c.pct}%`, height: '100%', bgcolor: COLORS[i % COLORS.length], borderRadius: 3 }} />
              </Box>
            </Box>
          ))}
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, color: INK, mb: 0.75 }}>Top Client Examples</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {data.top_clients_examples.map((c, i) => (
            <Chip key={i} label={c} size="small"
              sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, ...SANS, fontSize: '0.67rem', height: 24 }} />
          ))}
        </Box>
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Revenue Visibility',   level: data.client_concentration === 'CONCENTRATED' ? 'HIGH' : 'MEDIUM',
            reason: 'Concentrated clients often have long-term contracts — visibility is high but cliff risk is also high if the contract is not renewed.' },
          { metric: 'Revenue Volatility',   level: data.client_concentration === 'CONCENTRATED' ? 'HIGH' : 'LOW',
            reason: 'A single large client adds or subtracts 5–15% of revenue based on their own budget cycle — this directly creates quarterly earnings swings.' },
          { metric: 'Gross Margin',         level: 'HIGH',   reason: 'Client type mix drives product/service mix, which drives blended gross margin. High-value B2B clients typically pay premium prices.' },
          { metric: 'Sales & Marketing Costs', level: 'MEDIUM', reason: 'Concentrated B2B models have lower S&M spend per ₹ of revenue vs consumer models — fewer clients to acquire and retain.' },
          { metric: 'Working Capital',      level: 'MEDIUM', reason: 'Large enterprise clients often pay on 60–90 day terms, creating a receivables drag on working capital.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#14b8a6" points={[
        `Client concentration is a revenue quality metric — always ask: "What % of revenue comes from the top 3 clients, and what happens to EPS if one of them churns?"`,
        `BFSI-heavy or government-heavy client bases (like TCS) give high visibility but also mean budget freeze risk during macro downturns — clients cut IT spend when they see credit stress.`,
        `Diversified retail consumer bases (like Jio, HDFC Bank) are churned at the margin but rarely cause revenue cliffs — churn is gradual and forecastable from cohort analysis.`,
      ]} />
    </>
  )
}

function MarginDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const m = data.margins
  return (
    <>
      <DrawerSection title="Margin Profile — Company vs Industry vs Market" accent="#f97316">
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
          All margins are Claude estimates based on company filings, industry research, and Nifty 500 averages. Use as directional context — always cross-check against latest quarterly results.
        </Typography>
        <MarginWaterfallSVG margins={m} cyan={CYAN} />
        <Box sx={{ mt: 2.5 }}>
          {[
            { label: 'Gross Margin', co: m.gross_margin_co, industry: m.gross_margin_industry, market: m.gross_margin_market,
              what: 'Revenue minus COGS. Measures pricing power and supply chain efficiency. High gross margin = ability to absorb opex shocks without going into operating loss.' },
            { label: 'EBITDA Margin', co: m.ebitda_margin_co, industry: m.ebitda_margin_industry, market: m.ebitda_margin_market,
              what: 'Earnings before interest, tax, depreciation, and amortisation. Best measure of operating efficiency — strips out financing and accounting decisions.' },
            { label: 'PAT Margin', co: m.pat_margin_co, industry: m.pat_margin_industry, market: m.pat_margin_market,
              what: 'Profit After Tax. The bottom line. Affected by debt levels (interest), capex history (depreciation), and tax structure. Compare PAT vs EBITDA delta to understand leverage and capex burden.' },
          ].map(bar => {
            const diff = bar.co - bar.industry
            const diffColor = diff >= 0 ? '#22c55e' : '#ef4444'
            return (
              <Box key={bar.label} sx={{ mb: 2, p: 1.75, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 1 }}>
                  <Typography sx={{ ...SANS, fontSize: '0.76rem', fontWeight: 800, color: INK }}>{bar.label}</Typography>
                  <Box sx={{ display: 'flex', gap: 1.5 }}>
                    <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN, fontWeight: 700 }}>Co: {bar.co}%</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK3 }}>Industry: {bar.industry}%</Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.72rem', color: diffColor, fontWeight: 700 }}>
                      {diff >= 0 ? '+' : ''}{diff.toFixed(1)}pp vs industry
                    </Typography>
                  </Box>
                </Box>
                <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.55 }}>{bar.what}</Typography>
              </Box>
            )
          })}
        </Box>
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Earnings Growth',      level: 'HIGH',   reason: 'Margin expansion of 100bps on a ₹10,000 Cr revenue base = ₹100 Cr incremental PAT — directly amplifies EPS growth.' },
          { metric: 'Return on Equity',     level: 'HIGH',   reason: 'PAT margin × asset turnover × leverage = ROE (DuPont). High PAT margin drives superior ROE even at lower leverage.' },
          { metric: 'Free Cash Flow',       level: 'HIGH',   reason: 'EBITDA is the starting point for FCF — margins tell you the underlying cash generation capacity before WC and capex.' },
          { metric: 'Debt Service',         level: 'MEDIUM', reason: 'EBITDA/Interest (interest coverage) ratio. Thin EBITDA margin = vulnerable to rate hike cycles that raise borrowing cost.' },
          { metric: 'Dividend Capacity',    level: 'MEDIUM', reason: 'High PAT margin companies can sustain dividends through downturns — low margin companies cut dividends first.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#f97316" points={[
        `The gap between Gross Margin and EBITDA Margin tells you how cost-heavy the operating model is — a 40% gross margin collapsing to 12% EBITDA means heavy sales, marketing, or R&D spend that may or may not be sustainable.`,
        `Compare PAT margin to EBITDA margin — if PAT is much lower than EBITDA (e.g. EBITDA 16%, PAT 4%), the company has high debt or heavy depreciation from past capex — a structural drag on equity returns.`,
        `Margin above industry average is only as durable as the moat — verify that the premium margin has a structural explanation (brand, scale, IP, switching costs) rather than being a temporary pricing anomaly.`,
      ]} />
    </>
  )
}

function SectorDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  const sc = stageColor(data.sector_stage)
  const stages = ['EARLY', 'GROWTH', 'MATURE', 'DECLINING']
  return (
    <>
      <DrawerSection title="Sector Stage & Growth Context" accent="#22c55e">
        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          {stages.map(s => (
            <Box key={s} sx={{ px: 1.5, py: 0.75, borderRadius: '8px',
              bgcolor: s === data.sector_stage ? `${stageColor(s)}18` : PAPER2,
              border: `1px solid ${s === data.sector_stage ? stageColor(s) : BORDER}`,
              opacity: s === data.sector_stage ? 1 : 0.5,
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.65rem', fontWeight: 700, color: s === data.sector_stage ? stageColor(s) : INK3 }}>
                {s === data.sector_stage ? '● ' : ''}{s}
              </Typography>
            </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
          <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>SECTOR CAGR (EST.)</Typography>
            <Typography sx={{ ...MONO, fontSize: '1.2rem', fontWeight: 800, color: '#22c55e' }}>{data.sector_cagr_pct}%</Typography>
          </Box>
          <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...SANS, fontSize: '0.6rem', color: INK3, mb: 0.25 }}>CURRENTLY GROWING?</Typography>
            <Chip label={data.sector_growing ? '✓ YES' : '✗ NO'} size="small"
              sx={{ bgcolor: data.sector_growing ? '#22c55e18' : '#ef444418', color: data.sector_growing ? '#22c55e' : '#ef4444', border: `1px solid ${data.sector_growing ? '#22c55e' : '#ef4444'}30`, ...MONO, fontSize: '0.7rem', fontWeight: 700 }} />
          </Box>
        </Box>
        <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: `${sc}0a`, border: `1px solid ${sc}20`, mb: 2 }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: sc, fontWeight: 700, mb: 0.5 }}>WHAT {data.sector_stage} STAGE MEANS FOR INVESTORS</Typography>
          <Typography sx={{ ...SANS, fontSize: '0.73rem', color: INK2, lineHeight: 1.6 }}>
            {data.sector_stage === 'EARLY' ? 'High growth, high uncertainty. Revenue is growing rapidly but profitability is unproven. Market rewards growth metrics (GMV, users) over earnings. Risk: sector may not achieve scale.' :
             data.sector_stage === 'GROWTH' ? 'Most attractive phase for investors. Revenue and profits are scaling simultaneously. Competitive dynamics are still forming. Premium multiples are justified if the company is gaining share.' :
             data.sector_stage === 'MATURE' ? 'Growth has slowed to GDP-level or below. Profitability is high and predictable. Market pays income/dividend multiples. Winners compete on cost efficiency, not growth.' :
             'Structural revenue decline. Capital should be returned, not reinvested. Focus on FCF yield and buyback yield rather than P/E or growth rates.'}
          </Typography>
        </Box>
        <Typography sx={{ ...SANS, fontSize: '0.73rem', fontWeight: 700, color: INK, mb: 1 }}>Growth Drivers</Typography>
        {data.sector_growth_drivers.map((d, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 0.75, p: 1.25, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: CYAN, pt: 0.15, flexShrink: 0 }}>0{i + 1}</Typography>
            <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK2, lineHeight: 1.5 }}>{d}</Typography>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Revenue CAGR',         level: 'HIGH',   reason: `Sector CAGR of ${data.sector_cagr_pct}% is the structural growth ceiling — company can beat it by gaining share but will struggle to sustain above it.` },
          { metric: 'P/E Multiple',         level: 'HIGH',   reason: `${data.sector_stage} stage sector commands ${data.sector_stage === 'GROWTH' ? '30–50×' : data.sector_stage === 'MATURE' ? '15–25×' : data.sector_stage === 'EARLY' ? '50–100×' : '8–15×'} P/E. Stage is the primary multiple driver.` },
          { metric: 'Capital Allocation',   level: 'HIGH',   reason: 'Growing sectors justify reinvestment at higher rates — ROIC must exceed WACC or value is destroyed. Mature sectors should return capital.' },
          { metric: 'Margin Trajectory',    level: 'MEDIUM', reason: 'Growth stage = margin expansion as scale advantages accrue. Mature stage = margins stable or declining as competition increases.' },
          { metric: 'Competitive Position', level: 'HIGH',   reason: 'In growth stage, gaining 1% market share is worth more than in maturity — the prize pool is expanding.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#22c55e" points={[
        `The sector stage is the highest-order variable in valuation — before picking multiples or growth rates, determine the stage. A mature-stage company should never be valued on growth metrics.`,
        `A ${data.sector_cagr_pct}% sector CAGR means the average company grows at this rate — a company growing 2× this rate is gaining market share, which is the highest-quality form of growth.`,
        `${data.sector_growing ? 'The sector is currently growing — this is a tailwind for all players and reduces the need for market share battles to drive revenue.' : 'The sector is not currently growing — revenue growth must come from market share gains, which are zero-sum and typically require margin sacrifice.'}`,
      ]} />
    </>
  )
}

function TailwindsDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER } = usePalette()
  return (
    <>
      <DrawerSection title="Tailwinds — Structural Catalysts" accent="#22c55e">
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 1.5 }}>
          Tailwinds are external forces that work in the company's favour without management action. They amplify growth and margin. The more tailwinds, the lower the execution risk embedded in the thesis.
        </Typography>
        {data.tailwinds.map((t, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 1, p: 1.5, borderRadius: '8px', bgcolor: '#22c55e0d', border: '1px solid #22c55e1a', alignItems: 'flex-start' }}>
            <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: '#22c55e18', border: '1px solid #22c55e30', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#22c55e', fontWeight: 700 }}>↑</Typography>
            </Box>
            <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2, lineHeight: 1.6 }}>{t}</Typography>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Headwinds — Risk Factors" accent="#ef4444">
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 1.5 }}>
          Headwinds are external pressures that work against the company. They do not necessarily break the investment thesis but they require the company to execute harder to achieve the same result.
        </Typography>
        {data.headwinds.map((h, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 1, p: 1.5, borderRadius: '8px', bgcolor: '#ef44440d', border: '1px solid #ef44441a', alignItems: 'flex-start' }}>
            <Box sx={{ width: 22, height: 22, borderRadius: '50%', bgcolor: '#ef444418', border: '1px solid #ef444430', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#ef4444', fontWeight: 700 }}>↓</Typography>
            </Box>
            <Typography sx={{ ...SANS, fontSize: '0.75rem', color: INK2, lineHeight: 1.6 }}>{h}</Typography>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="Financial Impact" accent="#f59e0b">
        <ImpactTable rows={[
          { metric: 'Revenue Growth',       level: 'HIGH',   reason: 'Tailwind count and quality is the best leading indicator of future revenue growth — more tailwinds = higher organic growth floor.' },
          { metric: 'EBITDA Margin',        level: 'HIGH',   reason: 'Strong tailwinds allow margin expansion without market share sacrifice; headwinds force the company to spend more to defend position.' },
          { metric: 'Earnings Visibility',  level: 'MEDIUM', reason: 'Regulatory or macro headwinds create earnings uncertainty — analysts widen their forecast range, increasing stock volatility.' },
          { metric: 'Valuation Multiple',   level: 'HIGH',   reason: 'Net tailwinds justify multiple expansion; net headwinds trigger de-rating. Count of structurally unresolved headwinds is a multiple compressor.' },
          { metric: 'Investment Risk',      level: 'HIGH',   reason: 'Headwinds that are cyclical (temporary) are priced in over 1–2 quarters; structural headwinds (secular decline) permanently impair the thesis.' },
        ]} />
      </DrawerSection>

      <KeyTakeaways accent="#06b6d4" points={[
        `Classify each headwind as CYCLICAL (goes away with time) or STRUCTURAL (permanent). Cyclical headwinds are buying opportunities; structural headwinds are thesis-breakers.`,
        `Count the ratio of tailwinds to headwinds — ${data.tailwinds.length} tailwinds vs ${data.headwinds.length} headwinds here. A 3:1 or better ratio indicates the external environment is working in the company's favour.`,
        `The highest-quality tailwinds are regulatory (government mandates) and demographic (population growth, rising income) — they don't reverse and they don't require the company to compete to benefit.`,
      ]} />
    </>
  )
}

function PredictorsDrawer({ data }: { data: IntelligenceData }) {
  const { INK, INK2, INK3, PAPER2, BORDER, CYAN } = usePalette()
  return (
    <>
      <DrawerSection title="Leading Revenue Indicators" accent="#f43f5e">
        <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3, mb: 2 }}>
          These are external data points that historically change <strong style={{ color: INK }}>1–3 months before</strong> the company's revenue or margins shift. Monitoring them gives you an edge in anticipating earnings beats/misses before the market does.
        </Typography>
        {data.predictors.map((p, i) => (
          <Box key={i} sx={{ display: 'flex', gap: 1.5, mb: 1.5, p: 1.75, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderLeft: `3px solid ${CYAN}` }}>
            <Box sx={{ width: 28, height: 28, borderRadius: '50%', bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}30`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <Typography sx={{ ...MONO, fontSize: '0.65rem', color: CYAN, fontWeight: 700 }}>{String(i + 1).padStart(2, '0')}</Typography>
            </Box>
            <Box>
              <Typography sx={{ ...SANS, fontSize: '0.78rem', fontWeight: 800, color: INK, mb: 0.4 }}>{p.name}</Typography>
              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK2, lineHeight: 1.6 }}>{p.why}</Typography>
            </Box>
          </Box>
        ))}
      </DrawerSection>

      <DrawerSection title="How to Use These Predictors" accent="#a855f7">
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
          {[
            { step: '01', title: 'Set up a monthly tracker', desc: 'Monitor each predictor monthly — create a simple spreadsheet with the current reading vs 3-month-ago reading. A significant change (±1 standard deviation) is actionable.' },
            { step: '02', title: 'Map direction to P&L line', desc: 'Each predictor affects a specific P&L line (revenue, COGS, margin). Know which line each predictor leads before you react to a change.' },
            { step: '03', title: 'Build a thesis stress test', desc: 'If 3+ predictors are moving adversely, your revenue growth assumption is at risk — revisit your earnings model 1–2 quarters ahead.' },
            { step: '04', title: 'Use for entry/exit timing', desc: 'Positive predictor turning points (trough to improving) are early buy signals. Negative turns from peak are early exit signals — they precede earnings revisions by 1–2 quarters.' },
          ].map(({ step, title, desc }) => (
            <Box key={step} sx={{ display: 'flex', gap: 1.5, p: 1.5, borderRadius: '8px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 800, color: '#a855f7', flexShrink: 0 }}>{step}</Typography>
              <Box>
                <Typography sx={{ ...SANS, fontSize: '0.74rem', fontWeight: 700, color: INK, mb: 0.3 }}>{title}</Typography>
                <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, lineHeight: 1.55 }}>{desc}</Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </DrawerSection>

      <KeyTakeaways accent="#f43f5e" points={[
        `Revenue predictors are the most actionable output of company intelligence — they convert qualitative understanding into a specific monitoring checklist you can act on.`,
        `The lead time of 1–3 months is crucial: it gives you enough time to adjust position sizing or initiate a position before the quarterly result confirms the trend.`,
        `Not all predictors move together — when they diverge (some positive, some negative), it signals a mixed quarter ahead. This is when detailed modelling matters most.`,
      ]} />
    </>
  )
}

// ── Master drawer renderer ─────────────────────────────────────────────────────
function DrawerContent({ moduleId, data, onClose }: { moduleId: string; data: IntelligenceData; onClose: () => void }) {
  const { BG, PAPER, INK, INK2, BORDER, CYAN } = usePalette()
  const { mode } = useThemeMode()

  const META: Record<string, { title: string; accent: string; subtitle: string }> = {
    overview:    { title: 'Company Overview',       accent: '#6366f1', subtitle: 'What the company does, its market position and industry context.' },
    bizmodel:    { title: 'Business Model',          accent: '#8b5cf6', subtitle: 'How value is created, segment breakdown, and competitive moat.' },
    revmodel:    { title: 'Revenue Model',           accent: '#ec4899', subtitle: 'Revenue streams, pricing power, and visibility of future earnings.' },
    supply:      { title: 'Supply Chain & Risks',    accent: '#f59e0b', subtitle: 'Value chain position, supply chain flow, and operational risk factors.' },
    competitive: { title: 'Competitive Position',    accent: '#a855f7', subtitle: "Porter's five forces, market share, and competitor landscape." },
    clients:     { title: 'Client Base',             accent: '#14b8a6', subtitle: 'Customer concentration, client type mix, and top account analysis.' },
    margins:     { title: 'Margin Profile',          accent: '#f97316', subtitle: 'Gross, EBITDA, and PAT margins vs industry and market averages.' },
    sector:      { title: 'Sector Dynamics',         accent: '#22c55e', subtitle: 'Sector stage, growth CAGR, and structural growth drivers.' },
    tailwinds:   { title: 'Tailwinds & Headwinds',   accent: '#06b6d4', subtitle: 'External forces that amplify or constrain the business trajectory.' },
    predictors:  { title: 'Revenue Predictors',      accent: '#f43f5e', subtitle: 'Leading indicators that precede revenue and margin changes by 1–3 months.' },
  }

  const meta = META[moduleId]
  if (!meta) return null

  const heroGrad = mode === 'dark'
    ? `linear-gradient(135deg, #0A1628 0%, #060C1A 100%)`
    : `linear-gradient(135deg, #EBF3FC 0%, #F2F7FD 100%)`

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', bgcolor: BG }}>
      {/* Header */}
      <Box sx={{ background: heroGrad, px: 3.5, pt: 3.5, pb: 2.5, borderBottom: `1px solid ${BORDER}`, flexShrink: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <Box>
            <Box sx={{ width: 32, height: 3, borderRadius: 2, bgcolor: meta.accent, mb: 1.5 }} />
            <Typography sx={{ ...SANS, fontSize: '1.35rem', fontWeight: 900, color: INK, lineHeight: 1.2, mb: 0.5 }}>
              {meta.title}
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2 }}>{meta.subtitle}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25 }}>
              <Box sx={{ ...{ fontFamily: "'IBM Plex Mono', monospace" }, fontSize: '0.65rem', color: CYAN, bgcolor: `${CYAN}14`, border: `1px solid ${CYAN}30`, px: 1, py: 0.25, borderRadius: '4px', fontWeight: 700 }}>
                {data.ticker}
              </Box>
              <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2 }}>{data.company}</Typography>
            </Box>
          </Box>
          <Box
            component="button"
            onClick={onClose}
            sx={{ width: 36, height: 36, borderRadius: '50%', border: `1px solid ${BORDER}`, bgcolor: 'transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: INK2, fontSize: '1.1rem', flexShrink: 0, '&:hover': { borderColor: meta.accent, color: meta.accent } }}
          >✕</Box>
        </Box>
      </Box>

      {/* Scrollable body */}
      <Box sx={{ flex: 1, overflowY: 'auto', px: 3.5, py: 3 }}>
        {moduleId === 'overview'    && <OverviewDrawer    data={data} />}
        {moduleId === 'bizmodel'    && <BizModelDrawer    data={data} />}
        {moduleId === 'revmodel'    && <RevModelDrawer    data={data} />}
        {moduleId === 'supply'      && <SupplyDrawer      data={data} />}
        {moduleId === 'competitive' && <CompetitiveDrawer data={data} />}
        {moduleId === 'clients'     && <ClientDrawer      data={data} />}
        {moduleId === 'margins'     && <MarginDrawer      data={data} />}
        {moduleId === 'sector'      && <SectorDrawer      data={data} />}
        {moduleId === 'tailwinds'   && <TailwindsDrawer   data={data} />}
        {moduleId === 'predictors'  && <PredictorsDrawer  data={data} />}
      </Box>
    </Box>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════════════════════════════════════════════
export default function CompanyIntelligencePage() {
  const { symbol: urlSymbol } = useParams<{ symbol?: string }>()
  const navigate = useNavigate()

  const { BG, PAPER, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const { CARD, INPUT_SX } = useTokens()
  const { mode } = useThemeMode()

  const [ticker,       setTicker]       = useState(urlSymbol?.toUpperCase() ?? '')
  const [input,        setInput]        = useState(urlSymbol?.toUpperCase() ?? '')
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [data,         setData]         = useState<IntelligenceData | null>(null)
  const [quote,        setQuote]        = useState<LiveQuote | null>(null)
  const [fundam,       setFundam]       = useState<Fundamentals | null>(null)
  const [cacheHit,     setCacheHit]     = useState<boolean | null>(null)
  const [activeModule, setActiveModule] = useState<string | null>(null)

  const analyze = useCallback(async (sym: string) => {
    if (!sym.trim()) return
    const t = sym.trim().toUpperCase()
    setLoading(true); setError(null); setData(null); setQuote(null); setFundam(null)
    navigate(`/company-intelligence/${t}`, { replace: true })
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

  useEffect(() => {
    if (urlSymbol && !data && !loading) {
      setInput(urlSymbol.toUpperCase())
      analyze(urlSymbol)
    }
  }, [urlSymbol]) // eslint-disable-line react-hooks/exhaustive-deps

  const heroGrad = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  // Module definitions — stats derived from data at render time
  const modules = data ? [
    { id: 'overview',    title: 'Company Overview',     accent: '#6366f1', icon: '◈',
      stats: [{ label: 'SECTOR', value: data.sector }, { label: 'STAGE', value: data.sector_stage, color: stageColor(data.sector_stage) }, { label: 'RANK', value: data.market_rank.split(' ').slice(0, 2).join(' ') }] },
    { id: 'bizmodel',    title: 'Business Model',        accent: '#8b5cf6', icon: '⬡',
      stats: [{ label: 'TYPE', value: data.business_model.type.split(' ').slice(0, 2).join(' ') }, { label: 'MOAT', value: data.business_model.moat_durability, color: durColor(data.business_model.moat_durability) }, { label: 'SEGMENTS', value: `${data.business_model.segments.length}` }] },
    { id: 'revmodel',    title: 'Revenue Model',         accent: '#ec4899', icon: '◎',
      stats: [{ label: 'PRICING POWER', value: data.revenue_model.pricing_power, color: powerColor(data.revenue_model.pricing_power) }, { label: 'VISIBILITY', value: data.revenue_model.revenue_visibility, color: powerColor(data.revenue_model.revenue_visibility) }, { label: 'STREAMS', value: `${data.revenue_model.streams.length}` }] },
    { id: 'supply',      title: 'Supply Chain',          accent: '#f59e0b', icon: '⬢',
      stats: [{ label: 'STAGES', value: `${data.supply_chain.length}` }, { label: 'RISKS', value: `${data.sc_risks.length}` }, { label: 'TOP RISK', value: data.sc_risks[0]?.severity ?? '—', color: data.sc_risks[0]?.severity === 'HIGH' ? '#ef4444' : '#fbbf24' }] },
    { id: 'competitive', title: 'Competitive Position',  accent: '#a855f7', icon: '◉',
      stats: [{ label: 'MARKET SHARE', value: `${data.market_share_pct}%`, color: CYAN }, { label: 'RIVALS', value: `${data.main_competitors.length}` }, { label: 'RIVALRY', value: `${data.porter.rivalry.score}/10`, color: threatColor(data.porter.rivalry.score) }] },
    { id: 'clients',     title: 'Client Base',           accent: '#14b8a6', icon: '◈',
      stats: [{ label: 'CONCENTRATION', value: data.client_concentration, color: concColor(data.client_concentration) }, { label: 'TOP TYPE', value: data.client_types[0]?.name ?? '—' }, { label: 'TOP TYPE %', value: `${data.client_types[0]?.pct ?? 0}%` }] },
    { id: 'margins',     title: 'Margin Profile',        accent: '#f97316', icon: '▦',
      stats: [{ label: 'GROSS', value: `${data.margins.gross_margin_co}%` }, { label: 'EBITDA', value: `${data.margins.ebitda_margin_co}%`, color: CYAN }, { label: 'PAT', value: `${data.margins.pat_margin_co}%` }] },
    { id: 'sector',      title: 'Sector Dynamics',       accent: '#22c55e', icon: '▲',
      stats: [{ label: 'CAGR', value: `${data.sector_cagr_pct}%`, color: '#22c55e' }, { label: 'STAGE', value: data.sector_stage, color: stageColor(data.sector_stage) }, { label: 'GROWING', value: data.sector_growing ? 'YES' : 'NO', color: data.sector_growing ? '#22c55e' : '#ef4444' }] },
    { id: 'tailwinds',   title: 'Tailwinds & Headwinds', accent: '#06b6d4', icon: '⇅',
      stats: [{ label: 'TAILWINDS', value: `${data.tailwinds.length}`, color: '#22c55e' }, { label: 'HEADWINDS', value: `${data.headwinds.length}`, color: '#ef4444' }, { label: 'NET', value: `+${data.tailwinds.length - data.headwinds.length}`, color: data.tailwinds.length >= data.headwinds.length ? '#22c55e' : '#ef4444' }] },
    { id: 'predictors',  title: 'Revenue Predictors',    accent: '#f43f5e', icon: '◎',
      stats: [{ label: 'LEADING INDICATORS', value: `${data.predictors.length}` }, { label: 'LEAD TIME', value: '1–3 months' }, { label: 'TYPE', value: 'Macro + Sector' }] },
  ] : []

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <Box sx={{ background: heroGrad, px: { xs: 2, md: 5 }, pt: 5, pb: 4 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 2,
          px: 1.5, py: 0.4, borderRadius: '20px', bgcolor: `${CYAN}14`, border: `1px solid ${CYAN}30` }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } } }} />
          <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem', color: CYAN, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Company Intelligence
          </Typography>
        </Box>
        <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: { xs: '1.6rem', md: '2rem' }, fontWeight: 800, color: INK, lineHeight: 1.15, mb: 0.75 }}>
          Deep<Box component="span" sx={{ color: CYAN }}> Company</Box> Research
        </Typography>
        <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.82rem', color: INK2, mb: 3, maxWidth: 540 }}>
          Claude-powered qualitative intelligence — click any module below to explore supply chain, Porter's forces, margin profile, revenue model, and expert-level interpretation.
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, maxWidth: 420 }}>
          <OutlinedInput
            value={input}
            onChange={e => setInput(e.target.value.toUpperCase())}
            onKeyDown={e => e.key === 'Enter' && analyze(input)}
            placeholder="NSE ticker — e.g. RELIANCE"
            size="small"
            sx={{ ...INPUT_SX, flex: 1, height: 40, textTransform: 'uppercase', fontFamily: "'IBM Plex Mono', monospace" }}
          />
          <Box component="button" onClick={() => analyze(input)} disabled={loading || !input.trim()}
            sx={{ px: 2.5, height: 40, borderRadius: '8px', border: 'none', cursor: 'pointer', bgcolor: CYAN, color: '#000', fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.75rem', fontWeight: 700, flexShrink: 0, transition: 'opacity 0.15s', '&:hover': { opacity: 0.85 }, '&:disabled': { opacity: 0.4, cursor: 'not-allowed' } }}>
            {loading ? '…' : 'Analyze'}
          </Box>
          {data && (
            <Tooltip title="Clear cache and re-analyze">
              <Box component="button"
                onClick={async () => { await intelligenceApi.invalidateCache(ticker || input); analyze(ticker || input) }}
                sx={{ px: 1.75, height: 40, borderRadius: '8px', border: `1px solid ${BORDER}`, cursor: 'pointer', bgcolor: 'transparent', color: INK2, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.7rem', flexShrink: 0, '&:hover': { borderColor: CYAN, color: CYAN } }}>
                ↺
              </Box>
            </Tooltip>
          )}
        </Box>
        {data && cacheHit !== null && (
          <Box sx={{ mt: 1.5, display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: cacheHit ? '#22c55e' : '#fbbf24' }} />
            <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem', color: INK3 }}>
              {cacheHit ? 'CACHE HIT — served from 24 h cache' : 'CACHE MISS — fresh from Claude'}
            </Typography>
          </Box>
        )}
      </Box>

      {/* ── Content ─────────────────────────────────────────────────── */}
      <Box sx={{ px: { xs: 2, md: 5 }, py: 3, maxWidth: 1200, mx: 'auto' }}>
        {error && <Alert severity="error" sx={{ mb: 2, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem' }}>{error}</Alert>}
        {loading && <Analyzing />}

        {data && !loading && (
          <>
            {/* Identity banner */}
            <Box sx={{ p: 2.5, mb: 2.5, borderRadius: '12px', bgcolor: PAPER, border: `1px solid ${BORDER}`, borderLeft: `4px solid ${CYAN}` }}>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', gap: 2, justifyContent: 'space-between' }}>
                <Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5, flexWrap: 'wrap' }}>
                    <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '1.1rem', fontWeight: 800, color: INK }}>{data.ticker}</Typography>
                    {data.market_leader && <Chip label="Market Leader" size="small" sx={{ bgcolor: `${CYAN}18`, color: CYAN, border: `1px solid ${CYAN}40`, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem', fontWeight: 700, height: 20 }} />}
                    <Chip label={data.sector} size="small" sx={{ bgcolor: '#6366f118', color: '#818cf8', border: '1px solid #6366f130', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.62rem', height: 20 }} />
                    <Chip label={data.sector_stage} size="small" sx={{ bgcolor: `${stageColor(data.sector_stage)}18`, color: stageColor(data.sector_stage), border: `1px solid ${stageColor(data.sector_stage)}30`, fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.6rem', height: 20 }} />
                  </Box>
                  <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '1rem', fontWeight: 700, color: INK, mb: 0.4 }}>{data.company}</Typography>
                  <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.78rem', color: INK2, fontStyle: 'italic' }}>"{data.tagline}"</Typography>
                </Box>
                <Box sx={{ textAlign: 'right' }}>
                  <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.62rem', color: INK3, mb: 0.25 }}>MARKET SHARE</Typography>
                  <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '1.1rem', fontWeight: 800, color: CYAN }}>{data.market_share_pct}%</Typography>
                  <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.72rem', color: INK2 }}>{data.market_rank}</Typography>
                </Box>
              </Box>
            </Box>

            {/* Quote + Fundamentals */}
            <Grid container spacing={2} sx={{ mb: 3 }}>
              <Grid item xs={12} md={6}><QuoteCard q={quote} /></Grid>
              <Grid item xs={12} md={6}><FundamentalsCard f={fundam} /></Grid>
            </Grid>

            {/* Module hint */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
              <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: CYAN, flexShrink: 0 }} />
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.78rem', fontWeight: 800, color: INK }}>Intelligence Modules</Typography>
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>— click any card to explore in detail</Typography>
            </Box>

            {/* Module grid */}
            <Grid container spacing={2} sx={{ mb: 4 }}>
              {modules.map(mod => (
                <Grid item xs={12} sm={6} md={4} key={mod.id}>
                  <ModuleCard {...mod} onClick={() => setActiveModule(mod.id)} />
                </Grid>
              ))}
            </Grid>
          </>
        )}

        {!loading && !data && !error && (
          <Box sx={{ textAlign: 'center', py: 10, color: INK3 }}>
            <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.8rem', mb: 1 }}>Enter an NSE ticker and click Analyze</Typography>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.72rem' }}>e.g. RELIANCE · TCS · INFY · HDFCBANK · TATAMOTORS</Typography>
          </Box>
        )}
      </Box>

      {/* ── Right drawer ───────────────────────────────────────────── */}
      <Drawer
        anchor="right"
        open={!!activeModule}
        onClose={() => setActiveModule(null)}
        PaperProps={{ sx: { width: { xs: '100%', sm: '85%', md: '80%' }, bgcolor: 'transparent', boxShadow: 'none' } }}
      >
        {activeModule && data && (
          <DrawerContent moduleId={activeModule} data={data} onClose={() => setActiveModule(null)} />
        )}
      </Drawer>

      <Footer />
    </Box>
  )
}
