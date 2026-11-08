import { useEffect, useMemo, useState } from 'react'
import { Box, Grid, Typography } from '@mui/material'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'
import { chartsApi } from '../../api/chartsApi'
import type { ChartsHistoryForDateResponse } from '../../types/charts'
import type { QuarterReaction } from '../../types/resultReaction'
import { MONO, SANS, GREEN, RED } from './chartsCommon'

// Result Reaction's day_*_pct fields are fractions (0.0152, not 1.52) -- unlike
// chartsCommon's pct(), which expects values already expressed in % units (e.g.
// a live tick's change_pct). Mirrors the *100 formatter ResultReactionPage.tsx
// itself uses for the same fields.
function pct(v: number | null | undefined, dp = 2): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`
}

interface DayEntry {
  key: string
  label: string
  date: string | null
  pct: number | null
}

// e.g. "2026-10-16" -> "Thu, 16 Oct" -- readable at a glance without needing to
// cross-reference the per-quarter table's Result Date column.
function formatDate(date: string | null): string {
  if (!date) return ''
  const d = new Date(`${date}T00:00:00`)
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: '2-digit', month: 'short' })
}

// All 7 days shown around one quarterly result -- Day -1 (pre-result) through
// Day 0 (announcement) through Day +5 (extended follow-through). Mirrors the
// Live Screener's MultiTimeframeGrid (one tile per period, fetched lazily, laid
// out all at once) but each tile here is an exact past calendar date's own
// intraday session rather than a relative "N days back" window.
function dayEntries(q: QuarterReaction): DayEntry[] {
  return [
    { key: 'm1', label: 'DAY -1', date: q.day_minus1_date, pct: q.day_minus1_pct },
    { key: '0',  label: 'DAY 0 (RESULT)', date: q.reaction_date, pct: q.day0_pct },
    { key: 'p1', label: 'DAY +1', date: q.day_plus1_date, pct: q.day_plus1_pct },
    { key: 'p2', label: 'DAY +2', date: q.day_plus2_date, pct: q.day_plus2_pct },
    { key: 'p3', label: 'DAY +3', date: q.day_plus3_date, pct: q.day_plus3_pct },
    { key: 'p4', label: 'DAY +4', date: q.day_plus4_date, pct: q.day_plus4_pct },
    { key: 'p5', label: 'DAY +5', date: q.day_plus5_date, pct: q.day_plus5_pct },
  ]
}

function MiniDayCard({
  label, date, pctVal, hist,
}: {
  label: string
  date: string | null
  pctVal: number | null
  hist: ChartsHistoryForDateResponse | undefined
}) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const candles = hist?.candles ?? []

  const ohlc = useMemo(
    () => candles.map(c => [new Date(c.time).getTime(), c.open, c.high, c.low, c.close]),
    [candles],
  )
  const changeColor = (pctVal ?? 0) >= 0 ? GREEN : RED

  // Intraday (open -> close) return for THIS specific day -- distinct from
  // pctVal, which is close-to-close vs the PRIOR day (the "Day N" column in
  // the quarter table). A day can gap down hard overnight (bad close-to-close)
  // yet trade flat-to-up intraday once the gap is in, or vice versa -- the two
  // numbers answer different questions and both matter for reading a reaction day.
  const intradayPct = useMemo(() => {
    if (!candles.length) return null
    const open = candles[0].open
    const close = candles[candles.length - 1].close
    return open ? (close - open) / open : null
  }, [candles])
  const intradayColor = intradayPct == null ? INK3 : intradayPct >= 0 ? GREEN : RED

  // The prior trading day's close, back-derived rather than fetched separately:
  // this tile's own last candle IS that day's close, and pctVal is already
  // close[this day]/close[prior day]-1 (see result_reaction_service), so
  // prevClose = lastClose / (1 + pctVal). Avoids a second API call per tile.
  const prevClose = useMemo(() => {
    if (!candles.length || pctVal == null) return null
    const lastClose = candles[candles.length - 1].close
    return pctVal === -1 ? null : lastClose / (1 + pctVal)
  }, [candles, pctVal])

  const options = useMemo<Highcharts.Options>(() => ({
    time: { timezone: 'Asia/Kolkata' },
    // Explicit height, not left to container measurement -- HighchartsReact
    // mounts the chart before this flex-laid-out card's own height has settled,
    // so an unset height silently falls back to Highcharts' 400px default and
    // overflows the (visually 240px) card. aspectRatio-based tiles elsewhere
    // (MultiTimeframeGrid) dodge this because aspect-ratio is intrinsically
    // resolvable at layout time; a fixed-height flex card isn't.
    chart: { height: 240, backgroundColor: 'transparent', spacing: [4, 4, 4, 4] },
    title: { text: undefined },
    credits: { enabled: false },
    rangeSelector: { enabled: false },
    scrollbar: { enabled: false },
    navigator: { enabled: false },
    xAxis: {
      type: 'datetime', lineColor: BORDER, tickColor: BORDER,
      labels: { style: { color: INK3, fontSize: '0.58rem' }, format: '{value:%H:%M}' },
    },
    yAxis: {
      labels: { style: { color: INK3, fontSize: '0.58rem' } },
      gridLineColor: mode === 'dark' ? '#1e293b' : '#eef2f7',
      opposite: false,
      // softMin/softMax (not min/max) only WIDEN the auto-scaled range when the
      // candle data alone wouldn't already cover prevClose -- otherwise a gappy
      // open (e.g. Day -1's prevClose sitting below the whole day's traded
      // range) clips the dotted line off the bottom/top of the chart entirely.
      softMin: prevClose ?? undefined,
      softMax: prevClose ?? undefined,
      plotLines: prevClose != null ? [{
        value: prevClose,
        color: INK3,
        width: 1,
        dashStyle: 'Dot',
        zIndex: 5,
        label: {
          text: 'Prev Close', align: 'right', x: -2, y: -3,
          style: { color: INK3, fontSize: '0.5rem', fontFamily: "'IBM Plex Mono', monospace" },
        },
      }] : [],
    },
    tooltip: {
      backgroundColor: mode === 'dark' ? '#0B1020' : '#fff', borderColor: BORDER,
      style: { color: INK, fontSize: '0.62rem' },
      formatter: function () {
        const d = this.series.chart.time.dateFormat('%H:%M', this.x as number)
        const p = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
        return `<b>${d}</b><br/>O ${p.open?.toFixed(2)} H ${p.high?.toFixed(2)}<br/>L ${p.low?.toFixed(2)} C ${p.close?.toFixed(2)}`
      },
    },
    series: [{
      type: 'candlestick', name: label, data: ohlc,
      color: RED, upColor: GREEN, lineColor: RED, upLineColor: GREEN,
      dataGrouping: { enabled: false },
    }],
  }), [ohlc, label, mode, INK, INK3, BORDER, prevClose])

  return (
    <Box sx={{ ...CARD, p: 1.25, display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.25 }}>
        <Typography sx={{ ...MONO, fontSize: '0.64rem', fontWeight: 800, color: CYAN, letterSpacing: '0.05em' }}>
          {label}
        </Typography>
        <Box sx={{ textAlign: 'right' }}>
          <Typography sx={{ ...MONO, fontSize: '0.7rem', fontWeight: 700, color: changeColor }}>
            {pct(pctVal)}
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3, letterSpacing: '0.03em' }}>
            vs prev close
          </Typography>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3 }}>
          {formatDate(date)}
        </Typography>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: intradayColor }}>
          {pct(intradayPct)} <Box component="span" sx={{ ...MONO, fontSize: '0.56rem', color: INK3, fontWeight: 400 }}>intraday</Box>
        </Typography>
      </Box>
      <Box sx={{ height: 240, position: 'relative' }}>
        {!candles.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center', mt: 2 }}>
            {!hist ? 'loading…' : (hist.error ?? 'No intraday data.')}
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

// Fetches all 7 days' intraday candles in parallel, once per quarter -- only
// mounted when a quarter's "View Charts" toggle is opened, so it's lazy by
// construction. Each day's candles are immutable (closed trading sessions), so
// there's no live-tick overlay to wire up, unlike MultiTimeframeGrid's "Today" tile.
export function ResultDayChartGrid({ symbol, quarter }: { symbol: string; quarter: QuarterReaction }) {
  const [hist, setHist] = useState<Record<string, ChartsHistoryForDateResponse>>({})
  const entries = useMemo(() => dayEntries(quarter), [quarter])

  useEffect(() => {
    let cancelled = false
    setHist({})
    for (const { key, date } of entries) {
      if (!date) continue
      chartsApi.getHistoryForDate(symbol, date)
        .then(r => { if (!cancelled) setHist(prev => ({ ...prev, [key]: r })) })
        .catch(() => { if (!cancelled) setHist(prev => ({ ...prev, [key]: { symbol, date, candles: [], error: 'Failed to load' } })) })
    }
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `entries` is derived fresh from `quarter` every render; keying off symbol+result_date is enough to detect a real quarter change
  }, [symbol, quarter.result_date])

  return (
    <Grid container spacing={1.5}>
      {entries.map(({ key, label, date, pct: p }) => (
        <Grid item xs={12} sm={6} md={4} key={key}>
          {date
            ? <MiniDayCard label={label} date={date} pctVal={p} hist={hist[key]} />
            : <MiniDayCard label={label} date={null} pctVal={null} hist={{ symbol, date: '', candles: [], error: 'Outside covered history' }} />}
        </Grid>
      ))}
    </Grid>
  )
}
