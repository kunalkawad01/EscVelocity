import { Box, Typography, Stack } from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import type { StockSummary } from '../../types/stock'
import { D, FONT } from '../../styles/ds'

// ─── Tokens ───────────────────────────────────────────────────────────────────

const BG     = D.bg
const SURFACE = D.surface
const BORDER  = D.border
const BORDER2 = D.border2
const INK     = D.ink
const INK2    = D.ink2
const INK3    = '#5B6880'
const GOLD    = D.gold
const GOLD2   = D.gold2
const MONO    = FONT.mono
const COND    = FONT.cond
const DISPLAY = FONT.display

function formatVolume(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(1)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(1)}L`
  return v.toLocaleString('en-IN')
}

interface Props { summary: StockSummary }

export default function HeroSection({ summary }: Props) {
  const isUp         = summary.change_pct >= 0
  const changeColor  = isUp ? '#16A34A' : '#DC2626'
  const regimeColor  = summary.regime === 'Bullish' ? '#16A34A'
    : summary.regime === 'Bearish' ? '#DC2626' : '#D97706'
  const rangePct = Math.max(2, Math.min(98,
    ((summary.close - summary.low_52w) / (summary.high_52w - summary.low_52w)) * 100
  ))

  return (
    <Box sx={{
      bgcolor: BG,
      borderBottom: `1px solid ${BORDER}`,
      px: { xs: 2.5, md: 6 },
      py: { xs: 3, md: 4 },
      position: 'relative', overflow: 'hidden',
      // Subtle gold ambient glow
      '&::after': {
        content: '""', position: 'absolute',
        top: '50%', left: '3%', transform: 'translateY(-50%)',
        width: 300, height: 300,
        background: `radial-gradient(circle, ${GOLD}0C 0%, transparent 70%)`,
        pointerEvents: 'none',
      },
    }}>
      <Stack
        direction={{ xs: 'column', lg: 'row' }}
        spacing={{ xs: 3, lg: 0 }}
        alignItems={{ lg: 'flex-start' }}
        justifyContent="space-between"
      >
        {/* ── LEFT: Symbol identity ── */}
        <Box sx={{ position: 'relative', zIndex: 1 }}>
          {/* Exchange + regime + date */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
            <Box sx={{ px: 1, py: 0.35, border: '1px solid rgba(59,130,246,0.25)', bgcolor: 'rgba(59,130,246,0.06)' }}>
              <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.12em', color: '#3B82F6', textTransform: 'uppercase' }}>
                NSE · EQUITY
              </Typography>
            </Box>
            <Box sx={{ px: 1, py: 0.35, border: `1px solid ${regimeColor}30`, bgcolor: `${regimeColor}07` }}>
              <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: regimeColor, textTransform: 'uppercase' }}>
                {summary.regime}
              </Typography>
            </Box>
            <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>{summary.date}</Typography>
          </Box>

          {/* Symbol — Bebas Neue display */}
          <Typography sx={{
            ...DISPLAY,
            fontSize: { xs: '3.5rem', md: '5.5rem' },
            lineHeight: 1, color: INK, letterSpacing: '0.01em',
          }}>
            {summary.symbol}
          </Typography>

          {/* SMA status chips */}
          <Box sx={{ display: 'flex', gap: 0.75, mt: 1.75, flexWrap: 'wrap' }}>
            {[
              { label: 'SMA 20',  active: summary.above_sma20 },
              { label: 'SMA 50',  active: summary.above_sma50 },
              { label: 'SMA 200', active: summary.above_sma200 },
            ].map(s => {
              const c = s.active ? '#16A34A' : '#DC2626'
              return (
                <Box key={s.label} sx={{
                  display: 'flex', alignItems: 'center', gap: 0.6,
                  px: 1, py: 0.35,
                  border: `1px solid ${c}28`, bgcolor: `${c}07`,
                }}>
                  <Box sx={{ width: 5, height: 5, borderRadius: '50%', bgcolor: c }} />
                  <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: c, letterSpacing: '0.05em' }}>
                    {s.active ? '▲' : '▼'} {s.label}
                  </Typography>
                </Box>
              )
            })}
          </Box>
        </Box>

        {/* ── CENTER: Price ── */}
        <Box sx={{ textAlign: { xs: 'left', lg: 'center' }, position: 'relative', zIndex: 1 }}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5 }}>
            Last Price
          </Typography>
          <Typography sx={{ ...DISPLAY, fontSize: { xs: '3rem', md: '4.5rem' }, lineHeight: 1, color: GOLD }}>
            ₹{summary.close.toLocaleString('en-IN')}
          </Typography>

          {/* Change badge — flat */}
          <Box sx={{
            display: 'inline-flex', alignItems: 'center', gap: 0.75,
            mt: 1.25, px: 1.5, py: 0.65,
            border: `1px solid ${changeColor}28`, bgcolor: `${changeColor}07`,
          }}>
            {isUp
              ? <TrendingUpIcon sx={{ color: changeColor, fontSize: 18 }} />
              : <TrendingDownIcon sx={{ color: changeColor, fontSize: 18 }} />
            }
            <Typography sx={{ ...MONO, color: changeColor, fontWeight: 700, fontSize: '1.2rem', letterSpacing: '-0.02em' }}>
              {isUp ? '+' : ''}{summary.change_pct.toFixed(2)}%
            </Typography>
          </Box>
        </Box>

        {/* ── RIGHT: Metrics panel ── */}
        <Box sx={{ position: 'relative', zIndex: 1, minWidth: { lg: 300 } }}>
          {/* Key metrics grid */}
          <Box sx={{
            border: `1px solid ${BORDER}`,
            bgcolor: SURFACE, overflow: 'hidden', mb: 1,
          }}>
            <Box sx={{
              display: 'flex',
              '& > *:not(:last-child)': { borderRight: `1px solid ${BORDER}` },
            }}>
              {[
                { label: '52W High', value: `₹${summary.high_52w.toLocaleString('en-IN')}`, color: GOLD2 },
                { label: '52W Low',  value: `₹${summary.low_52w.toLocaleString('en-IN')}`,  color: INK2 },
                { label: 'Vol 20D',  value: formatVolume(summary.avg_volume_20d),             color: '#3B82F6' },
              ].map(m => (
                <Box key={m.label} sx={{ px: 2, py: 1.5, flex: 1, textAlign: 'center' }}>
                  <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, mb: 0.4 }}>
                    {m.label}
                  </Typography>
                  <Typography sx={{ ...MONO, fontSize: '0.95rem', fontWeight: 700, color: m.color, lineHeight: 1 }}>
                    {m.value}
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>

          {/* 52W range bar */}
          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.4 }}>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>
                ₹{summary.low_52w.toLocaleString('en-IN')}
              </Typography>
              <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: INK3, textTransform: 'uppercase' }}>
                52-week range
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>
                ₹{summary.high_52w.toLocaleString('en-IN')}
              </Typography>
            </Box>
            <Box sx={{ height: 4, bgcolor: BORDER2, position: 'relative', overflow: 'visible' }}>
              {/* Fill */}
              <Box sx={{
                position: 'absolute', left: 0, top: 0, height: '100%',
                width: `${rangePct}%`,
                background: `linear-gradient(90deg, ${BORDER2}, ${GOLD})`,
              }} />
              {/* Position marker */}
              <Box sx={{
                position: 'absolute', top: '50%', transform: 'translate(-50%, -50%)',
                left: `${rangePct}%`,
                width: 8, height: 8, borderRadius: '50%',
                bgcolor: GOLD, border: `1.5px solid ${BG}`,
                boxShadow: `0 0 5px ${GOLD}80`,
              }} />
            </Box>
          </Box>
        </Box>
      </Stack>
    </Box>
  )
}
