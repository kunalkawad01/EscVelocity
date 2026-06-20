import { useMemo } from 'react'
import { Box, Typography, Stack, CircularProgress, Chip } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { RiskResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import StatCard from './StatCard'
import { usePalette } from '../../hooks/usePalette'

const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: RiskResponse | null; loading: boolean }

export default function RiskIntelligence({ data, loading }: Props) {
  const { INK, INK2, INK3, BORDER } = usePalette()

  const options = useMemo((): Highcharts.Options => {
    if (!data?.atr_series.length) return {}
    const series = data.atr_series.map(p => [new Date(p.date).getTime(), p.atr14])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 260 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: { ...hcTheme.yAxis, title: { text: 'ATR (₹)', style: { color: INK3 } } },
      series: [{
        type: 'area',
        name: 'ATR(14)',
        data: series,
        color: '#6366f1',
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(171,71,188,0.3)'],
            [1, 'rgba(171,71,188,0.02)'],
          ],
        },
        lineWidth: 2,
        marker: { enabled: false },
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          return `<b>${Highcharts.dateFormat('%b %d, %Y', Number(this.x))}</b><br/>ATR: <b>₹${Number(this.y).toFixed(2)}</b>`
        },
      },
    }
  }, [data, INK3])

  if (loading) {
    return (
      <Box sx={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (!data) return null

  const { stats } = data
  const trendColor = stats.atr_trend === 'rising' ? '#ef4444' : stats.atr_trend === 'falling' ? '#22c55e' : '#f59e0b'

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Box>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
            Volatility Exposure
          </Typography>
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, display: 'block' }}>
            Risk Intelligence
          </Typography>
          <Typography sx={{ fontSize: '0.73rem', color: INK2, lineHeight: 1.5 }}>
            ATR(14) measures the actual daily range a position absorbs — percentile reveals if volatility is elevated, normal, or compressed
          </Typography>
        </Box>
        <Chip
          label={`Trend: ${stats.atr_trend.toUpperCase()}`}
          size="small"
          sx={{ bgcolor: `${trendColor}20`, color: trendColor, fontWeight: 700, fontSize: '0.75rem' }}
        />
      </Box>
      <Stack direction="row" spacing={2} mb={3} flexWrap="wrap">
        <StatCard label="Current ATR" value={`₹${stats.current_atr}`} accent="default" />
        <StatCard label="ATR Percentile" value={`${stats.atr_percentile}th`} sub="vs history" accent={stats.atr_percentile > 70 ? 'error' : stats.atr_percentile < 30 ? 'success' : 'secondary'} />
        <StatCard label="ATR % of Price" value={`${stats.atr_pct_of_price}%`} sub="daily range estimate" accent="default" />
      </Stack>

      <Box sx={{ mb: 3 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>Low Volatility</Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>High Volatility</Typography>
        </Box>
        <Box sx={{ height: 8, borderRadius: 4, bgcolor: BORDER, overflow: 'hidden' }}>
          <Box
            sx={{
              height: '100%',
              width: `${stats.atr_percentile}%`,
              borderRadius: 4,
              background: `linear-gradient(90deg, #22c55e 0%, #f59e0b 50%, #ef4444 100%)`,
              transition: 'width 0.8s ease',
            }}
          />
        </Box>
        <Typography variant="caption" sx={{ color: trendColor, fontWeight: 700 }}>{stats.atr_percentile}th percentile</Typography>
      </Box>

      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}
