import { useState } from 'react'
import {
  Box, Typography, LinearProgress,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow,
  Grid, Tooltip,
} from '@mui/material'
import { indicatorsApi } from '../../api/indicatorsApi'
import type { IndicatorEdgeReport, IndicatorEdgeResult, SignalStats, ThresholdResult } from '../../types/indicatorEdge'
import { GRADE_COLOR, DIR_COLOR } from '../../types/indicatorEdge'
import SymbolAutocomplete from '../shared/SymbolAutocomplete'

import { usePalette, useTokens } from '../../hooks/usePalette'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const


function Pill({ label, color }: { label: string; color: string }) {
  return (
    <Box component="span" sx={{
      display: 'inline-block', px: 0.75, py: 0.2, borderRadius: '5px',
      fontSize: '0.6875rem', fontWeight: 700, whiteSpace: 'nowrap',
      color, bgcolor: `${color}18`, border: `1px solid ${color}28`,
    }}>
      {label}
    </Box>
  )
}

function RunBtn({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  const { CYAN } = usePalette()
  return (
    <Box component="button" onClick={onClick} disabled={loading} sx={{
      px: 2.5, py: 0.875, borderRadius: '10px', fontSize: '0.875rem', fontWeight: 700,
      cursor: loading ? 'wait' : 'pointer',
      background: `linear-gradient(135deg, ${CYAN}, #0090C8)`,
      color: '#FFFFFF', border: 'none', opacity: loading ? 0.6 : 1,
      boxShadow: `0 0 16px ${CYAN}40`,
      '&:hover:not(:disabled)': { boxShadow: `0 0 24px ${CYAN}70`, transform: 'translateY(-1px)' },
      transition: 'all 0.15s',
      ...JAKARTA,
    }}>
      {loading ? 'Analysing…' : 'Run Edge Lab'}
    </Box>
  )
}

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, ...JAKARTA }}>{title}</Typography>
      {meta && <Typography sx={{ fontSize: '0.75rem', color: INK3, ml: 'auto', ...JAKARTA }}>{meta}</Typography>}
    </Box>
  )
}

function Ret({ v }: { v: number }) {
  const { INK2 } = usePalette()
  const c = v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : INK2
  return <Typography component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: c }}>
    {v > 0 ? '+' : ''}{v.toFixed(2)}%
  </Typography>
}

// ─── Stats mini-card ──────────────────────────────────────────────────────────

const DIST_BUCKET_ORDER = ['<-10', '-10:-5', '-5:0', '0:5', '5:10', '>10']
const DIST_BUCKET_COLOR: Record<string, string> = {
  '<-10':   '#ef4444',
  '-10:-5': '#f87171',
  '-5:0':   '#fca5a5',
  '0:5':    '#86efac',
  '5:10':   '#22c55e',
  '>10':    '#15803d',
}

function DistributionBar({ dist }: { dist: Record<string, number> }) {
  const { INK3 } = usePalette()
  const total = DIST_BUCKET_ORDER.reduce((s, k) => s + (dist[k] ?? 0), 0)
  if (total === 0) return null
  return (
    <Box sx={{ mt: 1.5 }}>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: INK3,
        textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75, ...JAKARTA }}>
        Return Distribution
      </Typography>
      <Box sx={{ display: 'flex', height: 28, borderRadius: '6px', overflow: 'hidden', gap: '1px' }}>
        {DIST_BUCKET_ORDER.map(key => {
          const count = dist[key] ?? 0
          const pct = total > 0 ? count / total * 100 : 0
          if (pct === 0) return null
          return (
            <Tooltip key={key} title={`${key}%: ${count} (${pct.toFixed(0)}%)`} placement="top">
              <Box sx={{
                width: `${pct}%`, bgcolor: DIST_BUCKET_COLOR[key],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: pct > 8 ? 'auto' : '2px',
              }}>
                {pct > 10 && (
                  <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#000', opacity: 0.7 }}>
                    {pct.toFixed(0)}%
                  </Typography>
                )}
              </Box>
            </Tooltip>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.4 }}>
        <Typography sx={{ fontSize: '0.55rem', color: INK3, ...JAKARTA }}>&#8592; Bearish</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: INK3, ...JAKARTA }}>Bullish &#8594;</Typography>
      </Box>
    </Box>
  )
}

function StatsMini({ st, direction }: { st: SignalStats; direction?: string }) {
  const { BORDER, INK3, INK, INK2 } = usePalette()
  const row = (label: string, val: React.ReactNode) => (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', py: 0.4,
      borderBottom: `1px dashed ${BORDER}` }}>
      <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>{label}</Typography>
      <Box>{val}</Box>
    </Box>
  )
  const probColor = (p: number) => p >= 60 ? '#22c55e' : p >= 50 ? '#fbbf24' : '#ef4444'
  return (
    <Box sx={{ mt: 1 }}>
      {row('Occurrences',           <Typography sx={{ fontSize: '0.875rem', color: INK, fontWeight: 600 }}>{st.occurrences}</Typography>)}
      {row('Avg Forward Return 1W',   <Ret v={st.avg_1w} />)}
      {row('Avg Forward Return 2W',   <Ret v={st.avg_2w} />)}
      {row('Avg Forward Return 1M',   <Ret v={st.avg_1m} />)}
      {row('Median 1M',               <Ret v={st.median_1m} />)}
      {row('Max Return',              <Ret v={st.max_1m} />)}
      {row('Min Return',              <Ret v={st.min_1m} />)}
      {row('Std Deviation',           <Typography sx={{ fontSize: '0.875rem', color: INK2 }}>{st.std_1m.toFixed(2)}%</Typography>)}
      {row('Win Rate (signal worked)',<Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: probColor(st.win_rate) }}>{st.win_rate.toFixed(1)}%</Typography>)}
      {row('Stock ↑ Probability',     <Typography sx={{ fontSize: '0.875rem', color: st.positive_prob > 50 ? '#22c55e' : INK2 }}>{st.positive_prob.toFixed(1)}%</Typography>)}
      {row('Stock ↓ Probability',     <Typography sx={{ fontSize: '0.875rem', color: st.negative_prob > 50 ? '#22c55e' : INK2 }}>{st.negative_prob.toFixed(1)}%</Typography>)}
      {row('Max Drawdown (Avg MAE)',  <Typography sx={{ fontSize: '0.875rem', color: '#f87171', fontWeight: 600 }}>{st.max_drawdown_1m.toFixed(2)}%</Typography>)}
      {row('Expected Value',          <Ret v={st.expected_value} />)}
      <DistributionBar dist={st.distribution} />
    </Box>
  )
}

// ─── Ranking table ────────────────────────────────────────────────────────────

function RankTable({
  results, selected, onSelect,
}: {
  results: IndicatorEdgeResult[]
  selected: string | null
  onSelect: (signal: string) => void
}) {
  const { TH, TD, t1, t2, t3, BORDER, CYAN, PAPER, INK, INK2 } = useTokens()
  return (
    <TableContainer sx={{ maxHeight: 420, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
      <Table stickyHeader size="small">
        <TableHead>
          <TableRow>
            {['Rank','Indicator','Signal','Dir','Grade','Edge Score','Samples','Win Rate','Avg 1M','EV','Active'].map(h => (
              <TableCell key={h} sx={TH}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {results.map((r, idx) => {
            const isSelected = r.signal === selected
            return (
              <TableRow
                key={r.signal}
                onClick={() => onSelect(r.signal)}
                sx={{
                  cursor: 'pointer',
                  bgcolor: isSelected ? `${CYAN}10` : PAPER,
                  '&:hover td': { bgcolor: `${CYAN}08` },
                }}
              >
                {/* T3: rank is ordinal meta context */}
                <TableCell sx={{ ...TD, ...t3 }}>#{idx + 1}</TableCell>
                {/* T1+CYAN: indicator name is the primary finding */}
                <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{r.name}</TableCell>
                {/* T2: signal is secondary description */}
                <TableCell sx={{ ...TD, maxWidth: 180 }}>
                  <Tooltip title={r.signal} placement="top">
                    <Typography sx={{ ...t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                      {r.signal}
                    </Typography>
                  </Tooltip>
                </TableCell>
                {/* Pill */}
                <TableCell sx={TD}><Pill label={r.direction} color={DIR_COLOR[r.direction] ?? INK2} /></TableCell>
                {/* Grade: colored emphasis — keep large */}
                <TableCell sx={TD}>
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 900, color: GRADE_COLOR[r.grade] ?? INK2 }}>
                    {r.grade}
                  </Typography>
                </TableCell>
                {/* T1: edge score is the key ranking metric */}
                <TableCell sx={{ ...TD, ...t1 }}>{r.edge_score.toFixed(3)}</TableCell>
                {/* T3: sample count is meta */}
                <TableCell sx={{ ...TD, ...t3 }}>{r.stats.occurrences}</TableCell>
                {/* T1 semantic: win rate colored by quality */}
                <TableCell sx={{ ...TD, ...t1, color: r.stats.win_rate >= 60 ? '#22c55e' : r.stats.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                  {r.stats.win_rate.toFixed(1)}%
                </TableCell>
                {/* Ret handles color */}
                <TableCell sx={TD}><Ret v={r.stats.avg_1m} /></TableCell>
                <TableCell sx={TD}><Ret v={r.stats.expected_value} /></TableCell>
                {/* Active dot */}
                <TableCell sx={TD}>
                  {r.is_active
                    ? <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                    : <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: BORDER }} />}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

// ─── Threshold sweep table ────────────────────────────────────────────────────

function SweepTable({ sweep, best }: { sweep: ThresholdResult[]; best: ThresholdResult | null }) {
  const { TH, TD, t1, t2, t3, BORDER, INK, INK2, INK3 } = useTokens()
  if (!sweep.length) return (
    <Typography sx={{ fontSize: '0.875rem', color: INK3, py: 2, ...JAKARTA }}>
      No threshold sweep for this signal type.
    </Typography>
  )
  return (
    <TableContainer>
      <Table size="small">
        <TableHead>
          <TableRow>
            {['Threshold','Occurrences','Avg 1M Return','Win Rate','Expected Value',''].map(h => (
              <TableCell key={h} sx={TH}>{h}</TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {sweep.map(row => {
            const isBest = best?.threshold === row.threshold
            return (
              <TableRow key={row.threshold} sx={{ bgcolor: isBest ? 'rgba(34,197,94,0.06)' : 'transparent' }}>
                {/* T1 if best threshold, T2 otherwise */}
                <TableCell sx={isBest ? { ...TD, ...t1 } : { ...TD, ...t2 }}>{row.label}</TableCell>
                {/* T3: occurrence count is meta */}
                <TableCell sx={{ ...TD, ...t3 }}>{row.occurrences}</TableCell>
                <TableCell sx={TD}><Ret v={row.avg_1m} /></TableCell>
                {/* T1 semantic: win rate colored by quality */}
                <TableCell sx={{ ...TD, ...t1, color: row.win_rate >= 60 ? '#22c55e' : row.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                  {row.win_rate.toFixed(1)}%
                </TableCell>
                <TableCell sx={TD}><Ret v={row.expected_value} /></TableCell>
                <TableCell sx={TD}>
                  {isBest && <Pill label="Best" color="#22c55e" />}
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </TableContainer>
  )
}

// ─── Current signals panel ────────────────────────────────────────────────────

function CurrentSignalsPanel({ report }: { report: IndicatorEdgeReport }) {
  const { BG, BORDER, INK, INK2, INK3 } = usePalette()
  const active = report.current_signals.filter(s => s.is_active)
  const inactive = report.current_signals.filter(s => !s.is_active)

  function SignalRow({ s }: { s: typeof report.current_signals[0] }) {
    return (
      <Box sx={{
        p: 1.5, mb: 1.5, borderRadius: '10px',
        bgcolor: s.is_active ? 'rgba(34,197,94,0.06)' : BG,
        border: `1px solid ${s.is_active ? 'rgba(34,197,94,0.2)' : BORDER}`,
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: s.stats ? 1 : 0 }}>
          <Box>
            <Typography sx={{ fontSize: '0.7rem', fontWeight: 700, color: s.is_active ? INK : INK2, ...JAKARTA }}>
              {s.indicator}
            </Typography>
            <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
              {s.current_value}
            </Typography>
          </Box>
          <Box sx={{ textAlign: 'right' }}>
            <Pill
              label={s.signal_label}
              color={
                s.signal_label.includes('Oversold') || s.signal_label.includes('Lower') ? '#22c55e' :
                s.signal_label.includes('Overbought') || s.signal_label.includes('Upper') ? '#ef4444' :
                s.signal_label === 'Spike' ? '#f59e0b' : INK2
              }
            />
          </Box>
        </Box>
        {s.is_active && s.stats && (
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mt: 0.75,
            pt: 0.75, borderTop: `1px dashed ${BORDER}` }}>
            {[
              { label: '1M Avg', v: s.stats.avg_1m },
              { label: 'Win Rate', pct: s.stats.win_rate },
              { label: 'EV', v: s.stats.expected_value },
              { label: 'Samples', n: s.stats.occurrences },
            ].map(item => (
              <Box key={item.label}>
                <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>{item.label}</Typography>
                {item.v !== undefined && <Ret v={item.v} />}
                {item.pct !== undefined && (
                  <Typography sx={{ fontSize: '0.875rem', fontWeight: 700,
                    color: item.pct >= 60 ? '#22c55e' : item.pct >= 50 ? '#fbbf24' : '#ef4444' }}>
                    {item.pct.toFixed(1)}%
                  </Typography>
                )}
                {item.n !== undefined && (
                  <Typography sx={{ fontSize: '0.875rem', color: INK, fontWeight: 600 }}>
                    {item.n}
                  </Typography>
                )}
              </Box>
            ))}
          </Box>
        )}
      </Box>
    )
  }

  return (
    <Box>
      {active.length > 0 && (
        <Box sx={{ mb: 2 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#22c55e',
            textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1, ...JAKARTA }}>
            Active Signals ({active.length})
          </Typography>
          {active.map(s => <SignalRow key={s.indicator} s={s} />)}
        </Box>
      )}
      <Box>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK3,
          textTransform: 'uppercase', letterSpacing: '0.1em', mb: 1, ...JAKARTA }}>
          Inactive
        </Typography>
        {inactive.map(s => <SignalRow key={s.indicator} s={s} />)}
      </Box>
    </Box>
  )
}

// ─── Main export ──────────────────────────────────────────────────────────────

export default function IndicatorEdgeLab() {
  const { CARD, BG, BORDER, CYAN, INK, INK2, INK3, INPUT_SX } = useTokens()
  const [symbol,   setSymbol]   = useState('RELIANCE')
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [report,   setReport]   = useState<IndicatorEdgeReport | null>(null)
  const [selected, setSelected] = useState<string | null>(null)

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await indicatorsApi.getEdge(symbol)
      setReport(res)
      setSelected(res.results[0]?.signal ?? null)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Edge Lab failed')
    } finally {
      setLoading(false)
    }
  }

  const selectedResult = report?.results.find(r => r.signal === selected) ?? null

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <SectionHead title="Indicator Edge Lab" accent="#8b5cf6"
          meta={report ? `${report.data_start} → ${report.data_end}  ·  ${report.total_bars} bars` : undefined} />
        <SymbolAutocomplete value={symbol} onChange={setSymbol} minWidth={160} />
        <RunBtn onClick={run} loading={loading} />
      </Box>

      {loading && (
        <LinearProgress sx={{
          borderRadius: 1, mb: 2,
          bgcolor: BORDER,
          '& .MuiLinearProgress-bar': { bgcolor: CYAN, boxShadow: `0 0 8px ${CYAN}80` },
        }} />
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.875rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {!report && !loading && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>
            Select a stock and run the Edge Lab to find which indicators have historically worked best.
          </Typography>
        </Box>
      )}

      {report && (
        <>
          {/* Best Setup banner */}
          <Box sx={{
            display: 'flex', gap: 3, mb: 2.5, p: 1.5, flexWrap: 'wrap',
            borderRadius: '10px', bgcolor: BG,
            border: `1.5px solid ${BORDER}`,
          }}>
            {[
              { label: 'Best Indicator', value: report.best_indicator, color: '#8b5cf6' },
              { label: 'Best Setup',     value: report.best_setup,     color: INK },
              { label: 'Total Signals',  value: `${report.results.length} analysed`, color: INK2 },
              { label: 'Computed',       value: report.computed_at,    color: INK3 },
            ].map(item => (
              <Box key={item.label}>
                <Typography sx={{ fontSize: '0.75rem', color: INK3, textTransform: 'uppercase', letterSpacing: '0.08em', ...JAKARTA }}>
                  {item.label}
                </Typography>
                <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: item.color, ...JAKARTA }}>
                  {item.value}
                </Typography>
              </Box>
            ))}
          </Box>

          <Grid container spacing={2.5}>
            {/* Left: ranking table */}
            <Grid item xs={12} lg={8}>
              <Box sx={{ ...CARD, p: 2 }}>
                <SectionHead title="Indicator Ranking" accent="#6366f1"
                  meta="click a row to inspect" />
                <RankTable results={report.results} selected={selected} onSelect={setSelected} />
              </Box>

              {/* Threshold sweep for selected */}
              {selectedResult && (
                <Box sx={{ ...CARD, p: 2, mt: 2 }}>
                  <SectionHead
                    title={`Threshold Sweep — ${selectedResult.name}`}
                    accent="#fbbf24"
                    meta={selectedResult.signal}
                  />
                  <SweepTable
                    sweep={selectedResult.threshold_sweep}
                    best={selectedResult.best_threshold}
                  />
                </Box>
              )}
            </Grid>

            {/* Right: detail + current signals */}
            <Grid item xs={12} lg={4}>
              {selectedResult && (
                <Box sx={{ ...CARD, p: 2, mb: 2 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: '#8b5cf6', flexShrink: 0 }} />
                    <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: INK, flex: 1, ...JAKARTA }}>
                      {selectedResult.signal}
                    </Typography>
                    <Typography sx={{ fontSize: '0.95rem', fontWeight: 900, color: GRADE_COLOR[selectedResult.grade] }}>
                      {selectedResult.grade}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', gap: 1.5, mb: 1, flexWrap: 'wrap' }}>
                    <Pill label={selectedResult.direction} color={DIR_COLOR[selectedResult.direction] ?? INK2} />
                    <Pill label={selectedResult.category} color="#6366f1" />
                    {selectedResult.is_active && <Pill label="Active Now" color="#22c55e" />}
                  </Box>
                  <StatsMini st={selectedResult.stats} direction={selectedResult.direction} />
                  {selectedResult.best_threshold && (
                    <Box sx={{ mt: 1.5, p: 1, borderRadius: '8px', bgcolor: 'rgba(34,197,94,0.06)',
                      border: '1px solid rgba(34,197,94,0.15)' }}>
                      <Typography sx={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 700,
                        textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.5, ...JAKARTA }}>
                        Optimal Threshold
                      </Typography>
                      <Typography sx={{ fontSize: '0.7rem', color: INK, fontWeight: 700, ...JAKARTA }}>
                        {selectedResult.best_threshold.label}
                      </Typography>
                      <Box sx={{ display: 'flex', gap: 2, mt: 0.5 }}>
                        <Box>
                          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>Win Rate</Typography>
                          <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: '#22c55e' }}>
                            {selectedResult.best_threshold.win_rate.toFixed(1)}%
                          </Typography>
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>Avg 1M</Typography>
                          <Ret v={selectedResult.best_threshold.avg_1m} />
                        </Box>
                        <Box>
                          <Typography sx={{ fontSize: '0.75rem', color: INK3, ...JAKARTA }}>EV</Typography>
                          <Ret v={selectedResult.best_threshold.expected_value} />
                        </Box>
                      </Box>
                    </Box>
                  )}
                </Box>
              )}

              <Box sx={{ ...CARD, p: 2 }}>
                <SectionHead title="Current Readings" accent="#14b8a6" />
                <CurrentSignalsPanel report={report} />
              </Box>
            </Grid>
          </Grid>
        </>
      )}
    </Box>
  )
}
