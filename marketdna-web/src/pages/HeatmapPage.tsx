import { useState, useEffect, useCallback, useMemo } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import { useNavigate } from 'react-router-dom'
import Highcharts from 'highcharts/highstock'
import HighchartsTreemapModule from 'highcharts/modules/treemap'
import HighchartsReact from 'highcharts-react-official'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { sectorHeatmapApi } from '../api/sectorHeatmapApi'
import { SectorHeatmapResponse } from '../types/sector_heatmap'

HighchartsTreemapModule(Highcharts)

// ─── Constants ────────────────────────────────────────────────────────────────

const TFS = ['1d', '5d', '1m', '3m', '6m', '1y', '2y'] as const
type TF = typeof TFS[number]
const TF_LABELS: Record<TF, string> = {
  '1d': '1D', '5d': '5D', '1m': '1M', '3m': '3M', '6m': '6M', '1y': '1Y', '2y': '2Y',
}

type ViewKey = 'fno-stocks' | 'fno-sectors' | 'nifty50' | 'nifty500-sectors'

const VIEWS: { key: ViewKey; label: string; universe: string; grouped: boolean; desc: string }[] = [
  { key: 'fno-stocks',       label: 'F&O Stocks',       universe: 'fno',      grouped: false, desc: 'Every F&O-eligible stock, one tile each' },
  { key: 'fno-sectors',      label: 'F&O Sectorwise',   universe: 'fno',      grouped: true,  desc: 'F&O stocks grouped by sector' },
  { key: 'nifty50',          label: 'Nifty 50',         universe: 'nifty50',  grouped: false, desc: 'All 50 index constituents, one tile each' },
  { key: 'nifty500-sectors', label: 'Nifty 500 Sectors',universe: 'nifty500', grouped: true,  desc: 'Nifty 500 universe grouped by sector' },
]

// NSE cash market hours: 9:15–15:30 IST, Mon–Fri
function isMarketOpenIST(): boolean {
  const ist = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = ist.getDay()
  if (day === 0 || day === 6) return false
  const mins = ist.getHours() * 60 + ist.getMinutes()
  return mins >= 555 && mins <= 930
}

// ─── Colour helpers ────────────────────────────────────────────────────────────

function hexToRgb(hex: string) {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function mixHex(a: string, b: string, t: number): string {
  const pa = hexToRgb(a)
  const pb = hexToRgb(b)
  const r = Math.round(pa.r + (pb.r - pa.r) * t)
  const g = Math.round(pa.g + (pb.g - pa.g) * t)
  const bl = Math.round(pa.b + (pb.b - pa.b) * t)
  return `rgb(${r},${g},${bl})`
}

function heatColor(ret: number, maxAbs: number, mode: 'light' | 'dark'): string {
  const neutral = mode === 'dark' ? '#334155' : '#cbd5e1'
  const target = ret >= 0 ? '#22c55e' : '#ef4444'
  const t = maxAbs > 0 ? Math.min(Math.abs(ret) / maxAbs, 1) : 0
  return mixHex(neutral, target, t)
}

function hexWithAlpha(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex)
  return `rgba(${r},${g},${b},${alpha})`
}

// ─── View / TF selector pills ──────────────────────────────────────────────────

function Pills<T extends string>({
  options, value, onChange, labelOf, CYAN, INK3,
}: {
  options: readonly T[]
  value: T
  onChange: (v: T) => void
  labelOf: (v: T) => string
  CYAN: string
  INK3: string
}) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {options.map(opt => {
        const active = opt === value
        return (
          <Box
            key={opt}
            onClick={() => onChange(opt)}
            sx={{
              px: 1.5, py: 0.5, borderRadius: 1, cursor: 'pointer',
              border: '1px solid', borderColor: active ? CYAN : 'divider',
              bgcolor: active ? `${CYAN}18` : 'transparent',
              transition: 'all 0.15s',
              '&:hover': { borderColor: CYAN },
            }}
          >
            <Typography sx={{
              fontFamily: "'IBM Plex Mono', monospace",
              fontSize: '0.7rem', fontWeight: 700,
              color: active ? CYAN : INK3,
            }}>
              {labelOf(opt)}
            </Typography>
          </Box>
        )
      })}
    </Box>
  )
}

// ─── Series builder ─────────────────────────────────────────────────────────────

function buildTreemapData(
  resp: SectorHeatmapResponse,
  tf: TF,
  grouped: boolean,
  mode: 'light' | 'dark',
): any[] {
  const allRets: number[] = []
  for (const sec of resp.sectors) {
    for (const st of sec.stocks) allRets.push(st.returns[tf] ?? 0)
  }
  const maxAbs = allRets.length ? Math.max(...allRets.map(v => Math.abs(v)), 1) : 1

  const points: any[] = []

  if (!grouped) {
    for (const sec of resp.sectors) {
      for (const st of sec.stocks) {
        const ret = st.returns[tf] ?? 0
        points.push({
          id: st.symbol,
          name: st.symbol,
          value: 1,
          color: heatColor(ret, maxAbs, mode),
          custom: { ret, fullName: st.name, symbol: st.symbol },
        })
      }
    }
    return points
  }

  for (const sec of resp.sectors) {
    if (!sec.stocks.length) continue
    points.push({
      id: `sec__${sec.name}`,
      name: sec.name,
      color: hexWithAlpha(sec.color, mode === 'dark' ? 0.16 : 0.1),
      borderColor: sec.color,
      custom: { isGroup: true },
    })
    for (const st of sec.stocks) {
      const ret = st.returns[tf] ?? 0
      points.push({
        id: `${sec.name}__${st.symbol}`,
        parent: `sec__${sec.name}`,
        name: st.symbol,
        value: 1,
        color: heatColor(ret, maxAbs, mode),
        custom: { ret, fullName: st.name, symbol: st.symbol },
      })
    }
  }
  return points
}

// ─── Treemap chart ──────────────────────────────────────────────────────────────

function HeatmapTreemap({
  data, grouped, height, BORDER, PAPER2, INK,
}: {
  data: any[]
  grouped: boolean
  height: number
  BORDER: string
  PAPER2: string
  INK: string
}) {
  const navigate = useNavigate()

  const options: Highcharts.Options = useMemo(() => ({
    chart: {
      backgroundColor: 'transparent',
      height,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
      animation: false,
    },
    title: { text: undefined },
    credits: { enabled: false },
    tooltip: {
      useHTML: true,
      backgroundColor: PAPER2,
      borderColor: BORDER,
      style: { fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.72rem', color: INK },
      formatter: function (this: any) {
        const p = this.point
        if (p.custom?.isGroup) return `<b>${p.name}</b>`
        const ret = p.custom?.ret ?? 0
        const sign = ret > 0 ? '+' : ''
        return `<b>${p.custom?.symbol}</b> &mdash; ${p.custom?.fullName}<br/>Return: <b>${sign}${ret.toFixed(2)}%</b>`
      },
    },
    series: [{
      type: 'treemap',
      layoutAlgorithm: 'squarified',
      animation: false,
      data,
      borderColor: BORDER,
      levels: grouped
        ? [
            {
              level: 1,
              layoutAlgorithm: 'squarified',
              borderWidth: 3,
              borderColor: BORDER,
              dataLabels: {
                enabled: true,
                align: 'left',
                verticalAlign: 'top',
                x: 4, y: 4,
                style: {
                  fontFamily: "'IBM Plex Sans', sans-serif",
                  fontSize: '0.68rem',
                  fontWeight: '800',
                  color: INK,
                  textOutline: 'none',
                },
              },
            },
            {
              level: 2,
              borderWidth: 1,
              dataLabels: {
                enabled: true,
                style: {
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '0.62rem',
                  fontWeight: '700',
                  color: '#fff',
                  textOutline: '1px #000000',
                },
                formatter: function (this: any) {
                  const ret = this.point.custom?.ret ?? 0
                  const sign = ret > 0 ? '+' : ''
                  return `${this.point.name}<br/>${sign}${ret.toFixed(1)}%`
                },
              },
            },
          ]
        : [
            {
              level: 1,
              borderWidth: 1,
              dataLabels: {
                enabled: true,
                style: {
                  fontFamily: "'IBM Plex Mono', monospace",
                  fontSize: '0.68rem',
                  fontWeight: '700',
                  color: '#fff',
                  textOutline: '1px #000000',
                },
                formatter: function (this: any) {
                  const ret = this.point.custom?.ret ?? 0
                  const sign = ret > 0 ? '+' : ''
                  return `${this.point.name}<br/>${sign}${ret.toFixed(1)}%`
                },
              },
            },
          ],
      point: {
        events: {
          click: function (this: any) {
            const sym = this.custom?.symbol
            if (sym) navigate(`/stock/${sym}`)
          },
        },
      },
    } as any],
  }), [data, grouped, height, BORDER, PAPER2, INK, navigate])

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ─── Legend ─────────────────────────────────────────────────────────────────────

function GradientLegend({ maxAbs, mode, INK3 }: { maxAbs: number; mode: 'light' | 'dark'; INK3: string }) {
  const neutral = mode === 'dark' ? '#334155' : '#cbd5e1'
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
      <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', color: INK3 }}>
        -{maxAbs.toFixed(1)}%
      </Typography>
      <Box sx={{
        width: 160, height: 10, borderRadius: 1,
        background: `linear-gradient(90deg, #ef4444 0%, ${neutral} 50%, #22c55e 100%)`,
      }} />
      <Typography sx={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: '0.62rem', color: INK3 }}>
        +{maxAbs.toFixed(1)}%
      </Typography>
    </Box>
  )
}

// ─── Page ───────────────────────────────────────────────────────────────────────

export default function HeatmapPage() {
  const { INK, INK3, CYAN, BG, PAPER, PAPER2, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [activeView, setActiveView] = useState<ViewKey>('fno-stocks')
  const [tf, setTf] = useState<TF>('1d')
  const [cache, setCache] = useState<Record<string, SectorHeatmapResponse>>({})
  const [loadingUniverse, setLoadingUniverse] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const view = VIEWS.find(v => v.key === activeView)!

  const fetchUniverse = useCallback(async (universe: string, { background = false } = {}) => {
    if (!background) setLoadingUniverse(universe)
    setError(null)
    try {
      const result = await sectorHeatmapApi.getHeatmap(universe)
      setCache(prev => ({ ...prev, [universe]: result }))
    } catch (e: any) {
      if (!background) setError(e.message || 'Failed to load heatmap')
    } finally {
      if (!background) setLoadingUniverse(null)
    }
  }, [])

  useEffect(() => {
    if (!cache[view.universe]) fetchUniverse(view.universe)
  }, [view.universe, cache, fetchUniverse])

  useEffect(() => {
    const id = setInterval(() => {
      if (isMarketOpenIST()) fetchUniverse(view.universe, { background: true })
    }, 60_000)
    return () => clearInterval(id)
  }, [view.universe, fetchUniverse])

  const data = cache[view.universe]
  const isLoading = loadingUniverse === view.universe && !data

  const treemapData = useMemo(
    () => (data ? buildTreemapData(data, tf, view.grouped, mode) : []),
    [data, tf, view.grouped, mode],
  )

  const maxAbsRet = useMemo(() => {
    if (!data) return 1
    const vals: number[] = []
    for (const sec of data.sectors) for (const st of sec.stocks) vals.push(Math.abs(st.returns[tf] ?? 0))
    return vals.length ? Math.max(...vals, 0.5) : 1
  }, [data, tf])

  const stockCount = useMemo(() => (data ? data.sectors.reduce((n, s) => n + s.stocks.length, 0) : 0), [data])

  const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" }
  const MONO = { fontFamily: "'IBM Plex Mono', monospace" }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        pt: 10, pb: 4, px: { xs: 2, md: 4 },
      }}>
        <Box sx={{
          display: 'inline-flex', alignItems: 'center', gap: 1,
          border: `1px solid ${CYAN}44`, borderRadius: 2,
          px: 1.5, py: 0.4, mb: 2, bgcolor: `${CYAN}0A`,
        }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, animation: 'pulse 2s infinite', '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.4 } } }} />
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: CYAN, fontWeight: 700, letterSpacing: '0.1em' }}>
            MARKET HEATMAP
          </Typography>
        </Box>

        <Typography variant="h4" sx={{ ...SANS, fontWeight: 300, color: INK, mb: 0.5, lineHeight: 1.15 }}>
          Market <Box component="span" sx={{ fontWeight: 800 }}>Heatmap</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.85rem', color: INK3, mb: 3, maxWidth: 560 }}>
          {view.desc} — colour intensity scales with return magnitude relative to the strongest mover in view. Click any tile to open its Stock DNA page.
        </Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center' }}>
          <Pills options={VIEWS.map(v => v.key)} value={activeView} onChange={setActiveView} labelOf={(k) => VIEWS.find(v => v.key === k)!.label} CYAN={CYAN} INK3={INK3} />
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignItems: 'center', mt: 1.5 }}>
          <Pills options={TFS} value={tf} onChange={setTf} labelOf={(t) => TF_LABELS[t]} CYAN={CYAN} INK3={INK3} />
          {data && (
            <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
              {stockCount} stocks · as of {new Date(data.as_of).toLocaleString('en-IN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: 'short' })}
            </Typography>
          )}
        </Box>
      </Box>

      {/* Main content */}
      <Box sx={{ px: { xs: 1, md: 4 }, pb: 6 }}>
        <Box sx={{ ...CARD, p: 0, overflow: 'hidden' }}>
          {isLoading && (
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 2, py: 10 }}>
              <CircularProgress size={22} sx={{ color: CYAN }} />
              <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3 }}>
                Computing returns…
              </Typography>
            </Box>
          )}

          {error && !isLoading && (
            <Box sx={{ py: 6, textAlign: 'center' }}>
              <Typography sx={{ ...SANS, fontSize: '0.85rem', color: '#ef4444', mb: 1 }}>{error}</Typography>
              <Box
                onClick={() => fetchUniverse(view.universe)}
                sx={{ display: 'inline-block', px: 2, py: 0.75, border: `1px solid ${CYAN}`, borderRadius: 1, cursor: 'pointer' }}
              >
                <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN }}>Retry</Typography>
              </Box>
            </Box>
          )}

          {!isLoading && !error && data && (
            treemapData.length > 0 ? (
              <HeatmapTreemap
                data={treemapData}
                grouped={view.grouped}
                height={view.grouped ? 680 : 560}
                BORDER={BORDER}
                PAPER2={PAPER2}
                INK={INK}
              />
            ) : (
              <Box sx={{ py: 6, textAlign: 'center' }}>
                <Typography sx={{ ...SANS, fontSize: '0.82rem', color: INK3 }}>No stocks found for this view.</Typography>
              </Box>
            )
          )}
        </Box>

        {/* Legend */}
        {data && (
          <Box sx={{
            display: 'flex', gap: 3, flexWrap: 'wrap', alignItems: 'center',
            px: 2, py: 1.25, mt: 2, bgcolor: PAPER, borderRadius: 2, border: '1px solid', borderColor: BORDER,
          }}>
            <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, color: INK3 }}>
              {TF_LABELS[tf]} return
            </Typography>
            <GradientLegend maxAbs={maxAbsRet} mode={mode} INK3={INK3} />
          </Box>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
