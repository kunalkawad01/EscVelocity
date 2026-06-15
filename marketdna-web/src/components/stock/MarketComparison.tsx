import { useMemo } from 'react'
import { Box, Typography, Stack, CircularProgress, Chip } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { MarketComparisonResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import StatCard from './StatCard'

interface Props { data: MarketComparisonResponse | null; loading: boolean }

export default function MarketComparison({ data, loading }: Props) {
  const options = useMemo((): Highcharts.Options => {
    if (!data?.ratio_series.length) return {}

    const ratioData = data.ratio_series.map(p => [new Date(p.date).getTime(), p.ratio])
    const sma50Data = data.ratio_series.filter(p => p.sma50 != null).map(p => [new Date(p.date).getTime(), p.sma50])
    const sma200Data = data.ratio_series.filter(p => p.sma200 != null).map(p => [new Date(p.date).getTime(), p.sma200])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 300 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: { ...hcTheme.yAxis, title: { text: 'Stock / Index Ratio', style: { color: '#8898aa' } } },
      series: [
        {
          type: 'area',
          name: 'Ratio',
          data: ratioData,
          color: '#4f9cf9',
          fillColor: {
            linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
            stops: [
              [0, 'rgba(79,156,249,0.2)'],
              [1, 'rgba(79,156,249,0.02)'],
            ],
          },
          lineWidth: 1.5,
          marker: { enabled: false },
        },
        {
          type: 'line',
          name: 'SMA 50',
          data: sma50Data,
          color: '#f0b429',
          lineWidth: 1.5,
          dashStyle: 'ShortDash',
          marker: { enabled: false },
        },
        {
          type: 'line',
          name: 'SMA 200',
          data: sma200Data,
          color: '#ab47bc',
          lineWidth: 2,
          dashStyle: 'ShortDash',
          marker: { enabled: false },
        },
      ],
      legend: { ...hcTheme.legend, enabled: true },
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          return `<b>${Highcharts.dateFormat('%b %d, %Y', Number(this.x))}</b><br/>Ratio: <b>${Number(this.y).toFixed(4)}</b>`
        },
      },
    }
  }, [data])

  if (loading) {
    return (
      <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (!data) return null

  const { stats } = data
  const statusColor = stats.status === 'Outperforming' ? '#22c55e' : stats.status === 'Underperforming' ? '#ef5350' : '#f0b429'

  return (
    <Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
        <Typography variant="h6" sx={{ fontWeight: 700 }}>Stock vs Market (Equal-Weight NIFTY)</Typography>
        <Chip
          label={stats.status}
          size="small"
          sx={{ bgcolor: `${statusColor}20`, color: statusColor, fontWeight: 700 }}
        />
      </Box>
      <Stack direction="row" spacing={2} mb={3} flexWrap="wrap">
        <StatCard label="Current Ratio" value={stats.current_ratio.toFixed(4)} accent="primary" />
        <StatCard
          label="1Y Ratio Change"
          value={`${stats.ratio_change_1y > 0 ? '+' : ''}${stats.ratio_change_1y.toFixed(2)}%`}
          accent={stats.ratio_change_1y > 0 ? 'success' : 'error'}
        />
        <StatCard label="vs Market" value={stats.status} accent={stats.status === 'Outperforming' ? 'success' : stats.status === 'Underperforming' ? 'error' : 'secondary'} />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}
