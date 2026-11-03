import { useEffect, useMemo, useState } from 'react'
import { Box, IconButton, Tooltip, Typography } from '@mui/material'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'
import TrendingDownIcon from '@mui/icons-material/TrendingDown'
import Highcharts from 'highcharts/highstock'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { useThemeMode } from '../../contexts/ThemeModeContext'
import { useInView } from '../../hooks/useInView'
import { chartsApi } from '../../api/chartsApi'
import { CHARTS_TFS } from '../../types/charts'
import type { ChartsTf, ChartsTick, ChartsHistoryResponse } from '../../types/charts'
import type { CartDirection } from '../../hooks/useChartsCart'
import { MONO, SANS, GREEN, RED, TF_LABELS, pct } from './chartsCommon'

// One square chart tile: symbol header + live LTP/change%, bullish/bearish add-to-cart
// buttons, timeframe tabs, candlestick/line toggle, and a lazy-mounted Highstock chart.
// Shared by /charts (grid of the whole F&O universe) and /chart-cart (filtered cart
// view) so both pages render identically and never drift apart.
export function ChartTile({
  symbol, tick, isInCart, onToggleCart, initialTf = '1d',
}: {
  symbol: string
  tick: ChartsTick | undefined
  isInCart: (symbol: string, tf: ChartsTf, direction: CartDirection) => boolean
  onToggleCart: (args: { symbol: string; tf: ChartsTf; direction: CartDirection; price: number; changePct: number }) => void
  initialTf?: ChartsTf
}) {
  const { INK, INK3, BORDER, CYAN } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const { ref, inView } = useInView<HTMLDivElement>()
  const [tf, setTf] = useState<ChartsTf>(initialTf)
  const [chartType, setChartType] = useState<'candlestick' | 'line'>('candlestick')
  const [hist, setHist] = useState<ChartsHistoryResponse | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!inView) return
    let cancelled = false
    setLoading(true)
    chartsApi.getHistory(symbol, tf)
      .then(r => { if (!cancelled) setHist(r) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [inView, symbol, tf])

  const changeColor = (tick?.change_pct ?? 0) >= 0 ? GREEN : RED

  // Cart price/change% are scoped to the *selected* timeframe's own move (first
  // candle's open -> last close), not the live daily change_pct -- "2D Bullish"
  // should show the 2-day move the trader is looking at, not today's tick. Direction
  // itself is the trader's own call (two explicit buttons below), not derived from price.
  const periodPerf = useMemo(() => {
    const candles = hist?.candles ?? []
    if (!candles.length) return null
    const open = candles[0].open
    const close = tf === '1d' && tick?.ltp ? tick.ltp : candles[candles.length - 1].close
    const changePct = ((close - open) / open) * 100
    return { price: close, changePct }
  }, [hist, tf, tick?.ltp])

  const inCartBullish = isInCart(symbol, tf, 'bullish')
  const inCartBearish = isInCart(symbol, tf, 'bearish')

  const options = useMemo<Highcharts.Options>(() => {
    const candles = hist?.candles ?? []
    const ohlc = candles.map(c => [new Date(c.time).getTime(), c.open, c.high, c.low, c.close])
    // Live overlay: only the 1D tab's last bar tracks the websocket tick -- longer
    // timeframes are EOD daily candles that don't move intraday (by page design).
    if (tf === '1d' && tick?.ltp && ohlc.length > 0) {
      const last = ohlc[ohlc.length - 1]
      ohlc[ohlc.length - 1] = [last[0], last[1], Math.max(last[2], tick.ltp), Math.min(last[3], tick.ltp), tick.ltp]
    }
    const lineColor = changeColor

    const series: Highcharts.SeriesOptionsType = chartType === 'candlestick'
      ? { type: 'candlestick', name: symbol, data: ohlc, color: RED, upColor: GREEN, lineColor: RED, upLineColor: GREEN }
      : { type: 'area', name: symbol, data: ohlc.map(c => [c[0], c[4]]), color: lineColor, lineWidth: 1.3, fillOpacity: 0.12, marker: { enabled: false } }

    return {
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
        plotLines: tick?.prev_close ? [{
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
          if (chartType === 'candlestick') {
            const p = this.point as Highcharts.Point & { open?: number; high?: number; low?: number; close?: number }
            return `<b>${d}</b><br/>O ${p.open?.toFixed(2)} H ${p.high?.toFixed(2)}<br/>L ${p.low?.toFixed(2)} C ${p.close?.toFixed(2)}`
          }
          return `<b>${d}</b><br/>${(this.y as number).toFixed(2)}`
        },
      },
      series: [series],
    }
  }, [hist, tf, tick?.ltp, tick?.prev_close, symbol, chartType, changeColor, INK, INK3, BORDER, mode])

  return (
    <Box ref={ref} sx={{ ...CARD, p: 1.25, aspectRatio: '1 / 1', display: 'flex', flexDirection: 'column' }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 0.5, gap: 0.5 }}>
        <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 800, color: INK }}>{symbol}</Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box sx={{ textAlign: 'right' }}>
            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
              {tick ? tick.ltp.toFixed(2) : '—'}
            </Typography>
            {tick && (
              <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 700, color: changeColor }}>
                {pct(tick.change_pct)}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.1 }}>
            <Tooltip title={`${inCartBullish ? 'Remove from' : 'Add to'} cart — ${TF_LABELS[tf]} Bullish`}>
              <span>
                <IconButton
                  size="small"
                  disabled={!periodPerf}
                  onClick={() => periodPerf && onToggleCart({ symbol, tf, direction: 'bullish', price: periodPerf.price, changePct: periodPerf.changePct })}
                  sx={{ p: 0.3, color: inCartBullish ? GREEN : INK3 }}
                >
                  <TrendingUpIcon sx={{ fontSize: '0.95rem' }} />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={`${inCartBearish ? 'Remove from' : 'Add to'} cart — ${TF_LABELS[tf]} Bearish`}>
              <span>
                <IconButton
                  size="small"
                  disabled={!periodPerf}
                  onClick={() => periodPerf && onToggleCart({ symbol, tf, direction: 'bearish', price: periodPerf.price, changePct: periodPerf.changePct })}
                  sx={{ p: 0.3, color: inCartBearish ? RED : INK3 }}
                >
                  <TrendingDownIcon sx={{ fontSize: '0.95rem' }} />
                </IconButton>
              </span>
            </Tooltip>
          </Box>
        </Box>
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, mb: 0.5 }}>
        <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap', flex: 1 }}>
          {CHARTS_TFS.map(t => (
          <Box
            key={t}
            onClick={() => setTf(t)}
            sx={{
              px: 0.6, py: 0.1, borderRadius: 0.75, cursor: 'pointer',
              bgcolor: tf === t ? `${CYAN}20` : 'transparent',
              border: `1px solid ${tf === t ? CYAN : BORDER}`,
            }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.5rem', fontWeight: tf === t ? 800 : 600, color: tf === t ? CYAN : INK3 }}>
              {TF_LABELS[t]}
            </Typography>
          </Box>
          ))}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.25, flexShrink: 0 }}>
          {(['candlestick', 'line'] as const).map(ct => (
            <Box
              key={ct}
              onClick={() => setChartType(ct)}
              title={ct === 'candlestick' ? 'Candlestick' : 'Line'}
              sx={{
                width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center',
                borderRadius: 0.75, cursor: 'pointer',
                bgcolor: chartType === ct ? `${CYAN}20` : 'transparent',
                border: `1px solid ${chartType === ct ? CYAN : BORDER}`,
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.56rem', fontWeight: 800, color: chartType === ct ? CYAN : INK3, lineHeight: 1 }}>
                {ct === 'candlestick' ? '▥' : '╱'}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
      <Box sx={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {!inView ? (
          <Box sx={{ position: 'absolute', inset: 0, bgcolor: mode === 'dark' ? '#0f172a' : '#f1f5f9', borderRadius: 1 }} />
        ) : hist?.error ? (
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: RED, textAlign: 'center', mt: 2 }}>{hist.error}</Typography>
        ) : !hist?.candles.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, textAlign: 'center', mt: 2 }}>
            {loading ? 'loading…' : 'No candles.'}
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
