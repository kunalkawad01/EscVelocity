import { useEffect, useState } from 'react'
import { Box, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material'
import { usePalette, useTokens } from '../../hooks/usePalette'
import { stockApi } from '../../api/stockApi'
import { MONO, SANS, GREEN, RED } from './chartsCommon'
import type { IntradayStatsResponse } from '../../types/stock'

function fmtPct(v: number | null | undefined): string {
  return v == null ? '—' : `${v >= 0 ? '+' : ''}${v.toFixed(2)}%`
}

function fmtPrice(v: number | null | undefined): string {
  return v == null ? '—' : v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function pctColor(v: number | null | undefined, fallback: string): string {
  if (v == null) return fallback
  return v > 0 ? GREEN : v < 0 ? RED : fallback
}

// vs-SMA read: LTP at/above the average is the bullish side of that window,
// below is bearish -- same price-vs-SMA convention indicators_service uses for
// TrendReading, just inlined here rather than fetched a second time.
function smaColor(sma: number | null | undefined, ltp: number | undefined, fallback: string): string {
  if (sma == null || ltp == null) return fallback
  return ltp >= sma ? GREEN : RED
}

// 5-year intraday (open->close) return percentile distribution + latest
// SMA20/50/100/200, fetched once per expanded Live Screener row from
// GET /api/stock/{symbol}/intraday-stats. Separate from MultiTimeframeGrid's
// own charts -- this is a stats table, not a chart, so it's its own fetch
// against stockApi rather than chartsApi.
export function IntradayStatsTable({ symbol, ltp }: { symbol: string; ltp: number | undefined }) {
  const { INK, INK2, INK3 } = usePalette()
  const { CARD, TH, TD } = useTokens()
  const [data, setData] = useState<IntradayStatsResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    stockApi.getIntradayStats(symbol, 5)
      .then(r => { if (!cancelled) setData(r) })
      .catch(e => { if (!cancelled) setError(e.message || 'Failed to load') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [symbol])

  const p = data?.percentiles
  const sma = data?.sma

  return (
    <Box sx={{ ...CARD, p: 1.5, mt: 1.5 }}>
      <Box sx={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', mb: 1, flexWrap: 'wrap', gap: 0.5 }}>
        <Typography sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 800, color: INK }}>
          5-Year Intraday Return %{' '}
          <Typography component="span" sx={{ ...MONO, fontSize: '0.56rem', color: INK3, fontWeight: 700 }}>
            (open → close, percentile distribution)
          </Typography>
        </Typography>
        {data && (
          <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>
            {data.n.toLocaleString('en-IN')} trading days
          </Typography>
        )}
      </Box>

      {loading ? (
        <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, textAlign: 'center', py: 2 }}>
          loading…
        </Typography>
      ) : error ? (
        <Typography sx={{ ...MONO, fontSize: '0.62rem', color: RED, textAlign: 'center', py: 2 }}>
          {error}
        </Typography>
      ) : !p ? (
        <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, textAlign: 'center', py: 2 }}>
          Not enough history.
        </Typography>
      ) : (
        <Table size="small" sx={{ mb: 2 }}>
          <TableHead>
            <TableRow>
              <TableCell sx={TH} align="center">Min</TableCell>
              <TableCell sx={TH} align="center">25th %ile</TableCell>
              <TableCell sx={TH} align="center">50th %ile (Median)</TableCell>
              <TableCell sx={TH} align="center">75th %ile</TableCell>
              <TableCell sx={TH} align="center">90th %ile</TableCell>
              <TableCell sx={TH} align="center">Max</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            <TableRow>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.min, INK2) }}>{fmtPct(p.min)}</Typography>
              </TableCell>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.p25, INK2) }}>{fmtPct(p.p25)}</Typography>
              </TableCell>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.p50, INK2) }}>{fmtPct(p.p50)}</Typography>
              </TableCell>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.p75, INK2) }}>{fmtPct(p.p75)}</Typography>
              </TableCell>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.p90, INK2) }}>{fmtPct(p.p90)}</Typography>
              </TableCell>
              <TableCell sx={TD} align="center">
                <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: pctColor(p.max, INK2) }}>{fmtPct(p.max)}</Typography>
              </TableCell>
            </TableRow>
          </TableBody>
        </Table>
      )}

      {!loading && !error && (
        <>
          <Typography sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 800, color: INK, mb: 1 }}>
            Moving Averages
          </Typography>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell sx={TH} align="center">SMA 20</TableCell>
                <TableCell sx={TH} align="center">SMA 50</TableCell>
                <TableCell sx={TH} align="center">SMA 100</TableCell>
                <TableCell sx={TH} align="center">SMA 200</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              <TableRow>
                <TableCell sx={TD} align="center">
                  <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: smaColor(sma?.sma20, ltp, INK2) }}>{fmtPrice(sma?.sma20)}</Typography>
                </TableCell>
                <TableCell sx={TD} align="center">
                  <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: smaColor(sma?.sma50, ltp, INK2) }}>{fmtPrice(sma?.sma50)}</Typography>
                </TableCell>
                <TableCell sx={TD} align="center">
                  <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: smaColor(sma?.sma100, ltp, INK2) }}>{fmtPrice(sma?.sma100)}</Typography>
                </TableCell>
                <TableCell sx={TD} align="center">
                  <Typography sx={{ ...MONO, fontSize: '0.76rem', fontWeight: 700, color: smaColor(sma?.sma200, ltp, INK2) }}>{fmtPrice(sma?.sma200)}</Typography>
                </TableCell>
              </TableRow>
            </TableBody>
          </Table>
          <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3, mt: 1 }}>
            SMA colored green when LTP ({fmtPrice(ltp)}) is at/above that average, red when below — a quick
            above/below-trend read, not a signal.
          </Typography>
        </>
      )}
      <Typography sx={{ ...MONO, fontSize: '0.56rem', color: INK3, mt: 1 }}>
        Intraday return = (close − open) / open × 100 per trading day — the stock's own in-session move, excluding
        the overnight gap.
      </Typography>
    </Box>
  )
}
