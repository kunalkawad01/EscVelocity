import { useState, useEffect, useRef } from 'react'
import {
  Box, Typography, LinearProgress, Select, MenuItem, OutlinedInput,
  Table, TableBody, TableCell, TableContainer, TableHead, TableRow, Tooltip,
  Collapse, CircularProgress,
} from '@mui/material'
import { indicatorsApi } from '../../api/indicatorsApi'
import { regimeApi } from '../../api/regimeApi'
import { regimeColor } from '../../types/regime'
import type {
  StockEdgeSummaryItem, StockEdgeSummaryResult,
  IndicatorEdgeReport, IndicatorEdgeResult, SignalStats, CurrentSignal,
} from '../../types/indicatorEdge'
import { GRADE_COLOR, DIR_COLOR } from '../../types/indicatorEdge'

import { usePalette, useTokens } from '../../hooks/usePalette'

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

function Ret({ v }: { v: number }) {
  const c = v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : '#94a3b8'
  return (
    <Typography component="span" sx={{ fontSize: '0.875rem', fontWeight: 600, color: c }}>
      {v > 0 ? '+' : ''}{v.toFixed(2)}%
    </Typography>
  )
}

// ─── Sort helpers ─────────────────────────────────────────────────────────────

type SortKey = 'edge_score' | 'win_rate' | 'avg_1m' | 'expected_value' | 'max_drawdown_1m' | 'occurrences' | 'symbol'

function sortItems(items: StockEdgeSummaryItem[], key: SortKey, asc: boolean) {
  return [...items].sort((a, b) => {
    const va = a[key] as number | string
    const vb = b[key] as number | string
    if (typeof va === 'string') return asc ? va.localeCompare(vb as string) : (vb as string).localeCompare(va)
    return asc ? (va - (vb as number)) : ((vb as number) - va)
  })
}

// ─── Distribution bar ─────────────────────────────────────────────────────────

const DIST_BUCKET_ORDER = ['<-10', '-10:-5', '-5:0', '0:5', '5:10', '>10']
const DIST_BUCKET_COLOR: Record<string, string> = {
  '<-10':   '#ef4444',
  '-10:-5': '#f87171',
  '-5:0':   '#fca5a5',
  '0:5':    '#86efac',
  '5:10':   '#22c55e',
  '>10':    '#15803d',
}
const DIST_BUCKET_LABEL: Record<string, string> = {
  '<-10':   '< -10%',
  '-10:-5': '-10 to -5%',
  '-5:0':   '-5 to 0%',
  '0:5':    '0 to +5%',
  '5:10':   '+5 to +10%',
  '>10':    '> +10%',
}

function DistributionBar({ dist }: { dist: Record<string, number> }) {
  const { INK3 } = usePalette()
  const total = DIST_BUCKET_ORDER.reduce((s, k) => s + (dist[k] ?? 0), 0)
  if (total === 0) return null
  return (
    <Box>
      <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: INK3,
        textTransform: 'uppercase', letterSpacing: '0.08em', mb: 0.75 }}>
        Return Distribution (1M)
      </Typography>
      <Box sx={{ display: 'flex', height: 32, borderRadius: '6px', overflow: 'hidden', gap: '1px' }}>
        {DIST_BUCKET_ORDER.map(key => {
          const count = dist[key] ?? 0
          const pct = total > 0 ? count / total * 100 : 0
          if (pct === 0) return null
          return (
            <Tooltip key={key} title={`${DIST_BUCKET_LABEL[key]}: ${count} occurrences (${pct.toFixed(0)}%)`} placement="top">
              <Box sx={{
                width: `${pct}%`, bgcolor: DIST_BUCKET_COLOR[key],
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                minWidth: pct > 5 ? 'auto' : '2px',
              }}>
                {pct > 10 && (
                  <Typography sx={{ fontSize: '0.55rem', fontWeight: 700, color: '#000', opacity: 0.75 }}>
                    {pct.toFixed(0)}%
                  </Typography>
                )}
              </Box>
            </Tooltip>
          )
        })}
      </Box>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 0.5 }}>
        <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>← Stock fell</Typography>
        <Typography sx={{ fontSize: '0.55rem', color: INK3 }}>Stock rose →</Typography>
      </Box>
    </Box>
  )
}

// ─── Stat row ────────────────────────────────────────────────────────────────

function StatRow({ label, children }: { label: string; children: React.ReactNode }) {
  const { INK3, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center',
      py: 0.5, borderBottom: `1px solid ${BORDER}` }}>
      <Typography sx={{ fontSize: '0.75rem', color: INK3 }}>{label}</Typography>
      <Box>{children}</Box>
    </Box>
  )
}

// ─── Natural-language interpretation ─────────────────────────────────────────

function buildNarrative(item: StockEdgeSummaryItem, result: IndicatorEdgeResult): string[] {
  const { symbol, direction, occurrences } = item
  const { avg_1m, win_rate, positive_prob, negative_prob, max_drawdown_1m, expected_value } = result.stats
  const isBearish = direction === 'Bearish'

  const lines: string[] = []

  // Sentence 1: signal frequency
  lines.push(
    `This signal has fired ${occurrences} times in the available history for ${symbol}.`
  )

  // Sentence 2: what happened after
  if (isBearish) {
    const fell = avg_1m < 0
    lines.push(
      fell
        ? `After the signal, ${symbol} fell ${Math.abs(avg_1m).toFixed(2)}% on average over the next month — consistent with the bearish expectation.`
        : `Despite the bearish signal, ${symbol} actually rose ${avg_1m.toFixed(2)}% on average over the next month — the signal fired but momentum continued upward.`
    )
  } else {
    const rose = avg_1m > 0
    lines.push(
      rose
        ? `After the signal, ${symbol} gained ${avg_1m.toFixed(2)}% on average over the next month — consistent with the bullish expectation.`
        : `Despite the bullish signal, ${symbol} fell ${Math.abs(avg_1m).toFixed(2)}% on average over the next month.`
    )
  }

  // Sentence 3: win rate interpretation
  const dirVerb = isBearish ? 'fell as expected' : 'rose as expected'
  let edgeLabel: string
  if (win_rate >= 65) edgeLabel = 'a strong, statistically meaningful edge'
  else if (win_rate >= 60) edgeLabel = 'a reliable edge'
  else if (win_rate >= 55) edgeLabel = 'a moderate edge'
  else if (win_rate >= 50) edgeLabel = 'a marginal edge'
  else edgeLabel = 'no directional edge'

  lines.push(
    `The stock ${dirVerb} on ${win_rate.toFixed(1)}% of occurrences, giving this signal ${edgeLabel}.`
  )

  // Sentence 4: EV
  if (expected_value > 0) {
    lines.push(
      `On average, each signal occurrence returned ${expected_value.toFixed(2)}% in the predicted direction (Expected Value).`
    )
  } else {
    lines.push(
      `The expected value is negative (${expected_value.toFixed(2)}%), meaning this signal loses money on average despite the win rate.`
    )
  }

  // Sentence 5: probabilities
  lines.push(
    `Unconditionally, the stock rose on ${positive_prob.toFixed(1)}% of days and fell on ${negative_prob.toFixed(1)}% of days following this signal.`
  )

  // Sentence 6: drawdown risk
  lines.push(
    `On average, a trade moved ${max_drawdown_1m.toFixed(2)}% against the position before the month was out (Max Adverse Excursion).`
  )

  return lines
}

// ─── Regime insight ──────────────────────────────────────────────────────────

function buildRegimeInsight(st: SignalStats, symbol: string, direction: string): string | null {
  const isBearish = direction === 'Bearish'

  const stockHighWR = st.regime_high_win_rate
  const stockLowWR  = st.regime_low_win_rate
  const mktHighWR   = st.mkt_regime_high_win_rate
  const mktLowWR    = st.mkt_regime_low_win_rate

  // Need at least one pair to draw a conclusion
  if (stockHighWR === null && stockLowWR === null) return null
  if (mktHighWR   === null && mktLowWR   === null) return null

  const stockLift = (stockHighWR !== null && stockLowWR !== null)
    ? Math.abs(stockHighWR - stockLowWR) : 0
  const mktLift = (mktHighWR !== null && mktLowWR !== null)
    ? Math.abs(mktHighWR - mktLowWR) : 0

  const stockBetterInLow = (stockLowWR ?? 0) > (stockHighWR ?? 0)
  const mktBetterInLow   = (mktLowWR   ?? 0) > (mktHighWR   ?? 0)

  const STRONG_LIFT  = 10   // ≥10% difference = strong regime effect
  const WEAK_LIFT    = 4    // <4% = negligible

  const stockStrong = stockLift >= STRONG_LIFT
  const mktStrong   = mktLift   >= STRONG_LIFT
  const stockWeak   = stockLift <  WEAK_LIFT
  const mktWeak     = mktLift   <  WEAK_LIFT

  // Case 1: Stock regime dominates, market regime is flat
  if (stockStrong && mktWeak) {
    const betterState = stockBetterInLow ? 'weakly structured (Regime < 60)' : 'strongly trending (Regime ≥ 60)'
    const signalType  = stockBetterInLow
      ? (isBearish ? 'a trend-exhaustion signal' : 'a mean-reversion signal')
      : 'a trend-continuation signal'
    return `The win rate swings ${stockLift.toFixed(0)}% based on ${symbol}'s own regime, but barely moves (${mktLift.toFixed(0)}%) based on the broader market. This is ${signalType} — it works best when ${symbol} itself is ${betterState}, regardless of what the market is doing.`
  }

  // Case 2: Market regime dominates, stock regime is flat
  if (mktStrong && stockWeak) {
    const betterState = mktBetterInLow ? 'weak (avg NIFTY regime < 60)' : 'strong (avg NIFTY regime ≥ 60)'
    return `The broader market environment drives this signal more than the stock's own structure. Win rate shifts ${mktLift.toFixed(0)}% based on market regime but only ${stockLift.toFixed(0)}% based on ${symbol}'s own regime. Look for this signal when the market is ${betterState}.`
  }

  // Case 3: Both matter, same direction
  if (stockStrong && mktStrong && stockBetterInLow === mktBetterInLow) {
    const betterState = stockBetterInLow ? 'weak regimes (both stock and market < 60)' : 'strong regimes (both ≥ 60)'
    return `Both stock and market regime amplify this signal. Win rate lifts ${stockLift.toFixed(0)}% on stock regime and ${mktLift.toFixed(0)}% on market regime. The best setups occur in ${betterState} — confluence of both conditions filters out the noise.`
  }

  // Case 4: Both matter, conflicting directions
  if (stockStrong && mktStrong && stockBetterInLow !== mktBetterInLow) {
    const stockCond = stockBetterInLow ? 'stock regime < 60' : 'stock regime ≥ 60'
    const mktCond   = mktBetterInLow   ? 'market regime < 60' : 'market regime ≥ 60'
    return `Stock and market regime pull in opposite directions. Win rate is higher when ${stockCond} (+${stockLift.toFixed(0)}% lift), but also higher when ${mktCond} (+${mktLift.toFixed(0)}% lift). This tension likely reflects sector rotation — ${symbol} diverges from the market, making signal timing context-dependent.`
  }

  // Case 5: Neither matters much
  if (stockWeak && mktWeak) {
    return `This signal shows consistent win rate regardless of regime. The ${st.win_rate.toFixed(1)}% hit rate holds across both strong and weak market environments — suggesting the edge comes from the indicator mechanics itself, not from structural context.`
  }

  // Case 6: Moderate effects — just report the dominant one
  const dominant      = stockLift >= mktLift ? 'stock' : 'market'
  const dominantLift  = stockLift >= mktLift ? stockLift : mktLift
  const dominantLow   = stockLift >= mktLift ? stockBetterInLow : mktBetterInLow
  const betterEnv     = dominantLow ? `${dominant} regime < 60` : `${dominant} regime ≥ 60`
  return `${symbol}'s ${dominant} regime is the stronger conditioning factor (+${dominantLift.toFixed(0)}% win rate lift). The signal has a higher hit rate when ${betterEnv}.`
}

// ─── Interpretation panel ────────────────────────────────────────────────────

function InterpretationPanel({
  item,
  result,
  currentSignal,
  onClose,
}: {
  item: StockEdgeSummaryItem
  result: IndicatorEdgeResult
  currentSignal: CurrentSignal | null
  onClose: () => void
}) {
  const { PAPER2, BG, INK, INK2, INK3, BORDER, CYAN } = usePalette()
  const st: SignalStats = result.stats
  const isBearish = item.direction === 'Bearish'
  const narrative = buildNarrative(item, result)
  const probColor = (p: number) => p >= 60 ? '#22c55e' : p >= 50 ? '#fbbf24' : '#ef4444'

  return (
    <Box sx={{
      mt: 1.5, p: 2.5, borderRadius: '12px',
      background: PAPER2,
      border: `1px solid ${DIR_COLOR[item.direction] ?? '#94a3b8'}28`,
      position: 'relative',
    }}>
      {/* Close button */}
      <Box
        component="button"
        onClick={onClose}
        sx={{
          position: 'absolute', top: 12, right: 12,
          background: 'none', border: 'none', cursor: 'pointer',
          color: INK3, fontSize: '0.7rem', fontWeight: 700,
          '&:hover': { color: INK2 },
        }}
      >
        ✕ Close
      </Box>

      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2, flexWrap: 'wrap', pr: 6 }}>
        <Typography sx={{ fontSize: '0.9rem', fontWeight: 900, color: INK }}>
          {item.symbol}
        </Typography>
        <Box sx={{ width: 1, height: 16, bgcolor: BORDER }} />
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK2 }}>
          {item.best_indicator}
        </Typography>
        <Typography sx={{ fontSize: '0.7rem', color: INK3 }}>
          {item.best_signal}
        </Typography>
        <Pill label={item.direction} color={DIR_COLOR[item.direction] ?? '#94a3b8'} />
        <Typography sx={{ fontSize: '1rem', fontWeight: 900, color: GRADE_COLOR[item.grade] ?? '#94a3b8' }}>
          {item.grade}
        </Typography>
        {item.is_active && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
            <Typography sx={{ fontSize: '0.75rem', color: '#22c55e', fontWeight: 700 }}>Active Now</Typography>
          </Box>
        )}
      </Box>

      {/* Current Reading */}
      {currentSignal && (
        <Box sx={{
          mb: 2, p: 1.25, borderRadius: '10px', display: 'flex',
          alignItems: 'center', gap: 2, flexWrap: 'wrap',
          bgcolor: currentSignal.is_active
            ? 'rgba(34,197,94,0.06)' : PAPER2,
          border: `1px solid ${currentSignal.is_active
            ? 'rgba(34,197,94,0.2)' : BORDER}`,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
              bgcolor: currentSignal.is_active ? '#22c55e' : BORDER,
              boxShadow: currentSignal.is_active ? '0 0 6px #22c55e' : 'none',
            }} />
            <Typography sx={{ fontSize: '0.75rem', fontWeight: 700,
              color: currentSignal.is_active ? '#22c55e' : INK3,
              textTransform: 'uppercase', letterSpacing: '0.07em' }}>
              {currentSignal.is_active ? 'Signal Active' : 'Signal Inactive'}
            </Typography>
          </Box>
          <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.75 }}>
            <Typography sx={{ fontSize: '0.6875rem', color: '#374151' }}>Current reading</Typography>
            <Typography sx={{ fontSize: '0.78rem', fontWeight: 800, color: INK }}>
              {currentSignal.current_value}
            </Typography>
          </Box>
          {currentSignal.is_active && (
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Typography sx={{ fontSize: '0.6875rem', color: '#374151' }}>Condition</Typography>
              <Pill
                label={currentSignal.signal_label}
                color={DIR_COLOR[item.direction] ?? '#94a3b8'}
              />
            </Box>
          )}
          {!currentSignal.is_active && (
            <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>
              Threshold not met — no active signal today
            </Typography>
          )}
        </Box>
      )}

      {/* Regime-conditional performance panels */}
      {(() => {
        const RegimeBuckets = ({
          title, subtitle,
          highWR, highEV, highN,
          lowWR,  lowEV,  lowN,
          overallWR,
        }: {
          title: string; subtitle: string
          highWR: number | null; highEV: number | null; highN: number
          lowWR:  number | null; lowEV:  number | null; lowN:  number
          overallWR: number
        }) => (
          <Box sx={{ mb: 2 }}>
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 0.75 }}>
              <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK3,
                textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                {title}
              </Typography>
              <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>{subtitle}</Typography>
            </Box>
            <Box sx={{ display: 'flex', gap: 1.5 }}>
              {/* ≥ 60 bucket */}
              <Box sx={{ flex: 1, p: 1.25, borderRadius: '8px',
                bgcolor: 'rgba(34,197,94,0.06)', border: '1px solid rgba(34,197,94,0.18)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: 1, bgcolor: '#22c55e' }} />
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#22c55e',
                    textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    ≥ 60 &nbsp;·&nbsp; {highN} signals
                  </Typography>
                </Box>
                {highWR !== null ? (
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>Win Rate</Typography>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 900,
                        color: highWR >= 60 ? '#22c55e' : highWR >= 50 ? '#fbbf24' : '#ef4444' }}>
                        {highWR.toFixed(1)}%
                      </Typography>
                    </Box>
                    {highEV !== null && (
                      <Box>
                        <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>EV</Typography>
                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 900,
                          color: highEV > 0 ? '#22c55e' : '#ef4444' }}>
                          {highEV > 0 ? '+' : ''}{highEV.toFixed(2)}%
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                      <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>vs Overall</Typography>
                      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700,
                        color: (highWR - overallWR) > 0 ? '#22c55e' : '#f87171' }}>
                        {(highWR - overallWR) > 0 ? '+' : ''}{(highWR - overallWR).toFixed(1)}%
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>Insufficient samples</Typography>
                )}
              </Box>
              {/* < 60 bucket */}
              <Box sx={{ flex: 1, p: 1.25, borderRadius: '8px',
                bgcolor: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.5 }}>
                  <Box sx={{ width: 7, height: 7, borderRadius: 1, bgcolor: '#ef4444' }} />
                  <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#ef4444',
                    textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                    &lt; 60 &nbsp;·&nbsp; {lowN} signals
                  </Typography>
                </Box>
                {lowWR !== null ? (
                  <Box sx={{ display: 'flex', gap: 2 }}>
                    <Box>
                      <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>Win Rate</Typography>
                      <Typography sx={{ fontSize: '0.85rem', fontWeight: 900,
                        color: lowWR >= 60 ? '#22c55e' : lowWR >= 50 ? '#fbbf24' : '#ef4444' }}>
                        {lowWR.toFixed(1)}%
                      </Typography>
                    </Box>
                    {lowEV !== null && (
                      <Box>
                        <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>EV</Typography>
                        <Typography sx={{ fontSize: '0.85rem', fontWeight: 900,
                          color: lowEV > 0 ? '#22c55e' : '#ef4444' }}>
                          {lowEV > 0 ? '+' : ''}{lowEV.toFixed(2)}%
                        </Typography>
                      </Box>
                    )}
                    <Box sx={{ ml: 'auto', textAlign: 'right' }}>
                      <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>vs Overall</Typography>
                      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700,
                        color: (lowWR - overallWR) > 0 ? '#22c55e' : '#f87171' }}>
                        {(lowWR - overallWR) > 0 ? '+' : ''}{(lowWR - overallWR).toFixed(1)}%
                      </Typography>
                    </Box>
                  </Box>
                ) : (
                  <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>Insufficient samples</Typography>
                )}
              </Box>
            </Box>
          </Box>
        )

        return (
          <>
            {(st.regime_high_win_rate !== null || st.regime_low_win_rate !== null) && (
              <RegimeBuckets
                title="Stock Regime Conditional" subtitle="(stock's own SMA structure)"
                highWR={st.regime_high_win_rate}  highEV={st.regime_high_ev}  highN={st.regime_high_occurrences}
                lowWR={st.regime_low_win_rate}     lowEV={st.regime_low_ev}    lowN={st.regime_low_occurrences}
                overallWR={st.win_rate}
              />
            )}
            {(st.mkt_regime_high_win_rate !== null || st.mkt_regime_low_win_rate !== null) && (
              <RegimeBuckets
                title="Market Regime Conditional" subtitle="(avg regime across all 50 NIFTY stocks)"
                highWR={st.mkt_regime_high_win_rate}  highEV={st.mkt_regime_high_ev}  highN={st.mkt_regime_high_occurrences}
                lowWR={st.mkt_regime_low_win_rate}     lowEV={st.mkt_regime_low_ev}    lowN={st.mkt_regime_low_occurrences}
                overallWR={st.win_rate}
              />
            )}
            {(() => {
              const insight = buildRegimeInsight(st, item.symbol, item.direction)
              if (!insight) return null
              return (
                <Box sx={{
                  mb: 2, p: 1.5, borderRadius: '8px',
                  bgcolor: 'rgba(251,191,36,0.06)',
                  border: '1px solid rgba(251,191,36,0.22)',
                }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, mb: 0.75 }}>
                    <Box sx={{ fontSize: '0.75rem', lineHeight: 1 }}>💡</Box>
                    <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: '#fbbf24',
                      textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                      Key Insight
                    </Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.875rem', color: INK2, lineHeight: 1.7 }}>
                    {insight}
                  </Typography>
                </Box>
              )
            })()}
          </>
        )
      })()}

      <Box sx={{ display: 'flex', gap: 3, flexDirection: { xs: 'column', md: 'row' } }}>
        {/* Left: narrative */}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK3,
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            Interpretation
          </Typography>
          <Box sx={{
            p: 1.5, borderRadius: '8px',
            bgcolor: PAPER2,
            border: `1px solid ${BORDER}`,
          }}>
            {narrative.map((line, i) => (
              <Typography key={i} sx={{
                fontSize: '0.875rem', color: INK2, lineHeight: 1.7,
                mb: i < narrative.length - 1 ? 0.75 : 0,
              }}>
                {line}
              </Typography>
            ))}
          </Box>
        </Box>

        {/* Right: stats + distribution */}
        <Box sx={{ width: { xs: '100%', md: 280 }, flexShrink: 0 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK3,
            textTransform: 'uppercase', letterSpacing: '0.08em', mb: 1 }}>
            Historical Stats
          </Typography>
          <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: PAPER2,
            border: `1px solid ${BORDER}` }}>
            <StatRow label="Occurrences">
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: INK }}>
                {st.occurrences}
              </Typography>
            </StatRow>
            <StatRow label="Avg Forward Return 1W"><Ret v={st.avg_1w} /></StatRow>
            <StatRow label="Avg Forward Return 2W"><Ret v={st.avg_2w} /></StatRow>
            <StatRow label="Avg Forward Return 1M"><Ret v={st.avg_1m} /></StatRow>
            <StatRow label="Median 1M"><Ret v={st.median_1m} /></StatRow>
            <StatRow label={`Win Rate (${isBearish ? 'stock fell' : 'stock rose'})`}>
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 700, color: probColor(st.win_rate) }}>
                {st.win_rate.toFixed(1)}%
              </Typography>
            </StatRow>
            <StatRow label="Stock ↑ Probability">
              <Typography sx={{ fontSize: '0.875rem', color: st.positive_prob > 50 ? '#22c55e' : '#94a3b8' }}>
                {st.positive_prob.toFixed(1)}%
              </Typography>
            </StatRow>
            <StatRow label="Stock ↓ Probability">
              <Typography sx={{ fontSize: '0.875rem', color: st.negative_prob > 50 ? '#22c55e' : '#94a3b8' }}>
                {st.negative_prob.toFixed(1)}%
              </Typography>
            </StatRow>
            <StatRow label="Max Adverse Excursion">
              <Typography sx={{ fontSize: '0.875rem', fontWeight: 600, color: '#f87171' }}>
                {st.max_drawdown_1m.toFixed(2)}%
              </Typography>
            </StatRow>
            <StatRow label="Expected Value"><Ret v={st.expected_value} /></StatRow>
            <StatRow label="Std Deviation">
              <Typography sx={{ fontSize: '0.875rem', color: INK3 }}>
                {st.std_1m.toFixed(2)}%
              </Typography>
            </StatRow>
            <Box sx={{ mt: 1.5 }}>
              <DistributionBar dist={st.distribution} />
            </Box>
          </Box>
        </Box>
      </Box>
    </Box>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function EdgeSummaryTable({ onSymbolSelect }: { onSymbolSelect?: (s: string) => void }) {
  const { BG, PAPER, PAPER2, INK, INK2, INK3, BORDER, CYAN, CARD, TH, TD, t1, t2, t3, INPUT_SX } = useTokens()
  const [loading,    setLoading]    = useState(false)
  const [error,      setError]      = useState<string | null>(null)
  const [data,       setData]       = useState<StockEdgeSummaryResult | null>(null)
  const [regimeMap,  setRegimeMap]  = useState<Record<string, { score: number; label: string }>>({})
  const [sortKey,    setSortKey]    = useState<SortKey>('edge_score')
  const [sortAsc,    setSortAsc]    = useState(false)
  const [filterGrade,    setFilterGrade]    = useState('All')
  const [filterDir,      setFilterDir]      = useState('All')
  const [filterActive,   setFilterActive]   = useState('All')
  const [filterIndicator,setFilterIndicator]= useState('All')
  const [search,         setSearch]         = useState('')

  // Interpretation panel state
  const [expandedSymbol,        setExpandedSymbol]        = useState<string | null>(null)
  const [expandedItem,          setExpandedItem]          = useState<StockEdgeSummaryItem | null>(null)
  const [expandedResult,        setExpandedResult]        = useState<IndicatorEdgeResult | null>(null)
  const [expandedCurrentSignal, setExpandedCurrentSignal] = useState<CurrentSignal | null>(null)
  const [expandLoading,         setExpandLoading]         = useState(false)
  const [expandError,           setExpandError]           = useState<string | null>(null)
  const reportCache = useRef<Record<string, IndicatorEdgeReport>>({})
  const panelRef = useRef<HTMLDivElement | null>(null)

  const run = async () => {
    setLoading(true)
    setError(null)
    try {
      const [summary, snapshot] = await Promise.all([
        indicatorsApi.getEdgeSummary(),
        regimeApi.getSnapshot().catch(() => null),
      ])
      setData(summary)
      if (snapshot) {
        const map: Record<string, { score: number; label: string }> = {}
        snapshot.stocks.forEach(s => { map[s.symbol] = { score: s.regime_score, label: s.regime_label } })
        setRegimeMap(map)
      }
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { run() }, [])

  const handleRowClick = async (item: StockEdgeSummaryItem) => {
    // Toggle off if same row clicked again
    if (expandedSymbol === item.symbol) {
      setExpandedSymbol(null)
      setExpandedItem(null)
      setExpandedResult(null)
      setExpandedCurrentSignal(null)
      return
    }

    setExpandedSymbol(item.symbol)
    setExpandedItem(item)
    setExpandedResult(null)
    setExpandedCurrentSignal(null)
    setExpandError(null)

    // Scroll panel into view after state update
    setTimeout(() => panelRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100)

    try {
      setExpandLoading(true)
      let report = reportCache.current[item.symbol]
      if (!report) {
        report = await indicatorsApi.getEdge(item.symbol)
        reportCache.current[item.symbol] = report
      }
      const matched = report.results.find(r => r.signal === item.best_signal) ?? report.results[0] ?? null
      setExpandedResult(matched)
      // Find the current reading for this indicator
      const cs = matched
        ? (report.current_signals.find(s => s.indicator === matched.name) ?? null)
        : null
      setExpandedCurrentSignal(cs)
    } catch (e: unknown) {
      setExpandError(e instanceof Error ? e.message : 'Failed to load detail')
    } finally {
      setExpandLoading(false)
    }
  }

  const allIndicators = data
    ? [...new Set(data.items.map(i => i.best_indicator))].sort()
    : []

  const rows = data
    ? sortItems(
        data.items.filter(it => {
          if (filterGrade     !== 'All' && it.grade          !== filterGrade)     return false
          if (filterDir       !== 'All' && it.direction       !== filterDir)       return false
          if (filterActive    !== 'All' && String(it.is_active) !== filterActive)  return false
          if (filterIndicator !== 'All' && it.best_indicator  !== filterIndicator) return false
          if (search && !it.symbol.includes(search.toUpperCase())) return false
          return true
        }),
        sortKey, sortAsc,
      )
    : []

  function SortTH({ label, col }: { label: string; col: SortKey }) {
    const active = sortKey === col
    return (
      <TableCell
        sx={{ ...TH, cursor: 'pointer', userSelect: 'none',
          color: active ? INK : INK3,
          '&:hover': { color: INK2 } }}
        onClick={() => { if (active) setSortAsc(a => !a); else { setSortKey(col); setSortAsc(false) } }}
      >
        {label}{active ? (sortAsc ? ' ↑' : ' ↓') : ''}
      </TableCell>
    )
  }

  const gradeCount = data
    ? ['A+','A','B','C','D'].reduce((acc, g) => ({ ...acc, [g]: data.items.filter(i => i.grade === g).length }), {} as Record<string, number>)
    : {}
  const activeCount = data?.items.filter(i => i.is_active).length ?? 0

  return (
    <Box sx={{ ...CARD, mb: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2, flexWrap: 'wrap' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
          <Box sx={{ width: 3, height: 20, borderRadius: '2px', bgcolor: CYAN, flexShrink: 0, boxShadow: `0 0 8px ${CYAN}80` }} />
          <Typography sx={{ fontSize: '0.9rem', fontWeight: 700, color: INK, letterSpacing: '-0.01em' }}>
            Stock vs Best Indicator
          </Typography>
        </Box>
        {data && (
          <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>
            {data.total_symbols} symbols · {data.computed_at}
          </Typography>
        )}
        <Box component="button" onClick={run} disabled={loading} sx={{
          ml: 'auto', px: 2, py: 0.75, borderRadius: '8px', fontSize: '0.875rem', fontWeight: 700,
          cursor: loading ? 'wait' : 'pointer',
          background: 'linear-gradient(135deg,#14b8a6,#0d9488)',
          color: '#fff', border: 'none', opacity: loading ? 0.6 : 1,
          '&:hover:not(:disabled)': { opacity: 0.85 },
        }}>
          {loading ? 'Loading…' : 'Refresh'}
        </Box>
      </Box>

      {loading && (
        <>
          <LinearProgress sx={{ borderRadius: 1, mb: 1, '& .MuiLinearProgress-bar': { bgcolor: '#14b8a6' } }} />
          <Typography sx={{ fontSize: '0.75rem', color: '#374151', mb: 2 }}>
            Analysing all stocks — this may take 10–30 seconds…
          </Typography>
        </>
      )}

      {error && (
        <Box sx={{ p: 1.5, borderRadius: '8px', bgcolor: 'rgba(239,68,68,0.08)',
          border: '1px solid rgba(239,68,68,0.2)', mb: 2 }}>
          <Typography sx={{ fontSize: '0.875rem', color: '#ef4444' }}>{error}</Typography>
        </Box>
      )}

      {!data && !loading && (
        <Box sx={{ textAlign: 'center', py: 5 }}>
          <Typography sx={{ fontSize: '0.75rem', color: '#374151' }}>
            Run all stocks to see which indicator works best for each symbol.
          </Typography>
        </Box>
      )}

      {data && (
        <>
          {/* Grade distribution + active count */}
          <Box sx={{ display: 'flex', gap: 2, mb: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            {['A+','A','B','C','D'].map(g => (
              <Box key={g} sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                <Typography sx={{ fontSize: '0.7rem', fontWeight: 800, color: GRADE_COLOR[g] }}>{g}</Typography>
                <Typography sx={{ fontSize: '0.75rem', color: INK3 }}>{gradeCount[g] ?? 0}</Typography>
              </Box>
            ))}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, ml: 1 }}>
              <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 5px #22c55e' }} />
              <Typography sx={{ fontSize: '0.75rem', color: INK2 }}>{activeCount} active signals</Typography>
            </Box>
            {expandedSymbol && (
              <Typography sx={{ fontSize: '0.75rem', color: '#14b8a6', ml: 'auto' }}>
                Showing interpretation for {expandedSymbol}
              </Typography>
            )}
          </Box>

          {/* Filters */}
          <Box sx={{ display: 'flex', gap: 1, mb: 1.5, flexWrap: 'wrap', alignItems: 'center' }}>
            <OutlinedInput
              size="small" placeholder="Search symbol…" value={search}
              onChange={e => setSearch(e.target.value)}
              sx={{ ...INPUT_SX, width: 130 }}
            />
            <Select value={filterGrade} onChange={e => setFilterGrade(e.target.value as string)}
              input={<OutlinedInput sx={INPUT_SX} />} sx={{ minWidth: 100, ...INPUT_SX }}>
              <MenuItem value="All" sx={{ fontSize: '0.875rem' }}>All Grades</MenuItem>
              {['A+','A','B','C','D'].map(g => (
                <MenuItem key={g} value={g} sx={{ fontSize: '0.875rem', color: GRADE_COLOR[g] }}>{g}</MenuItem>
              ))}
            </Select>
            <Select value={filterDir} onChange={e => setFilterDir(e.target.value as string)}
              input={<OutlinedInput sx={INPUT_SX} />} sx={{ minWidth: 110, ...INPUT_SX }}>
              <MenuItem value="All" sx={{ fontSize: '0.875rem' }}>All Direction</MenuItem>
              {['Bullish','Bearish','Mixed'].map(d => (
                <MenuItem key={d} value={d} sx={{ fontSize: '0.875rem' }}>{d}</MenuItem>
              ))}
            </Select>
            <Select value={filterIndicator} onChange={e => setFilterIndicator(e.target.value as string)}
              input={<OutlinedInput sx={INPUT_SX} />} sx={{ minWidth: 130, ...INPUT_SX }}>
              <MenuItem value="All" sx={{ fontSize: '0.875rem' }}>All Indicators</MenuItem>
              {allIndicators.map(ind => (
                <MenuItem key={ind} value={ind} sx={{ fontSize: '0.875rem' }}>{ind}</MenuItem>
              ))}
            </Select>
            <Select value={filterActive} onChange={e => setFilterActive(e.target.value as string)}
              input={<OutlinedInput sx={INPUT_SX} />} sx={{ minWidth: 110, ...INPUT_SX }}>
              <MenuItem value="All" sx={{ fontSize: '0.875rem' }}>All Status</MenuItem>
              <MenuItem value="true"  sx={{ fontSize: '0.875rem' }}>Active Only</MenuItem>
              <MenuItem value="false" sx={{ fontSize: '0.875rem' }}>Inactive</MenuItem>
            </Select>
            {(filterGrade !== 'All' || filterDir !== 'All' || filterActive !== 'All' || filterIndicator !== 'All' || search) && (
              <Box component="button"
                onClick={() => { setFilterGrade('All'); setFilterDir('All'); setFilterActive('All'); setFilterIndicator('All'); setSearch('') }}
                sx={{ px: 1.25, py: 0.4, borderRadius: '6px', fontSize: '0.75rem', cursor: 'pointer',
                  border: `1px solid ${BORDER}`, bgcolor: 'transparent', color: INK3,
                  '&:hover': { color: INK2 } }}>
                Clear
              </Box>
            )}
            <Typography sx={{ fontSize: '0.75rem', color: '#374151', ml: 'auto' }}>
              {rows.length} / {data.items.length} · click a row to interpret
            </Typography>
          </Box>

          <TableContainer sx={{ maxHeight: 520, borderRadius: '12px', border: `1px solid ${BORDER}` }}>
            <Table stickyHeader size="small">
              <TableHead>
                <TableRow>
                  <SortTH label="Symbol"      col="symbol" />
                  <TableCell sx={TH}>Regime</TableCell>
                  <TableCell sx={TH}>Best Indicator</TableCell>
                  <TableCell sx={TH}>Best Signal</TableCell>
                  <TableCell sx={TH}>Dir</TableCell>
                  <TableCell sx={TH}>Grade</TableCell>
                  <SortTH label="Edge Score"   col="edge_score" />
                  <SortTH label="Win Rate"     col="win_rate" />
                  <SortTH label="Avg 1M"       col="avg_1m" />
                  <SortTH label="Stock ↓ Prob" col="edge_score" />
                  <SortTH label="Max DD"       col="max_drawdown_1m" />
                  <SortTH label="EV"           col="expected_value" />
                  <SortTH label="Samples"      col="occurrences" />
                  <TableCell sx={TH}>Active</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map(it => {
                  const isExpanded = expandedSymbol === it.symbol
                  return (
                    <TableRow
                      key={it.symbol}
                      onClick={() => handleRowClick(it)}
                      sx={{
                        cursor: 'pointer',
                        bgcolor: isExpanded ? `${CYAN}0D` : PAPER,
                        '&:hover td': { bgcolor: `${CYAN}08` },
                        transition: 'background 0.15s',
                      }}
                    >
                      {/* T1+CYAN: primary identifier */}
                      <TableCell sx={{ ...TD, ...t1, color: CYAN }}>{it.symbol}</TableCell>
                      {/* T3 context: regime mini-gauge */}
                      <TableCell sx={{ ...TD, minWidth: 56 }}>
                        {regimeMap[it.symbol] ? (
                          <Tooltip title={regimeMap[it.symbol].label} placement="top">
                            <Box>
                              <Typography sx={{ ...t3, fontWeight: 700, color: regimeColor(regimeMap[it.symbol].score), lineHeight: 1.2 }}>
                                {regimeMap[it.symbol].score.toFixed(0)}
                              </Typography>
                              <Box sx={{ mt: 0.3, height: 3, borderRadius: 1, bgcolor: BORDER, overflow: 'hidden' }}>
                                <Box sx={{ width: `${regimeMap[it.symbol].score}%`, height: '100%', bgcolor: regimeColor(regimeMap[it.symbol].score), borderRadius: 1 }} />
                              </Box>
                            </Box>
                          </Tooltip>
                        ) : (
                          <Typography sx={t3}>—</Typography>
                        )}
                      </TableCell>
                      {/* T1: best indicator is a primary finding */}
                      <TableCell sx={{ ...TD, ...t1 }}>{it.best_indicator}</TableCell>
                      {/* T2: signal description is secondary context */}
                      <TableCell sx={{ ...TD, maxWidth: 200 }}>
                        <Tooltip title={it.best_signal} placement="top">
                          <Typography sx={{ ...t2, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
                            {it.best_signal}
                          </Typography>
                        </Tooltip>
                      </TableCell>
                      {/* Pill */}
                      <TableCell sx={TD}>
                        <Pill label={it.direction} color={DIR_COLOR[it.direction] ?? '#94a3b8'} />
                      </TableCell>
                      {/* Grade: large, grade-colored — keep bold prominence */}
                      <TableCell sx={TD}>
                        <Typography sx={{ fontSize: '0.875rem', fontWeight: 900, color: GRADE_COLOR[it.grade] ?? '#94a3b8' }}>
                          {it.grade}
                        </Typography>
                      </TableCell>
                      {/* T1: edge score is the headline metric */}
                      <TableCell sx={{ ...TD, ...t1 }}>{it.edge_score.toFixed(3)}</TableCell>
                      {/* T1 semantic: win rate colored by quality */}
                      <TableCell sx={{ ...TD, ...t1, color: it.win_rate >= 60 ? '#22c55e' : it.win_rate >= 50 ? '#fbbf24' : '#ef4444' }}>
                        {it.win_rate.toFixed(1)}%
                      </TableCell>
                      {/* Ret component handles color internally */}
                      <TableCell sx={TD}><Ret v={it.avg_1m} /></TableCell>
                      {/* T2 risk: negative probabilities — always red */}
                      <TableCell sx={{ ...TD, ...t2, color: '#ef4444' }}>
                        {it.negative_prob.toFixed(1)}%
                      </TableCell>
                      <TableCell sx={{ ...TD, ...t2, color: '#ef4444' }}>
                        {it.max_drawdown_1m.toFixed(2)}%
                      </TableCell>
                      <TableCell sx={TD}><Ret v={it.expected_value} /></TableCell>
                      {/* T3: sample count is meta context */}
                      <TableCell sx={{ ...TD, ...t3 }}>{it.occurrences}</TableCell>
                      {/* Dot indicator */}
                      <TableCell sx={TD}>
                        {it.is_active
                          ? <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: '#22c55e', boxShadow: '0 0 6px #22c55e' }} />
                          : <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: BORDER }} />}
                      </TableCell>
                    </TableRow>
                  )
                })}
                {rows.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={13} sx={{ ...TD, ...t3, textAlign: 'center', py: 3 }}>
                      No stocks match the current filters.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </TableContainer>

          {/* Interpretation panel — rendered below the table, outside the scroll container */}
          <Collapse in={!!expandedSymbol} timeout={200}>
            <Box ref={panelRef}>
              {expandLoading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, p: 2, mt: 1.5 }}>
                  <CircularProgress size={16} sx={{ color: '#14b8a6' }} />
                  <Typography sx={{ fontSize: '0.7rem', color: '#374151' }}>
                    Loading historical analysis for {expandedSymbol}…
                  </Typography>
                </Box>
              )}
              {expandError && (
                <Box sx={{ p: 1.5, mt: 1.5, borderRadius: '8px',
                  bgcolor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)' }}>
                  <Typography sx={{ fontSize: '0.875rem', color: '#ef4444' }}>{expandError}</Typography>
                </Box>
              )}
              {expandedItem && expandedResult && !expandLoading && (
                <InterpretationPanel
                  item={expandedItem}
                  result={expandedResult}
                  currentSignal={expandedCurrentSignal}
                  onClose={() => {
                    setExpandedSymbol(null)
                    setExpandedItem(null)
                    setExpandedResult(null)
                    setExpandedCurrentSignal(null)
                  }}
                />
              )}
            </Box>
          </Collapse>
        </>
      )}
    </Box>
  )
}
