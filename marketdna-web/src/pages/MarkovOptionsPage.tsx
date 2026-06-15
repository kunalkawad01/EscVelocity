import { useState, useEffect, useCallback } from 'react'
import Navbar from '../components/Navbar'
import {
  Box, Typography, CircularProgress,
  Tooltip, Chip, Table, TableBody, TableCell, TableContainer,
  TableHead, TableRow, LinearProgress,
} from '@mui/material'
import SymbolAutocomplete from '../components/shared/SymbolAutocomplete'
import { useSymbols } from '../hooks/useSymbols'
import { markovOptionsApi } from '../api/markovOptionsApi'
import type {
  MarkovOptionsResult, MarketMarkovResult,
  RegimeMonth, Regime,
} from '../types/markov_options'
import { REGIMES, REGIME_COLOR, REGIME_BG } from '../types/markov_options'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'


const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ─── Section accent colours (regime-independent, stay fixed) ─────────────────

const SECTION_ACCENT: Record<string, string> = {
  timeline:  '#6366f1',
  matrix:    '#14b8a6',
  forecast:  '#f59e0b',
  strategy:  '#22c55e',
  market:    '#8b5cf6',
}

// ─── Small helpers ───────────────────────────────────────────────────────────

function RegimePill({ regime, small }: { regime: Regime; small?: boolean }) {
  const { INK2 } = usePalette()
  return (
    <Box component="span" sx={{
      display: 'inline-block',
      px: small ? 0.875 : 1.125,
      py: small ? 0.25 : 0.375,
      fontSize: small ? '0.6875rem' : '0.75rem',
      fontWeight: 700,
      background: REGIME_BG[regime] ?? 'rgba(255,255,255,0.07)',
      color: REGIME_COLOR[regime] ?? INK2,
      border: `1px solid ${REGIME_COLOR[regime] ?? INK2}30`,
      whiteSpace: 'nowrap',
      fontFamily: "'IBM Plex Sans Condensed', sans-serif",
    }}>
      {regime}
    </Box>
  )
}

function SectionHeader({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
      <Box sx={{ width: 3, height: 22, borderRadius: 0, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...JAKARTA, fontSize: '1rem', fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>
        {title}
      </Typography>
      {meta && (
        <Typography sx={{ ...JAKARTA, fontSize: '0.75rem', color: INK3, ml: 'auto' }}>{meta}</Typography>
      )}
    </Box>
  )
}

function LoadingCard({ message }: { message: string }) {
  const { CARD, CYAN, INK3 } = useTokens()
  return (
    <Box sx={{ ...CARD, py: 4, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5 }}>
      <Box component="img"
        src="/illustrations/computing-regimes.svg"
        alt="Computing regimes"
        sx={{ width: 140, height: 'auto', opacity: 0.85 }}
      />
      <CircularProgress size={20} sx={{ color: CYAN }} />
      <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>{message}</Typography>
    </Box>
  )
}

function ErrorCard({ message }: { message: string }) {
  const { CARD, INK2 } = useTokens()
  return (
    <Box sx={{
      ...CARD,
      bgcolor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.20)',
      borderLeft: '3px solid #EF4444',
    }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#EF4444', mb: 0.5 }}>Error</Typography>
      <Typography sx={{ fontSize: '0.7rem', color: INK2, fontFamily: 'monospace', wordBreak: 'break-all' }}>{message}</Typography>
    </Box>
  )
}

// ─── Regime Timeline ─────────────────────────────────────────────────────────

function RegimeTimeline({ history }: { history: RegimeMonth[] }) {
  const { CARD, INK2, INK3, BORDER } = useTokens()
  const [hovered, setHovered] = useState<number | null>(null)
  const visible = history.slice(-56)
  return (
    <Box sx={CARD}>
      <SectionHeader title="Regime Timeline" accent={SECTION_ACCENT.timeline} meta={`last ${visible.length} months`} />
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: '3px', mb: 1.5 }}>
        {visible.map((m, i) => (
          <Tooltip
            key={i}
            title={
              <Box sx={{ fontSize: '0.65rem', lineHeight: 1.7 }}>
                <strong>{m.month}</strong><br />
                Regime: {m.regime}<br />
                ADX: {m.adx} | RSI: {m.rsi}<br />
                vs SMA50: {m.pct_vs_sma50 > 0 ? '+' : ''}{m.pct_vs_sma50}%<br />
                Return: {m.monthly_ret > 0 ? '+' : ''}{m.monthly_ret}%<br />
                HV ratio: {m.hv_ratio}×
              </Box>
            }
            placement="top"
            arrow
          >
            <Box
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
              sx={{
                width: 14, height: 28,
                borderRadius: '3px',
                bgcolor: REGIME_COLOR[m.regime as Regime] ?? INK2,
                opacity: hovered === null ? 0.85 : hovered === i ? 1 : 0.35,
                cursor: 'default',
                transition: 'opacity 0.15s',
                flexShrink: 0,
              }}
            />
          </Tooltip>
        ))}
      </Box>
      {/* Legend */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
        {REGIMES.map(r => (
          <Box key={r} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 10, height: 10, borderRadius: '2px', bgcolor: REGIME_COLOR[r as Regime] }} />
            <Typography sx={{ fontSize: '0.6rem', color: INK3 }}>{r}</Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ─── Transition Matrix ────────────────────────────────────────────────────────

function TransitionMatrixView({ matrix, counts }: { matrix: number[][]; counts: number[][] }) {
  const { CARD, INK2, INK3, BORDER } = useTokens()
  return (
    <Box sx={CARD}>
      <SectionHeader title="Markov Transition Matrix" accent={SECTION_ACCENT.matrix} meta="α=0.20 prior blend" />
      <Box sx={{ overflowX: 'auto' }}>
        <Box component="table" sx={{ borderCollapse: 'collapse', fontSize: '0.62rem', width: '100%' }}>
          <Box component="thead">
            <Box component="tr">
              <Box component="th" sx={{ p: 0.75, color: INK2, fontWeight: 600, textAlign: 'left', whiteSpace: 'nowrap', minWidth: 110 }}>
                From ↓ / To →
              </Box>
              {REGIMES.map(r => (
                <Box component="th" key={r} sx={{
                  p: 0.75, fontWeight: 700, textAlign: 'center',
                  color: REGIME_COLOR[r as Regime],
                  whiteSpace: 'nowrap', minWidth: 72,
                }}>
                  {r}
                </Box>
              ))}
            </Box>
          </Box>
          <Box component="tbody">
            {REGIMES.map((fromR, i) => (
              <Box component="tr" key={fromR} sx={{ '&:hover td': { background: 'rgba(28,25,23,0.03)' } }}>
                <Box component="td" sx={{
                  p: 0.75, fontWeight: 700, color: REGIME_COLOR[fromR as Regime],
                  borderRight: `1px solid ${BORDER}`, whiteSpace: 'nowrap',
                }}>
                  {fromR}
                </Box>
                {REGIMES.map((_, j) => {
                  const prob  = matrix[i]?.[j] ?? 0
                  const count = counts[i]?.[j] ?? 0
                  const rowMax = matrix[i]?.reduce((a, b) => Math.max(a, b), -Infinity) ?? -Infinity
                  const isMax = rowMax > 0 && matrix[i]?.[j] === rowMax && j === matrix[i].indexOf(rowMax)
                  return (
                    <Box component="td" key={j} sx={{
                      p: 0.75, textAlign: 'center',
                      background: isMax ? `${REGIME_COLOR[REGIMES[j] as Regime]}14` : 'transparent',
                      borderLeft: `1px solid ${BORDER}`,
                    }}>
                      <Typography sx={{
                        fontSize: '0.65rem', fontWeight: isMax ? 800 : 400,
                        color: isMax ? REGIME_COLOR[REGIMES[j] as Regime] : INK3,
                      }}>
                        {(prob * 100).toFixed(0)}%
                      </Typography>
                      <Typography sx={{ fontSize: '0.55rem', color: count < 3 ? '#f59e0b' : INK3 }}>
                        n={count}
                      </Typography>
                    </Box>
                  )
                })}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
      <Typography sx={{ fontSize: '0.6rem', color: INK3, mt: 1.5 }}>
        Cells highlighted = most likely next state for each source regime. Yellow n= means &lt;3 observations (unreliable).
      </Typography>
    </Box>
  )
}

// ─── Forecast Bar ────────────────────────────────────────────────────────────

function ForecastBar({ forecast }: { forecast: MarkovOptionsResult['forecast'] }) {
  const { CARD, INK2, INK3, BORDER } = useTokens()
  const sorted = REGIMES.map(r => ({
    regime: r as Regime,
    prob: forecast.probabilities[r as Regime] ?? 0,
  })).slice().sort((a, b) => b.prob - a.prob)

  return (
    <Box sx={CARD}>
      <SectionHeader title="Next Month Forecast" accent={SECTION_ACCENT.forecast}
        meta={`from ${forecast.current_regime}`} />
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        {sorted.map(({ regime, prob }) => (
          <Box key={regime}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.3 }}>
              <RegimePill regime={regime} small />
              <Typography sx={{
                fontSize: '0.7rem', fontWeight: regime === forecast.dominant_regime ? 800 : 400,
                color: regime === forecast.dominant_regime ? REGIME_COLOR[regime] : INK3,
              }}>
                {(prob * 100).toFixed(1)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={prob * 100}
              sx={{
                height: 5, borderRadius: 3,
                bgcolor: BORDER,
                '& .MuiLinearProgress-bar': { bgcolor: REGIME_COLOR[regime], borderRadius: 3 },
              }}
            />
          </Box>
        ))}
      </Box>
      {forecast.tail_risk_regime && (
        <Box sx={{
          mt: 2, p: 1.5, borderRadius: '10px',
          bgcolor: 'rgba(245,158,11,0.07)', border: '1px solid rgba(245,158,11,0.20)',
          borderLeft: '3px solid #f59e0b',
        }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#f59e0b', mb: 0.3 }}>
            Tail Risk
          </Typography>
          <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>
            <RegimePill regime={forecast.tail_risk_regime} small /> has {((forecast.tail_risk_probability ?? 0) * 100).toFixed(1)}% probability — review strategy if this regime materialises.
          </Typography>
        </Box>
      )}
    </Box>
  )
}

// ─── Options Strategy Card ───────────────────────────────────────────────────

function StrategyCard({ forecast }: { forecast: MarkovOptionsResult['forecast'] }) {
  const { CARD, INK2, INK3 } = useTokens()
  const s    = forecast.strategy
  const col  = REGIME_COLOR[forecast.dominant_regime]
  const isBuy = s.iv_action === 'Buy'

  return (
    <Box sx={{ ...CARD, borderLeft: `3px solid ${col}` }}>
      <SectionHeader title="Options Strategy" accent={col}
        meta={`for ${forecast.dominant_regime}`} />

      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 2, mb: 2 }}>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: '0.62rem', color: INK3, mb: 0.3, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Primary
          </Typography>
          <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: col, letterSpacing: '-0.02em' }}>
            {s.primary}
          </Typography>
        </Box>
        <Box sx={{
          px: 1.5, py: 0.5, borderRadius: '8px',
          bgcolor: isBuy ? 'rgba(245,158,11,0.10)' : 'rgba(34,197,94,0.10)',
          border: `1px solid ${isBuy ? '#f59e0b' : '#22c55e'}30`,
        }}>
          <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: isBuy ? '#f59e0b' : '#22c55e' }}>
            IV {s.iv_action}
          </Typography>
        </Box>
      </Box>

      <Typography sx={{ fontSize: '0.68rem', color: INK2, lineHeight: 1.7, mb: 2 }}>
        {s.rationale}
      </Typography>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography sx={{ fontSize: '0.6rem', color: INK3, mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Alternatives
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            {s.alternatives.map(a => (
              <Typography key={a} sx={{ fontSize: '0.68rem', color: INK2 }}>· {a}</Typography>
            ))}
          </Box>
        </Box>
        <Box sx={{ flex: 1, minWidth: 140 }}>
          <Typography sx={{ fontSize: '0.6rem', color: '#ef4444', mb: 0.5, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            Avoid
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.4 }}>
            {s.avoid.map(a => (
              <Typography key={a} sx={{ fontSize: '0.68rem', color: INK3 }}>· {a}</Typography>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Market Overview Table ────────────────────────────────────────────────────

function MarketOverview({ data, onSelectSymbol }: { data: MarketMarkovResult; onSelectSymbol: (s: string) => void }) {
  const { CARD, TH, TD, INPUT_SX, INK, INK2, INK3, BORDER, CYAN, PAPER } = useTokens()
  const [filterStock, setFilterStock]   = useState('')
  const [filterRegime, setFilterRegime] = useState<string>('All')
  const [filterIV, setFilterIV]         = useState<string>('All')

  const filtered = data.items.filter(it => {
    if (filterStock && !it.symbol.toLowerCase().includes(filterStock.toLowerCase())) return false
    if (filterRegime !== 'All' && it.current_regime !== filterRegime) return false
    if (filterIV !== 'All' && it.iv_action !== filterIV) return false
    return true
  })

  return (
    <Box sx={CARD}>
      <SectionHeader title="Market Regime Overview" accent={SECTION_ACCENT.market}
        meta={`${data.items.length} stocks · ${data.scanned_at}`} />

      {/* Distribution chips */}
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
        {REGIMES.map(r => {
          const count = data.regime_distribution[r as Regime] ?? 0
          return count > 0 ? (
            <Chip
              key={r}
              label={`${r} ${count}`}
              size="small"
              onClick={() => setFilterRegime(filterRegime === r ? 'All' : r)}
              sx={{
                fontSize: '0.6rem', height: 22, fontWeight: filterRegime === r ? 800 : 400,
                bgcolor: filterRegime === r ? `${REGIME_COLOR[r as Regime]}20` : BORDER,
                color: REGIME_COLOR[r as Regime],
                border: `1px solid ${REGIME_COLOR[r as Regime]}30`,
                cursor: 'pointer',
              }}
            />
          ) : null
        })}
      </Box>

      {/* Filter bar */}
      <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
        <OutlinedInput
          placeholder="Stock…"
          value={filterStock}
          onChange={e => setFilterStock(e.target.value)}
          sx={{ ...INPUT_SX, width: 100 }}
        />
        <Select
          value={filterRegime}
          onChange={e => setFilterRegime(e.target.value)}
          sx={{ ...INPUT_SX, minWidth: 140 }}
          displayEmpty
          MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
        >
          <MenuItem value="All" sx={{ fontSize: '0.72rem' }}>All Regimes</MenuItem>
          {REGIMES.map(r => (
            <MenuItem key={r} value={r} sx={{ fontSize: '0.72rem', color: REGIME_COLOR[r as Regime] }}>{r}</MenuItem>
          ))}
        </Select>
        <Select
          value={filterIV}
          onChange={e => setFilterIV(e.target.value)}
          sx={{ ...INPUT_SX, minWidth: 90 }}
          displayEmpty
          MenuProps={{ PaperProps: { sx: { bgcolor: PAPER, border: `1px solid ${BORDER}`, color: INK } } }}
        >
          <MenuItem value="All" sx={{ fontSize: '0.72rem' }}>IV: All</MenuItem>
          <MenuItem value="Buy" sx={{ fontSize: '0.72rem', color: '#f59e0b' }}>IV Buy</MenuItem>
          <MenuItem value="Sell" sx={{ fontSize: '0.72rem', color: '#22c55e' }}>IV Sell</MenuItem>
        </Select>
        {(filterStock || filterRegime !== 'All' || filterIV !== 'All') && (
          <Box
            component="button"
            onClick={() => { setFilterStock(''); setFilterRegime('All'); setFilterIV('All') }}
            sx={{
              px: 1.25, py: 0.4, borderRadius: '6px', fontSize: '0.65rem', cursor: 'pointer',
              border: `1px solid ${BORDER}`, bgcolor: 'transparent', color: INK3,
              '&:hover': { color: INK2 },
            }}
          >
            Clear
          </Box>
        )}
        <Typography sx={{ fontSize: '0.62rem', color: INK3, ml: 'auto' }}>
          {filtered.length} / {data.items.length}
        </Typography>
      </Box>

      <TableContainer sx={{ maxHeight: 460 }}>
        <Table size="small" stickyHeader>
          <TableHead>
            <TableRow sx={{ '& th': TH }}>
              <TableCell>#</TableCell>
              <TableCell>Stock</TableCell>
              <TableCell>Current Regime</TableCell>
              <TableCell>Next Month</TableCell>
              <TableCell>Probability</TableCell>
              <TableCell>Strategy</TableCell>
              <TableCell>IV</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {filtered.map((item, idx) => (
              <TableRow key={item.symbol} sx={{ '& td': TD, '&:hover td': { bgcolor: `${BORDER}40` } }}>
                <TableCell sx={{ fontSize: '0.6rem', color: INK3 }}>{idx + 1}</TableCell>
                <TableCell>
                  <Typography
                    component="button"
                    onClick={() => {
                      onSelectSymbol(item.symbol)
                      document.getElementById('stock-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                    }}
                    sx={{
                      fontSize: '0.72rem', fontWeight: 700, color: CYAN,
                      background: 'none', border: 'none', cursor: 'pointer', p: 0,
                      '&:hover': { textDecoration: 'underline' },
                    }}
                  >
                    {item.symbol}
                  </Typography>
                </TableCell>
                <TableCell><RegimePill regime={item.current_regime} small /></TableCell>
                <TableCell><RegimePill regime={item.dominant_next} small /></TableCell>
                <TableCell>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <LinearProgress
                      variant="determinate"
                      value={item.dominant_prob * 100}
                      sx={{
                        width: 48, height: 4, borderRadius: 2,
                        bgcolor: BORDER,
                        '& .MuiLinearProgress-bar': {
                          bgcolor: REGIME_COLOR[item.dominant_next],
                          borderRadius: 2,
                        },
                      }}
                    />
                    <Typography sx={{ fontSize: '0.65rem', color: INK2 }}>
                      {(item.dominant_prob * 100).toFixed(0)}%
                    </Typography>
                  </Box>
                </TableCell>
                <TableCell sx={{ fontSize: '0.65rem', color: INK2 }}>{item.primary_strategy}</TableCell>
                <TableCell>
                  <Typography sx={{
                    fontSize: '0.62rem', fontWeight: 700,
                    color: item.iv_action === 'Buy' ? '#f59e0b' : '#22c55e',
                  }}>
                    {item.iv_action}
                  </Typography>
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} sx={{ textAlign: 'center', py: 4, color: INK3, fontSize: '0.7rem' }}>
                  No stocks match filters.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </TableContainer>
    </Box>
  )
}

// ─── Stock detail panel ───────────────────────────────────────────────────────

function StockDetail({
  symbols, selectedSymbol, onSymbolChange,
}: {
  symbols: string[]; selectedSymbol: string; onSymbolChange: (s: string) => void
}) {
  const { CARD, INPUT_SX, INK, INK2, INK3, BORDER, CYAN, PAPER } = useTokens()
  const [result, setResult]   = useState<MarkovOptionsResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError]     = useState<string | null>(null)

  const load = useCallback((sym: string) => {
    setLoading(true)
    setError(null)
    markovOptionsApi.getSymbol(sym)
      .then(setResult)
      .catch(e => setError((e as Error).message))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load(selectedSymbol) }, [selectedSymbol, load])

  return (
    <Box>
      {/* Symbol selector */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
        <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: '#6366f1', flexShrink: 0 }} />
        <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
          Stock Analysis
        </Typography>
        <SymbolAutocomplete value={selectedSymbol} onChange={onSymbolChange} symbols={symbols} minWidth={160} />
        <Box
          component="button"
          onClick={() => load(selectedSymbol)}
          disabled={loading}
          sx={{
            px: 1.5, py: 0.5, borderRadius: '8px', fontSize: '0.65rem',
            border: `1px solid ${BORDER}`,
            bgcolor: PAPER, color: INK2,
            cursor: loading ? 'default' : 'pointer',
            '&:hover:not(:disabled)': { borderColor: CYAN, color: INK },
          }}
        >
          {loading ? '…' : 'Refresh'}
        </Box>
      </Box>

      {loading && <LoadingCard message={`Computing Markov regimes for ${selectedSymbol}…`} />}
      {!loading && error && <ErrorCard message={error} />}
      {!loading && !error && result && (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {/* Quick stats */}
          <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
            {[
              { label: 'Months', value: result.n_months },
              { label: 'Current Regime', value: <RegimePill regime={result.forecast.current_regime} /> },
              { label: 'Next Month', value: <RegimePill regime={result.forecast.dominant_regime} /> },
              { label: 'Probability', value: `${(result.forecast.dominant_probability * 100).toFixed(1)}%` },
              { label: 'IV Action', value: result.forecast.strategy.iv_action,
                color: result.forecast.strategy.iv_action === 'Buy' ? '#f59e0b' : '#22c55e' },
            ].map(({ label, value, color }) => (
              <Box key={label} sx={{
                flex: '1 1 100px', ...CARD, p: 1.5,
                borderLeft: '3px solid rgba(99,102,241,0.4)',
              }}>
                <Typography sx={{ fontSize: '0.6rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.07em', mb: 0.3 }}>
                  {label}
                </Typography>
                <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, color: color ?? INK, letterSpacing: '-0.02em' }}>
                  {value}
                </Typography>
              </Box>
            ))}
          </Box>

          <RegimeTimeline history={result.history} />

          <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
            <ForecastBar forecast={result.forecast} />
            <StrategyCard forecast={result.forecast} />
          </Box>

          <TransitionMatrixView matrix={result.matrix.matrix} counts={result.matrix.counts} />
        </Box>
      )}
    </Box>
  )
}

// ─── Footer ──────────────────────────────────────────────────────────────────

function Footer() {
  const { PAPER, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const NAV = [
    { label: 'Platform',     links: ['Stock DNA', 'Pattern DNA', 'Markov Options', 'Quant Strategies', 'Indicators'] },
    { label: 'Intelligence', links: ['Market Regime', 'Breadth Score', 'Edge Lab', 'Cointegration', 'Delivery Intel'] },
    { label: 'Research',     links: ['Validation Framework', 'MCP Architecture', 'AI Agents', 'Feature Store', 'Backtests'] },
  ]
  return (
    <Box component="footer" sx={{ bgcolor: PAPER, borderTop: `1px solid ${BORDER}`, mt: 8 }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, pt: 6, pb: 4 }}>
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', mb: 5 }}>
          <Box sx={{ flex: '0 0 auto', maxWidth: 260 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 7, height: 7, bgcolor: CYAN, animation: 'blink 1.4s step-end infinite', '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } } }} />
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 800, fontSize: '1rem', color: INK, letterSpacing: '0.08em' }}>
                MARKET<Box component="span" sx={{ color: CYAN }}>DNA</Box>
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, lineHeight: 1.7 }}>
              Quantitative market intelligence for Indian equities and options. Research precedes product. Validation is mandatory.
            </Typography>
          </Box>
          {NAV.map(col => (
            <Box key={col.label} sx={{ flex: '1 1 140px' }}>
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75 }}>{col.label}</Typography>
              {col.links.map(link => (
                <Typography key={link} sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, mb: 0.875, cursor: 'default', transition: 'color 0.12s', '&:hover': { color: INK2 } }}>{link}</Typography>
              ))}
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 3, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>© 2024 MarketDNA · For research purposes only</Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>Not investment advice</Typography>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Page ────────────────────────────────────────────────────────────────────

const NAV_LINKS = [
  { label: 'Stock', anchor: 'stock-analysis' },
  { label: 'Market', anchor: 'market-overview' },
]

export default function MarkovOptionsPage() {
  const { BG, PAPER, BORDER, CYAN, INK, INK2, INK3, CARD } = useTokens()
  const { mode } = useThemeMode()

  const [marketData, setMarketData]     = useState<MarketMarkovResult | null>(null)
  const [marketLoading, setMarketLoading] = useState(false)
  const [marketError, setMarketError]   = useState<string | null>(null)
  const [marketLoaded, setMarketLoaded] = useState(false)

  const [selectedSymbol, setSelectedSymbol] = useState('RELIANCE')
  const symbols = marketData?.items.map(i => i.symbol).sort() ?? []
  const allSymbols = useSymbols()

  function loadMarket() {
    setMarketLoading(true)
    setMarketError(null)
    markovOptionsApi.getMarket()
      .then(d => { setMarketData(d); setMarketLoaded(true) })
      .catch(e => setMarketError((e as Error).message))
      .finally(() => setMarketLoading(false))
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK, ...JAKARTA }}>
      <Navbar sections={NAV_LINKS} />

      {/* Hero */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -100, right: '10%', width: 500, height: 400, borderRadius: '50%', background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: '5%', width: 300, height: 300, borderRadius: '50%', background: `radial-gradient(ellipse, #9B7FE818 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Left — text */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5, px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D` }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, animation: 'hpulse 2s ease-in-out infinite', '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } } }} />
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                Markov Chain · Regime Classification
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5 }}>
              Markov{' '}
              <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>Options</Box>
            </Typography>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, maxWidth: 520 }}>
              Six-regime Markov chain classifier with options strategy recommendations. Transition matrix, regime persistence, and systematic strategy mapping.
            </Typography>
          </Box>

          {/* Right — Markov chain illustration (desktop only) */}
          <Box sx={{ display: { xs: 'none', lg: 'flex' }, flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: 400, opacity: 0.9 }}>
            <Box component="img"
              src="/illustrations/markov-chain.svg"
              alt="Markov regime transition graph"
              sx={{ width: '100%', height: 'auto', maxHeight: 295, objectFit: 'contain', filter: mode === 'dark' ? 'brightness(0.90)' : 'brightness(0.96)' }}
            />
          </Box>
        </Box>
      </Box>

      {/* Page content */}
      <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>

        {/* Stock Analysis section */}
        <Box id="stock-analysis" sx={{ scrollMarginTop: '64px', mb: 4 }}>
          <StockDetail
            symbols={symbols.length > 0 ? symbols : allSymbols}
            selectedSymbol={selectedSymbol}
            onSymbolChange={setSelectedSymbol}
          />
        </Box>

        {/* Market Overview section */}
        <Box id="market-overview" sx={{ scrollMarginTop: '64px' }}>
          {!marketLoaded && (
            <Box sx={{ ...CARD, display: 'flex', gap: 3, alignItems: 'center', flexWrap: 'wrap' }}>
              {/* Left — illustration */}
              <Box sx={{ display: { xs: 'none', sm: 'flex' }, flexShrink: 0, alignItems: 'center' }}>
                <Box component="img"
                  src="/illustrations/market-scan.svg"
                  alt="Market radar scan"
                  sx={{ width: 160, height: 'auto', opacity: 0.82 }}
                />
              </Box>

              {/* Right — text + button */}
              <Box sx={{ flex: 1, minWidth: 200 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                  <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: SECTION_ACCENT.market, flexShrink: 0 }} />
                  <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
                    Market Regime Overview
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: '0.7rem', color: INK2, mb: 2 }}>
                  Scan all {symbols.length > 0 ? symbols.length : allSymbols.length || 'NSE 500'} stocks for current regime + next-month forecast. Takes ~30–60 seconds.
                </Typography>
                {marketLoading
                  ? <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                      <CircularProgress size={20} sx={{ color: CYAN }} />
                      <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>Scanning all symbols…</Typography>
                    </Box>
                  : <Box
                      component="button"
                      onClick={loadMarket}
                      sx={{
                        px: 2.5, py: 1, borderRadius: '10px',
                        border: `1.5px solid ${CYAN}`,
                        background: INK, color: BG,
                        fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer',
                        '&:hover': { opacity: 0.85 },
                      }}
                    >
                      Run Market Scan
                    </Box>
                }
                {marketError && <ErrorCard message={marketError} />}
              </Box>
            </Box>
          )}

          {marketLoaded && marketData && (
            <MarketOverview
              data={marketData}
              onSelectSymbol={sym => {
                setSelectedSymbol(sym)
                document.getElementById('stock-analysis')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
              }}
            />
          )}
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
