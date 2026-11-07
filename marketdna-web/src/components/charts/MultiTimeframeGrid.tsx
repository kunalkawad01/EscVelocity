import { useEffect, useMemo, useState } from 'react'
import { Box, Grid, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'
import { chartsApi } from '../../api/chartsApi'
import type { ChartsHistoryResponse, ChartsTf, ChartsTick } from '../../types/charts'
import { MONO, SANS, GREEN, RED, pct } from './chartsCommon'

// The 6 timeframes shown side-by-side when a Live Screener row is expanded --
// a snapshot view (every timeframe visible at once, each with its own return%),
// as opposed to /charts' ChartTile (one timeframe at a time via tabs). 'yesterday'
// is a tf the backend supports (see fno_charts_service.get_history) but that
// deliberately isn't one of the 8 /charts tab timeframes (CHARTS_TFS) -- it only
// exists for this grid.
const SCREENER_TFS: Array<{ tf: ChartsTf; label: string }> = [
  { tf: '1d', label: 'TODAY' },
  { tf: 'yesterday', label: 'YESTERDAY' },
  { tf: '5d', label: '5-DAY' },
  { tf: '1mo', label: '1 MONTH' },
  { tf: '3mo', label: 'QUARTERLY' },
  { tf: '1y', label: '1 YEAR' },
]

// Same square candlestick tile as /charts' ChartTile (card chrome, header
// layout, red/green candle coloring, tiny axis labels, prev-close dotted plot
// line) but locked to one fixed timeframe -- no tf tabs, no resolution toggle,
// no add-to-cart, since here the "switching" is done by laying all 6 out at
// once instead of one tile with tabs.
function MiniTfCard({
  symbol, tf, label, hist, tick,
}: {
  symbol: string
  tf: ChartsTf
  label: string
  hist: ChartsHistoryResponse | undefined
  tick: ChartsTick | undefined
}) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const candles = hist?.candles ?? []

  // Live overlay: only "Today" tracks the websocket tick -- every other card is
  // a fixed, already-completed window (yesterday's close, or an older bar), same
  // rule ChartTile applies to its own 1D tab.
  const ohlc = useMemo(() => {
    const arr = candles.map(c => [new Date(c.time).getTime(), c.open, c.high, c.low, c.close])
    if (tf === '1d' && tick?.ltp && arr.length > 0) {
      const last = arr[arr.length - 1]
      arr[arr.length - 1] = [last[0], last[1], Math.max(last[2], tick.ltp), Math.min(last[3], tick.ltp), tick.ltp]
    }
    return arr
  }, [candles, tf, tick?.ltp])

  // Period return: "Today" uses the gap-inclusive prev_close -> ltp tick figure
  // (same number the live header shows); every other card is first-candle-open
  // -> last-candle-close of its own fixed window -- same convention as ChartTile's
  // periodPerf for non-1d timeframes.
  const periodPerf = useMemo(() => {
    if (!candles.length) return null
    if (tf === '1d' && tick?.prev_close) return { price: tick.ltp, changePct: tick.change_pct }
    const open = candles[0].open
    const close = tf === '1d' && tick?.ltp ? tick.ltp : candles[candles.length - 1].close
    return { price: close, changePct: open ? ((close - open) / open) * 100 : 0 }
  }, [candles, tf, tick])

  const changeColor = (periodPerf?.changePct ?? 0) >= 0 ? GREEN : RED

  const options = useMemo<Highcharts.Options>(() => ({
    time: { timezone: 'Asia/Kolkata' },
    chart: { backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
    title: { text: undefined },
    credits: { enabled: false },
    rangeSelector: { enabled: false },
    scrollbar: { enabled: false },
    navigator: { enabled: false },
    xAxis: {
      type: 'datetime', lineColor: BORDER, tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.5rem' } },
    },
    yAxis: {
      labels: { style: { color: INK3, fontSize: '0.5rem' } },
      gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      plotLines: tf === '1d' && tick?.prev_close ? [{
        value: tick.prev_close,
        color: INK3,
        width: 1,
        dashStyle: 'Dot',
        zIndex: 5,
        label: {
          text: 'Prev Close', align: 'right', x: -2, y: -3,
          style: { color: INK3, fontSize: '0.45rem', fontFamily: "'IBM Plex Mono', monospace" },
        },
      }] : [],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.62rem' },
      formatter: function () {
        const d = this.series.chart.time.dateFormat('%e %b %y %H:%M', this.x as number)
        const p = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
        return `<b>${d}</b><br/>O ${p.open?.toFixed(2)} H ${p.high?.toFixed(2)}<br/>L ${p.low?.toFixed(2)} C ${p.close?.toFixed(2)}`
      },
    },
    series: [{
      type: 'candlestick', name: symbol, data: ohlc,
      color: RED, upColor: GREEN, lineColor: RED, upLineColor: GREEN,
      dataGrouping: { enabled: false },
    }],
  }), [ohlc, symbol, mode, INK, INK3, BORDER, tf, tick?.prev_close])

  return (
    <Box sx={{ ...CARD, p: 1.25, aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 800, color: CYAN, letterSpacing: '0.06em' }}>
          {label}
        </Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
            {periodPerf ? periodPerf.price.toFixed(2) : '—'}
          </Typography>
          {periodPerf && (
            <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 700, color: changeColor }}>
              {pct(periodPerf.changePct)}
            </Typography>
          )}
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {!candles.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center', mt: 2 }}>
            {!hist ? 'loading…' : (hist.error ?? 'No candles.')}
          </Typography>
        ) : (
          <Box sx={{ position: 'absolute', inset: 0 }}>
            <HighchartsReact
              highcharts={Highcharts} constructorType="stockChart" options={options}
              containerProps={{ style: { height: '100%', width: '100%' } }}
            />
          </Box>
        )}
      </Box>
    </Box>
  )
}

// Fetches all 6 timeframes in parallel once per symbol -- only mounted when a
// Live Screener row is expanded, so this is already lazy by construction (no
// separate IntersectionObserver gate needed, unlike /charts' tile grid).
//
// Each tf's result is written to state AS IT ARRIVES, not after Promise.all
// settles -- the original version waited for the single slowest of the 6
// fetches (often '1y', the largest payload) before showing ANY of them, so a
// fast 'Today' response sat invisible behind a slow '1 Year' one. Writing
// incrementally lets fast timeframes render immediately and spreads the 6
// Highcharts mounts across separate render passes instead of one synchronous
// burst, which is what actually made the expand feel like a freeze rather
// than a mount cost -- a symbol reported as "slow / not smooth" to load.
export function MultiTimeframeGrid({ symbol, tick }: { symbol: string; tick: ChartsTick | undefined }) {
  const [hist, setHist] = useState<Record<string, ChartsHistoryResponse>>({})

  useEffect(() => {
    let cancelled = false
    setHist({}) // new symbol -- every card goes back to "loading…" immediately
    for (const { tf } of SCREENER_TFS) {
      chartsApi.getHistory(symbol, tf)
        .then(r => { if (!cancelled) setHist(prev => ({ ...prev, [tf]: r })) })
        .catch(() => { if (!cancelled) setHist(prev => ({ ...prev, [tf]: { tf, symbol, candles: [], error: 'Failed to load' } })) })
    }
    return () => { cancelled = true }
  }, [symbol])

  return (
    <Grid container spacing={1.5}>
      {SCREENER_TFS.map(({ tf, label }) => (
        <Grid item xs={6} sm={4} key={tf}>
          <MiniTfCard
            symbol={symbol}
            tf={tf}
            label={label}
            hist={hist[tf]}
            tick={tf === '1d' ? tick : undefined}
          />
        </Grid>
      ))}
    </Grid>
  )
}
