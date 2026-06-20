import React, { useState, useEffect, useMemo } from 'react'
import {
  Box, Typography, Chip, CircularProgress, Alert,
  Table, TableBody, TableCell, TableHead, TableRow,
  OutlinedInput, InputAdornment,
} from '@mui/material'
import { AgGridReact } from 'ag-grid-react'
import type { ColDef, ICellRendererParams } from 'ag-grid-community'
import { ModuleRegistry, AllCommunityModule, themeQuartz } from 'ag-grid-community'
import Highcharts from 'highcharts'
import HighchartsMore from 'highcharts/highcharts-more'
import HighchartsReact from 'highcharts-react-official'

HighchartsMore(Highcharts)
ModuleRegistry.registerModules([AllCommunityModule])

import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { optionsApi } from '../api/optionsApi'
import type { EMScanRow, EMHistoryRow, EMScanResponse } from '../types/options'
import { hcTheme } from '../theme'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

function fmt(n: number, d = 0) {
  return n.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })
}

// ── Cell Renderers (use CSS vars set on the wrapper Box) ─────────────────────

type P<T = unknown> = ICellRendererParams<EMScanRow, T>

function TickerRenderer({ data }: P) {
  if (!data) return null
  return (
    <div style={{ lineHeight: 1.3, paddingTop: 4 }}>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontWeight: 700, fontSize: '0.78rem', color: 'var(--em-ink)' }}>
        {data.symbol}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.58rem', color: 'var(--em-ink3)' }}>
        ATM {fmt(data.atm_strike)} · {data.expiry}
      </div>
      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
        <span style={{
          padding: '1px 5px', borderRadius: 4,
          background: 'var(--em-cyan-bg)', border: '1px solid var(--em-cyan-bd)',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.56rem', color: 'var(--em-cyan)',
        }}>DTE {data.dte}d</span>
        <span style={{
          padding: '1px 5px', borderRadius: 4,
          background: 'var(--em-ink3-bg)', border: '1px solid var(--em-ink3-bd)',
          fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.56rem', color: 'var(--em-ink3)',
        }}>{data.days_in_series}d data</span>
      </div>
    </div>
  )
}

function MoneyRenderer({ value }: P<number>) {
  if (value == null) return <span style={{ color: 'var(--em-ink3)' }}>—</span>
  return <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', color: 'var(--em-ink)' }}>₹{fmt(value)}</span>
}

function FuturesRenderer({ data }: P) {
  if (!data) return null
  const chg = data.futures_chg_pct
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', color: 'var(--em-ink2)' }}>
        {data.futures_ltp != null ? `₹${fmt(data.futures_ltp)}` : '—'}
      </div>
      {chg != null && (
        <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.62rem', color: chg >= 0 ? '#22c55e' : '#ef4444' }}>
          {chg >= 0 ? '+' : ''}{chg.toFixed(2)}%
        </div>
      )}
    </div>
  )
}

function StraddleRenderer({ data }: P) {
  if (!data) return null
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.75rem', fontWeight: 600, color: '#a78bfa' }}>
        ₹{fmt(data.straddle_premium, 1)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.58rem', color: 'var(--em-ink3)' }}>
        CE ₹{fmt(data.ce_ltp, 1)} + PE ₹{fmt(data.pe_ltp, 1)}
      </div>
    </div>
  )
}

function EMRenderer({ data }: P) {
  if (!data) return null
  const pct = data.spot > 0 ? (data.monthly_em / data.spot * 100) : 0
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.85rem', fontWeight: 800, color: '#a78bfa' }}>
        ±₹{fmt(data.monthly_em, 0)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.62rem', color: '#a78bfa', opacity: 0.8 }}>
        ±{pct.toFixed(2)}%
      </div>
    </div>
  )
}

function LowerBoundRenderer({ data }: P) {
  if (!data) return null
  const pct = data.spot > 0 ? (data.monthly_em / data.spot * 100) : 0
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444' }}>
        ₹{fmt(data.lower_bound)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.6rem', color: '#ef4444', opacity: 0.7 }}>
        −{pct.toFixed(1)}%
      </div>
    </div>
  )
}

function UpperBoundRenderer({ data }: P) {
  if (!data) return null
  const pct = data.spot > 0 ? (data.monthly_em / data.spot * 100) : 0
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', fontWeight: 600, color: '#22c55e' }}>
        ₹{fmt(data.upper_bound)}
      </div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.6rem', color: '#22c55e', opacity: 0.7 }}>
        +{pct.toFixed(1)}%
      </div>
    </div>
  )
}

function CEWallRenderer({ value }: P<number>) {
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444' }}>₹{fmt(value ?? 0)}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.58rem', color: 'var(--em-ink3)' }}>Resistance</div>
    </div>
  )
}

function PEWallRenderer({ value }: P<number>) {
  return (
    <div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.72rem', fontWeight: 600, color: '#22c55e' }}>₹{fmt(value ?? 0)}</div>
      <div style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: '0.58rem', color: 'var(--em-ink3)' }}>Support</div>
    </div>
  )
}

function LowerWallBoolRenderer({ value }: P<boolean>) {
  const v = !!value
  const color = v ? '#22c55e' : '#ef4444'
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: `${color}18`, border: `1px solid ${color}35`,
      fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '0.6rem', fontWeight: 700, color,
    }}>
      {v ? '▲ Above' : '▼ Below'}
    </span>
  )
}

function UpperWallBoolRenderer({ value }: P<boolean>) {
  const v = !!value
  const color = v ? '#f59e0b' : 'var(--em-ink3)'
  return (
    <span style={{
      padding: '2px 6px', borderRadius: 4,
      background: `color-mix(in srgb, ${color} 12%, transparent)`,
      border: `1px solid color-mix(in srgb, ${color} 30%, transparent)`,
      fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '0.6rem', fontWeight: 700, color,
    }}>
      {v ? '⚡ Above' : '— Below'}
    </span>
  )
}

function DirRenderer({ value }: P<string>) {
  if (value === '↑') return <span style={{ color: '#22c55e', fontWeight: 700, fontSize: '0.95rem' }}>↑</span>
  if (value === '↓') return <span style={{ color: '#ef4444', fontWeight: 700, fontSize: '0.95rem' }}>↓</span>
  return <span style={{ color: 'var(--em-ink3)', fontSize: '0.8rem' }}>—</span>
}

function SignalRenderer({ data }: P) {
  if (!data) return null
  const { signal, signal_color } = data
  return (
    <span style={{
      padding: '2px 7px', borderRadius: 10,
      background: `${signal_color}20`, border: `1px solid ${signal_color}40`,
      fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '0.6rem', fontWeight: 600, color: signal_color,
      whiteSpace: 'nowrap',
    }}>
      {signal}
    </span>
  )
}

// ── History detail panel ───────────────────────────────────────────────────────

function DirCell({ dir }: { dir: string }) {
  const { INK3 } = usePalette()
  if (dir === '↑') return <span style={{ color: '#22c55e', fontWeight: 700 }}>↑</span>
  if (dir === '↓') return <span style={{ color: '#ef4444', fontWeight: 700 }}>↓</span>
  return <span style={{ color: INK3 }}>—</span>
}

function BoolBadge({ value, trueLabel, falseLabel, trueColor, falseColor }: {
  value: boolean; trueLabel: string; falseLabel: string; trueColor: string; falseColor: string
}) {
  const color = value ? trueColor : falseColor
  return (
    <span style={{
      padding: '1px 5px', borderRadius: 4,
      background: `${color}18`, border: `1px solid ${color}35`,
      fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '0.6rem', fontWeight: 700, color,
    }}>
      {value ? trueLabel : falseLabel}
    </span>
  )
}

function EMRangeChart({ rows, todayDate }: { rows: EMHistoryRow[]; todayDate: string }) {
  const { INK3, CYAN } = usePalette()

  const sorted = useMemo(() => [...rows].sort((a, b) => a.date.localeCompare(b.date)), [rows])

  const options = useMemo((): Highcharts.Options => {
    const cats = sorted.map(r => r.date)
    const todayIdx = cats.indexOf(todayDate)

    return {
      ...hcTheme,
      chart: { ...hcTheme.chart, height: 340 },
      title: { text: '' },
      xAxis: {
        ...hcTheme.xAxis,
        categories: cats,
        labels: {
          ...hcTheme.xAxis.labels,
          rotation: -45,
          step: Math.max(1, Math.ceil(cats.length / 8)),
        },
        plotBands: todayIdx >= 0 ? [{
          from: todayIdx - 0.5,
          to: todayIdx + 0.5,
          color: `${CYAN}12`,
          label: {
            text: 'Today',
            style: { color: CYAN, fontSize: '9px', fontWeight: '700', fontFamily: 'IBM Plex Sans, sans-serif' },
            y: 14,
          },
        }] : [],
      },
      yAxis: {
        ...hcTheme.yAxis,
        title: { text: '₹ Price', style: { color: INK3, fontFamily: 'IBM Plex Sans, sans-serif', fontSize: '11px' } },
        labels: { ...hcTheme.yAxis.labels, formatter: function() { return '₹' + Number(this.value).toLocaleString('en-IN', { maximumFractionDigits: 0 }) } },
      },
      legend: { ...hcTheme.legend, enabled: true },
      tooltip: {
        ...hcTheme.tooltip,
        shared: true,
        formatter: function(this: Highcharts.TooltipFormatterContextObject) {
          const idx = this.points?.[0]?.point?.x as number ?? -1
          const r = sorted[idx]
          if (!r) return ''
          const lines = [`<b>${r.date}${r.date === todayDate ? ' (Today)' : ''}</b>`]
          lines.push(`<span style="color:#a78bfa">■</span> EM Range: ₹${fmt(r.lower_bound)} – ₹${fmt(r.upper_bound)}`)
          lines.push(`<span style="color:${CYAN}">●</span> Spot/ATM: ₹${fmt(r.spot)}`)
          if (r.futures_ltp != null) lines.push(`<span style="color:#f59e0b">●</span> Futures: ₹${fmt(r.futures_ltp)}`)
          return lines.join('<br/>')
        },
      },
      plotOptions: {
        columnrange: { borderWidth: 0, borderRadius: 3, pointWidth: 10 },
        scatter: { marker: { radius: 5, symbol: 'circle' } },
        spline: { lineWidth: 2, marker: { enabled: true, radius: 7, symbol: 'circle', lineWidth: 2 } },
      },
      series: [
        {
          type: 'columnrange',
          name: 'EM Range',
          data: sorted.map(r => ({ low: r.lower_bound, high: r.upper_bound })),
          color: '#a78bfa',
          opacity: 0.55,
          zIndex: 1,
        },
        {
          type: 'scatter',
          name: 'Spot / ATM',
          data: sorted.map(r => r.spot),
          color: CYAN,
          zIndex: 3,
          marker: { radius: 5, symbol: 'circle' },
        },
        {
          type: 'spline',
          name: 'Futures LTP',
          data: sorted.map(r => r.futures_ltp ?? null),
          color: '#f59e0b',
          lineWidth: 2,
          zIndex: 2,
          marker: {
            radius: 7,
            symbol: 'circle',
            lineWidth: 2,
            lineColor: '#f59e0b',
            fillColor: '#f59e0b35',
          },
        },
      ] as Highcharts.SeriesOptionsType[],
    }
  }, [sorted, todayDate, CYAN, INK3])

  return (
    <Box sx={{ mt: 1.5, mb: 0.5 }}>
      <HighchartsReact highcharts={Highcharts} options={options} />
    </Box>
  )
}

function HistoryPanel({ row, date }: { row: EMScanRow; date: string }) {
  const { INK, INK2, INK3, CYAN } = usePalette()
  const { TH, TD, CARD } = useTokens()

  const todayRow: EMHistoryRow = {
    date,
    spot: row.spot,
    atm_strike: row.atm_strike,
    expiry: row.expiry,
    dte: row.dte,
    ce_ltp: row.ce_ltp,
    pe_ltp: row.pe_ltp,
    futures_ltp: row.futures_ltp,
    futures_chg_pct: row.futures_chg_pct,
    straddle_premium: row.straddle_premium,
    monthly_em: row.monthly_em,
    lower_bound: row.lower_bound,
    upper_bound: row.upper_bound,
    ce_wall: row.ce_wall,
    pe_wall: row.pe_wall,
    lower_above_pe_wall: row.lower_above_pe_wall,
    upper_above_ce_wall: row.upper_above_ce_wall,
    ce_direction: row.ce_direction,
    pe_direction: row.pe_direction,
    futures_direction: row.futures_direction,
    signal: row.signal,
    signal_color: row.signal_color,
  }

  const allRows = [todayRow, ...row.history]

  return (
    <Box sx={{ ...CARD, mt: 2, mb: 1 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: CYAN }} />
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: INK, ...SANS }}>
          {row.symbol} — Historical Data
        </Typography>
        <Typography sx={{ fontSize: '0.68rem', color: INK3, ml: 'auto', ...MONO }}>
          {row.days_in_series} trading day{row.days_in_series !== 1 ? 's' : ''} of data
        </Typography>
      </Box>

      <EMRangeChart rows={allRows} todayDate={date} />

      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small">
          <TableHead>
            <TableRow>
              {['Date','Spot','Fut LTP','Straddle','Monthly EM','Lower','Upper',
                'CE Wall','PE Wall','Price>PE Wall','Price>CE Wall','CE OI','PE OI','Fut','Signal'].map(h => (
                <TableCell key={h} sx={{ ...TH, py: 0.5 }}>{h}</TableCell>
              ))}
            </TableRow>
          </TableHead>
          <TableBody>
            {allRows.map((r, idx) => {
              const isToday = idx === 0
              const rowSx = isToday
                ? { background: `${CYAN}0A`, '& td': { borderBottom: `1px solid ${CYAN}30` } }
                : { '&:last-child td': { border: 0 } }
              return (
                <TableRow key={r.date + idx} sx={rowSx}>
                  {/* Date + ATM strike + expiry/DTE — mirrors TickerRenderer */}
                  <TableCell sx={{ ...TD, lineHeight: 1.3, paddingTop: '6px', paddingBottom: '6px' }}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontWeight: 700, fontSize: '0.72rem', color: isToday ? CYAN : INK }}>
                      {r.date}
                      {isToday && (
                        <span style={{
                          marginLeft: 5, padding: '1px 5px', borderRadius: 4,
                          background: `${CYAN}20`, border: `1px solid ${CYAN}40`,
                          fontSize: '0.55rem', fontWeight: 700, color: CYAN,
                        }}>TODAY</span>
                      )}
                    </div>
                    {r.atm_strike != null && (
                      <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.6rem', color: INK3 }}>
                        ATM {fmt(r.atm_strike)} · {r.expiry ?? '—'}
                      </div>
                    )}
                    {r.dte != null && (
                      <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                        <span style={{
                          padding: '1px 5px', borderRadius: 4,
                          background: `${CYAN}18`, border: `1px solid ${CYAN}30`,
                          fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.56rem', color: CYAN,
                        }}>DTE {r.dte}d</span>
                      </div>
                    )}
                  </TableCell>
                  <TableCell sx={TD}><span style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.68rem', color: INK }}>₹{fmt(r.spot)}</span></TableCell>
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.68rem', color: INK2 }}>{r.futures_ltp != null ? `₹${fmt(r.futures_ltp)}` : '—'}</div>
                    {r.futures_chg_pct != null && (
                      <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.6rem', color: r.futures_chg_pct >= 0 ? '#22c55e' : '#ef4444' }}>
                        {r.futures_chg_pct >= 0 ? '+' : ''}{r.futures_chg_pct.toFixed(2)}%
                      </div>
                    )}
                  </TableCell>
                  {/* Straddle — mirrors StraddleRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', fontWeight: 600, color: '#a78bfa' }}>
                      ₹{fmt(r.straddle_premium, 1)}
                    </div>
                    {r.ce_ltp != null && r.pe_ltp != null && (
                      <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.58rem', color: INK3 }}>
                        CE ₹{fmt(r.ce_ltp, 1)} + PE ₹{fmt(r.pe_ltp, 1)}
                      </div>
                    )}
                  </TableCell>
                  {/* Monthly EM — mirrors EMRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.82rem', fontWeight: 800, color: '#a78bfa' }}>±₹{fmt(r.monthly_em, 0)}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.62rem', color: '#a78bfa', opacity: 0.8 }}>
                      ±{r.spot > 0 ? (r.monthly_em / r.spot * 100).toFixed(2) : '0.00'}%
                    </div>
                  </TableCell>
                  {/* Spot − EM — mirrors LowerBoundRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444' }}>₹{fmt(r.lower_bound)}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.6rem', color: '#ef4444', opacity: 0.7 }}>
                      −{r.spot > 0 ? (r.monthly_em / r.spot * 100).toFixed(1) : '0.0'}%
                    </div>
                  </TableCell>
                  {/* Spot + EM — mirrors UpperBoundRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', fontWeight: 600, color: '#22c55e' }}>₹{fmt(r.upper_bound)}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.6rem', color: '#22c55e', opacity: 0.7 }}>
                      +{r.spot > 0 ? (r.monthly_em / r.spot * 100).toFixed(1) : '0.0'}%
                    </div>
                  </TableCell>
                  {/* CE Wall — mirrors CEWallRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', fontWeight: 600, color: '#ef4444' }}>₹{fmt(r.ce_wall)}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.58rem', color: INK3 }}>Resistance</div>
                  </TableCell>
                  {/* PE Wall — mirrors PEWallRenderer */}
                  <TableCell sx={TD}>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.72rem', fontWeight: 600, color: '#22c55e' }}>₹{fmt(r.pe_wall)}</div>
                    <div style={{ fontFamily: 'IBM Plex Mono,monospace', fontSize: '0.58rem', color: INK3 }}>Support</div>
                  </TableCell>
                  <TableCell sx={TD}><BoolBadge value={r.lower_above_pe_wall} trueLabel="▲ Above" falseLabel="▼ Below" trueColor="#22c55e" falseColor="#ef4444" /></TableCell>
                  <TableCell sx={TD}><BoolBadge value={r.upper_above_ce_wall} trueLabel="⚡ Above" falseLabel="— Below" trueColor="#f59e0b" falseColor={INK3} /></TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'center' }}><DirCell dir={r.ce_direction} /></TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'center' }}><DirCell dir={r.pe_direction} /></TableCell>
                  <TableCell sx={{ ...TD, textAlign: 'center' }}><DirCell dir={r.futures_direction} /></TableCell>
                  <TableCell sx={TD}>
                    <span style={{
                      padding: '2px 6px', borderRadius: 8,
                      background: `${r.signal_color}20`, border: `1px solid ${r.signal_color}40`,
                      fontFamily: 'IBM Plex Sans,sans-serif', fontSize: '0.6rem', fontWeight: 600, color: r.signal_color,
                    }}>{r.signal}</span>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  )
}

// ── Main Page ─────────────────────────────────────────────────────────────────

export default function ExpectedMovePage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()

  const [data, setData] = useState<EMScanResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [signalFilter, setSignalFilter] = useState('All')
  const [selectedRow, setSelectedRow] = useState<EMScanRow | null>(null)
  const [searchText, setSearchText] = useState('')

  useEffect(() => {
    optionsApi.getEMScan()
      .then(setData)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const signals = useMemo(() => {
    if (!data) return ['All']
    const s = new Set(data.rows.map(r => r.signal))
    return ['All', ...Array.from(s).sort()]
  }, [data])

  const rowData = useMemo(() => {
    if (!data) return []
    let rows = signalFilter === 'All' ? data.rows : data.rows.filter(r => r.signal === signalFilter)
    if (searchText.trim()) {
      const q = searchText.trim().toLowerCase()
      rows = rows.filter(r => r.symbol.toLowerCase().includes(q))
    }
    return rows
  }, [data, signalFilter, searchText])

  const avgEM = useMemo(() => {
    if (!data || data.rows.length === 0) return 0
    const pcts = data.rows.filter(r => r.spot > 0).map(r => r.monthly_em / r.spot * 100)
    return pcts.reduce((a, b) => a + b, 0) / pcts.length
  }, [data])

  const gridTheme = useMemo(() =>
    themeQuartz.withParams({
      backgroundColor: PAPER,
      foregroundColor: INK,
      borderColor: BORDER,
      headerBackgroundColor: PAPER2,
      headerTextColor: INK3,
      rowHoverColor: `${CYAN}07`,
      selectedRowBackgroundColor: `${CYAN}10`,
      fontFamily: "'IBM Plex Sans', sans-serif",
      fontSize: 12,
    }),
  [PAPER, INK, BORDER, PAPER2, INK3, CYAN])

  const colDefs = useMemo<ColDef<EMScanRow>[]>(() => [
    {
      field: 'symbol', headerName: 'Ticker', width: 155, pinned: 'left',
      cellRenderer: TickerRenderer, sortable: true,
    },
    {
      field: 'spot', headerName: 'Spot ₹', width: 95,
      cellRenderer: MoneyRenderer, sortable: true,
    },
    {
      field: 'futures_ltp', headerName: 'Futures', width: 115,
      cellRenderer: FuturesRenderer, sortable: true,
    },
    {
      field: 'straddle_premium', headerName: 'Straddle', width: 140,
      cellRenderer: StraddleRenderer, sortable: true,
    },
    {
      field: 'monthly_em', headerName: 'Monthly EM', width: 125,
      cellRenderer: EMRenderer, sortable: true, sort: 'desc',
      comparator: (_a, _b, nodeA, nodeB) => {
        const ap = nodeA.data && nodeA.data.spot > 0 ? nodeA.data.monthly_em / nodeA.data.spot : 0
        const bp = nodeB.data && nodeB.data.spot > 0 ? nodeB.data.monthly_em / nodeB.data.spot : 0
        return ap - bp
      },
    },
    {
      field: 'lower_bound', headerName: 'Spot − EM', width: 115,
      cellRenderer: LowerBoundRenderer, sortable: true,
    },
    {
      field: 'upper_bound', headerName: 'Spot + EM', width: 115,
      cellRenderer: UpperBoundRenderer, sortable: true,
    },
    {
      field: 'ce_wall', headerName: 'CE Wall', width: 110,
      cellRenderer: CEWallRenderer, sortable: true,
    },
    {
      field: 'pe_wall', headerName: 'PE Wall', width: 110,
      cellRenderer: PEWallRenderer, sortable: true,
    },
    {
      field: 'lower_above_pe_wall', headerName: 'Price > PE Wall', width: 115,
      cellRenderer: LowerWallBoolRenderer, sortable: true,
    },
    {
      field: 'upper_above_ce_wall', headerName: 'Price > CE Wall', width: 115,
      cellRenderer: UpperWallBoolRenderer, sortable: true,
    },
    {
      field: 'ce_direction', headerName: 'Call OI', width: 82,
      cellRenderer: DirRenderer, sortable: true,
      cellStyle: { textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    },
    {
      field: 'pe_direction', headerName: 'Put OI', width: 82,
      cellRenderer: DirRenderer, sortable: true,
      cellStyle: { textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    },
    {
      field: 'futures_direction', headerName: 'Fut Price', width: 85,
      cellRenderer: DirRenderer, sortable: true,
      cellStyle: { textAlign: 'center', display: 'flex', alignItems: 'center', justifyContent: 'center' },
    },
    {
      field: 'signal', headerName: 'Interpretation', width: 165,
      cellRenderer: SignalRenderer, sortable: true,
      cellStyle: { display: 'flex', alignItems: 'center' },
    },
  ] as ColDef<EMScanRow>[], [])

  const defaultColDef = useMemo<ColDef>(() => ({
    resizable: true,
    suppressMovable: false,
    cellStyle: { display: 'flex', alignItems: 'center' },
  }), [])

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  // CSS vars for cell renderers + AG Grid theme overrides
  const cssVars = {
    '--em-ink': INK,
    '--em-ink2': INK2,
    '--em-ink3': INK3,
    '--em-cyan': CYAN,
    '--em-border': BORDER,
    '--em-cyan-bg': `${CYAN}18`,
    '--em-cyan-bd': `${CYAN}30`,
    '--em-ink3-bg': `${INK3}12`,
    '--em-ink3-bd': `${INK3}25`,
    // AG Grid quartz CSS variable overrides
    '--ag-background-color': mode === 'dark' ? '#0D1B2E' : '#FFFFFF',
    '--ag-foreground-color': INK,
    '--ag-border-color': BORDER,
    '--ag-header-background-color': mode === 'dark' ? '#0A1628' : '#F8FAFC',
    '--ag-header-foreground-color': INK3,
    '--ag-row-hover-color': `${CYAN}08`,
    '--ag-selected-row-background-color': `${CYAN}12`,
    '--ag-odd-row-background-color': mode === 'dark' ? '#0A1220' : '#FAFBFC',
    '--ag-font-family': "'IBM Plex Sans', sans-serif",
    '--ag-font-size': '12px',
    '--ag-cell-horizontal-padding': '10px',
  } as React.CSSProperties

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroBg, pt: 11, pb: 4, px: { xs: 2, md: 6 } }}>
        <Box sx={{ maxWidth: 1600, mx: 'auto' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1.5, px: 1.5, py: 0.5, borderRadius: 2, bgcolor: `${CYAN}18`, border: `1px solid ${CYAN}40` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}` }} />
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', ...SANS }}>
              F&O Intelligence
            </Typography>
          </Box>
          <Typography variant="h3" sx={{ fontWeight: 900, color: INK, letterSpacing: '-0.03em', mb: 1, ...SANS }}>
            Expected <Box component="span" sx={{ color: CYAN }}>Move</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.9rem', color: INK3, maxWidth: 700, mb: 2.5, ...SANS }}>
            ATM straddle-implied move for every F&O symbol. Monthly EM = CE + PE premium at ATM.
            Click any row to expand historical data.
          </Typography>
          {data && (
            <Box sx={{ display: 'flex', gap: 2.5, flexWrap: 'wrap' }}>
              {[
                { label: 'Symbols', value: data.rows.length.toString(), color: CYAN },
                { label: 'Data Date', value: data.date, color: INK2 },
                { label: 'Avg Monthly EM', value: `±${avgEM.toFixed(2)}%`, color: '#a78bfa' },
              ].map(s => (
                <Box key={s.label} sx={{ display: 'flex', flexDirection: 'column' }}>
                  <Typography sx={{ fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', ...SANS }}>{s.label}</Typography>
                  <Typography sx={{ fontSize: '0.95rem', fontWeight: 700, color: s.color, ...MONO }}>{s.value}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </Box>
      </Box>

      {/* Body */}
      <Box sx={{ maxWidth: 1600, mx: 'auto', px: { xs: 1, md: 4 }, py: 3 }}>
        {loading && (
          <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}>
            <CircularProgress sx={{ color: CYAN }} />
          </Box>
        )}
        {error && <Alert severity="error" sx={{ mb: 2 }}>{error}</Alert>}

        {data && !loading && (
          <>
            {/* Search box */}
            <Box sx={{ mb: 1.5 }}>
              <OutlinedInput
                value={searchText}
                onChange={e => { setSearchText(e.target.value); setSelectedRow(null) }}
                placeholder="Search symbol…"
                size="small"
                sx={{ ...INPUT_SX, width: 220, height: 32, fontSize: '0.78rem', ...MONO }}
                startAdornment={
                  <InputAdornment position="start">
                    <Typography sx={{ fontSize: '0.75rem', color: INK3 }}>⌕</Typography>
                  </InputAdornment>
                }
              />
            </Box>

            {/* Filter chips */}
            <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 1.5 }}>
              {signals.map(s => (
                <Chip
                  key={s} label={s} size="small"
                  onClick={() => { setSignalFilter(s); setSelectedRow(null) }}
                  sx={{
                    fontSize: '0.65rem', height: 22,
                    bgcolor: signalFilter === s ? CYAN : 'transparent',
                    color: signalFilter === s ? '#000' : INK3,
                    border: `1px solid ${signalFilter === s ? CYAN : BORDER}`,
                    ...SANS, fontWeight: signalFilter === s ? 700 : 400, cursor: 'pointer',
                  }}
                />
              ))}
              <Typography sx={{ ml: 'auto', fontSize: '0.7rem', color: INK3, alignSelf: 'center', ...MONO }}>
                {rowData.length} symbols
              </Typography>
            </Box>

            {/* AG Grid */}
            <Box style={{ ...cssVars, height: 620, borderRadius: 12, overflow: 'hidden', border: `1px solid ${BORDER}` }}>
              <AgGridReact<EMScanRow>
                theme={gridTheme}
                rowData={rowData}
                columnDefs={colDefs}
                defaultColDef={defaultColDef}
                rowHeight={52}
                headerHeight={36}
                onRowClicked={e => {
                  if (!e.data) return
                  setSelectedRow(prev => prev?.symbol === e.data!.symbol ? null : e.data!)
                }}
                suppressCellFocus
                animateRows
                suppressMovableColumns={false}
              />
            </Box>

            {/* History detail panel */}
            {selectedRow && <HistoryPanel row={selectedRow} date={data.date} />}

            {/* Legend */}
            <Box sx={{ ...CARD, mt: 2 }}>
              <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1.5, ...SANS }}>
                Signal Key
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                {[
                  { label: 'Bullish Build-up',      color: '#22c55e', desc: 'CE OI ↓ + PE OI ↑' },
                  { label: 'Bearish Build-up',       color: '#ef4444', desc: 'CE OI ↑ + PE OI ↓' },
                  { label: 'Aggressive Long Build',  color: '#10b981', desc: 'Both OI ↑ + Fut ↑' },
                  { label: 'Aggressive Short Build', color: '#f97316', desc: 'Both OI ↑ + Fut ↓' },
                  { label: 'Short Covering',         color: '#60a5fa', desc: 'Both OI ↓ + Fut ↑' },
                  { label: 'Long Unwinding',         color: '#f59e0b', desc: 'Both OI ↓ + Fut ↓' },
                  { label: 'Neutral',                color: INK3, desc: 'No clear edge' },
                ].map(s => (
                  <Box key={s.label} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: s.color, flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.65rem', color: s.color, fontWeight: 600, ...SANS }}>{s.label}</Typography>
                    <Typography sx={{ fontSize: '0.62rem', color: INK3, ...SANS }}>({s.desc})</Typography>
                  </Box>
                ))}
              </Box>
            </Box>
          </>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
