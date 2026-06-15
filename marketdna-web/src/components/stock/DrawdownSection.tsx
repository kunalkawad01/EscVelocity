import { useMemo } from 'react'
import { Box, Typography, Stack, CircularProgress } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { DrawdownResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import StatCard from './StatCard'

interface Props { data: DrawdownResponse | null; loading: boolean }

const INK    = '#F2EDE4'
const INK2   = '#8B95AC'
const INK3   = '#5B6880'

export default function DrawdownSection({ data, loading }: Props) {
  const options = useMemo((): Highcharts.Options => {
    if (!data?.drawdowns.length) return {}
    const series = data.drawdowns.map(p => [new Date(p.date).getTime(), p.drawdown_pct])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 280 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: {
        ...hcTheme.yAxis,
        title: { text: 'Drawdown %', style: { color: INK3 } },
        max: 0,
        labels: { ...hcTheme.yAxis.labels, format: '{value}%' },
      },
      series: [{
        type: 'area',
        name: 'Drawdown',
        data: series,
        color: '#ef4444',
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, 'rgba(239,83,80,0.04)'],
            [1, 'rgba(239,83,80,0.35)'],
          ],
        },
        lineWidth: 1.5,
        marker: { enabled: false },
        threshold: 0,
      }],
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          return `<b>${Highcharts.dateFormat('%b %d, %Y', Number(this.x))}</b><br/>Drawdown: <b>${Number(this.y).toFixed(2)}%</b>`
        },
      },
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
  const uwPct = Math.round(stats.days_underwater / stats.total_days * 100)

  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Loss Architecture
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Drawdown Intelligence
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2, display: 'block', lineHeight: 1.5 }}>
        How far the stock falls from peak, how long it stays underwater, and how quickly it recovers — the three core dimensions of loss experience
      </Typography>
      <Stack direction="row" spacing={2} mb={3} flexWrap="wrap">
        <StatCard label="Current Drawdown" value={`${stats.current_drawdown.toFixed(2)}%`} accent={stats.current_drawdown < -15 ? 'error' : stats.current_drawdown < -5 ? 'secondary' : 'success'} />
        <StatCard label="Max Drawdown" value={`${stats.max_drawdown.toFixed(2)}%`} accent="error" />
        <StatCard label="Avg Drawdown" value={`${stats.avg_drawdown.toFixed(2)}%`} accent="default" />
        <StatCard label="Avg Recovery" value={`${stats.avg_recovery_days}d`} sub="trough to peak" accent="default" />
        <StatCard label="Time Underwater" value={`${uwPct}%`} sub={`${stats.days_underwater} of ${stats.total_days} days`} accent="default" />
      </Stack>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}
