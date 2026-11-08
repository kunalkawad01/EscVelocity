import { Fragment, useEffect, useMemo, useState } from 'react'
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SearchBox from '../components/shared/SearchBox'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { resultReactionApi } from '../api/resultReactionApi'
import { ResultDayChartGrid } from '../components/charts/ResultDayChartGrid'
import type { SymbolResultReaction } from '../types/resultReaction'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const GREEN = '#22c55e'
const RED = '#ef4444'

type SortKey = 'symbol' | 'lastResult' | 'avgDayMinus1' | 'avgDay0' | 'avgDayPlus1' | 'winRate' | 'nQuarters'
type SortDir = 'asc' | 'desc'

function pct(v: number | null | undefined, dp = 2): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${(v * 100).toFixed(dp)}%`
}

function pctColor(v: number | null | undefined, fallback: string): string {
  if (v == null) return fallback
  return v > 0 ? GREEN : v < 0 ? RED : fallback
}

function lastResultDate(row: SymbolResultReaction): string | null {
  return row.quarters[0]?.result_date ?? null
}

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
    <TableCell sx={{ ...TH, cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }} align={align} onClick={() => onSort(k)}>
      <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.4 }}>
        {label}
        <Box component="span" sx={{ fontSize: '0.56rem', color: active ? CYAN : INK3, opacity: active ? 1 : 0.45 }}>
          {active ? (sortDir === 'asc' ? '▲' : '▼') : '⇅'}
        </Box>
      </Box>
    </TableCell>
  )
}

export default function ResultReactionPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { CARD, TD } = useTokens()
  const { mode } = useThemeMode()

  const [items, setItems] = useState<SymbolResultReaction[]>([])
  const [ready, setReady] = useState(false)
  const [computed, setComputed] = useState(0)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [chartsOpen, setChartsOpen] = useState<Record<string, boolean>>({})
  const [sortKey, setSortKey] = useState<SortKey>('avgDay0')
  const [sortDir, setSortDir] = useState<SortDir>('desc')
  const [refreshing, setRefreshing] = useState(false)

  useEffect(() => {
    let cancelled = false
    const poll = () => {
      resultReactionApi.getScan()
        .then(d => {
          if (cancelled) return
          setItems(d.items)
          setReady(d.ready)
          setComputed(d.computed)
          setTotal(d.total)
          if (!d.ready) setTimeout(poll, 3000)
          else setRefreshing(false)
        })
        .catch(e => { if (!cancelled) setError(e.message) })
    }
    poll()
    return () => { cancelled = true }
  }, [])

  const toggleExpand = (symbol: string) => setExpanded(prev => ({ ...prev, [symbol]: !prev[symbol] }))
  const toggleCharts = (key: string) => setChartsOpen(prev => ({ ...prev, [key]: !prev[key] }))
  const toggleSort = (k: SortKey) => {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir('desc') }
  }

  const refresh = () => {
    setRefreshing(true)
    setReady(false)
    resultReactionApi.invalidate().then(() => setTimeout(() => {
      const poll = () => {
        resultReactionApi.getScan()
          .then(d => {
            setItems(d.items); setReady(d.ready); setComputed(d.computed); setTotal(d.total)
            if (!d.ready) setTimeout(poll, 3000)
            else setRefreshing(false)
          })
          .catch(e => setError(e.message))
      }
      poll()
    }, 1000))
  }

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase()
    return q ? items.filter(r => r.symbol.includes(q)) : items
  }, [items, search])

  const sorted = useMemo(() => {
    const arr = [...searched]
    const val = (r: SymbolResultReaction): number | string | null => {
      switch (sortKey) {
        case 'symbol': return r.symbol
        case 'lastResult': return lastResultDate(r)
        case 'avgDayMinus1': return r.avg_day_minus1_pct
        case 'avgDay0': return r.avg_day0_pct
        case 'avgDayPlus1': return r.avg_day_plus1_pct
        case 'winRate': return r.win_rate
        case 'nQuarters': return r.n_quarters
      }
    }
    arr.sort((a, b) => {
      const av = val(a), bv = val(b)
      if (av == null && bv == null) return 0
      if (av == null) return 1
      if (bv == null) return -1
      if (typeof av === 'string' && typeof bv === 'string') {
        const c = av.localeCompare(bv)
        return sortDir === 'asc' ? c : -c
      }
      return sortDir === 'asc' ? (av as number) - (bv as number) : (bv as number) - (av as number)
    })
    return arr
  }, [searched, sortKey, sortDir])

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
              width: 6, height: 6, borderRadius: '50%', bgcolor: ready ? GREEN : '#f59e0b',
              animation: !ready ? 'pulse 1.6s ease-in-out infinite' : 'none',
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.25 } },
            }} />
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: ready ? GREEN : '#f59e0b', letterSpacing: '0.08em' }}>
              {ready ? 'READY' : `SCANNING ${computed}/${total || '…'}`}
            </Typography>
          </Box>
        </Box>
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Result <Box component="span" sx={{ color: CYAN }}>Reaction</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 760, mt: 1, mb: 2 }}>
          How every F&amp;O underlying actually traded around its last 4 quarterly results — the day before
          (anticipation/drift), the announcement day itself (catches pre-market releases), and the day after
          (catches the common after-close release). Result dates come from NSE's own corporate event calendar;
          returns are computed off daily closes. Click a row for the per-quarter breakdown.
        </Typography>
        <SearchBox value={search} onChange={setSearch} placeholder="Search symbol…" width={260} />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 1, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
            {sorted.length} / {items.length || total} symbols
          </Typography>
          <Box
            onClick={refreshing ? undefined : refresh}
            sx={{
              px: 1, py: 0.3, borderRadius: 1, cursor: refreshing ? 'default' : 'pointer',
              border: `1px solid ${BORDER}`, opacity: refreshing ? 0.5 : 1,
            }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3 }}>
              {refreshing ? 'REFRESHING…' : 'FORCE REFRESH (~2 MIN, HITS NSE)'}
            </Typography>
          </Box>
        </Box>
      </Box>

      {/* Table */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        {error ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: RED, textAlign: 'center', py: 6 }}>{error}</Typography>
        ) : !items.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            {ready ? 'No data.' : `Scanning NSE event calendar… ${computed}/${total || '?'} symbols (first run takes ~2 min, cached for 7 days after).`}
          </Typography>
        ) : !sorted.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            No symbols match "{search}".
          </Typography>
        ) : (
          <Box sx={{ ...CARD, p: 0, overflowX: 'auto' }}>
            <Table size="small">
              <TableHead>
                <TableRow>
                  <SortTh label="Symbol" k="symbol" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} align="left" />
                  <SortTh label="Last Result" k="lastResult" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Avg Day -1" k="avgDayMinus1" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Avg Day 0" k="avgDay0" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Avg Day +1" k="avgDayPlus1" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Win Rate" k="winRate" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
                  <SortTh label="Qtrs" k="nQuarters" sortKey={sortKey} sortDir={sortDir} onSort={toggleSort} />
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
                          <Typography sx={{ ...MONO, fontSize: '0.78rem', fontWeight: 700, color: INK }}>{r.symbol}</Typography>
                        </Box>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        {r.error
                          ? <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }} title={r.error}>n/a</Typography>
                          : <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>{lastResultDate(r) ?? '—'}</Typography>}
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: pctColor(r.avg_day_minus1_pct, INK2) }}>
                          {pct(r.avg_day_minus1_pct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: pctColor(r.avg_day0_pct, INK2) }}>
                          {pct(r.avg_day0_pct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', fontWeight: 700, color: pctColor(r.avg_day_plus1_pct, INK2) }}>
                          {pct(r.avg_day_plus1_pct)}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK2 }}>
                          {r.win_rate == null ? '—' : `${(r.win_rate * 100).toFixed(0)}%`}
                        </Typography>
                      </TableCell>
                      <TableCell sx={TD} align="right">
                        <Typography sx={{ ...MONO, fontSize: '0.74rem', color: INK3 }}>{r.n_quarters}</Typography>
                      </TableCell>
                    </TableRow>
                    {expanded[r.symbol] && (
                      <TableRow>
                        <TableCell colSpan={7} sx={{ p: 0, borderBottom: `1px solid ${BORDER}` }}>
                          <Box sx={{ px: 3, py: 1.5 }}>
                            {r.quarters.length === 0 ? (
                              <Typography sx={{ ...SANS, fontSize: '0.72rem', color: INK3 }}>
                                {r.error ?? 'No quarters resolved against covered price history.'}
                              </Typography>
                            ) : (
                              <Table size="small">
                                <TableHead>
                                  <TableRow>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }}>Result Date</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day -1</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day 0</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day +1</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day +2</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day +3</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day +4</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} align="right">Day +5</TableCell>
                                    <TableCell sx={{ ...TD, color: INK3, border: 'none' }} />
                                  </TableRow>
                                </TableHead>
                                <TableBody>
                                  {r.quarters.map(q => {
                                    const chartsKey = `${r.symbol}-${q.result_date}`
                                    return (
                                      <Fragment key={q.result_date}>
                                        <TableRow>
                                          <TableCell sx={{ ...TD, border: 'none' }}>
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK2 }}>{q.result_date}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_minus1_pct, INK2) }}>{pct(q.day_minus1_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day0_pct, INK2) }}>{pct(q.day0_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_plus1_pct, INK2) }}>{pct(q.day_plus1_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_plus2_pct, INK2) }}>{pct(q.day_plus2_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_plus3_pct, INK2) }}>{pct(q.day_plus3_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_plus4_pct, INK2) }}>{pct(q.day_plus4_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: pctColor(q.day_plus5_pct, INK2) }}>{pct(q.day_plus5_pct)}</Typography>
                                          </TableCell>
                                          <TableCell sx={{ ...TD, border: 'none' }} align="right">
                                            <Box
                                              onClick={(e) => { e.stopPropagation(); toggleCharts(chartsKey) }}
                                              sx={{
                                                display: 'inline-block', px: 0.9, py: 0.2, borderRadius: 1, cursor: 'pointer',
                                                border: `1px solid ${BORDER}`,
                                              }}
                                            >
                                              <Typography sx={{ ...MONO, fontSize: '0.58rem', fontWeight: 700, color: chartsOpen[chartsKey] ? CYAN : INK3 }}>
                                                {chartsOpen[chartsKey] ? 'HIDE CHARTS' : 'VIEW CHARTS'}
                                              </Typography>
                                            </Box>
                                          </TableCell>
                                        </TableRow>
                                        {chartsOpen[chartsKey] && (
                                          <TableRow>
                                            <TableCell colSpan={9} sx={{ p: 0, border: 'none' }}>
                                              <Box sx={{ pb: 2, pt: 0.5 }}>
                                                <ResultDayChartGrid symbol={r.symbol} quarter={q} />
                                              </Box>
                                            </TableCell>
                                          </TableRow>
                                        )}
                                      </Fragment>
                                    )
                                  })}
                                </TableBody>
                              </Table>
                            )}
                          </Box>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                ))}
              </TableBody>
            </Table>
          </Box>
        )}
      </Box>

      <Footer />
    </Box>
  )
}
