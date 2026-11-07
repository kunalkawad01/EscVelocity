import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'
import { MONO, SANS, GREEN, RED } from './chartsCommon'
import type { ChartsTick } from '../../types/charts'

// Same sampling cadence as EqualWeightIndexTile -- see its comment.
const SAMPLE_MS = 5000

// Live advance/decline breadth across the F&O universe, computed purely from the
// streaming /ws/charts tick map (change_pct vs yesterday's close, same field the
// Chg % column uses) -- no backend series endpoint, no dependency on the 9:18
// reference. Plots two running lines (advancing count, declining count) rather
// than a single net line so both the level and the spread are visible at once.
// Builds forward from whenever the page loads; does not backfill from market
// open if opened mid-session (see Suggestions in the page doc).
export function AdvanceDeclineTile({ ticks }: { ticks: Record<string, ChartsTick> }) {
  const { INK, INK3, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const [advSeries, setAdvSeries] = useState<Array<[number, number]>>([])
  const [decSeries, setDecSeries] = useState<Array<[number, number]>>([])
  const lastSampleAt = useRef(0)

  const counts = useMemo(() => {
    let advances = 0
    let declines = 0
    let unchanged = 0
    for (const sym of Object.keys(ticks)) {
      const t = ticks[sym]
      if (!t.prev_close) continue
      if (t.change_pct > 0) advances++
      else if (t.change_pct < 0) declines++
      else unchanged++
    }
    return { advances, declines, unchanged, total: advances + declines + unchanged }
  }, [ticks])

  useEffect(() => {
    if (!counts.total) return
    const now = Date.now()
    if (advSeries.length && now - lastSampleAt.current < SAMPLE_MS) return
    lastSampleAt.current = now
    setAdvSeries(prev => [...prev, [now, counts.advances]])
    setDecSeries(prev => [...prev, [now, counts.declines]])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [counts.advances, counts.declines, counts.total])

  const options = useMemo<Highcharts.Options>(() => ({
    chart: { backgroundColor: 'transparent', spacing: [4, 4, 4, 4], height: 180 },
    title: { text: undefined },
    credits: { enabled: false },
    xAxis: {
      type: 'datetime', lineColor: BORDER, tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.55rem' } },
    },
    yAxis: {
      labels: { style: { color: INK3, fontSize: '0.55rem' } },
      gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      title: { text: undefined },
      min: 0,
    },
    legend: { enabled: false },
    tooltip: {
      shared: true,
      backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.62rem' },
      formatter: function () {
        const d = this.points?.[0]?.series.chart.time.dateFormat('%H:%M:%S', this.x as number)
        const lines = (this.points ?? []).map(p => `${p.series.name}: <b>${p.y}</b>`)
        return [`<b>${d}</b>`, ...lines].join('<br/>')
      },
    },
    series: [
      { type: 'line', name: 'Advancing', data: advSeries, color: GREEN, lineWidth: 1.5, marker: { enabled: false } },
      { type: 'line', name: 'Declining', data: decSeries, color: RED, lineWidth: 1.5, marker: { enabled: false } },
    ],
  }), [advSeries, decSeries, mode, INK, INK3, BORDER])

  return (
    <Box sx={{ ...CARD, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 800, color: INK }}>
          F&amp;O Advance-Decline
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 800, color: GREEN }}>
            ▲ {counts.advances}
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 800, color: RED }}>
            ▼ {counts.declines}
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
            ({counts.unchanged} flat)
          </Typography>
        </Box>
      </Box>
      {!advSeries.length ? (
        <Box sx={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>
            Waiting for live ticks…
          </Typography>
        </Box>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}
