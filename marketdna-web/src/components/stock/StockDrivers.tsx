import { useState } from 'react'
import { Box, Typography, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material'
import type { Driver, DriverCategory, LiveValue, StockDriversResponse } from '../../types/drivers'
import { usePalette, useTokens } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// Fixed accent per category — stable across all dossiers (also used by the
// PriceChart driver-event flags overlay)
export const CATEGORY_COLOR: Record<DriverCategory, string> = {
  demand:      '#3B82F6',
  policy:      '#F59E0B',
  orders:      '#22C55E',
  input_costs: '#EF4444',
  competition: '#8B5CF6',
  ownership:   '#14B8A6',
  catalyst:    '#A855F7',
}

const CATEGORY_LABEL: Record<DriverCategory, string> = {
  demand:      'Demand',
  policy:      'Policy',
  orders:      'Orders',
  input_costs: 'Input Costs',
  competition: 'Competition',
  ownership:   'Ownership',
  catalyst:    'Catalyst',
}

const CADENCE_DAYS: Record<string, number> = {
  monthly: 31, quarterly: 92, half_yearly: 183, yearly: 366,
}

type Tab = 'narrative' | 'simple' | 'forecast'

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'narrative', label: 'Driver' },
  { key: 'simple',    label: 'Plain English' },
  { key: 'forecast',  label: 'How to Forecast' },
]

// ─── Sub-blocks ───────────────────────────────────────────────────────────────

function VerifyNote({ text }: { text: string }) {
  return (
    <Box sx={{
      mt: 1.5, px: 1.5, py: 1, borderRadius: 1.5,
      border: '1px solid rgba(251,191,36,0.35)', bgcolor: 'rgba(251,191,36,0.06)',
    }}>
      <Typography sx={{ ...SANS, fontSize: '0.72rem', color: '#fbbf24', lineHeight: 1.6 }}>
        ⚠ Verify: {text}
      </Typography>
    </Box>
  )
}

function ForecastTab({ driver }: { driver: Driver }) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()
  const { TH, TD } = useTokens()
  const fc = driver.forecast
  return (
    <Box>
      <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, lineHeight: 1.75, mb: fc.leading_indicators.length ? 2 : 0 }}>
        {fc.how}
      </Typography>

      {fc.leading_indicators.length > 0 && (
        <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'auto', mb: fc.rule_of_thumb ? 2 : 0 }}>
          <Table size="small">
            <TableHead>
              <TableRow sx={{ bgcolor: PAPER2 }}>
                <TableCell sx={TH}>Leading Indicator</TableCell>
                <TableCell sx={TH}>Source</TableCell>
                <TableCell sx={TH}>Cadence</TableCell>
                <TableCell sx={TH}>Lead</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {fc.leading_indicators.map(li => (
                <TableRow key={li.name}>
                  <TableCell sx={{ ...TD, fontWeight: 600 }}>{li.name}</TableCell>
                  <TableCell sx={TD}>{li.source}</TableCell>
                  <TableCell sx={{ ...TD, ...MONO, fontSize: '0.7rem' }}>{li.cadence}</TableCell>
                  <TableCell sx={{ ...TD, color: INK3 }}>{li.lead}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Box>
      )}

      {fc.rule_of_thumb && (
        <Box sx={{
          px: 1.5, py: 1.25, borderRadius: 1.5,
          border: '1px solid rgba(251,191,36,0.35)', bgcolor: 'rgba(251,191,36,0.06)',
        }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#fbbf24', mb: 0.5 }}>
            Rule of Thumb
          </Typography>
          <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, lineHeight: 1.65 }}>
            {fc.rule_of_thumb}
          </Typography>
        </Box>
      )}
    </Box>
  )
}

function LiveChip({ label, value }: { label: string; value: LiveValue }) {
  const { INK2, INK3 } = usePalette()
  const GREEN = '#22c55e'
  return (
    <Box sx={{
      display: 'flex', alignItems: 'center', gap: 1.25, flexWrap: 'wrap',
      mt: 1.75, px: 1.5, py: 1, borderRadius: 1.5,
      border: `1px solid ${GREEN}30`, bgcolor: `${GREEN}08`,
    }}>
      <Box sx={{
        width: 6, height: 6, borderRadius: '50%', bgcolor: GREEN, flexShrink: 0,
        animation: 'livepulse 2s ease-in-out infinite',
        '@keyframes livepulse': {
          '0%,100%': { boxShadow: `0 0 3px ${GREEN}` },
          '50%':     { boxShadow: `0 0 10px ${GREEN}` },
        },
      }} />
      <Typography sx={{ ...COND, fontSize: '0.6rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: GREEN }}>
        Live
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: GREEN }}>
        {value.detail}
      </Typography>
      <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK2, flex: 1, minWidth: 160 }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3 }}>as of {value.as_of}</Typography>
    </Box>
  )
}

function DriverBody({ driver, liveValue }: { driver: Driver; liveValue?: LiveValue }) {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER } = usePalette()
  const [tab, setTab] = useState<Tab>('narrative')
  return (
    <Box>
      {/* Tab toggle */}
      <Box sx={{ display: 'inline-flex', gap: 0, mb: 1.75, border: `1px solid ${BORDER}`, borderRadius: 1.5, overflow: 'hidden' }}>
        {TABS.map(t => {
          const active = tab === t.key
          return (
            <Box
              key={t.key}
              onClick={() => setTab(t.key)}
              sx={{
                px: 1.5, py: 0.5, cursor: 'pointer', userSelect: 'none',
                bgcolor: active ? `${CYAN}14` : PAPER,
                borderRight: t.key !== 'forecast' ? `1px solid ${BORDER}` : 'none',
                '&:hover': { bgcolor: active ? `${CYAN}14` : `${CYAN}0A` },
              }}
            >
              <Typography sx={{
                ...COND, fontSize: '0.68rem', fontWeight: 700, letterSpacing: '0.1em',
                textTransform: 'uppercase', color: active ? CYAN : INK3,
              }}>
                {t.label}
              </Typography>
            </Box>
          )
        })}
      </Box>

      {tab === 'narrative' && (
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, lineHeight: 1.75 }}>
          {driver.narrative}
        </Typography>
      )}
      {tab === 'simple' && (
        <Typography sx={{ ...SANS, fontSize: '0.84rem', color: INK, lineHeight: 1.85 }}>
          {driver.simple_english}
        </Typography>
      )}
      {tab === 'forecast' && <ForecastTab driver={driver} />}

      {/* Live metric wiring (step 6) — our own data speaking to this driver */}
      {driver.live && liveValue && <LiveChip label={driver.live.label} value={liveValue} />}

      {/* Watch / direction strip */}
      {(driver.watch || driver.direction) && (
        <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap', mt: 1.75, pt: 1.5, borderTop: `1px dashed ${BORDER}` }}>
          {driver.watch && (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3 }}>
                Watch
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN }}>{driver.watch}</Typography>
            </Box>
          )}
          {driver.direction && (
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
              <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: INK3 }}>
                Direction
              </Typography>
              <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK2 }}>{driver.direction}</Typography>
            </Box>
          )}
          {driver.as_of && (
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3, ml: 'auto' }}>as of {driver.as_of}</Typography>
          )}
        </Box>
      )}

      {/* Dated events — also flagged on the Price Chart above */}
      {driver.events.length > 0 && (
        <Box sx={{ mt: 1.5 }}>
          {driver.events.map(ev => (
            <Box key={`${ev.event_date}-${ev.label}`} sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.5 }}>
              <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3, minWidth: 64 }}>{ev.event_date}</Typography>
              <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK2, flex: 1 }}>{ev.label}</Typography>
              {ev.observed_move && (
                <Typography sx={{
                  ...MONO, fontSize: '0.7rem', fontWeight: 700,
                  color: ev.observed_move.includes('-') ? '#ef4444' : '#22c55e',
                }}>
                  {ev.observed_move}
                </Typography>
              )}
            </Box>
          ))}
        </Box>
      )}

      {driver.verify_note && <VerifyNote text={driver.verify_note} />}
    </Box>
  )
}

function DriverCard({ driver, liveValue, collapsed, onToggle }: {
  driver: Driver
  liveValue?: LiveValue
  collapsed?: boolean
  onToggle?: () => void
}) {
  const { INK, INK3, BORDER, PAPER } = usePalette()
  const color = CATEGORY_COLOR[driver.category]
  const isCollapsible = onToggle !== undefined
  return (
    <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, bgcolor: PAPER, overflow: 'hidden', mb: 1.5 }}>
      <Box
        onClick={onToggle}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1.25,
          px: 2, py: 1.25,
          cursor: isCollapsible ? 'pointer' : 'default',
          '&:hover': isCollapsible ? { bgcolor: `${color}08` } : undefined,
        }}
      >
        <Box sx={{ width: 3, height: 16, borderRadius: 2, bgcolor: color, flexShrink: 0 }} />
        <Typography sx={{ ...SANS, fontSize: '0.84rem', fontWeight: 700, color: INK, flex: 1 }}>
          {driver.title}
        </Typography>
        <Box sx={{
          px: 1, py: 0.25, borderRadius: 1,
          border: `1px solid ${color}30`, bgcolor: `${color}0A`,
        }}>
          <Typography sx={{ ...COND, fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color }}>
            {CATEGORY_LABEL[driver.category]}
          </Typography>
        </Box>
        {isCollapsible && (
          <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3, userSelect: 'none' }}>
            {collapsed ? '▸' : '▾'}
          </Typography>
        )}
      </Box>
      {!collapsed && (
        <Box sx={{ px: 2, pb: 2, pt: 0.5 }}>
          <DriverBody driver={driver} liveValue={liveValue} />
        </Box>
      )}
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function StockDrivers({ data, loading }: {
  data: StockDriversResponse | null
  loading: boolean
}) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()
  const [open, setOpen] = useState<Record<string, boolean>>({})

  if (loading) {
    return (
      <Typography sx={{ ...COND, fontSize: '0.8rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        Loading drivers…
      </Typography>
    )
  }
  if (!data) return null

  const primary = data.drivers.filter(d => d.weight === 'primary')
  const rest    = data.drivers.filter(d => d.weight !== 'primary')
  const lv      = data.live_values ?? {}
  const liveFor = (d: Driver) => (d.live ? lv[d.live.metric] : undefined)

  // Staleness: past the review cadence = visibly stale. Load-bearing — never hide.
  const reviewedMs  = new Date(data.last_reviewed).getTime()
  const ageDays     = Math.floor((Date.now() - reviewedMs) / 86_400_000)
  const cadenceDays = CADENCE_DAYS[data.review_cadence] ?? 92
  const isStale     = ageDays > cadenceDays
  const staleColor  = isStale ? '#ef4444' : '#22c55e'

  return (
    <Box>
      {/* Meta strip: sector · staleness badge · sources */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap', mb: 2.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK2, fontWeight: 600 }}>
          {data.company}
        </Typography>
        <Typography sx={{ ...COND, fontSize: '0.7rem', color: INK3, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
          {data.sector}
        </Typography>
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 0.75, ml: 'auto',
          px: 1.25, py: 0.4, borderRadius: 1,
          border: `1px solid ${staleColor}30`, bgcolor: `${staleColor}08`,
        }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: staleColor }} />
          <Typography sx={{ ...COND, fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: staleColor }}>
            {isStale ? `Stale — reviewed ${ageDays}d ago` : `Reviewed ${data.last_reviewed}`}
          </Typography>
        </Box>
      </Box>

      {/* Primary drivers — always expanded */}
      {primary.map(d => <DriverCard key={d.title} driver={d} liveValue={liveFor(d)} />)}

      {/* Secondary + background — collapsed rows */}
      {rest.length > 0 && (
        <Box sx={{ mt: 2 }}>
          <Typography sx={{ ...COND, fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: INK3, mb: 1 }}>
            Secondary & Background
          </Typography>
          {rest.map(d => (
            <DriverCard
              key={d.title}
              driver={d}
              liveValue={liveFor(d)}
              collapsed={!open[d.title]}
              onToggle={() => setOpen(prev => ({ ...prev, [d.title]: !prev[d.title] }))}
            />
          ))}
        </Box>
      )}

      {/* Sources footnote */}
      {data.sources.length > 0 && (
        <Box sx={{ mt: 2, px: 1.5, py: 1, borderRadius: 1.5, bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
          <Typography sx={{ ...SANS, fontSize: '0.7rem', color: INK3, lineHeight: 1.7 }}>
            Sources: {data.sources.map(s => `${s.title} (${s.period})`).join(' · ')}. Curated research
            content — reviewed {data.last_reviewed}, refreshed {data.review_cadence.replace('_', '-')}.
          </Typography>
        </Box>
      )}
    </Box>
  )
}
