import { useState, useMemo } from 'react'
import { Box, ButtonGroup, Button, Typography, CircularProgress } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts/highstock'
import type { OHLCVResponse } from '../../types/stock'
import { hcTheme } from '../../theme'

const TIMEFRAMES = [
  { label: '1M', days: 21 },
  { label: '3M', days: 63 },
  { label: '6M', days: 126 },
  { label: 'YTD', days: 0 },
  { label: '1Y', days: 252 },
  { label: '2Y', days: 504 },
  { label: '3Y', days: 756 },
  { label: '5Y', days: 1260 },
  { label: 'All', days: -1 },
]

interface Props { data: OHLCVResponse | null; loading: boolean }

export default function PriceChart({ data, loading }: Props) {
  const [tf, setTf] = useState('1Y')

  const sliced = useMemo(() => {
    if (!data?.candles.length) return []
    const tf_days = TIMEFRAMES.find(t => t.label === tf)?.days ?? 252
    if (tf_days === 0) {
      const year = new Date().getFullYear()
      return data.candles.filter(c => c.date.startsWith(`${year}`))
    }
    if (tf_days === -1) return data.candles
    return data.candles.slice(-tf_days)
  }, [data, tf])

  const options = useMemo((): Highcharts.Options => {
    const ohlc = sliced.map(c => [new Date(c.date).getTime(), c.open, c.high, c.low, c.close])
    const vol = sliced.map(c => [new Date(c.date).getTime(), c.volume])
    const sma20 = sliced.filter(c => c.sma20 != null).map(c => [new Date(c.date).getTime(), c.sma20])
    const sma50 = sliced.filter(c => c.sma50 != null).map(c => [new Date(c.date).getTime(), c.sma50])
    const sma200 = sliced.filter(c => c.sma200 != null).map(c => [new Date(c.date).getTime(), c.sma200])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 480 },
      title: { text: '' },
      rangeSelector: { enabled: false },
      navigator: { enabled: false },
      scrollbar: { enabled: false },
      xAxis: {
        ...hcTheme.xAxis,
        type: 'datetime',
        crosshair: { color: 'rgba(59,130,246,0.3)', dashStyle: 'Dash' },
      },
      yAxis: [
        {
          ...hcTheme.yAxis,
          height: '72%',
          labels: { ...hcTheme.yAxis.labels, format: '₹{value}', align: 'right', x: -4 },
        },
        {
          ...hcTheme.yAxis,
          top: '75%',
          height: '22%',
          offset: 0,
          labels: { ...hcTheme.yAxis.labels, format: '{value}', align: 'right', x: -4 },
        },
      ],
      series: [
        {
          type: 'candlestick',
          name: data?.symbol ?? '',
          data: ohlc,
          color: '#ef4444',
          upColor: '#22c55e',
          lineColor: '#ef4444',
          upLineColor: '#22c55e',
          yAxis: 0,
        },
        { type: 'column', name: 'Volume', data: vol, yAxis: 1, color: 'rgba(59,130,246,0.25)', borderWidth: 0 },
        { type: 'line', name: 'SMA 20', data: sma20, yAxis: 0, color: '#f59e0b', lineWidth: 1.5, marker: { enabled: false } },
        { type: 'line', name: 'SMA 50', data: sma50, yAxis: 0, color: '#3b82f6', lineWidth: 1.5, marker: { enabled: false } },
        { type: 'line', name: 'SMA 200', data: sma200, yAxis: 0, color: '#6366f1', lineWidth: 2, marker: { enabled: false }, dashStyle: 'ShortDash' },
      ],
      tooltip: {
        ...hcTheme.tooltip,
        split: true,
        formatter: undefined,
      },
      legend: { ...hcTheme.legend, enabled: true },
    }
  }, [sliced, data?.symbol])

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography variant="h6" sx={{ fontWeight: 700 }}>Price Chart</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            OHLCV candlestick with SMA20/50/200 overlays — the primary visual record of price action and moving average structure
          </Typography>
        </Box>
        <ButtonGroup size="small" variant="outlined">
          {TIMEFRAMES.map(t => (
            <Button
              key={t.label}
              onClick={() => setTf(t.label)}
              sx={{
                px: 1.5,
                borderColor: 'rgba(255,255,255,0.1)',
                color: tf === t.label ? '#3b82f6' : 'text.secondary',
                bgcolor: tf === t.label ? 'rgba(59,130,246,0.1)' : 'transparent',
                fontWeight: tf === t.label ? 700 : 400,
                fontSize: '0.875rem',
              }}
            >
              {t.label}
            </Button>
          ))}
        </ButtonGroup>
      </Box>
      {loading ? (
        <Box sx={{ height: 480, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <CircularProgress size={32} />
        </Box>
      ) : (
        <HighchartsReact highcharts={Highcharts} constructorType="stockChart" options={options} />
      )}
    </Box>
  )
}
