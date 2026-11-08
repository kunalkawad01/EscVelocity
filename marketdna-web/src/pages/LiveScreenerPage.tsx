import { Fragment, useEffect, useMemo, useState } from 'react'
import {
  Box, Grid, Table, TableBody, TableCell, TableHead, TableRow, Typography,
} from '@mui/material'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SearchBox from '../components/shared/SearchBox'
import { MultiTimeframeGrid } from '../components/charts/MultiTimeframeGrid'
import { IntradayStatsTable } from '../components/charts/IntradayStatsTable'
import { ScreenerFilterBar } from '../components/charts/ScreenerFilterBar'
import { EqualWeightIndexTile } from '../components/charts/EqualWeightIndexTile'
import { AdvanceDeclineTile } from '../components/charts/AdvanceDeclineTile'
import { RegimeBadge } from '../components/charts/RegimeBadge'
import { MONO, SANS, GREEN, RED, AMBER, pct, pctFrom, giveBackPct, recoveryPct } from '../components/charts/chartsCommon'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useFoTicker } from '../hooks/useFoTicker'
import { chartsApi } from '../api/chartsApi'
import { useScreenerFilters } from '../hooks/useScreenerFilters'
import type { ChartsScreenerStatsResponse, ChartsTick } from '../types/charts'

interface ScreenerRow {
  symbol: string
  ltp: number | null
  changePct: number | null
  open: number | null
  prevClose: number | null
  high: number | null
  low: number | null
  fromHighPct: number | null
  fromLowPct: number | null
  fromOpenPct: number | null
  giveBackPct: number | null
  recoveryPct: number | null
}

type SortKey = Exclude<keyof ScreenerRow, 'symbol'> | 'symbol'
type SortDir = 'asc' | 'desc'

function toRow(symbol: string, t: ChartsTick | undefined): ScreenerRow {
  if (!t) {
    return {
      symbol, ltp: null, changePct: null, open: null, prevClose: null,
      high: null, low: null, fromHighPct: null, fromLowPct: null, fromOpenPct: null,
      giveBackPct: null, recoveryPct: null,
    }
  }
  return {
    symbol,
    ltp: t.ltp,
    changePct: t.prev_close ? t.change_pct : null,
    open: t.open ?? null,
    prevClose: t.prev_close ?? null,
    high: t.high ?? null,
    low: t.low ?? null,
    fromHighPct: pctFrom(t.ltp, t.high),
    fromLowPct: pctFrom(t.ltp, t.low),
    fromOpenPct: pctFrom(t.ltp, t.open),
    giveBackPct: giveBackPct(t.ltp, t.open, t.high),
    recoveryPct: recoveryPct(t.ltp, t.open, t.low),
  }
}

function num(v: number | null, dp = 2): string {
  return v == null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: dp, maximumFractionDigits: dp })
}

function pctColor(v: number | null, fallback: string): string {
  if (v == null) return fallback
  return v > 0 ? GREEN : v < 0 ? RED : fallback
}

// Give-back % reads as a continuum, not a signed value -- still near the high
// (<=25%) is strong/GREEN, a partial fade (25-75%) is AMBER, and mostly/fully
// erased (>75%, including a round-trip below the open) is RED.
function giveBackColor(v: number | null, fallback: string): string {
  if (v == null) return fallback
  if (v <= 25) return GREEN
  if (v <= 75) return AMBER
  return RED
}

function giveBackLabel(v: number | null): string {
  return v == null ? '—' : `${v.toFixed(1)}%`
}

// Recovery % is Give-back %'s mirror, so its color tiers flip: still near the
// low (<=25%) is weak/RED, a partial bounce (25-75%) is AMBER, and mostly/fully
// recovered (>75%, including a move back above the open) is GREEN.
function recoveryColor(v: number | null, fallback: string): string {
  if (v == null) return fallback
  if (v <= 25) return RED
  if (v <= 75) return AMBER
  return GREEN
}

// Click-to-sort column header. Arrow shows direction once this column is the
// active sort; a faint ⇅ otherwise so every sortable header reads the same way.
function SortTh({
  label, k, sortKey, sortDir, onSort, align = 'right',
}: {
  label: string
  k: SortKey
  sortKey: SortKey
  sortDir: SortDir
  onSort: (k: SortKey) => void
  align?: 'left' | 'right'
}) {
  const { CYAN, INK3 } = usePalette()
  const { TH } = useTokens()
  const active = sortKey === k
  return (
    <TableCell
      sx={{ ...TH, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}
      align={align}
      onClick={() => onSort(k)}
    >
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
        {label}
        <Box component="span" sx={{ fontSize: '0.56rem', color: active ? CYAN : INK3, opacity: active ? 1 : 0.45 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </Box>
      </Box>
    </TableCell>
  )
}

const OPEN_REF_MINUTE = '09:18'

export default function LiveScreenerPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER, PAPER2 } = usePalette()
  const { CARD, TD } = useTokens()
  const { mode } = useThemeMode()
  const { ticks, wsConnected } = useFoTicker()
  const [symbols, setSymbols] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [sortKey, setSortKey] = useState<SortKey>('changePct')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  // Open reference: 9:15's raw opening-auction print vs. 9:18's price, which
  // skips the first few minutes of often-choppy price discovery. Swapping it
  // in means replacing `tick.open` for every symbol before it flows into the
  // table rows / filter engine -- every open-based formula (pctFrom, giveBackPct,
  // recoveryPct) already reads `t.open`, so no need to touch those functions.
  const [openRef, setOpenRef] = useState<'915' | '918'>('915')
  const [refOpens, setRefOpens] = useState<Record<string, number>>({})
  const [refOpensLoading, setRefOpensLoading] = useState(false)
  const [refOpensError, setRefOpensError] = useState<string | null>(null)
  const [refOpensAt, setRefOpensAt] = useState<string | null>(null)

  const loadRefOpens = () => {
    setRefOpensLoading(true)
    setRefOpensError(null)
    chartsApi.getReferenceOpen(OPEN_REF_MINUTE)
      .then(r => { setRefOpens(r.opens); setRefOpensAt(r.computed_at ?? null) })
      .catch(e => setRefOpensError(e.message || 'Failed to load'))
      .finally(() => setRefOpensLoading(false))
  }

  const selectOpenRef = (ref: '915' | '918') => {
    setOpenRef(ref)
    if (ref === '918' && !Object.keys(refOpens).length && !refOpensLoading) {
      loadRefOpens()
    }
  }

  // The hero's equal-weight index needs the 9:18 reference regardless of
  // whether the trader ever touches the Open Ref toggle, so it's fetched once
  // proactively on mount -- not gated behind that toggle the way it was before
  // this tile existed. `selectOpenRef`'s own guard (empty + not-loading) means
  // this can't double-fire if the toggle is also clicked before the scan lands.
  useEffect(() => {
    loadRefOpens()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const effectiveTicks = useMemo(() => {
    if (openRef === '915' || !Object.keys(refOpens).length) return ticks
    const out: Record<string, ChartsTick> = {}
    for (const sym of Object.keys(ticks)) {
      const ref = refOpens[sym]
      out[sym] = ref != null ? { ...ticks[sym], open: ref } : ticks[sym]
    }
    return out
  }, [ticks, openRef, refOpens])

  // 5-year return-percentile bands + latest SMA20/50/100/200 for the whole F&O
  // universe, in one call -- powers the dynamic filter's vs-SMA fields and "vs
  // OWN %ILE" mode (see useScreenerFilters/ScreenerFilterBar). Unlike the 9:18
  // open-reference scan, this is pure local DuckDB aggregation (no Kite calls),
  // so it's fast (~4s for 209 symbols) and safe to fetch eagerly on mount.
  const [screenerStats, setScreenerStats] = useState<ChartsScreenerStatsResponse | null>(null)
  useEffect(() => {
    chartsApi.getScreenerStats(5).then(setScreenerStats).catch(() => {})
  }, [])

  const filters = useScreenerFilters(effectiveTicks, screenerStats?.stats)

  useEffect(() => {
    chartsApi.getSymbols().then(r => setSymbols(r.symbols)).catch(() => {})
  }, [])

  const toggleExpand = (symbol: string) =>
    setExpanded(prev => ({ ...prev, [symbol]: !prev[symbol] }))

  const expandedCount = Object.values(expanded).filter(Boolean).length
  const collapseAll = () => setExpanded({})

  const toggleSort = (k: SortKey) => {
    if (k === sortKey) {
      setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(k)
      setSortDir('desc')
    }
  }

  const rows = useMemo(() => symbols.map(s => toRow(s, effectiveTicks[s])), [symbols, effectiveTicks])

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase()
    return q ? rows.filter(r => r.symbol.includes(q)) : rows
  }, [rows, search])

  const filtered = useMemo(
    () => (filters.active ? searched.filter(r => filters.passes(r.symbol)) : searched),
    [searched, filters],
  )

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      if (sortKey === 'symbol') {
        const c = a.symbol.localeCompare(b.symbol)
        return sortDir === 'asc' ? c : -c
      }
      const av = a[sortKey]
      const bv = b[sortKey]
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      return sortDir === 'asc' ? av - bv : bv - av
    })
    return arr
  }, [filtered, sortKey, sortDir])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        px: { xs: 2, md: 4 }, pt: 4, pb: 3,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase' }}>
            ● F&amp;O Universe
          </Typography>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: wsConnected ? GREEN : INK3,
              animation: wsConnected ? 'pulse 1.6s ease-in-out infinite' : 'none',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }} />
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: wsConnected ? GREEN : INK3, letterSpacing: '0.08em' }}>
              {wsConnected ? 'LIVE' : 'CONNECTING…'}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Live <Box component="span" sx={{ color: CYAN }}>Screener</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 680, mt: 1, mb: 2 }}>
          Every F&amp;O underlying in one sortable table — open, previous close, day's high/low, and how far the
          live price sits from each. Click a symbol to drop in 6 timeframes at once — today, yesterday, 5-day,
          1 month, quarterly, 1 year — each with its own return%. Research/monitoring
          view — no order placement.
        </Typography>
        <SearchBox value={search} onChange={setSearch} placeholder="Search symbol…" width={260} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
            {sorted.length} / {symbols.length} symbols
          </Typography>
          {expandedCount > 0 && (
            <Box
              onClick={collapseAll}
              sx={{
                display: 'flex', alignItems: 'center', gap: 0.4, px: 1, py: 0.3,
                borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}`,
              }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3 }}>
                COLLAPSE ALL ({expandedCount})
              </Typography>
            </Box>
          )}
        </Box>

        {/* Open reference: raw 9:15 print vs. 9:18 (skips early opening-auction
            noise). Swapping this re-bases every open-derived column/filter. */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1.25, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.06em' }}>
            OPEN REF:
          </Typography>
          <Box sx={{ display: 'flex', gap: 0.3 }}>
            {(['915', '918'] as const).map(ref => (
              <Box
                key={ref}
                onClick={() => selectOpenRef(ref)}
                sx={{
                  px: 1, py: 0.3, borderRadius: 1, cursor: 'pointer',
                  bgcolor: openRef === ref ? `${CYAN}20` : 'transparent',
                  border: `1px solid ${openRef === ref ? CYAN : BORDER}`,
                }}
              >
                <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800, color: openRef === ref ? CYAN : INK3 }}>
                  {ref === '915' ? '9:15 OPEN' : '9:18 OPEN'}
                </Typography>
              </Box>
            ))}
          </Box>
          {openRef === '918' && (
            <Typography sx={{ ...MONO, fontSize: '0.58rem', color: refOpensError ? RED : INK3 }}>
              {refOpensLoading
                ? `scanning 09:18 prints… (~60-70s cold)`
                : refOpensError
                ? `failed to load — ${refOpensError}`
                : refOpensAt
                ? `${Object.keys(refOpens).length} symbols as of ${refOpensAt}`
                : null}
            </Typography>
          )}
          {openRef === '918' && !refOpensLoading && (
            <Box
              onClick={loadRefOpens}
              sx={{ px: 0.9, py: 0.2, borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}` }}
            >
              <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 700, color: INK3 }}>
                RE-SCAN
              </Typography>
            </Box>
          )}
        </Box>

        {/* Live hero charts: equal-weight F&O index (base 100 @ 9:18) and
            advance-decline breadth, both built client-side off the streaming tick. */}
        <Grid container spacing={2} sx={{ mt: 2 }}>
          <Grid item xs={12} md={6}>
            <EqualWeightIndexTile ticks={ticks} refOpens={refOpens} refOpensLoading={refOpensLoading} />
          </Grid>
          <Grid item xs={12} md={6}>
            <AdvanceDeclineTile ticks={ticks} />
          </Grid>
        </Grid>
      </Box>

      {/* Dynamic AND/OR return filter */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 2, borderBottom: `1px solid ${BORDER}` }}>
        <Box sx={{ ...CARD, p: 1.5 }}>
          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
            <RegimeBadge ticks={ticks} refOpens={refOpens} />
          </Box>
          <ScreenerFilterBar f={filters} />
        </Box>
      </Box>

      {/* Table */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        {!symbols.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            Loading F&amp;O universe…
          </Typography>
        ) : !sorted.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            {search ? `No symbols match "${search}".` : 'No symbols match the current filters.'}
          </Typography>
        ) : (
          <Box sx={{ ...CARD, p: 0, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <SortTh label="Symbol" k="symbol" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="left" />
                  <SortTh label="LTP" k="ltp" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Chg %" k="changePct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label={openRef === '918' ? 'Open (9:18)' : 'Open'} k="open" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Prev Close" k="prevClose" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="High" k="high" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Low" k="low" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="From High %" k="fromHighPct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="From Low %" k="fromLowPct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="From Open %" k="fromOpenPct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Give-back %" k="giveBackPct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Recovery %" k="recoveryPct" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                </TableRow>
              </TableHead>
              <TableBody>
                {sorted.map(r => (
                  <Fragment key={r.symbol}>
                    <TableRow hover sx={{ cursor: 'pointer' }} onClick={() => toggleExpand(r.symbol)}>
                      <TableCell sx={TD}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
                          <Box component="span" sx={{ fontSize: '0.6rem', color: expanded[r.symbol] ? CYAN : INK3, width: 10 }}>
                            {expanded[r.symbol] ? '▾' : '▸'}
                          </Box>
                          <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 800, color: expanded[r.symbol] ? CYAN : INK }}>
                            {r.symbol}
                          </Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 600, color: INK2 }}>
                          {num(r.ltp)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: pctColor(r.changePct, INK2) }}>
                          {pct(r.changePct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>{num(r.open)}</Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>{num(r.prevClose)}</Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>{num(r.high)}</Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>{num(r.low)}</Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 600, color: pctColor(r.fromHighPct, INK3) }}>
                          {pct(r.fromHighPct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 600, color: pctColor(r.fromLowPct, INK3) }}>
                          {pct(r.fromLowPct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 600, color: pctColor(r.fromOpenPct, INK3) }}>
                          {pct(r.fromOpenPct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: giveBackColor(r.giveBackPct, INK3) }}>
                          {giveBackLabel(r.giveBackPct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: recoveryColor(r.recoveryPct, INK3) }}>
                          {giveBackLabel(r.recoveryPct)}
                        </Typography>
                      </TableCell>
                    </TableRow>
                    {expanded[r.symbol] && (
                      <TableRow>
                        <TableCell colSpan={12} sx={{ p: 2, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
                          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                            <Box
                              onClick={() => toggleExpand(r.symbol)}
                              sx={{
                                display: 'flex', alignItems: 'center', gap: 0.5, px: 1, py: 0.4,
                                borderRadius: 1, cursor: 'pointer', border: `1px solid ${BORDER}`,
                              }}
                            >
                              <Box component="span" sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>▴</Box>
                              <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: INK3 }}>
                                COLLAPSE
                              </Typography>
                            </Box>
                          </Box>
                          <MultiTimeframeGrid symbol={r.symbol} tick={effectiveTicks[r.symbol]} />
                          <IntradayStatsTable symbol={r.symbol} ltp={effectiveTicks[r.symbol]?.ltp} />
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, mt: 1.5, px: 0.5 }}>
          Click any column header to sort; click a symbol to expand 6 timeframes at once (today, yesterday, 5-day,
          1 month, quarterly, 1 year) with each one's own return%. "From High/Low/Open %" reflect the session so
          far, not the final day's range. "Give-back %" is how much of the day's open-to-high rally has been handed
          back — 0% is still at the high, 100% is a full round-trip to the open, {'>'}100% means it's now trading
          below the open; shown as — when the stock never traded above its own open. "Recovery %" is its mirror —
          how much of the day's open-to-low decline has been clawed back — 0% is still at the low, 100% is a full
          round-trip to the open, {'>'}100% means it's now trading above the open; shown as — when the stock never
          traded below its own open. "Open Ref" swaps the open used by every open-based column/filter (Open, From
          Open %, Give-back %, Recovery %, and the Low/High vs Open % filter fields) from the raw 9:15 opening print
          to the traded price at 9:18 — a noise-reduced reference that skips the first few minutes of often-choppy
          opening-auction price discovery. The 9:18 scan is a bulk per-symbol lookup (~60-70s cold, cached after)
          and only covers symbols whose session has reached 9:18 — others silently fall back to the raw 9:15 open
          until then. The expanded view also shows a 5-year intraday (open → close) return percentile table and
          latest SMA20/50/100/200, fetched once per symbol when expanded.
        </Typography>
      </Box>

      <Footer />
    </Box>
  )
}
