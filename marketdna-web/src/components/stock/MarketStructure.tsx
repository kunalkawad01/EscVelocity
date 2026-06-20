import { useMemo } from 'react'
import { Box, Typography, Stack, Chip, CircularProgress } from '@mui/material'
import HighchartsReact from 'highcharts-react-official'
import Highcharts from 'highcharts'
import type { RegimeResponse } from '../../types/stock'
import { hcTheme } from '../../theme'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

interface Props { data: RegimeResponse | null; loading: boolean }

const REGIME_COLOR: Record<string, string> = {
  'Super Bull': '#22c55e',
  'Bull':       '#4ade80',
  'Neutral':    '#f59e0b',
  'Bear':       '#ef4444',
}

const REGIME_SCORE: Record<string, number> = {
  'Bear': 0, 'Neutral': 1, 'Bull': 2, 'Super Bull': 3,
}

export default function MarketStructure({ data, loading }: Props) {
  const { INK, INK2, INK3, BORDER } = usePalette()

  const options = useMemo((): Highcharts.Options => {
    if (!data?.timeline.length) return {}

    const slice = data.timeline.slice(-252)
    const regimeData = slice.map(p => [
      new Date(p.date).getTime(),
      REGIME_SCORE[p.regime] ?? 0,
    ])

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 180 },
      title: { text: '' },
      xAxis: { ...hcTheme.xAxis, type: 'datetime' },
      yAxis: {
        ...hcTheme.yAxis,
        title: { text: '' },
        min: -0.5, max: 3.5,
        tickPositions: [0, 1, 2, 3],
        labels: {
          style: { color: INK3, fontSize: '10px' },
          formatter: function (this: Highcharts.AxisLabelsFormatterContextObject) {
            const map: Record<number, string> = { 0: 'Bear', 1: 'Neutral', 2: 'Bull', 3: 'S.Bull' }
            return map[this.value as number] ?? ''
          },
        },
      },
      series: [{
        type: 'area',
        name: 'Regime',
        data: regimeData,
        color: REGIME_COLOR[data.stats.current_regime] ?? INK3,
        fillColor: {
          linearGradient: { x1: 0, y1: 0, x2: 0, y2: 1 },
          stops: [
            [0, `${REGIME_COLOR[data.stats.current_regime] ?? INK3}33`],
            [1, `${REGIME_COLOR[data.stats.current_regime] ?? INK3}05`],
          ],
        },
        lineWidth: 2,
        marker: { enabled: false },
        step: 'left',
      }],
      legend: { enabled: false },
      tooltip: {
        ...hcTheme.tooltip,
        formatter: function (this: Highcharts.TooltipFormatterContextObject) {
          const regimes = ['Bear', 'Neutral', 'Bull', 'Super Bull']
          return `<b>${Highcharts.dateFormat('%b %d, %Y', Number(this.x))}</b><br/>Regime: <b>${regimes[Number(this.y) ?? 0]}</b>`
        },
      },
    }
  }, [data, INK3])

  if (loading) {
    return (
      <Box sx={{ height: 300, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <CircularProgress size={28} />
      </Box>
    )
  }
  if (!data) return null

  const { stats } = data
  const color = REGIME_COLOR[stats.current_regime] ?? INK3
  const prevColor = REGIME_COLOR[stats.prev_regime] ?? INK3

  return (
    <Box>
      <Typography sx={{ ...COND, fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: INK3, textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Regime Intelligence
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Market Structure
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        SMA-based regime classification — the foundational context (Bear / Neutral / Bull / Super Bull) that frames all other analysis on this page
      </Typography>

      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={3} mb={3} alignItems={{ sm: 'flex-start' }}>
        <Box sx={{ flex: 1, p: 2.5, borderRadius: 2, border: `1px solid ${color}33`, background: `${color}0a` }}>
          <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', mb: 0.5 }}>
            Current Regime
          </Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '2.25rem', fontWeight: 800, color, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
            {stats.current_regime}
          </Typography>
          <Typography sx={{ mt: 0.5, display: 'block', fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.72rem', color: 'text.secondary' }}>
            <Typography component="span" sx={{ ...MONO, fontSize: '0.8rem', fontWeight: 700, color }}>{stats.days_in_regime}</Typography>
            {' '}days in this regime
          </Typography>
        </Box>

        <Stack spacing={2} flex={1}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Previous Regime
            </Typography>
            <Chip label={stats.prev_regime} size="small" sx={{ bgcolor: `${prevColor}15`, color: prevColor, fontWeight: 700, fontFamily: "'IBM Plex Sans', sans-serif" }} />
          </Box>

          <Box>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
              <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Regime Strength
              </Typography>
              <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 700, color }}>
                {stats.regime_strength}%
              </Typography>
            </Box>
            <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER }}>
              <Box sx={{ height: '100%', width: `${stats.regime_strength}%`, borderRadius: 2, bgcolor: color, transition: 'width 0.8s ease' }} />
            </Box>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.6875rem', color: 'text.secondary' }}>
              % of last 20 sessions in same regime
            </Typography>
          </Box>
        </Stack>

        <Box sx={{ flex: 1 }}>
          <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', mb: 1 }}>
            Regime Scale
          </Typography>
          <Stack spacing={0.75}>
            {['Super Bull', 'Bull', 'Neutral', 'Bear'].map(r => {
              const isActive = r === stats.current_regime
              const desc = r === 'Super Bull' ? 'Price above all 4 SMAs' : r === 'Bull' ? 'Price above 3 SMAs' : r === 'Neutral' ? 'Price above 2 SMAs' : 'Price below 3+ SMAs'
              return (
                <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: REGIME_COLOR[r], flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.75rem', fontWeight: isActive ? 700 : 500, color: isActive ? REGIME_COLOR[r] : 'text.secondary', lineHeight: 1.2 }}>
                      {r}
                    </Typography>
                    <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.65rem', color: 'text.secondary', opacity: isActive ? 1 : 0.7 }}>
                      {desc}
                    </Typography>
                  </Box>
                </Box>
              )
            })}
          </Stack>
        </Box>
      </Stack>

      {data.timeline.length > 0 && (
        <Box>
          <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: 'text.secondary', textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', mb: 1 }}>
            Regime Timeline — 1 Year
          </Typography>
          <HighchartsReact highcharts={Highcharts} options={options} />
        </Box>
      )}
    </Box>
  )
}
