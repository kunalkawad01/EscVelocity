import { useMemo } from 'react'
import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'
import { MONO, GREEN, RED, AMBER } from './chartsCommon'
import type { ChartsTick } from '../../types/charts'

// Breadth-as-regime-gate (the one strategy from the research that can't be a
// per-stock filter condition): advance/decline counts + the equal-weight F&O
// index level -- same two inputs AdvanceDeclineTile and EqualWeightIndexTile
// already chart in the hero, recomputed independently here since neither tile
// exposes its numbers upward. RISK ON (advancers > decliners AND index > 100)
// favors the long-side strategy presets (ORB, Gap Continuation, Pullback
// Reclaim, Leader+Unusual); RISK OFF (the mirror) favors the fade/short
// presets (Gap Fade, Rally Fading). This is guidance only, never a filter --
// the breadth research consistently found it unreliable as a standalone
// mechanical trigger, only useful as context layered on top of a real
// per-stock setup.
export function RegimeBadge({ ticks, refOpens }: { ticks: Record<string, ChartsTick>; refOpens: Record<string, number> }) {
  const { INK3 } = usePalette()

  const { advances, declines, indexValue } = useMemo(() => {
    let adv = 0
    let dec = 0
    for (const sym of Object.keys(ticks)) {
      const t = ticks[sym]
      if (!t.prev_close) continue
      if (t.change_pct > 0) adv++
      else if (t.change_pct < 0) dec++
    }
    const refSymbols = Object.keys(refOpens)
    let sum = 0
    let n = 0
    for (const sym of refSymbols) {
      const t = ticks[sym]
      const ref = refOpens[sym]
      if (!t || !ref) continue
      sum += t.ltp / ref
      n++
    }
    return { advances: adv, declines: dec, indexValue: n ? (sum / n) * 100 : null }
  }, [ticks, refOpens])

  if (!advances && !declines) return null

  const regime: 'ON' | 'OFF' | 'NEUTRAL' =
    indexValue != null && advances > declines && indexValue > 100 ? 'ON'
    : indexValue != null && declines > advances && indexValue < 100 ? 'OFF'
    : 'NEUTRAL'

  const color = regime === 'ON' ? GREEN : regime === 'OFF' ? RED : AMBER
  const label = regime === 'ON'
    ? 'RISK ON — favors long presets'
    : regime === 'OFF'
    ? 'RISK OFF — favors fade/short presets'
    : 'NEUTRAL — mixed breadth'

  return (
    <Box
      title="Breadth regime gate: advance/decline + F&O Equal-Weight Index level, same inputs as the hero charts. Guidance only, not a filter."
      sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.6, px: 1, py: 0.35, borderRadius: 1, border: `1px solid ${color}55` }}
    >
      <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: color }} />
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 800, color }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3 }}>
        (▲{advances} ▼{declines}{indexValue != null ? `, idx ${indexValue.toFixed(1)}` : ''})
      </Typography>
    </Box>
  )
}
