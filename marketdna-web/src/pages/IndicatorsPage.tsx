import { useState, useRef, useMemo } from 'react'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import MarketRegimeDashboard from '../components/market/MarketRegimeDashboard'
import IndicatorEdgeLab from '../components/stock/IndicatorEdgeLab'
import EdgeSummaryTable from '../components/stock/EdgeSummaryTable'
import MaterialTable from '../components/MaterialTable'
import type { ColDef } from '../components/MaterialTable'
import SymbolAutocomplete from '../components/shared/SymbolAutocomplete'
import SearchBox from '../components/shared/SearchBox'
import SectionHead from '../components/shared/SectionHead'
import {
  Box, Typography, LinearProgress,
  Select, MenuItem, OutlinedInput, Tooltip, Grid,
} from '@mui/material'
import { indicatorsApi } from '../api/indicatorsApi'
import type { StockIndicators, IndicatorScanResult, IndicatorScanItem } from '../types/indicators'
import {
  SIGNAL_COLOR, RSI_SIGNAL_COLOR, TREND_COLOR, BB_SIGNAL_COLOR, MACD_COLOR,
} from '../types/indicators'

// ─── Theme ────────────────────────────────────────────────────────────────────

import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const CAVEAT  = { fontFamily: "'Caveat', cursive" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

// ─── Constants ────────────────────────────────────────────────────────────────


// (CARD, TH, TD, t1, t2, t3, INPUT_SX computed via useTokens() inside each component)

function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.875, py: 0.25, borderRadius: '6px',
      fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap' as const,
      color, bgcolor: `${color}1A`, border: `1px solid ${color}40`,
      letterSpacing: '0.04em',
    }}>
      {label}
    </Box>
  )
}

function RunBtn({ onClick, loading, label }: { onClick: () => void; loading: boolean; label: string }) {
  const { CYAN } = usePalette()
  return (
    <Box component="button" onClick={onClick} disabled={loading} sx={{
      px: 2.5, py: 0.875, borderRadius: '10px', fontSize: '0.78rem', fontWeight: 700,
      cursor: loading ? 'wait' : 'pointer',
      background: `linear-gradient(135deg, ${CYAN}, #0078A8)`,
      color: '#FFFFFF', border: 'none',
      opacity: loading ? 0.6 : 1,
      letterSpacing: '0.06em',
      boxShadow: `0 0 16px ${CYAN}40`,
      '&:hover:not(:disabled)': { boxShadow: `0 0 24px ${CYAN}70`, transform: 'translateY(-1px)' },
      transition: 'all 0.15s',
      ...JAKARTA,
    }}>
      {loading ? 'Loading…' : label}
    </Box>
  )
}


function StatRow({ label, value, valueColor }: { label: string; value: React.ReactNode; valueColor?: string }) {
  const { INK3, INK, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', py: 0.5,
      borderBottom: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>{label}</Typography>
      <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: valueColor ?? INK, ...JAKARTA }}>
        {value}
      </Typography>
    </Box>
  )
}

function PctTag({ v }: { v: number }) {
  const { INK3 } = usePalette()
  const c = v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : INK3
  return <Typography component="span" sx={{ fontSize: '0.65rem', color: c, ml: 0.5 }}>
    {v > 0 ? '+' : ''}{v.toFixed(1)}%
  </Typography>
}

function BbBar({ pct_b }: { pct_b: number }) {
  const { CYAN, BORDER, INK3 } = usePalette()
  const color = pct_b < 30 ? '#22c55e' : pct_b > 70 ? '#ef4444' : CYAN
  return (
    <Box sx={{ width: '100%', mt: 0.5 }}>
      <Box sx={{ position: 'relative', height: 4, borderRadius: 2, bgcolor: BORDER }}>
        <Box sx={{
          position: 'absolute', left: 0, height: '100%', borderRadius: 2,
          width: `${Math.max(0, Math.min(100, pct_b))}%`, bgcolor: color,
          boxShadow: `0 0 6px ${color}80`,
        }} />
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.25 }}>
        <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>Lower</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>Upper</Typography>
      </Box>
    </Box>
  )
}

function fmtVol(v: number): string {
  if (v >= 1e7) return `${(v / 1e7).toFixed(2)}Cr`
  if (v >= 1e5) return `${(v / 1e5).toFixed(2)}L`
  return v.toLocaleString('en-IN')
}

function fmtPrice(v: number): string {
  return `₹${v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

// ─── Market Scan section ──────────────────────────────────────────────────────

function ScanSection({ onSymbolSelect }: { onSymbolSelect: (s: string) => void }) {
  const { PAPER, PAPER2, INK, INK2, INK3, BORDER, CYAN, CARD, INPUT_SX } = useTokens()
  const [loading, setLoading]   = useState(false)
  const [fetched, setFetched]   = useState(false)
  const [error, setError]       = useState<string | null>(null)
  const [data, setData]         = useState<IndicatorScanResult | null>(null)
  const [filterSignal, setFilterSignal] = useState('All')
  const [filterRSI,    setFilterRSI]    = useState('All')
  const [filterMACD,   setFilterMACD]   = useState('All')
  const [filterTrend,  setFilterTrend]  = useState('All')
  const [searchStock,  setSearchStock]  = useState('')

  const runScan = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await indicatorsApi.scan()
      setData(res)
      setFetched(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  const rows: IndicatorScanItem[] = useMemo(() => (data?.items ?? []).filter(it => {
    if (filterSignal !== 'All' && it.overall_signal !== filterSignal) return false
    if (filterRSI    !== 'All' && it.rsi_signal     !== filterRSI)    return false
    if (filterMACD   !== 'All' && it.macd_crossover  !== filterMACD)  return false
    if (filterTrend  !== 'All' && it.trend_label     !== filterTrend) return false
    if (searchStock && !it.symbol.includes(searchStock.toUpperCase())) return false
    return true
  }).slice().sort((a, b) => b.signal_score - a.signal_score),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [data, filterSignal, filterRSI, filterMACD, filterTrend, searchStock])

  const scanColumns: ColDef<IndicatorScanItem>[] = useMemo(() => [
    {
      field: 'symbol',
      headerName: 'Symbol',
      width: 100,
      mono: true,
      renderCell: (v) => (
        <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 700, color: CYAN, fontFamily: "'IBM Plex Mono', monospace" }}>
          {String(v)}
        </Typography>
      ),
    },
    {
      field: 'price',
      headerName: 'Price',
      width: 90,
      align: 'right',
      type: 'number',
      mono: true,
      renderCell: (v) => (
        <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 500, color: INK2, fontFamily: "'IBM Plex Mono', monospace" }}>
          {fmtPrice(v as number)}
        </Typography>
      ),
    },
    {
      field: 'rsi14',
      headerName: 'RSI',
      width: 70,
      align: 'right',
      type: 'number',
      mono: true,
      renderCell: (v, row) => (
        <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 700, color: RSI_SIGNAL_COLOR[row.rsi_signal] ?? INK2, fontFamily: "'IBM Plex Mono', monospace" }}>
          {(v as number).toFixed(1)}
        </Typography>
      ),
    },
    {
      field: 'rsi_signal',
      headerName: 'RSI Signal',
      width: 110,
      sortable: false,
      renderCell: (v) => <Pill label={String(v)} color={RSI_SIGNAL_COLOR[String(v)] ?? INK2} />,
    },
    {
      field: 'macd_hist',
      headerName: 'MACD Hist',
      width: 100,
      align: 'right',
      type: 'number',
      mono: true,
      renderCell: (v) => {
        const n = v as number
        return (
          <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 700, color: n >= 0 ? '#22c55e' : '#ef4444', fontFamily: "'IBM Plex Mono', monospace" }}>
            {n >= 0 ? '▲' : '▼'} {Math.abs(n).toFixed(3)}
          </Typography>
        )
      },
    },
    {
      field: 'macd_crossover',
      headerName: 'MACD Cross',
      width: 110,
      sortable: false,
      renderCell: (v) => {
        const s = String(v)
        return s !== 'None'
          ? <Pill label={`⚡ ${s}`} color={MACD_COLOR[s] ?? INK2} />
          : <Typography component="span" sx={{ fontSize: '0.72rem', color: INK3 }}>—</Typography>
      },
    },
    {
      field: 'bb_pct_b',
      headerName: 'BB %B',
      width: 90,
      type: 'number',
      renderCell: (v, row) => (
        <Box>
          <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 500, color: BB_SIGNAL_COLOR[row.bb_signal] ?? INK2 }}>
            {(v as number).toFixed(1)}%
          </Typography>
          <BbBar pct_b={v as number} />
        </Box>
      ),
    },
    {
      field: 'atr_pct',
      headerName: 'ATR %',
      width: 72,
      align: 'right',
      type: 'number',
      mono: true,
      renderCell: (v) => (
        <Typography component="span" sx={{ fontSize: '0.72rem', color: INK3, fontFamily: "'IBM Plex Mono', monospace" }}>
          {(v as number).toFixed(2)}%
        </Typography>
      ),
    },
    {
      field: 'volume_ratio',
      headerName: 'Vol Ratio',
      width: 80,
      align: 'right',
      type: 'number',
      mono: true,
      renderCell: (v) => {
        const n = v as number
        return (
          <Typography component="span" sx={{ fontSize: '0.78rem', fontWeight: 500, color: n > 2 ? '#f59e0b' : INK2, fontFamily: "'IBM Plex Mono', monospace" }}>
            {n.toFixed(2)}×
          </Typography>
        )
      },
    },
    {
      field: 'trend_label',
      headerName: 'Trend',
      width: 110,
      sortable: false,
      renderCell: (v) => <Pill label={String(v)} color={TREND_COLOR[String(v)] ?? INK2} />,
    },
    {
      field: 'overall_signal',
      headerName: 'Signal',
      width: 100,
      sortable: false,
      renderCell: (v) => <Pill label={String(v)} color={SIGNAL_COLOR[String(v)] ?? INK2} />,
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [CYAN, INK2, INK3])

  const dist = data?.signal_distribution ?? {}

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <SectionHead title="Market Indicator Scan" accent="#6366f1" />
        <Box sx={{ ml: 'auto' }}>
          <RunBtn onClick={runScan} loading={loading} label="Run Scan" />
        </Box>
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2,
          bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '10px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {fetched && !error && data && (
        <>
          {/* Signal distribution */}
          <Box sx={{ display: 'flex', gap: 1.5, mb: 2, flexWrap: 'wrap', alignItems: 'center',
            p: 1.5, borderRadius: '10px', bgcolor: PAPER2, border: `1px solid ${BORDER}` }}>
            {['Strong Buy','Buy','Neutral','Sell','Strong Sell'].map(s => (
              <Box key={s} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: SIGNAL_COLOR[s], boxShadow: `0 0 6px ${SIGNAL_COLOR[s]}` }} />
                <Typography sx={{ fontSize: '0.65rem', color: INK2, ...JAKARTA }}>{s}</Typography>
                <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: SIGNAL_COLOR[s], ...JAKARTA }}>
                  {dist[s] ?? 0}
                </Typography>
              </Box>
            ))}
            <Typography sx={{ fontSize: '0.6rem', color: INK3, ml: 'auto', ...JAKARTA }}>
              {data.computed_at}
            </Typography>
          </Box>

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox value={searchStock} onChange={setSearchStock} placeholder="Symbol…" width={130} />
            <Select value={filterSignal} onChange={e => setFilterSignal(e.target.value as string)}
              input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
              sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
              <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK }}>All Signals</MenuItem>
              {['Strong Buy','Buy','Neutral','Sell','Strong Sell'].map(s => (
                <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: INK }}>{s}</MenuItem>
              ))}
            </Select>
            <Select value={filterRSI} onChange={e => setFilterRSI(e.target.value as string)}
              input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
              sx={{ minWidth: 140, ...INPUT_SX, bgcolor: PAPER2 }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
              <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK }}>All RSI</MenuItem>
              {['Oversold','Near Oversold','Neutral','Near Overbought','Overbought'].map(s => (
                <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: INK }}>{s}</MenuItem>
              ))}
            </Select>
            <Select value={filterMACD} onChange={e => setFilterMACD(e.target.value as string)}
              input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
              sx={{ minWidth: 120, ...INPUT_SX, bgcolor: PAPER2 }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
              <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK }}>All MACD</MenuItem>
              {['Bullish','Bearish','None'].map(s => (
                <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: INK }}>{s}</MenuItem>
              ))}
            </Select>
            <Select value={filterTrend} onChange={e => setFilterTrend(e.target.value as string)}
              input={<OutlinedInput sx={{ ...INPUT_SX, bgcolor: PAPER2 }} />}
              sx={{ minWidth: 140, ...INPUT_SX, bgcolor: PAPER2 }}
              MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, border: `1px solid ${BORDER}`, color: INK } } }}>
              <MenuItem value="All" sx={{ fontSize: '0.72rem', color: INK }}>All Trends</MenuItem>
              {['Fully Bullish','Mostly Bullish','Mixed','Mostly Bearish','Fully Bearish'].map(s => (
                <MenuItem key={s} value={s} sx={{ fontSize: '0.72rem', color: INK }}>{s}</MenuItem>
              ))}
            </Select>
            {(filterSignal !== 'All' || filterRSI !== 'All' || filterMACD !== 'All' || filterTrend !== 'All' || searchStock) && (
              <Box component="button" onClick={() => { setFilterSignal('All'); setFilterRSI('All'); setFilterMACD('All'); setFilterTrend('All'); setSearchStock('') }}
                sx={{ px: 1.25, py: 0.4, borderRadius: '6px', fontSize: '0.65rem', cursor: 'pointer',
                  border: `1px solid ${BORDER}`, bgcolor: 'transparent', color: INK2,
                  '&:hover': { color: INK, borderColor: INK2 }, transition: 'all 0.12s' }}>
                Clear
              </Box>
            )}
            <Typography sx={{ fontSize: '0.62rem', color: INK3, ml: 'auto', ...JAKARTA }}>
              {rows.length} / {data.items.length}
            </Typography>
          </Box>

          <MaterialTable<IndicatorScanItem>
            columns={scanColumns}
            rows={rows}
            height={460}
            rowHeight={42}
            searchable={false}
            exportable
            onRowClick={it => onSymbolSelect(it.symbol)}
            emptyMessage="No stocks match the current filters"
            getRowId={it => it.symbol}
          />
        </>
      )}
    </Box>
  )
}

// ─── Trend Card ───────────────────────────────────────────────────────────────

function TrendCard({ trend, price }: { trend: StockIndicators['trend']; price: number }) {
  const { CARD, BORDER, INK, INK2, INK3 } = useTokens()
  const rows = [
    { label: 'SMA 20',  value: trend.sma20,  diff: trend.price_vs_sma20 },
    { label: 'SMA 50',  value: trend.sma50,  diff: trend.price_vs_sma50 },
    { label: 'SMA 100', value: trend.sma100, diff: trend.price_vs_sma100 },
    { label: 'SMA 200', value: trend.sma200, diff: trend.price_vs_sma200 },
  ]
  return (
    <Box sx={CARD}>
      <SectionHead title="Trend" accent="#22c55e" />
      <StatRow
        label="Trend Label"
        value={<Pill label={trend.trend_label} color={TREND_COLOR[trend.trend_label] ?? INK2} />}
      />
      <StatRow
        label="Alignment"
        value={
          <Box sx={{ display: 'flex', gap: 0.3 }}>
            {[0,1,2,3].map(i => (
              <Box key={i} sx={{ width: 10, height: 10, borderRadius: '3px',
                bgcolor: i < trend.alignment_score ? '#22c55e' : BORDER }} />
            ))}
          </Box>
        }
      />
      <StatRow label="Current Price" value={fmtPrice(price)} valueColor={INK} />
      <Box sx={{ mt: 1 }}>
        {rows.map(r => (
          <Box key={r.label} sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            py: 0.5, borderBottom: `1px dashed ${BORDER}` }}>
            <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>{r.label}</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.7rem', color: INK2, ...JAKARTA }}>{fmtPrice(r.value)}</Typography>
              <PctTag v={r.diff} />
            </Box>
          </Box>
        ))}
      </Box>
      <Box sx={{ mt: 1, pt: 0.5, display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>EMA 20</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: INK2, ...JAKARTA }}>{fmtPrice(trend.ema20)}</Typography>
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between' }}>
        <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>EMA 50</Typography>
        <Typography sx={{ fontSize: '0.7rem', color: INK2, ...JAKARTA }}>{fmtPrice(trend.ema50)}</Typography>
      </Box>
    </Box>
  )
}

// ─── Momentum Card ────────────────────────────────────────────────────────────

function MomentumCard({ momentum }: { momentum: StockIndicators['momentum'] }) {
  const { CARD, INK, INK2, INK3 } = useTokens()
  const macdDir  = momentum.macd_hist >= 0 ? '▲' : '▼'
  const macdCol  = momentum.macd_hist >= 0 ? '#22c55e' : '#ef4444'
  return (
    <Box sx={CARD}>
      <SectionHead title="Momentum" accent="#6366f1" />
      <StatRow
        label={`RSI (14)  ${momentum.rsi14.toFixed(1)}`}
        value={<Pill label={momentum.rsi_signal} color={RSI_SIGNAL_COLOR[momentum.rsi_signal] ?? INK2} />}
      />
      <Box sx={{ mt: 1.5, mb: 0.5 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75, letterSpacing: '0.08em', ...JAKARTA }}>
          MACD (12, 26, 9)
        </Typography>
        <StatRow label="Line"   value={momentum.macd_line.toFixed(4)} />
        <StatRow label="Signal" value={momentum.macd_signal.toFixed(4)} />
        <StatRow
          label="Histogram"
          value={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: macdCol }}>
                {macdDir} {Math.abs(momentum.macd_hist).toFixed(4)}
              </Typography>
              {momentum.macd_crossover !== 'None' && (
                <Pill label={`⚡ ${momentum.macd_crossover}`} color={MACD_COLOR[momentum.macd_crossover]} />
              )}
            </Box>
          }
        />
      </Box>
      <Box sx={{ mt: 1.5 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75, letterSpacing: '0.08em', ...JAKARTA }}>
          STOCHASTIC (14, 3, 3)
        </Typography>
        <StatRow label="%K" value={momentum.stoch_k.toFixed(1)} />
        <StatRow
          label="%D"
          value={
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.72rem', color: INK }}>{momentum.stoch_d.toFixed(1)}</Typography>
              <Pill
                label={momentum.stoch_signal}
                color={momentum.stoch_signal === 'Overbought' ? '#ef4444' : momentum.stoch_signal === 'Oversold' ? '#22c55e' : INK2}
              />
            </Box>
          }
        />
      </Box>
    </Box>
  )
}

// ─── Volatility Card ──────────────────────────────────────────────────────────

function VolatilityCard({ volatility }: { volatility: StockIndicators['volatility'] }) {
  const { CARD, INK2, INK3 } = useTokens()
  return (
    <Box sx={CARD}>
      <SectionHead title="Volatility" accent="#f59e0b" />
      <Box sx={{ mb: 1.5 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75, letterSpacing: '0.08em', ...JAKARTA }}>
          BOLLINGER BANDS (20, 2)
        </Typography>
        <StatRow label="Upper Band"  value={fmtPrice(volatility.bb_upper)} />
        <StatRow label="Middle (SMA)" value={fmtPrice(volatility.bb_middle)} />
        <StatRow label="Lower Band"  value={fmtPrice(volatility.bb_lower)} />
        <Box sx={{ mt: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
            <Typography sx={{ fontSize: '0.68rem', color: INK3, ...JAKARTA }}>%B Position</Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.72rem', fontWeight: 600, color: BB_SIGNAL_COLOR[volatility.bb_signal] ?? INK2 }}>
                {volatility.bb_pct_b.toFixed(1)}%
              </Typography>
              <Pill label={volatility.bb_signal} color={BB_SIGNAL_COLOR[volatility.bb_signal] ?? INK2} />
            </Box>
          </Box>
          <BbBar pct_b={volatility.bb_pct_b} />
        </Box>
      </Box>
      <Box sx={{ mt: 2 }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75, letterSpacing: '0.08em', ...JAKARTA }}>
          ATR (14)
        </Typography>
        <StatRow label="ATR Value" value={fmtPrice(volatility.atr14)} />
        <StatRow label="ATR % of Price" value={`${volatility.atr_pct.toFixed(2)}%`}
          valueColor={volatility.atr_pct > 3 ? '#f59e0b' : INK2} />
      </Box>
    </Box>
  )
}

// ─── Volume Card ──────────────────────────────────────────────────────────────

function VolumeCard({ volume }: { volume: StockIndicators['volume'] }) {
  const { CARD, BORDER, INK, INK2, INK3 } = useTokens()
  const ratioColor = volume.volume_signal === 'High Volume' ? '#f59e0b'
                   : volume.volume_signal === 'Low Volume'  ? INK2
                   : INK
  return (
    <Box sx={CARD}>
      <SectionHead title="Volume" accent="#14b8a6" />
      <StatRow label="Today's Volume" value={fmtVol(volume.volume)} />
      <StatRow label="20d Avg Volume"  value={fmtVol(volume.volume_sma20)} />
      <StatRow
        label="Volume Ratio"
        value={
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: ratioColor }}>
              {volume.volume_ratio.toFixed(2)}×
            </Typography>
            <Pill
              label={volume.volume_signal}
              color={volume.volume_signal === 'High Volume' ? '#f59e0b' : volume.volume_signal === 'Low Volume' ? INK2 : '#22c55e'}
            />
          </Box>
        }
      />
      <Box sx={{ mt: 1.5, pt: 1, borderTop: `1px dashed ${BORDER}` }}>
        <Typography sx={{ fontSize: '0.62rem', fontWeight: 700, color: INK3, mb: 0.75, letterSpacing: '0.08em', ...JAKARTA }}>
          ON BALANCE VOLUME
        </Typography>
        <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: volume.obv >= 0 ? '#22c55e' : '#ef4444' }}>
          {volume.obv >= 0 ? '+' : ''}{fmtVol(Math.abs(volume.obv))}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: INK3, mt: 0.25, ...JAKARTA }}>
          {volume.obv >= 0 ? 'Net buying pressure in history' : 'Net selling pressure in history'}
        </Typography>
      </Box>
    </Box>
  )
}

// ─── Stock Detail section ─────────────────────────────────────────────────────

function StockDetailSection({ preloadSymbol }: { preloadSymbol: string }) {
  const { CARD, INPUT_SX, BORDER, CYAN, PAPER2, INK, INK2, INK3 } = useTokens()
  const [symbol,  setSymbol]  = useState(preloadSymbol || 'RELIANCE')
  const [loading, setLoading] = useState(false)
  const [fetched, setFetched] = useState(false)
  const [error,   setError]   = useState<string | null>(null)
  const [data,    setData]    = useState<StockIndicators | null>(null)

  const prevPreload = useRef(preloadSymbol)
  if (preloadSymbol !== prevPreload.current) {
    prevPreload.current = preloadSymbol
    setSymbol(preloadSymbol)
  }

  const fetchIndicators = async (sym?: string) => {
    const target = sym ?? symbol
    setLoading(true)
    setError(null)
    try {
      const res = await indicatorsApi.getSymbol(target)
      setData(res)
      setFetched(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Fetch failed')
    } finally {
      setLoading(false)
    }
  }

  const signalColor = data ? SIGNAL_COLOR[data.overall_signal] ?? INK2 : INK2

  return (
    <Box id="stock-detail" sx={CARD}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Stock Indicators" accent="#8b5cf6" />
        <SymbolAutocomplete value={symbol} onChange={setSymbol} minWidth={160} />
        <RunBtn onClick={() => fetchIndicators()} loading={loading} label="Fetch Indicators" />
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2,
          bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.72rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {fetched && !error && data && (
        <>
          {/* Overall signal banner */}
          <Box sx={{
            display: 'flex', alignItems: 'center', gap: 2, mb: 2.5, p: 1.5,
            borderRadius: '12px', bgcolor: PAPER2, border: `1px solid ${signalColor}35`,
            boxShadow: `0 0 20px ${signalColor}12`,
          }}>
            <Box>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.1em', ...JAKARTA }}>
                Overall Signal
              </Typography>
              <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: signalColor, ...JAKARTA }}>
                {data.overall_signal}
              </Typography>
            </Box>
            <Box sx={{ ml: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>Score</Typography>
              <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: signalColor }}>
                {data.signal_score > 0 ? '+' : ''}{data.signal_score.toFixed(2)}
              </Typography>
            </Box>
            <Box sx={{ ml: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>As of</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: INK2, ...JAKARTA }}>{data.date}</Typography>
            </Box>
            <Box sx={{ ml: 2 }}>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, ...JAKARTA }}>Price</Typography>
              <Typography sx={{ fontSize: '0.85rem', fontWeight: 700, color: INK }}>
                {fmtPrice(data.price)}
              </Typography>
            </Box>
          </Box>

          {/* Divergences */}
          {data.divergences.length > 0 && (
            <Box sx={{ mb: 2 }}>
              {data.divergences.map((d, i) => (
                <Box key={i} sx={{
                  display: 'flex', gap: 1.5, p: 1.25, mb: 1, borderRadius: '8px',
                  bgcolor: d.type.startsWith('Bullish') ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.06)',
                  border: `1px solid ${d.type.startsWith('Bullish') ? 'rgba(34,197,94,0.2)' : 'rgba(239,68,68,0.2)'}`,
                }}>
                  <Typography sx={{ fontSize: '0.8rem' }}>{d.type.startsWith('Bullish') ? '↗' : '↘'}</Typography>
                  <Box>
                    <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: d.type.startsWith('Bullish') ? '#22c55e' : '#ef4444' }}>
                      {d.type}
                    </Typography>
                    <Typography sx={{ fontSize: '0.65rem', color: INK2, mt: 0.25 }}>{d.description}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          )}

          {/* 4 cards grid */}
          <Grid container spacing={2}>
            <Grid item xs={12} sm={6}>
              <TrendCard trend={data.trend} price={data.price} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <MomentumCard momentum={data.momentum} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <VolatilityCard volatility={data.volatility} />
            </Grid>
            <Grid item xs={12} sm={6}>
              <VolumeCard volume={data.volume} />
            </Grid>
          </Grid>

          <Typography sx={{ fontSize: '0.58rem', color: INK3, mt: 2, textAlign: 'right', ...JAKARTA }}>
            Computed {data.computed_at}
          </Typography>
        </>
      )}

      {!fetched && !loading && (
        <Box sx={{ textAlign: 'center', py: 5, color: INK3 }}>
          <Typography sx={{ fontSize: '0.75rem', ...JAKARTA }}>
            Select a stock and click Fetch Indicators to view detailed readings.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Section metadata ─────────────────────────────────────────────────────────

const SECTION_META = {
  regime: {
    label: 'Market Regime & Breadth',
    illustration: 'https://cdn.undraw.co/illustration/charts_31si.svg',
    accent: '#6366f1',
    what: 'How many NIFTY 50 stocks are trading above SMA 20/50/200, and each stock\'s Regime Score (0–100). The breadth score summarises structural market participation in one number.',
    useful: 'Deciding whether a rally or selloff is broad-based or driven by a handful of large-caps. High breadth confirms healthy uptrends. Collapsing breadth is an early warning sign.',
    avoid: 'During sustained bull markets where breadth stays elevated for weeks — it loses discrimination. Also unreliable in very low-volume, holiday-affected sessions.',
  },
  scan: {
    label: 'Market Indicator Scan',
    illustration: 'https://cdn.undraw.co/illustration/data-analysis_b7cp.svg',
    accent: '#0099CC',
    what: 'A technical snapshot of all 50 stocks computed in one pass: RSI, MACD crossover, Bollinger Band %B, ATR volatility, volume ratio, and trend alignment score.',
    useful: 'Pre-filtering for convergence setups — stocks where RSI, trend, and volume all point the same direction. Click any row to pull that stock into the Edge Lab.',
    avoid: 'As a standalone trade trigger. Indicator convergence tells you where to look — the Edge Lab and Stock Detail tell you whether the setup has historically worked.',
  },
  edgeSummary: {
    label: 'Edge Summary Table',
    illustration: 'https://cdn.undraw.co/illustration/key-insights_ex8y.svg',
    accent: '#14b8a6',
    what: 'Ranks which indicator has historically produced the best validated edge for each stock. Combines win rate, expected 1-month return, and a composite edge score from backtested data.',
    useful: 'Before committing to a strategy on a stock — know which indicator to trust for that specific name. HDFC Bank\'s best signal is not the same as Reliance\'s.',
    avoid: 'For intraday or swing decisions under 5 days. All statistics are computed on daily closing data. Extrapolating to shorter timeframes produces misleading results.',
  },
  edgeLab: {
    label: 'Indicator Edge Lab',
    illustration: 'https://cdn.undraw.co/illustration/instant-analysis_vm8x.svg',
    accent: '#8b5cf6',
    what: 'Deep statistical validation for one indicator on one stock. Forward returns at 1W / 2W / 1M, win rate at every threshold level, and the full distribution of outcomes across every historical occurrence.',
    useful: 'Validating a setup before acting on it. "RSI below 30 on this stock — how has that historically played out?" This answers that question with data, not opinion.',
    avoid: 'When occurrence count is below 30. Small samples make win rates statistically meaningless regardless of how good they look — the grade system will flag this as unreliable.',
  },
  stockDetail: {
    label: 'Stock Indicator Detail',
    illustration: 'https://cdn.undraw.co/illustration/data-at-work_3tbf.svg',
    accent: '#f59e0b',
    what: 'Current readings of every key indicator for a selected stock: SMA/EMA trend alignment, RSI / MACD / Stochastic momentum, Bollinger Band position, ATR volatility regime, and OBV volume flow.',
    useful: 'After shortlisting a stock from the scan — verify that multiple indicators are aligned before going into deeper Edge Lab research. Confirmation from 3+ dimensions adds confidence.',
    avoid: 'In isolation from regime context. A bullish RSI reading during a bear regime has historically lower follow-through than the same reading in a bull regime. Always pair with the Breadth panel.',
  },
}

// ─── Section info card ────────────────────────────────────────────────────────

function SectionInfo({ meta }: { meta: typeof SECTION_META[keyof typeof SECTION_META] }) {
  const { PAPER, INK3, INK2 } = usePalette()
  return (
    <Box sx={{
      display: 'flex', gap: { xs: 2, md: 4 }, mb: 2.5, p: { xs: 2, md: 3 },
      borderRadius: '16px', bgcolor: PAPER, border: `1px solid ${meta.accent}28`,
      alignItems: 'flex-start', flexWrap: 'wrap',
      boxShadow: `0 0 24px ${meta.accent}0A`,
    }}>
      <Box
        component="img" src={meta.illustration} alt=""
        sx={{ width: { xs: 56, md: 72 }, height: { xs: 56, md: 72 }, flexShrink: 0, opacity: 0.88 }}
      />
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography sx={{ ...JAKARTA, fontSize: '0.95rem', fontWeight: 700, color: meta.accent, mb: 1.75, letterSpacing: '-0.01em' }}>
          {meta.label}
        </Typography>
        <Box sx={{ display: 'flex', gap: { xs: 2, md: 4 }, flexWrap: 'wrap' }}>
          {[
            { key: 'What this shows', text: meta.what,    dot: `${meta.accent}` },
            { key: 'Best used when',  text: meta.useful,  dot: '#22c55e'        },
            { key: 'Avoid when',      text: meta.avoid,   dot: '#ef4444'        },
          ].map(col => (
            <Box key={col.key} sx={{ flex: '1 1 180px', minWidth: 160 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.625 }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: col.dot, flexShrink: 0, boxShadow: `0 0 6px ${col.dot}` }} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.625rem', fontWeight: 700, color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                  {col.key}
                </Typography>
              </Box>
              <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK2, lineHeight: 1.65 }}>
                {col.text}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  )
}

// ─── Layout mode selector ─────────────────────────────────────────────────────

const LAYOUT_MODES = [
  {
    id: 0 as const,
    icon: '▤',
    label: 'Classic',
    sub: 'Stacked sections',
    desc: 'Every tool in sequence — scroll from breadth all the way to stock detail. Best for deep exploratory sessions.',
  },
  {
    id: 1 as const,
    icon: '◫',
    label: 'Focused',
    sub: 'Tab navigation',
    desc: 'One tool at a time. Zero distraction — click a tab to switch context. Best when you know what you\'re looking for.',
  },
  {
    id: 2 as const,
    icon: '◧',
    label: 'Split',
    sub: 'Scan + Analyse',
    desc: 'Scanner on the left, stock analysis on the right. Click a row and the detail updates instantly.',
  },
]

// ─── Tab bar (mode 1) ─────────────────────────────────────────────────────────

const TAB_LABELS = ['Market Overview', 'Scanner', 'Edge Lab', 'Stock Detail']

function TabBar({ active, onChange }: { active: number; onChange: (i: number) => void }) {
  const { BORDER, CYAN, INK3, INK, INK2, PAPER2 } = usePalette()
  return (
    <Box sx={{
      display: 'flex', gap: 0, mb: 3,
      borderBottom: `1px solid ${BORDER}`, overflowX: 'auto',
      '&::-webkit-scrollbar': { display: 'none' },
    }}>
      {TAB_LABELS.map((label, i) => (
        <Box
          key={label}
          onClick={() => onChange(i)}
          sx={{
            px: 3, py: 1.5, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
            ...JAKARTA, fontSize: '0.875rem', fontWeight: active === i ? 700 : 500,
            color: active === i ? CYAN : INK3,
            borderBottom: active === i ? `2px solid ${CYAN}` : '2px solid transparent',
            transition: 'all 0.15s',
            '&:hover': { color: active === i ? CYAN : INK2 },
          }}
        >
          {label}
        </Box>
      ))}
    </Box>
  )
}


// ─── Page ─────────────────────────────────────────────────────────────────────

export default function IndicatorsPage() {
  const { BG, PAPER, PAPER2, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const { mode } = useThemeMode()
  const [preloadSymbol, setPreloadSymbol] = useState('')
  const [layoutMode, setLayoutMode]       = useState<0 | 1 | 2>(0)
  const [activeTab,   setActiveTab]       = useState(0)
  const detailRef = useRef<HTMLDivElement>(null)

  const handleSymbolSelect = (sym: string) => {
    setPreloadSymbol(sym)
    if (layoutMode === 1) {
      setActiveTab(3)
    } else if (layoutMode === 0) {
      setTimeout(() => {
        detailRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }, 50)
    }
    // mode 2: right column auto-updates via preloadSymbol
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* Background glow */}
        <Box sx={{
          position: 'absolute', top: -100, right: '10%',
          width: 500, height: 400, borderRadius: '50%',
          background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 65%)`,
          pointerEvents: 'none',
        }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: '5%',
          width: 300, height: 300, borderRadius: '50%',
          background: `radial-gradient(ellipse, #6366f118 0%, transparent 70%)`,
          pointerEvents: 'none',
        }} />

        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative' }}>
          <Grid container spacing={{ xs: 4, md: 8 }} alignItems="center">
            {/* Left — text + mode selector */}
            <Grid item xs={12} md={7}>
              {/* Tag */}
              <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5,
                px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D` }}>
                <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN,
                  animation: 'hpulse 2s ease-in-out infinite',
                  '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } } }} />
                <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                  Technical Analysis · Edge Research
                </Typography>
              </Box>

              {/* Headline */}
              <Typography sx={{
                ...JAKARTA, fontWeight: 800, color: INK,
                fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' },
                lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5,
              }}>
                Indicator{' '}
                <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>
                  Analysis
                </Box>
              </Typography>

              <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 4, maxWidth: 500 }}>
                Five layers of market intelligence — from broad regime health down to a single stock's statistical edge.
                Every table is validated, every number is explainable.
              </Typography>

              {/* ── 3 Layout mode cards ── */}
              <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', fontWeight: 700, color: INK3, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.5 }}>
                Choose how you want to work
              </Typography>
              <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
                {LAYOUT_MODES.map(mode => {
                  const active = layoutMode === mode.id
                  return (
                    <Box
                      key={mode.id}
                      onClick={() => setLayoutMode(mode.id)}
                      sx={{
                        flex: '1 1 140px', p: 1.75, borderRadius: '12px', cursor: 'pointer',
                        bgcolor: active ? `${CYAN}12` : PAPER,
                        border: `1.5px solid ${active ? CYAN : BORDER}`,
                        boxShadow: active ? `0 0 20px ${CYAN}25` : 'none',
                        transition: 'all 0.18s',
                        '&:hover': { borderColor: active ? CYAN : INK3, bgcolor: active ? `${CYAN}12` : PAPER2 },
                      }}
                    >
                      <Typography sx={{ fontSize: '1.1rem', mb: 0.375, color: active ? CYAN : INK3 }}>
                        {mode.icon}
                      </Typography>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.875rem', fontWeight: 700, color: active ? CYAN : INK, mb: 0.25 }}>
                        {mode.label}
                      </Typography>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.65rem', color: active ? CYAN : INK3, fontWeight: 600, mb: 0.75 }}>
                        {mode.sub}
                      </Typography>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, lineHeight: 1.5 }}>
                        {mode.desc}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            </Grid>

            {/* Right — illustration */}
            <Grid item xs={12} md={5} sx={{ display: { xs: 'none', md: 'block' } }}>
              <Box sx={{ display: 'flex', justifyContent: 'center', position: 'relative' }}>
                <Box sx={{
                  position: 'absolute', top: '50%', left: '50%',
                  transform: 'translate(-50%, -50%)',
                  width: 280, height: 280, borderRadius: '50%',
                  background: `radial-gradient(circle, ${CYAN}18 0%, transparent 70%)`,
                  pointerEvents: 'none',
                }} />
                <Box
                  component="img"
                  src="https://cdn.undraw.co/illustration/real-time-analytics_50za.svg"
                  alt="Real-time analytics"
                  sx={{ width: '100%', maxWidth: 400, position: 'relative', filter: `drop-shadow(0 0 24px ${CYAN}30)` }}
                />
              </Box>
            </Grid>
          </Grid>

          {/* ── Quick stats strip ── */}
          <Box sx={{
            mt: { xs: 4, md: 5 }, pt: 3, borderTop: `1px solid ${BORDER}`,
            display: 'flex', gap: { xs: 3, md: 6 }, flexWrap: 'wrap',
          }}>
            {[
              { val: '50',      label: 'NIFTY 50 stocks'      },
              { val: '5+',      label: 'Years of history'      },
              { val: '5',       label: 'Analytical layers'     },
              { val: '100%',    label: 'Validated metrics'     },
              { val: '< 500ms', label: 'Query response time'   },
            ].map(stat => (
              <Box key={stat.label}>
                <Typography sx={{ ...JAKARTA, fontSize: { xs: '1.25rem', md: '1.5rem' }, fontWeight: 800, color: CYAN, lineHeight: 1 }}>
                  {stat.val}
                </Typography>
                <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, mt: 0.375 }}>
                  {stat.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* ── CONTENT ──────────────────────────────────────────────────────── */}
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 } }}>

        {/* ── MODE 0: Classic stacked ── */}
        {layoutMode === 0 && (
          <Box sx={{ py: 4 }}>
            <SectionInfo meta={SECTION_META.regime} />
            <MarketRegimeDashboard onSymbolSelect={handleSymbolSelect} />

            <SectionInfo meta={SECTION_META.scan} />
            <ScanSection onSymbolSelect={handleSymbolSelect} />

            <SectionInfo meta={SECTION_META.edgeSummary} />
            <EdgeSummaryTable onSymbolSelect={handleSymbolSelect} />

            <SectionInfo meta={SECTION_META.edgeLab} />
            <IndicatorEdgeLab />

            <SectionInfo meta={SECTION_META.stockDetail} />
            <Box ref={detailRef}>
              <StockDetailSection preloadSymbol={preloadSymbol} />
            </Box>
          </Box>
        )}

        {/* ── MODE 1: Tab-based ── */}
        {layoutMode === 1 && (
          <Box sx={{ py: 4 }}>
            <TabBar active={activeTab} onChange={setActiveTab} />

            {activeTab === 0 && (
              <>
                <SectionInfo meta={SECTION_META.regime} />
                <MarketRegimeDashboard onSymbolSelect={handleSymbolSelect} />
              </>
            )}
            {activeTab === 1 && (
              <>
                <SectionInfo meta={SECTION_META.scan} />
                <ScanSection onSymbolSelect={handleSymbolSelect} />
              </>
            )}
            {activeTab === 2 && (
              <>
                <SectionInfo meta={SECTION_META.edgeSummary} />
                <EdgeSummaryTable onSymbolSelect={handleSymbolSelect} />
                <SectionInfo meta={SECTION_META.edgeLab} />
                <IndicatorEdgeLab />
              </>
            )}
            {activeTab === 3 && (
              <>
                <SectionInfo meta={SECTION_META.stockDetail} />
                <StockDetailSection preloadSymbol={preloadSymbol} />
              </>
            )}
          </Box>
        )}

        {/* ── MODE 2: Split ── */}
        {layoutMode === 2 && (
          <Box sx={{ py: 4 }}>
            <Grid container spacing={3} alignItems="flex-start">
              {/* Left: scanner */}
              <Grid item xs={12} lg={5}>
                <Box sx={{
                  position: { lg: 'sticky' }, top: { lg: 64 },
                  maxHeight: { lg: 'calc(100vh - 80px)' }, overflowY: { lg: 'auto' },
                  '&::-webkit-scrollbar': { width: 4 },
                  '&::-webkit-scrollbar-track': { bgcolor: BG },
                  '&::-webkit-scrollbar-thumb': { bgcolor: BORDER, borderRadius: 2 },
                }}>
                  {/* Compact info banner */}
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2,
                    p: 1.5, borderRadius: '10px', bgcolor: PAPER, border: `1px solid ${BORDER}` }}>
                    <Box component="img" src={SECTION_META.scan.illustration} sx={{ width: 32, height: 32, opacity: 0.8 }} />
                    <Box>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 700, color: CYAN }}>Market Scanner</Typography>
                      <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3 }}>Click any row to analyse that stock →</Typography>
                    </Box>
                  </Box>
                  <ScanSection onSymbolSelect={handleSymbolSelect} />
                </Box>
              </Grid>

              {/* Right: stock detail */}
              <Grid item xs={12} lg={7}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2,
                  p: 1.5, borderRadius: '10px', bgcolor: PAPER, border: `1px solid ${BORDER}` }}>
                  <Box component="img" src={SECTION_META.stockDetail.illustration} sx={{ width: 32, height: 32, opacity: 0.8 }} />
                  <Box>
                    <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 700, color: '#f59e0b' }}>Stock Analysis</Typography>
                    <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3 }}>
                      {preloadSymbol ? `Showing: ${preloadSymbol}` : 'Select a stock from the scanner'}
                    </Typography>
                  </Box>
                </Box>
                {preloadSymbol
                  ? <StockDetailSection preloadSymbol={preloadSymbol} />
                  : (
                    <Box sx={{
                      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
                      minHeight: 320, borderRadius: '16px', bgcolor: PAPER, border: `1px dashed ${BORDER}`,
                    }}>
                      <Box component="img"
                        src="https://cdn.undraw.co/illustration/data-points_uc3j.svg"
                        sx={{ width: 180, opacity: 0.4, mb: 2 }}
                      />
                      <Typography sx={{ ...JAKARTA, fontSize: '0.875rem', color: INK3 }}>
                        Select a stock from the scanner to see its analysis here
                      </Typography>
                    </Box>
                  )
                }
              </Grid>
            </Grid>
          </Box>
        )}

      </Box>

      <Footer />
    </Box>
  )
}
