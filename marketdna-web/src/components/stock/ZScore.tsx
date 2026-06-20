import { useEffect, useRef } from 'react'
import { Box, Typography, Chip, CircularProgress, Grid } from '@mui/material'
import Highcharts from 'highcharts'
import type { ZScoreResponse, ZScoreZoneStats } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: ZScoreResponse | null; loading: boolean }

function zColor(z: number, ink3: string): string {
  if (z > 2.5) return '#ef4444'
  if (z > 1.5) return '#f97316'
  if (z < -2.5) return '#22c55e'
  if (z < -1.5) return '#4ade80'
  return ink3
}

function zoneColor(zone: string, ink3: string): string {
  if (zone.includes('Below')) return '#22c55e'
  if (zone.includes('-2σ to')) return '#4ade80'
  if (zone === 'Neutral') return ink3
  if (zone.includes('+1σ to')) return '#f97316'
  return '#ef4444'
}

function ZoneRow({ stat }: { stat: ZScoreZoneStats }) {
  const { BORDER, INK3 } = usePalette()
  const barColor = zoneColor(stat.zone, INK3)
  const retColor = stat.avg_fwd_21d > 0 ? '#22c55e' : '#ef4444'
  const barW = Math.min(100, Math.abs(stat.avg_fwd_21d) * 4)

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, py: 0.75 }}>
      <Box sx={{ minWidth: 110 }}>
        <Typography variant="caption" sx={{ color: barColor, fontWeight: 700, fontSize: '0.75rem' }}>
          {stat.zone}
        </Typography>
      </Box>
      <Box sx={{ flex: 1 }}>
        <Box sx={{ height: 6, borderRadius: 3, bgcolor: BORDER, overflow: 'hidden' }}>
          <Box sx={{ height: '100%', width: `${barW}%`, borderRadius: 3, bgcolor: retColor }} />
        </Box>
      </Box>
      <Box sx={{ minWidth: 48, textAlign: 'right' }}>
        <Typography variant="caption" sx={{ fontWeight: 800, color: retColor, fontSize: '0.7rem' }}>
          {stat.avg_fwd_21d > 0 ? '+' : ''}{stat.avg_fwd_21d.toFixed(1)}%
        </Typography>
      </Box>
      <Box sx={{ minWidth: 52, textAlign: 'right' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem' }}>
          {stat.pct_positive_21d.toFixed(0)}% pos
        </Typography>
      </Box>
      <Box sx={{ minWidth: 36, textAlign: 'right' }}>
        <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem' }}>
          n={stat.count}
        </Typography>
      </Box>
    </Box>
  )
}

function ZScoreChart({ series }: { series: ZScoreResponse['series'] }) {
  const { BORDER, INK3 } = usePalette()
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!ref.current || !series.length) return

    const chartData = series.map(p => [new Date(p.date).getTime(), p.zscore])

    const chart = Highcharts.chart(ref.current, {
      chart: {
        type: 'line',
        backgroundColor: 'transparent',
        height: 180,
        margin: [10, 8, 32, 40],
        animation: false,
      },
      title: { text: undefined },
      credits: { enabled: false },
      legend: { enabled: false },
      xAxis: {
        type: 'datetime',
        labels: { style: { color: INK3, fontSize: '9px' } },
        lineColor: BORDER,
        tickColor: BORDER,
      },
      yAxis: {
        title: { text: undefined },
        labels: { style: { color: INK3, fontSize: '9px' }, format: '{value}σ' },
        gridLineColor: BORDER,
        plotLines: [
          { value: 2.5,  color: '#ef444460', width: 1, dashStyle: 'Dash' },
          { value: 1.5,  color: '#f9731660', width: 1, dashStyle: 'Dash' },
          { value: 0,    color: INK3,        width: 1 },
          { value: -1.5, color: '#4ade8060', width: 1, dashStyle: 'Dash' },
          { value: -2.5, color: '#22c55e60', width: 1, dashStyle: 'Dash' },
        ],
        plotBands: [
          { from: -2.5, to: -1.5, color: 'rgba(34,197,94,0.06)' },
          { from: -1.5, to: -2.5, color: 'rgba(34,197,94,0.03)' },
          { from:  1.5, to:  2.5, color: 'rgba(239,68,68,0.06)' },
          { from:  2.5, to:  99,  color: 'rgba(239,68,68,0.1)'  },
        ],
      },
      tooltip: {
        backgroundColor: '#1e293b',
        borderColor: BORDER,
        style: { color: '#f1f5f9', fontSize: '11px' },
        xDateFormat: '%d %b %Y',
        pointFormat: '<b>{point.y:.2f}σ</b>',
      },
      series: [{
        type: 'line',
        data: chartData,
        color: '#3b82f6',
        lineWidth: 1.5,
        marker: { enabled: false },
      }],
    } as Highcharts.Options)

    return () => chart.destroy()
  }, [series, INK3, BORDER])

  return <div ref={ref} />
}

export default function ZScore({ data, loading }: Props) {
  const { BORDER, PAPER2, INK3 } = usePalette()
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>Computing Z-Score series…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const c = zColor(data.current_zscore, INK3)

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#60A5FA', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Mean Reversion · 252-day Rolling
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: `linear-gradient(135deg, #FFFFFF 30%, ${INK3} 100%)`, WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text', mb: 0.5, display: 'block' }}>
        Z-Score Mean Reversion
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK3, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        How many standard deviations is the current price from its 1-year mean — and what historically followed each extreme?
      </Typography>

      <Grid container spacing={3}>
        {/* Left: current reading + chart */}
        <Grid item xs={12} md={7}>
          {/* Current reading */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
            <Box>
              <Typography sx={{ ...MONO, fontSize: '3rem', fontWeight: 900, color: c, lineHeight: 1 }}>
                {data.current_zscore > 0 ? '+' : ''}{data.current_zscore.toFixed(2)}
                <Typography component="span" sx={{ ...MONO, fontSize: '1.2rem', fontWeight: 700, color: c }}>σ</Typography>
              </Typography>
            </Box>
            <Box>
              <Chip label={data.interpretation} size="small"
                sx={{ bgcolor: `${c}18`, color: c, fontWeight: 700, fontSize: '0.7rem', mb: 0.75 }} />
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>
                252d mean: ₹{data.price_mean_252d.toFixed(0)}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block' }}>
                252d std: ₹{data.price_std_252d.toFixed(0)}
              </Typography>
            </Box>
          </Box>

          {/* Z-Score chart */}
          <Box sx={{ borderRadius: 2, border: `1px solid ${BORDER}`, overflow: 'hidden', bgcolor: PAPER2 }}>
            <ZScoreChart series={data.series} />
          </Box>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5, px: 1 }}>
            <Typography variant="caption" sx={{ color: '#22c55e60', fontSize: '0.55rem' }}>−2.5σ threshold</Typography>
            <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.55rem' }}>Blue = Z-Score · Dashes = ±1.5 / ±2.5σ bands</Typography>
            <Typography variant="caption" sx={{ color: '#ef444460', fontSize: '0.55rem' }}>+2.5σ threshold</Typography>
          </Box>
        </Grid>

        {/* Right: zone backtest */}
        <Grid item xs={12} md={5}>
          <Typography variant="overline" sx={{ color: 'text.secondary', fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
            Historical avg 21d return by Z-Score zone
          </Typography>
          <Box sx={{ p: 1.5, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
            {data.zone_stats.map(s => <ZoneRow key={s.zone} stat={s} />)}
          </Box>
          <Typography variant="caption" sx={{ color: 'text.secondary', fontSize: '0.75rem', display: 'block', mt: 1.5, lineHeight: 1.6 }}>
            Each row shows the average 21-day return and % positive when the Z-Score was in that zone.
            Negative Z-Score zones historically show mean reversion — higher avg returns.
          </Typography>
        </Grid>
      </Grid>
    </Box>
  )
}
