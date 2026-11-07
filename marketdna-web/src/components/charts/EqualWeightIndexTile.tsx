import { useEffect, useMemo, useRef, useState } from 'react'
import { Box, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'
import { MONO, SANS, GREEN, RED, pct } from './chartsCommon'
import type { ChartsTick } from '../../types/charts'

// How often a new index point is recorded. useFoTicker delivers a combined tick
// message ~once/sec, but a full session's worth of 1s points (~22,500) is far more
// than a hero-section line chart needs -- 5s sampling keeps the series smooth and
// the array small without a visible loss of resolution.
const SAMPLE_MS = 5000

// Live equal-weighted F&O index, base 100 at the 9:18 reference open (the same
// noise-reduced reference the table's "Open Ref" toggle uses -- see
// fno_charts_service.get_reference_open_snapshot). index(t) = 100 * mean_i(ltp_i /
// open918_i) across every symbol whose 9:18 print has arrived. Purely client-side
// -- no backend series endpoint, just arithmetic over the already-streaming tick
// map plus the already-fetched reference-open snapshot. Builds forward from
// whenever the page loads / the 9:18 scan completes; does not backfill history
// from 9:18 if opened later in the session (see Suggestions in the page doc).
export function EqualWeightIndexTile({
  ticks, refOpens, refOpensLoading,
}: {
  ticks: Record<string, ChartsTick>
  refOpens: Record<string, number>
  refOpensLoading: boolean
}) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const [series, setSeries] = useState<Array<[number, number]>>([])
  const lastSampleAt = useRef(0)

  const indexValue = useMemo(() => {
    const refSymbols = Object.keys(refOpens)
    if (!refSymbols.length) return null
    let sum = 0
    let n = 0
    for (const sym of refSymbols) {
      const t = ticks[sym]
      const ref = refOpens[sym]
      if (!t || !ref) continue
      sum += t.ltp / ref
      n++
    }
    return n ? (sum / n) * 100 : null
  }, [ticks, refOpens])

  useEffect(() => {
    if (indexValue == null) return
    const now = Date.now()
    if (series.length && now - lastSampleAt.current < SAMPLE_MS) return
    lastSampleAt.current = now
    setSeries(prev => [...prev, [now, indexValue]])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [indexValue])

  const changePct = indexValue == null ? null : indexValue - 100
  const changeColor = (changePct ?? 0) >= 0 ? GREEN : RED

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
      plotLines: [{
        value: 100, color: INK3, width: 1, dashStyle: 'Dot', zIndex: 5,
        label: { text: '100', align: 'right', x: -2, y: -3, style: { color: INK3, fontSize: '0.45rem', fontFamily: "'IBM Plex Mono', monospace" } },
      }],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.62rem' },
      formatter: function () {
        const d = this.series.chart.time.dateFormat('%H:%M:%S', this.x as number)
        return `<b>${d}</b><br/>${(this.y as number).toFixed(2)}`
      },
    },
    series: [{
      type: 'line', name: 'F&O Equal-Weight Index', data: series,
      color: CYAN, lineWidth: 1.5, marker: { enabled: false },
    }],
  }), [series, mode, INK, INK3, BORDER, CYAN])

  return (
    <Box sx={{ ...CARD, p: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5, flexWrap: 'wrap', gap: 0.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 800, color: INK }}>
          F&amp;O Equal-Weight Index{' '}
          <Typography component="span" sx={{ ...MONO, fontSize: '0.56rem', color: INK3, fontWeight: 700 }}>
            (base 100 @ 9:18)
          </Typography>
        </Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 800, color: INK }}>
            {indexValue == null ? '—' : indexValue.toFixed(2)}
          </Typography>
          {changePct != null && (
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: changeColor }}>
              {pct(changePct)}
            </Typography>
          )}
        </Box>
      </Box>
      {!series.length ? (
        <Box sx={{ height: 180, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, textAlign: 'center', px: 2 }}>
            {refOpensLoading
              ? 'Building index — scanning 09:18 reference prints… (~60-70s cold)'
              : 'Waiting for 09:18 reference + live ticks…'}
          </Typography>
        </Box>
      ) : (
        <HighchartsReact highcharts={Highcharts} options={options} />
      )}
    </Box>
  )
}
