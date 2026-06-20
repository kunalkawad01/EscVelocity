import { useState, useEffect, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Box, Typography, Select, MenuItem, OutlinedInput,
  Grid, CircularProgress, Alert, Table, TableBody,
  TableCell, TableHead, TableRow, TableSortLabel, FormControl,
  InputLabel, Chip,
} from '@mui/material'
import Highcharts from 'highcharts'
import HighchartsReact from 'highcharts-react-official'

import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import FilterChip from '../components/shared/FilterChip'
import SearchBox from '../components/shared/SearchBox'
import SectionHead from '../components/shared/SectionHead'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { optionsApi } from '../api/optionsApi'
import type { OIAnalysis, OIBuildupItem, StrikeData, ExpectedMoveHistory } from '../types/options'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmt(n: number, d = 0) { return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d }) }
function fmtOI(n: number) {
  if (n >= 1_00_00_000) return (n / 1_00_00_000).toFixed(1) + 'Cr'
  if (n >= 1_00_000) return (n / 1_00_000).toFixed(1) + 'L'
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'K'
  return String(n)
}

function StatChip({ label, value, color }: { label: string; value: string; color?: string }) {
  const { INK2, INK3, PAPER2, BORDER } = usePalette()
  return (
    <Box sx={{
      px: 2, py: 1, borderRadius: 2, border: `1px solid ${BORDER}`, bgcolor: PAPER2,
      display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 90,
    }}>
      <Typography sx={{ fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', ...SANS }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: color ?? INK2, ...MONO }}>
        {value}
      </Typography>
    </Box>
  )
}

// ── OI Butterfly Chart ────────────────────────────────────────────────────────

function OIButterflyChart({ data, spot, ceWall, peWall, maxPain }: {
  data: StrikeData[]
  spot: number
  ceWall: number
  peWall: number
  maxPain: number
}) {
  const { mode } = useThemeMode()
  const { INK, INK3, BORDER, PAPER, CYAN } = usePalette()

  const visible = useMemo(
    () => data.filter(s => s.ce_oi > 0 || s.pe_oi > 0).slice(-40),
    [data]
  )

  const categories = visible.map(s => fmt(s.strike))
  const ceVals = visible.map(s => -s.ce_oi)
  const peVals = visible.map(s => s.pe_oi)
  const atmIdx = visible.reduce((best, s, i) =>
    Math.abs(s.strike - spot) < Math.abs(visible[best].strike - spot) ? i : best, 0)

  const plotLines: Highcharts.YAxisPlotLinesOptions[] = [
    {
      value: atmIdx,
      color: CYAN,
      width: 1.5,
      dashStyle: 'Dash',
      label: { text: 'ATM', style: { color: CYAN, fontSize: '0.65rem' }, align: 'right' },
      zIndex: 5,
    },
  ]

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      backgroundColor: 'transparent',
      height: Math.max(320, visible.length * 14),
      animation: false,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    title: { text: '' },
    xAxis: {
      categories,
      reversed: false,
      labels: { style: { color: INK3, fontSize: '0.62rem', fontFamily: "'IBM Plex Mono', monospace" } },
      lineColor: BORDER,
      tickColor: BORDER,
      plotLines,
    },
    yAxis: {
      title: { text: '' },
      labels: {
        formatter() { return fmtOI(Math.abs(this.value as number)) },
        style: { color: INK3, fontSize: '0.62rem' },
      },
      gridLineColor: BORDER,
    },
    plotOptions: {
      bar: {
        groupPadding: 0,
        pointPadding: 0.05,
        borderWidth: 0,
        dataLabels: { enabled: false },
      },
    },
    series: [
      {
        type: 'bar',
        name: 'CE (Calls)',
        data: ceVals,
        color: '#ef4444',
        tooltip: { valueSuffix: ' contracts' },
      },
      {
        type: 'bar',
        name: 'PE (Puts)',
        data: peVals,
        color: '#22c55e',
        tooltip: { valueSuffix: ' contracts' },
      },
    ],
    tooltip: {
      shared: false,
      backgroundColor: PAPER,
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" },
      formatter() {
        const idx = (this.point as Highcharts.Point).index
        const s = visible[idx]
        const isCall = this.series.name.startsWith('CE')
        const oi = isCall ? s.ce_oi : s.pe_oi
        const chg = isCall ? s.ce_oi_change : s.pe_oi_change
        const iv = isCall ? s.ce_iv : s.pe_iv
        const ltp = isCall ? s.ce_ltp : s.pe_ltp
        const chgStr = chg !== null && chg !== undefined
          ? ` (${chg >= 0 ? '+' : ''}${fmtOI(chg)})` : ''
        const ivStr = iv !== null && iv !== undefined ? ` | IV ${iv.toFixed(1)}%` : ''
        return `<b>Strike ${fmt(s.strike)}</b><br/>${this.series.name}: ${fmtOI(oi)}${chgStr}${ivStr}<br/>LTP: ₹${ltp.toFixed(2)}`
      },
    },
    legend: {
      enabled: true,
      itemStyle: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    credits: { enabled: false },
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Max Pain Curve ────────────────────────────────────────────────────────────

function MaxPainChart({ data, maxPain, spot }: {
  data: { strike: number; total_pain: number }[]
  maxPain: number
  spot: number
}) {
  const { INK, INK3, BORDER, PAPER, CYAN } = usePalette()

  const options: Highcharts.Options = {
    chart: {
      type: 'line',
      backgroundColor: 'transparent',
      height: 260,
      animation: false,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    title: { text: '' },
    xAxis: {
      categories: data.map(p => fmt(p.strike)),
      labels: {
        step: Math.max(1, Math.floor(data.length / 10)),
        style: { color: INK3, fontSize: '0.62rem', fontFamily: "'IBM Plex Mono', monospace" },
      },
      lineColor: BORDER,
      tickColor: BORDER,
      plotLines: [
        {
          value: data.findIndex(p => p.strike === maxPain),
          color: '#fbbf24',
          width: 2,
          dashStyle: 'Dash',
          label: { text: `Max Pain ₹${fmt(maxPain)}`, style: { color: '#fbbf24', fontSize: '0.65rem' }, rotation: 0, y: 14 },
          zIndex: 5,
        },
        {
          value: data.findIndex(p => Math.abs(p.strike - spot) === Math.min(...data.map(d => Math.abs(d.strike - spot)))),
          color: CYAN,
          width: 1.5,
          dashStyle: 'Dot',
          label: { text: `Spot ₹${fmt(spot)}`, style: { color: CYAN, fontSize: '0.65rem' }, rotation: 0, y: 28 },
          zIndex: 5,
        },
      ],
    },
    yAxis: {
      title: { text: 'Option Buyer Payout (₹)', style: { color: INK3, fontSize: '0.65rem' } },
      labels: {
        formatter() { return fmtOI(this.value as number) },
        style: { color: INK3, fontSize: '0.62rem' },
      },
      gridLineColor: BORDER,
    },
    series: [
      {
        type: 'line',
        name: 'Total Pain',
        data: data.map(p => p.total_pain),
        color: '#a78bfa',
        lineWidth: 2,
        marker: { enabled: false },
      },
    ],
    tooltip: {
      backgroundColor: PAPER,
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" },
      formatter() {
        const idx = (this.point as Highcharts.Point).index
        const p = data[idx]
        return `<b>Strike ₹${fmt(p.strike)}</b><br/>Total payout: ${fmtOI(p.total_pain)}`
      },
    },
    legend: { enabled: false },
    credits: { enabled: false },
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── OI Change Bar sparkline ───────────────────────────────────────────────────

function OIChangeChart({ data }: { data: StrikeData[] }) {
  const { INK3, BORDER, PAPER } = usePalette()

  const visible = data.filter(s => s.ce_oi_change !== null || s.pe_oi_change !== null)
  if (visible.length === 0) return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.75rem', color: INK3 }}>
        OI change data available from 2nd trading day onwards
      </Typography>
    </Box>
  )

  const options: Highcharts.Options = {
    chart: {
      type: 'bar',
      backgroundColor: 'transparent',
      height: Math.max(280, visible.length * 12),
      animation: false,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    title: { text: '' },
    xAxis: {
      categories: visible.map(s => fmt(s.strike)),
      labels: { style: { color: INK3, fontSize: '0.6rem', fontFamily: "'IBM Plex Mono', monospace" } },
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      title: { text: '' },
      labels: {
        formatter() { return fmtOI(Math.abs(this.value as number)) },
        style: { color: INK3, fontSize: '0.6rem' },
      },
      gridLineColor: BORDER,
    },
    plotOptions: {
      bar: { groupPadding: 0.05, pointPadding: 0.1, borderWidth: 0, dataLabels: { enabled: false } },
    },
    series: [
      {
        type: 'bar',
        name: 'CE ΔOI',
        data: visible.map(s => -(s.ce_oi_change ?? 0)),
        color: '#ef4444',
      },
      {
        type: 'bar',
        name: 'PE ΔOI',
        data: visible.map(s => s.pe_oi_change ?? 0),
        color: '#22c55e',
      },
    ],
    tooltip: {
      shared: false,
      backgroundColor: PAPER,
      borderColor: BORDER,
      style: { color: '#f8fafc', fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" },
      formatter() {
        const idx = (this.point as Highcharts.Point).index
        const s = visible[idx]
        const isCall = this.series.name.startsWith('CE')
        const chg = isCall ? s.ce_oi_change : s.pe_oi_change
        return `<b>Strike ${fmt(s.strike)}</b><br/>${this.series.name}: ${chg !== null && chg !== undefined ? (chg >= 0 ? '+' : '') + fmtOI(chg) : 'N/A'}`
      },
    },
    legend: {
      enabled: true,
      itemStyle: { color: '#cbd5e1', fontSize: '0.72rem' },
    },
    credits: { enabled: false },
  }

  return <HighchartsReact highcharts={Highcharts} options={options} />
}

// ── Expected Move Chart ───────────────────────────────────────────────────────

function ExpectedMoveChart({ symbol }: { symbol: string }) {
  const { INK, INK2, INK3, BORDER, PAPER, PAPER2, CYAN } = usePalette()
  const [data, setData] = useState<ExpectedMoveHistory | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!symbol) return
    setLoading(true)
    setError('')
    optionsApi.getExpectedMove(symbol)
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [symbol])

  if (loading) return (
    <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
      <CircularProgress size={28} sx={{ color: CYAN }} />
    </Box>
  )
  if (error) return <Alert severity="error" sx={{ fontSize: '0.75rem' }}>{error}</Alert>
  if (!data || data.history.length === 0) return (
    <Box sx={{ py: 4, textAlign: 'center' }}>
      <Typography sx={{ fontSize: '0.75rem', color: INK3, ...SANS }}>No expected move data yet</Typography>
    </Box>
  )

  const latest = data.history[data.history.length - 1]
  const dates  = data.history.map(p => p.date)

  const chartOptions: Highcharts.Options = {
    chart: {
      type: 'line',
      backgroundColor: 'transparent',
      height: 300,
      animation: false,
      style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    title: { text: '' },
    xAxis: {
      categories: dates,
      labels: {
        step: Math.max(1, Math.floor(dates.length / 8)),
        style: { color: INK3, fontSize: '0.62rem', fontFamily: "'IBM Plex Mono', monospace" },
      },
      lineColor: BORDER,
      tickColor: BORDER,
    },
    yAxis: {
      title: { text: 'Expected Move (%)', style: { color: INK3, fontSize: '0.65rem' } },
      labels: {
        formatter() { return (this.value as number).toFixed(1) + '%' },
        style: { color: INK3, fontSize: '0.62rem' },
      },
      gridLineColor: BORDER,
      min: 0,
    },
    series: [
      {
        type: 'line',
        name: 'Daily EM',
        data: data.history.map(p => p.daily_em_pct),
        color: '#60a5fa',
        lineWidth: 2,
        marker: { enabled: true, radius: 4, symbol: 'circle' },
        zIndex: 3,
      },
      {
        type: 'line',
        name: 'Weekly EM',
        data: data.history.map(p => p.weekly_em_pct),
        color: CYAN,
        lineWidth: 2,
        marker: { enabled: true, radius: 4, symbol: 'circle' },
        zIndex: 2,
      },
      {
        type: 'line',
        name: 'Monthly EM',
        data: data.history.map(p => p.monthly_em_pct),
        color: '#a78bfa',
        lineWidth: 2,
        dashStyle: 'Dash',
        marker: { enabled: true, radius: 4, symbol: 'circle' },
        zIndex: 1,
      },
    ],
    tooltip: {
      shared: true,
      backgroundColor: PAPER,
      borderColor: BORDER,
      style: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Mono', monospace" },
      formatter() {
        const idx = (this.points?.[0].point as Highcharts.Point).index
        const p = data.history[idx]
        const lines = [
          `<b>${p.date}</b>  DTE: ${p.dte}d  |  Spot: ₹${fmt(p.spot, 0)}`,
          `ATM Straddle: ₹${p.straddle_premium.toFixed(0)} (₹${p.ce_ltp.toFixed(0)} CE + ₹${p.pe_ltp.toFixed(0)} PE)`,
          `<span style="color:#60a5fa">● Daily EM:   ±₹${p.daily_em.toFixed(0)}  (±${p.daily_em_pct.toFixed(2)}%)</span>`,
          `<span style="color:${CYAN}">● Weekly EM:  ±₹${p.weekly_em.toFixed(0)}  (±${p.weekly_em_pct.toFixed(2)}%)</span>`,
          `<span style="color:#a78bfa">● Monthly EM: ±₹${p.monthly_em.toFixed(0)}  (±${p.monthly_em_pct.toFixed(2)}%)</span>`,
        ]
        return lines.join('<br/>')
      },
    },
    legend: {
      enabled: true,
      itemStyle: { color: INK, fontSize: '0.72rem', fontFamily: "'IBM Plex Sans', sans-serif" },
    },
    credits: { enabled: false },
  }

  // Today's EM breakout banner
  const rangeCard = (label: string, em: number, emPct: number, color: string) => (
    <Box key={label} sx={{
      flex: 1, minWidth: 110, px: 1.5, py: 1.2, borderRadius: 2,
      border: `1px solid ${color}40`, bgcolor: `${color}0D`,
      display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.3,
    }}>
      <Typography sx={{ fontSize: '0.58rem', color, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700, ...SANS }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '1rem', fontWeight: 800, color, ...MONO }}>
        ±{emPct.toFixed(2)}%
      </Typography>
      <Typography sx={{ fontSize: '0.65rem', color: INK3, ...MONO }}>
        ±₹{em.toFixed(0)}
      </Typography>
    </Box>
  )

  return (
    <Box>
      {/* Today's values */}
      <Box sx={{ display: 'flex', gap: 1.5, mb: 2.5, flexWrap: 'wrap' }}>
        {rangeCard('Daily EM', latest.daily_em, latest.daily_em_pct, '#60a5fa')}
        {rangeCard('Weekly EM', latest.weekly_em, latest.weekly_em_pct, CYAN)}
        {rangeCard('Monthly EM', latest.monthly_em, latest.monthly_em_pct, '#a78bfa')}
        <Box sx={{
          flex: 1, minWidth: 110, px: 1.5, py: 1.2, borderRadius: 2,
          border: `1px solid ${BORDER}`, bgcolor: PAPER2,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0.3,
        }}>
          <Typography sx={{ fontSize: '0.58rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.1em', ...SANS }}>
            Straddle
          </Typography>
          <Typography sx={{ fontSize: '1rem', fontWeight: 800, color: INK2, ...MONO }}>
            ₹{latest.straddle_premium.toFixed(0)}
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: INK3, ...MONO }}>
            DTE: {latest.dte}d · {latest.expiry}
          </Typography>
        </Box>
      </Box>

      <HighchartsReact highcharts={Highcharts} options={chartOptions} />

      {/* Formula note */}
      <Box sx={{ mt: 2, p: 1.5, borderRadius: 2, bgcolor: `${CYAN}08`, border: `1px solid ${CYAN}20` }}>
        <Typography sx={{ fontSize: '0.68rem', color: INK3, lineHeight: 1.7, ...SANS }}>
          <b style={{ color: INK2 }}>Formula:</b>{' '}
          Monthly EM = ATM Straddle (CE + PE premium).{' '}
          Weekly EM = Straddle × √(5/DTE).{' '}
          Daily EM = Straddle × √(1/DTE).{' '}
          DTE = business days to expiry. Represents the ±1σ move the market implies for that horizon.
        </Typography>
      </Box>
    </Box>
  )
}

// ── Scanner Table ─────────────────────────────────────────────────────────────

type SortField = 'symbol' | 'pcr' | 'atm_iv' | 'total_ce_oi' | 'total_pe_oi' | 'futures_chg_pct'

function ScannerTable({
  items,
  onSelect,
  selected,
}: {
  items: OIBuildupItem[]
  onSelect: (sym: string) => void
  selected: string
}) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()
  const { TH, TD } = useTokens()
  const navigate = useNavigate()
  const [sortField, setSortField] = useState<SortField>('pcr')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [signalFilter, setSignalFilter] = useState<string>('All')
  const [symSearch, setSymSearch] = useState('')

  const signals = ['All', 'Bullish Build-up', 'Bearish Build-up', 'Short Covering', 'Long Unwinding', 'Aggressive Long Build', 'Aggressive Short Build', 'Neutral']

  function handleSort(field: SortField) {
    if (field === sortField) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const sorted = useMemo(() => {
    const list = items
      .filter(i => signalFilter === 'All' || i.signal === signalFilter)
      .filter(i => !symSearch || i.symbol.toLowerCase().includes(symSearch.toLowerCase()))
    return [...list].sort((a, b) => {
      const av = a[sortField] ?? 0
      const bv = b[sortField] ?? 0
      if (typeof av === 'string') {
        return sortDir === 'asc' ? av.localeCompare(bv as string) : (bv as string).localeCompare(av)
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
  }, [items, sortField, sortDir, signalFilter, symSearch])

  return (
    <Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5, alignItems: 'center' }}>
        <SearchBox value={symSearch} onChange={setSymSearch} placeholder="Symbol…" width={110} />
        {signals.map(s => (
          <FilterChip
            key={s}
            label={s}
            value={s}
            current={signalFilter}
            onChange={setSignalFilter}
          />
        ))}
      </Box>
      <Box className="mdna-table-scroll">
        <Table size="small">
          <TableHead>
            <TableRow>
              {[
                ['symbol', 'Symbol'],
                ['pcr', 'PCR'],
                ['atm_iv', 'ATM IV%'],
                ['total_ce_oi', 'CE OI'],
                ['total_pe_oi', 'PE OI'],
                ['futures_chg_pct', 'Fut Chg%'],
              ].map(([field, label]) => (
                <TableCell key={field} sx={{ ...TH }}>
                  <TableSortLabel
                    active={sortField === field}
                    direction={sortField === field ? sortDir : 'asc'}
                    onClick={() => handleSort(field as SortField)}
                    sx={{ color: `${INK3} !important`, '& .MuiTableSortLabel-icon': { color: `${INK3} !important` } }}
                  >
                    {label}
                  </TableSortLabel>
                </TableCell>
              ))}
              <TableCell sx={{ ...TH }}>Signal</TableCell>
              <TableCell sx={{ ...TH }}>CE Wall / PE Wall</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {sorted.map(item => (
              <TableRow
                key={item.symbol}
                hover
                onClick={() => onSelect(item.symbol)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: selected === item.symbol ? `${CYAN}15` : 'transparent',
                  '&:hover': { bgcolor: `${CYAN}10` },
                }}
              >
                <TableCell sx={{ ...TD }}>
                  <Typography
                    onClick={e => { e.stopPropagation(); navigate(`/stock/${item.symbol}`) }}
                    sx={{ fontSize: '0.75rem', fontWeight: 700, color: selected === item.symbol ? CYAN : INK,
                      ...MONO, cursor: 'pointer', '&:hover': { color: CYAN }, transition: 'color 0.12s' }}
                  >
                    {item.symbol}
                  </Typography>
                  <Typography sx={{ fontSize: '0.62rem', color: INK3, ...MONO }}>
                    ₹{fmt(item.spot, 0)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{ ...MONO, fontSize: '0.75rem', fontWeight: 600,
                    color: item.pcr > 1.3 ? '#22c55e' : item.pcr < 0.7 ? '#ef4444' : INK2 }}>
                    {item.pcr.toFixed(2)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK2 }}>
                    {item.atm_iv !== null ? `${item.atm_iv.toFixed(1)}%` : '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{ ...MONO, fontSize: '0.72rem', color: '#ef4444' }}>
                    {fmtOI(item.total_ce_oi)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{ ...MONO, fontSize: '0.72rem', color: '#22c55e' }}>
                    {fmtOI(item.total_pe_oi)}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{
                    ...MONO, fontSize: '0.72rem', fontWeight: 600,
                    color: item.futures_chg_pct !== null
                      ? (item.futures_chg_pct >= 0 ? '#22c55e' : '#ef4444')
                      : INK3,
                  }}>
                    {item.futures_chg_pct !== null
                      ? `${item.futures_chg_pct >= 0 ? '+' : ''}${item.futures_chg_pct.toFixed(2)}%`
                      : '—'}
                  </Typography>
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Chip
                    label={item.signal}
                    size="small"
                    sx={{ fontSize: '0.62rem', height: 20, bgcolor: `${item.signal_color}22`, color: item.signal_color, border: `1px solid ${item.signal_color}44`, ...SANS }}
                  />
                </TableCell>
                <TableCell sx={{ ...TD }}>
                  <Typography sx={{ fontSize: '0.65rem', color: '#ef4444', ...MONO }}>
                    CE ₹{fmt(item.ce_wall)}{item.ce_wall_oi_change !== null ? ` (${item.ce_wall_oi_change >= 0 ? '+' : ''}${fmtOI(item.ce_wall_oi_change)})` : ''}
                  </Typography>
                  <Typography sx={{ fontSize: '0.65rem', color: '#22c55e', ...MONO }}>
                    PE ₹{fmt(item.pe_wall)}{item.pe_wall_oi_change !== null ? ` (${item.pe_wall_oi_change >= 0 ? '+' : ''}${fmtOI(item.pe_wall_oi_change)})` : ''}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function OptionsPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()

  const [selectedSymbol, setSelectedSymbol] = useState('')
  const [report, setReport] = useState<OIAnalysis | null>(null)
  const [reportLoading, setReportLoading] = useState(false)
  const [reportError, setReportError] = useState('')

  const [scannerData, setScannerData] = useState<OIBuildupItem[]>([])
  const [scannerDate, setScannerDate] = useState('')
  const [scannerLoading, setScannerLoading] = useState(true)
  const [scannerError, setScannerError] = useState('')

  const [activeChart, setActiveChart] = useState<'oi' | 'maxpain' | 'change' | 'expmove'>('oi')

  // Load scanner on mount
  useEffect(() => {
    setScannerLoading(true)
    optionsApi.getScanner()
      .then(res => {
        setScannerData(res.symbols)
        setScannerDate(res.date)
        if (res.symbols.length > 0 && !selectedSymbol) {
          setSelectedSymbol(res.symbols[0].symbol)
        }
      })
      .catch(e => setScannerError(e.message))
      .finally(() => setScannerLoading(false))
  }, [])

  // Load symbol detail when selection changes
  useEffect(() => {
    if (!selectedSymbol) return
    setReportLoading(true)
    setReportError('')
    setReport(null)
    optionsApi.getOIAnalysis(selectedSymbol)
      .then(setReport)
      .catch(e => setReportError(e.message))
      .finally(() => setReportLoading(false))
  }, [selectedSymbol])

  const symbolOptions = useMemo(() => scannerData.map(s => s.symbol), [scannerData])

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  const chartTabs = [
    { id: 'oi',       label: 'OI Butterfly' },
    { id: 'maxpain',  label: 'Max Pain Curve' },
    { id: 'change',   label: 'OI Change' },
    { id: 'expmove',  label: 'Expected Move' },
  ] as const

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroBg, pt: 11, pb: 5, px: { xs: 2, md: 6 } }}>
        <Box sx={{ maxWidth: 1280, mx: 'auto' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1.5, py: 0.5, borderRadius: 2, bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}40` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}` }} />
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', ...SANS }}>
              F&O Intelligence
            </Typography>
          </Box>

          <Typography variant="h3" sx={{ fontWeight: 900, color: INK, letterSpacing: '-0.03em', mb: 1, ...SANS }}>
            Options <Box component="span" sx={{ color: CYAN }}>OI Analysis</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: INK3, maxWidth: 600, mb: 3, ...SANS }}>
            Open interest distribution, max pain, CE/PE walls, and OI buildup signals across the F&O universe.
          </Typography>

          {/* Symbol Selector */}
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <FormControl size="small" sx={{ minWidth: 180 }}>
              <InputLabel sx={{ color: INK3, fontSize: '0.8rem' }}>Symbol</InputLabel>
              <Select
                value={selectedSymbol}
                onChange={e => setSelectedSymbol(e.target.value)}
                input={<OutlinedInput label="Symbol" sx={INPUT_SX} />}
                MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}` } } }}
                sx={{ ...MONO, fontSize: '0.85rem', color: INK }}
              >
                {symbolOptions.map(s => (
                  <MenuItem key={s} value={s} sx={{ fontSize: '0.8rem', ...MONO }}>{s}</MenuItem>
                ))}
              </Select>
            </FormControl>

            {scannerDate && (
              <Typography sx={{ fontSize: '0.7rem', color: INK3, ...MONO }}>
                Data: {scannerDate}
              </Typography>
            )}
          </Box>

          {/* Stats strip */}
          {report && (
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', mt: 2.5 }}>
              <StatChip label="Spot" value={`₹${fmt(report.spot, 0)}`} />
              <StatChip label="Max Pain" value={`₹${fmt(report.max_pain, 0)}`} color="#fbbf24" />
              <StatChip label="PCR" value={report.pcr.toFixed(2)}
                color={report.pcr > 1.3 ? '#22c55e' : report.pcr < 0.7 ? '#ef4444' : INK2} />
              <StatChip label="CE Wall" value={`₹${fmt(report.ce_wall, 0)}`} color="#ef4444" />
              <StatChip label="PE Wall" value={`₹${fmt(report.pe_wall, 0)}`} color="#22c55e" />
              {report.atm_iv !== null && <StatChip label="ATM IV" value={`${report.atm_iv.toFixed(1)}%`} color="#a78bfa" />}
              {report.basis_pct !== null && (
                <StatChip label="Basis" value={`${report.basis_pct >= 0 ? '+' : ''}${report.basis_pct.toFixed(2)}%`}
                  color={report.basis_pct >= 0 ? '#22c55e' : '#ef4444'} />
              )}
            </Box>
          )}
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2, md: 6 }, py: 4 }}>
        <Grid container spacing={2.5}>

          {/* Left: Charts */}
          <Grid item xs={12} lg={7}>
            <Box sx={{ ...CARD, mb: 3 }}>
              <SectionHead title={`OI Chain — ${selectedSymbol || '—'}`} accent="#6366f1" />

              {reportLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress size={32} sx={{ color: CYAN }} />
                </Box>
              )}
              {reportError && <Alert severity="error" sx={{ fontSize: '0.75rem', mb: 2 }}>{reportError}</Alert>}

              {report && !reportLoading && (
                <>
                  {/* Expiry badge */}
                  <Box sx={{ mb: 2, display: 'flex', gap: 1, alignItems: 'center' }}>
                    <Typography sx={{ fontSize: '0.7rem', color: INK3, ...SANS }}>Expiry:</Typography>
                    <Chip label={report.expiry} size="small" sx={{ fontSize: '0.65rem', height: 20, bgcolor: `${CYAN}18`, color: CYAN, ...MONO }} />
                    <Typography sx={{ fontSize: '0.7rem', color: INK3, ...SANS, ml: 1 }}>
                      {report.strikes.length} strikes · {fmtOI(report.total_ce_oi + report.total_pe_oi)} total OI
                    </Typography>
                  </Box>

                  {/* Chart tab selector */}
                  <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
                    {chartTabs.map(t => (
                      <Box
                        key={t.id}
                        onClick={() => setActiveChart(t.id)}
                        sx={{
                          px: 1.5, py: 0.5, borderRadius: 1.5, cursor: 'pointer',
                          bgcolor: activeChart === t.id ? CYAN : 'transparent',
                          border: `1px solid ${activeChart === t.id ? CYAN : BORDER}`,
                          fontSize: '0.7rem', fontWeight: 600,
                          color: activeChart === t.id ? '#000' : INK3,
                          ...SANS, userSelect: 'none',
                        }}
                      >
                        {t.label}
                      </Box>
                    ))}
                  </Box>

                  {activeChart === 'oi' && (
                    <OIButterflyChart
                      data={report.strikes}
                      spot={report.spot}
                      ceWall={report.ce_wall}
                      peWall={report.pe_wall}
                      maxPain={report.max_pain}
                    />
                  )}

                  {activeChart === 'maxpain' && (
                    <MaxPainChart
                      data={report.max_pain_curve}
                      maxPain={report.max_pain}
                      spot={report.spot}
                    />
                  )}

                  {activeChart === 'change' && (
                    <OIChangeChart data={report.strikes} />
                  )}

                  {activeChart === 'expmove' && (
                    <ExpectedMoveChart symbol={selectedSymbol} />
                  )}

                  {/* Interpretation callout — hidden for Expected Move tab */}
                  {activeChart !== 'expmove' && (
                    <Box sx={{ mt: 2.5, p: 1.5, borderRadius: 2, bgcolor: `${CYAN}0A`, border: `1px solid ${CYAN}25` }}>
                      <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6, ...SANS }}>
                        <b>CE Wall</b> at ₹{fmt(report.ce_wall, 0)} acts as resistance (heavy call writing). &nbsp;
                        <b>PE Wall</b> at ₹{fmt(report.pe_wall, 0)} acts as support (heavy put writing). &nbsp;
                        <b>Max Pain</b> at ₹{fmt(report.max_pain, 0)} is where option writers profit most on expiry
                        ({report.max_pain > report.spot ? 'above' : 'below'} current spot of ₹{fmt(report.spot, 0)}).
                      </Typography>
                    </Box>
                  )}
                </>
              )}
            </Box>
          </Grid>

          {/* Right: Scanner */}
          <Grid item xs={12} lg={5}>
            <Box sx={{ ...CARD, mb: 3 }}>
              <SectionHead title="F&O OI Buildup Scanner" accent="#10b981" />

              {scannerLoading && (
                <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}>
                  <CircularProgress size={32} sx={{ color: CYAN }} />
                </Box>
              )}
              {scannerError && <Alert severity="error" sx={{ fontSize: '0.75rem', mb: 2 }}>{scannerError}</Alert>}

              {!scannerLoading && scannerData.length > 0 && (
                <ScannerTable
                  items={scannerData}
                  onSelect={setSelectedSymbol}
                  selected={selectedSymbol}
                />
              )}

              {!scannerLoading && scannerData.length === 0 && !scannerError && (
                <Box sx={{ py: 4, textAlign: 'center' }}>
                  <Typography sx={{ fontSize: '0.8rem', color: INK3, ...SANS }}>
                    No options data found. Run the ingestion script first:
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: CYAN, mt: 1, ...MONO }}>
                    python -m ingestion.ingest_option_chain
                  </Typography>
                </Box>
              )}
            </Box>

            {/* Legend card */}
            <Box sx={{ ...CARD }}>
              <SectionHead title="Signal Guide" accent="#f59e0b" />
              {[
                { label: 'Bullish Build-up', color: '#22c55e', desc: 'CE OI ↓ + PE OI ↑ — resistance overhead easing, put support being added below. Classic bullish positioning.' },
                { label: 'Bearish Build-up', color: '#ef4444', desc: 'CE OI ↑ + PE OI ↓ — call writers loading resistance, put support being removed. Classic bearish positioning.' },
                { label: 'Short Covering', color: '#60a5fa', desc: 'CE OI ↓ + PE OI ↓ + futures ↑ — bears exiting as price rises. Mildly bullish momentum.' },
                { label: 'Long Unwinding', color: '#f59e0b', desc: 'CE OI ↓ + PE OI ↓ + futures ↓ — bulls exiting as price falls. Mildly bearish momentum.' },
                { label: 'Aggressive Long Build', color: '#10b981', desc: 'CE OI ↑ + PE OI ↑ + futures ↑ — new positions entering from both sides with bullish price action. High-commitment bullish.' },
                { label: 'Aggressive Short Build', color: '#f97316', desc: 'CE OI ↑ + PE OI ↑ + futures ↓ — new positions entering from both sides with bearish price action. High-commitment bearish.' },
                { label: 'Neutral', color: INK3, desc: 'Mixed or flat OI changes with no directional edge. PCR used as fallback on first ingestion day (PCR > 1.3 = bullish floor in Indian market).' },
              ].map(item => (
                <Box key={item.label} sx={{ display: 'flex', gap: 1.5, mb: 1.5, alignItems: 'flex-start' }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: item.color, mt: 0.4, flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: item.color, ...SANS }}>{item.label}</Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: INK3, ...SANS }}>{item.desc}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Grid>
        </Grid>
      </Box>

      <Footer />
    </Box>
  )
}
