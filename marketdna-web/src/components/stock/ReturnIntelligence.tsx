import { useMemo } from 'react'
import { Box, Typography, Grid, CircularProgress, Stack } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { ReturnsResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import StatCard from './StatCard'
import { usePalette } from '../../hooks/usePalette'

const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: ReturnsResponse | null; loading: boolean }

function HistogramChart({ title, bins, stats, color, ink3 }: {
  title: string
  bins: { bin_start: number; bin_end: number; count: number }[]
  stats: { mean: number; median: number; std: number }
  color: string
  ink3: string
}) {
  const options = useMemo((): Highcharts.Options => ({
    ...hcTheme,
    chart: { ...hcTheme.chart, height: 220 },
    title: { text: '' },
    xAxis: { ...hcTheme.xAxis, title: { text: 'Return %', style: { color: ink3, fontSize: '10px' } } },
    yAxis: { ...hcTheme.yAxis, title: { text: 'Frequency', style: { color: ink3, fontSize: '10px' } } },
    series: [
      {
        type: 'column',
        name: title,
        data: bins.map(b => [parseFloat(((b.bin_start + b.bin_end) / 2).toFixed(3)), b.count]),
        color: `${color}cc`,
        borderWidth: 0,
        pointPadding: 0,
        groupPadding: 0,
      },
      {
        type: 'line',
        name: `Mean ${stats.mean.toFixed(2)}%`,
        data: [[stats.mean, 0], [stats.mean, Math.max(...bins.map(b => b.count))]],
        color: '#f59e0b',
        lineWidth: 1.5,
        dashStyle: 'ShortDash',
        marker: { enabled: false },
      },
    ],
    legend: { ...hcTheme.legend, enabled: true },
    tooltip: { ...hcTheme.tooltip, formatter: function (this: Highcharts.TooltipFormatterContextObject) {
      return `<b>${Number(this.x).toFixed(2)}%</b><br/>Count: <b>${this.y}</b>`
    }},
  }), [bins, stats, title, color, ink3])

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

function YearlyBarChart({ data, ink3 }: { data: ReturnsResponse; ink3: string }) {
  const options = useMemo((): Highcharts.Options => ({
    ...hcTheme,
    chart: { ...hcTheme.chart, height: 220 },
    title: { text: '' },
    xAxis: { ...hcTheme.xAxis, categories: data.yearly_returns.map(r => r.period) },
    yAxis: { ...hcTheme.yAxis, title: { text: 'Return %', style: { color: ink3, fontSize: '10px' } } },
    series: [{
      type: 'column',
      name: 'Yearly Return %',
      data: data.yearly_returns.map(r => ({
        y: r.return_pct,
        color: r.return_pct >= 0 ? '#22c55e' : '#ef4444',
      })),
      borderWidth: 0,
    }],
    legend: { enabled: false },
    tooltip: {
      ...hcTheme.tooltip,
      formatter: function (this: Highcharts.TooltipFormatterContextObject) {
        return `<b>${this.x}</b><br/>Return: <b>${Number(this.y) > 0 ? '+' : ''}${Number(this.y).toFixed(1)}%</b>`
      },
    },
  }), [data.yearly_returns, ink3])

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

export default function ReturnIntelligence({ data, loading }: Props) {
  const { INK, INK2, INK3 } = usePalette()

  if (loading) {
    return (
      <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={32} />
      </Box>
    )
  }
  if (!data) return null

  const { daily_stats: d } = data

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Distribution Analysis
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Return Intelligence
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 3, display: 'block', lineHeight: 1.5 }}>
        Full distribution of daily, weekly, and monthly returns — fat tails, skew, and outlier frequencies reveal the stock's true risk-reward character
      </Typography>

      <Stack direction="row" spacing={2} mb={3} flexWrap="wrap">
        <StatCard label="Mean Daily" value={`${d.mean > 0 ? '+' : ''}${d.mean.toFixed(3)}%`} accent={d.mean >= 0 ? 'success' : 'error'} />
        <StatCard label="Median Daily" value={`${d.median > 0 ? '+' : ''}${d.median.toFixed(3)}%`} accent={d.median >= 0 ? 'success' : 'error'} />
        <StatCard label="Std Dev" value={`${d.std.toFixed(3)}%`} accent="default" />
        <StatCard label="95th Pct" value={`+${d.p95.toFixed(2)}%`} accent="success" />
        <StatCard label="5th Pct" value={`${d.p5.toFixed(2)}%`} accent="error" />
        <StatCard label="Best Day" value={`+${d.max_val.toFixed(2)}%`} accent="success" />
        <StatCard label="Worst Day" value={`${d.min_val.toFixed(2)}%`} accent="error" />
      </Stack>

      <Grid container spacing={3}>
        <Grid item xs={12} md={4}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Daily Returns Distribution
          </Typography>
          <HistogramChart title="Daily Return %" bins={data.daily_histogram} stats={data.daily_stats} color="#4f9cf9" ink3={INK3} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Monthly Returns Distribution
          </Typography>
          <HistogramChart title="Monthly Return %" bins={data.monthly_histogram} stats={data.monthly_stats} color="#22c55e" ink3={INK3} />
        </Grid>
        <Grid item xs={12} md={4}>
          <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 700, color: 'text.secondary', mb: 1, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Yearly Returns
          </Typography>
          <YearlyBarChart data={data} ink3={INK3} />
        </Grid>
      </Grid>
    </Box>
  )
}
