import { useMemo } from 'react'
import { Box, Typography, Stack, CircularProgress } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { RelativeStrengthResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import StatCard from './StatCard'
import { usePalette } from '../../hooks/usePalette'

const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: RelativeStrengthResponse | null; loading: boolean }

export default function RelativeStrengthSection({ data, loading }: Props) {
  const { INK, INK2, INK3 } = usePalette()
  const options = useMemo((): Highcharts.Options => {
    if (!data?.ranks.length) return {}
    const series = data.ranks.map(r => [new Date(r.date).getTime(), r.rank])
    const percentileSeries = data.ranks.map(r => [new Date(r.date).getTime(), r.percentile])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 280 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: [
        {
          ...hcTheme.yAxis,
          title: { text: 'Rank', style: { color: INK3 } },
          reversed: true,
          min: 1,
        },
        {
          ...hcTheme.yAxis,
          title: { text: 'Percentile', style: { color: INK3 } },
          opposite: true,
          min: 0,
          max: 100,
        },
      ],
      series: [
        {
          type: 'line',
          name: 'Rank (lower = better)',
          data: series,
          color: '#4f9cf9',
          lineWidth: 1.5,
          marker: { enabled: false },
          yAxis: 0,
        },
        {
          type: 'area',
          name: 'Percentile',
          data: percentileSeries,
          color: '#f59e0b',
          fillOpacity: 0.08,
          lineWidth: 1,
          marker: { enabled: false },
          yAxis: 1,
        },
      ],
      tooltip: { ...hcTheme.tooltip, shared: true },
      legend: { ...hcTheme.legend, enabled: true },
    }
  }, [data])

  if (loading) {
    return (
      <Box sx={{ height: 280, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (!data) return null

  const { stats } = data
  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Peer Comparison
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Relative Strength vs NIFTY 50
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2, display: 'block', lineHeight: 1.5 }}>
        Rank among all 48 NIFTY 50 peers over time — persistent leadership is more predictive than a single-day rank
      </Typography>
      <Stack direction="row" spacing={2} mb={3} flexWrap="wrap">
        <StatCard label="Current Rank" value={`#${stats.current_rank}`} sub={`of ${stats.total_symbols}`} accent="primary" />
        <StatCard label="Best Rank" value={`#${stats.best_rank}`} accent="success" />
        <StatCard label="Worst Rank" value={`#${stats.worst_rank}`} accent="error" />
        <StatCard label="Avg Rank" value={`#${stats.avg_rank}`} accent="default" />
        <StatCard label="Rank Percentile" value={`${stats.rank_percentile}%`} sub="higher = stronger" accent="secondary" />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}
