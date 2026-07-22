/**
 * F&O Momentum Radar — /fno-momentum
 *
 * Bifurcated futures-positioning lists over the NSE F&O universe:
 *   1. OI GAINERS      — futures open interest rising vs prior session
 *   2. SHORT COVERING  — price up while futures OI falls (shorts exiting)
 *
 * A stock appears only if it also qualifies on ≥1 momentum criterion:
 *   BIG_MOVE_PREV — last session beyond ±5% · TOP_SECTOR — best sector today
 *   GAP_0915 — 9:15 open beyond ±2% vs prev close.
 * Each row shows its criteria as chips; rows sorted by live % change.
 * Polls every 5s while state === LIVE.
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import {
  Box, Button, Chip, Container, Grid, Table, TableBody, TableCell, TableHead,
  TableRow, Tooltip, Typography,
} from '@mui/material'
import DownloadIcon from '@mui/icons-material/Download'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { fnoMomentumApi } from '../api/fnoMomentumApi'
import type { FnoMomentumResponse, MomentumRow, MomentumCriterion } from '../types/fnoMomentum'

const GREEN = '#22c55e'
const RED = '#ef4444'
const AMBER = '#fbbf24'
const MONO = "'IBM Plex Mono', monospace"
const SANS = "'IBM Plex Sans', sans-serif"

const CRITERIA_META: Record<MomentumCriterion, { label: string; color: string; hint: string }> = {
  BIG_MOVE_PREV: { label: '±5% PREV', color: '#8b5cf6', hint: 'Last trading session moved beyond ±5%' },
  TOP_SECTOR: { label: 'TOP SECTOR', color: '#14b8a6', hint: 'Belongs to today’s single best-performing F&O sector' },
  GAP_0915: { label: '±2% @ 9:15', color: '#f59e0b', hint: '9:15 open gapped beyond ±2% vs previous close' },
}

function fmtPct(v: number | undefined | null, digits = 2): string {
  if (v === undefined || v === null) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(digits)}%`
}

function pctColor(v: number | undefined | null): string {
  if (v === undefined || v === null) return 'inherit'
  return v > 0 ? GREEN : v < 0 ? RED : AMBER
}

const CRIT_SHORT: Record<MomentumCriterion, string> = {
  BIG_MOVE_PREV: '±5% prev',
  TOP_SECTOR: 'top sector',
  GAP_0915: '±2% @9:15',
}

function downloadPdf(data: FnoMomentumResponse) {
  const doc = new jsPDF({ orientation: 'landscape', unit: 'pt' })
  const pageW = doc.internal.pageSize.getWidth()
  const green: [number, number, number] = [22, 163, 74]
  const red: [number, number, number] = [220, 38, 38]
  const ink: [number, number, number] = [30, 41, 59]
  const muted: [number, number, number] = [100, 116, 139]

  doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...ink)
  doc.text('F&O Momentum Radar', 40, 42)
  doc.setFont('helvetica', 'normal').setFontSize(9).setTextColor(...muted)
  doc.text(
    `Session ${data.session_date}  ·  as of ${data.as_of} IST  ·  ${data.state}  ·  data ${data.data_mode}${data.oi_live ? '  ·  OI live' : '  ·  OI EOD'}`,
    40, 58,
  )
  const sectors = data.top_sectors
    .map(s => `${s.sector} (${s.avg_ret > 0 ? '+' : ''}${s.avg_ret.toFixed(2)}%)`)
    .join('   ')
  doc.text(`Best performing sector: ${sectors}`, 40, 72)

  const fmt = (v?: number | null) =>
    v === undefined || v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(2)}%`

  const toBody = (rows: MomentumRow[]) =>
    rows.map((r, i) => [
      String(i + 1), r.symbol, r.sector ?? '—',
      r.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 }),
      fmt(r.change_pct), fmt(r.oi_chg_pct), fmt(r.last_session_ret), fmt(r.gap_0915_pct),
      r.criteria.map(c => CRIT_SHORT[c]).join(', '),
    ])

  // Sign-colored % columns (Chg / OI Chg / Prev Sess / 9:15 Gap)
  const pctCols = new Set([4, 5, 6, 7])
  let y = 88
  const addSection = (title: string, subtitle: string, rows: MomentumRow[]) => {
    if (y > doc.internal.pageSize.getHeight() - 130) {
      doc.addPage()
      y = 40
    }
    doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...ink)
    doc.text(`${title}  (${rows.length})`, 40, y + 14)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...muted)
    doc.text(subtitle, 40, y + 26)
    autoTable(doc, {
      startY: y + 34,
      margin: { left: 40, right: 40 },
      head: [['#', 'Stock', 'Sector', 'LTP', 'Chg %', 'OI Chg %', 'Prev Sess', '9:15 Gap', 'Criteria']],
      body: rows.length ? toBody(rows) : [['—', 'No stocks qualified', '', '', '', '', '', '', '']],
      styles: { font: 'helvetica', fontSize: 8, cellPadding: 4, textColor: ink },
      headStyles: { fillColor: [30, 41, 59], textColor: 255, fontSize: 7.5, fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [244, 247, 251] },
      columnStyles: {
        0: { cellWidth: 24 }, 3: { halign: 'right' }, 4: { halign: 'right', fontStyle: 'bold' },
        5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' },
      },
      didParseCell: hook => {
        if (hook.section === 'body' && pctCols.has(hook.column.index)) {
          const v = String(hook.cell.raw)
          if (v.startsWith('+')) hook.cell.styles.textColor = green
          else if (v.startsWith('-')) hook.cell.styles.textColor = red
        }
      },
    })
    y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 14
  }

  addSection('OI Gainers — Futures Open Interest Rising', 'Fresh futures positions added vs prior session; sorted by live day change %.', data.oi_gainers)
  addSection('Short Covering — Price Up, OI Falling', 'Shorts buying back (price up while futures OI falls); sorted by live day change %.', data.short_covering)
  addSection(`Live Movers — Above +${data.thresholds.live_move_pct}%`, 'Whole F&O universe, unrelated to OI/quadrant buckets; sorted by live day change %.', data.movers_up)
  addSection(`Live Movers — Below -${data.thresholds.live_move_pct}%`, 'Whole F&O universe, unrelated to OI/quadrant buckets; sorted by live day change %.', data.movers_down)

  doc.setFontSize(7.5).setTextColor(...muted)
  doc.text(
    `Qualifiers — ±5% prev: last session beyond ±5% · top sector: today's best-performing F&O sector · ±2% @9:15: open gapped beyond ±2% vs prev close. Generated by MarketDNA.`,
    40, Math.min(y + 6, doc.internal.pageSize.getHeight() - 24), { maxWidth: pageW - 80 },
  )

  doc.save(`fno-momentum_${data.session_date}_${data.as_of.slice(11, 16).replace(':', '')}.pdf`)
}

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ fontSize: '0.82rem', fontWeight: 800, color: INK, fontFamily: SANS }}>
        {title}
      </Typography>
      {meta && (
        <Typography sx={{ fontSize: '0.7rem', color: INK3, fontFamily: MONO, ml: 'auto' }}>
          {meta}
        </Typography>
      )}
    </Box>
  )
}

function CriteriaChips({ criteria }: { criteria: MomentumCriterion[] }) {
  return (
    <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
      {criteria.map(c => {
        const m = CRITERIA_META[c]
        return (
          <Tooltip key={c} title={m.hint} arrow>
            <Chip
              label={m.label}
              size="small"
              sx={{
                height: 18, fontSize: '0.58rem', fontWeight: 700, fontFamily: MONO,
                color: m.color, bgcolor: `${m.color}1A`, border: `1px solid ${m.color}55`,
                '& .MuiChip-label': { px: 0.75 },
              }}
            />
          </Tooltip>
        )
      })}
    </Box>
  )
}

function BucketTable({ rows, emptyNote }: { rows: MomentumRow[]; emptyNote: string }) {
  const { INK, INK2, INK3, CYAN } = usePalette()
  const { TH, TD } = useTokens()
  if (rows.length === 0) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.78rem', color: INK3, fontFamily: SANS }}>
          {emptyNote}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={TH}>Stock</TableCell>
            <TableCell sx={TH} align="right">LTP</TableCell>
            <TableCell sx={TH} align="right">Chg %</TableCell>
            <TableCell sx={TH} align="right">OI Chg %</TableCell>
            <TableCell sx={TH} align="right">Prev Sess</TableCell>
            <TableCell sx={TH} align="right">9:15 Gap</TableCell>
            <TableCell sx={TH}>Criteria</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.symbol} hover>
              <TableCell sx={TD}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: INK, fontFamily: MONO }}>
                  {r.symbol}
                </Typography>
                {r.sector && (
                  <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: SANS }}>
                    {r.sector}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: INK2, fontFamily: MONO }}>
                  {r.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Typography>
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: MONO, color: pctColor(r.change_pct) }}>
                  {fmtPct(r.change_pct)}
                </Typography>
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.74rem', fontFamily: MONO, color: pctColor(r.oi_chg_pct) }}>
                  {fmtPct(r.oi_chg_pct)}
                </Typography>
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.74rem', fontFamily: MONO, color: pctColor(r.last_session_ret) }}>
                  {fmtPct(r.last_session_ret)}
                </Typography>
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.74rem', fontFamily: MONO, color: pctColor(r.gap_0915_pct) }}>
                  {fmtPct(r.gap_0915_pct)}
                </Typography>
              </TableCell>
              <TableCell sx={TD}>
                <CriteriaChips criteria={r.criteria} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: SANS, mt: 1, px: 0.5 }}>
        Sorted by live % change vs previous close. OI from current-month futures.{' '}
        <Box component="span" sx={{ color: CYAN }}>{rows.length}</Box> stocks qualified.
      </Typography>
    </Box>
  )
}

function MoversTable({ rows, emptyNote }: { rows: MomentumRow[]; emptyNote: string }) {
  const { INK, INK2, INK3, CYAN } = usePalette()
  const { TH, TD } = useTokens()
  if (rows.length === 0) {
    return (
      <Box sx={{ py: 5, textAlign: 'center' }}>
        <Typography sx={{ fontSize: '0.78rem', color: INK3, fontFamily: SANS }}>
          {emptyNote}
        </Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small">
        <TableHead>
          <TableRow>
            <TableCell sx={TH}>Stock</TableCell>
            <TableCell sx={TH} align="right">LTP</TableCell>
            <TableCell sx={TH} align="right">Chg %</TableCell>
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map(r => (
            <TableRow key={r.symbol} hover>
              <TableCell sx={TD}>
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, color: INK, fontFamily: MONO }}>
                  {r.symbol}
                </Typography>
                {r.sector && (
                  <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: SANS }}>
                    {r.sector}
                  </Typography>
                )}
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: INK2, fontFamily: MONO }}>
                  {r.ltp.toLocaleString('en-IN', { minimumFractionDigits: 2 })}
                </Typography>
              </TableCell>
              <TableCell sx={TD} align="right">
                <Typography sx={{ fontSize: '0.78rem', fontWeight: 700, fontFamily: MONO, color: pctColor(r.change_pct) }}>
                  {fmtPct(r.change_pct)}
                </Typography>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: SANS, mt: 1, px: 0.5 }}>
        Sorted by live % change vs previous close.{' '}
        <Box component="span" sx={{ color: CYAN }}>{rows.length}</Box> stocks.
      </Typography>
    </Box>
  )
}

export default function FnoMomentumPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()

  const [data, setData] = useState<FnoMomentumResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const load = useCallback(() => {
    fnoMomentumApi.getScan()
      .then(d => { setData(d); setError(null) })
      .catch(e => setError(e.message || 'Failed to load'))
  }, [])

  useEffect(() => {
    load()
  }, [load])

  // Poll every 5s only while the market is LIVE
  useEffect(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    if (data?.state === 'LIVE') {
      timerRef.current = setInterval(load, 5000)
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current) }
  }, [data?.state, load])

  const isLive = data?.state === 'LIVE'
  const stateColor = isLive ? GREEN : data?.state === 'PRE_OPEN' ? AMBER : INK3

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box
        sx={{
          background: mode === 'dark'
            ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
            : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
          borderBottom: `1px solid ${BORDER}`,
          pt: 6, pb: 4,
        }}
      >
        <Container maxWidth="xl">
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Box sx={{
              width: 8, height: 8, borderRadius: '50%', bgcolor: isLive ? GREEN : CYAN,
              animation: isLive ? 'pulse 2s infinite' : 'none',
              '@keyframes pulse': { '0%, 100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
            }} />
            <Typography sx={{ fontSize: '0.68rem', fontWeight: 700, letterSpacing: 2, color: CYAN, fontFamily: MONO }}>
              FUTURES POSITIONING · LIVE KITE
            </Typography>
          </Box>
          <Typography sx={{ fontSize: { xs: '1.8rem', md: '2.4rem' }, fontWeight: 800, color: INK, fontFamily: SANS, lineHeight: 1.1 }}>
            F&O Momentum <Box component="span" sx={{ color: CYAN }}>Radar</Box>
          </Typography>
          <Typography sx={{ fontSize: '0.85rem', color: INK2, fontFamily: SANS, mt: 1.5, maxWidth: 640 }}>
            OI Gainers and Short Covering in stock futures — filtered to names that also
            moved beyond ±5% last session, sit in a top-3 sector today, or gapped beyond
            ±2% at the 9:15 open. Live prices, sorted by % return.
          </Typography>
          {data && (
            <Box sx={{ display: 'flex', gap: 2, mt: 2, alignItems: 'center', flexWrap: 'wrap' }}>
              <Chip
                label={data.state.replace('_', ' ')}
                size="small"
                sx={{ height: 20, fontSize: '0.62rem', fontWeight: 700, fontFamily: MONO, color: stateColor, bgcolor: `${stateColor === INK3 ? CYAN : stateColor}14`, border: `1px solid ${BORDER}` }}
              />
              <Typography sx={{ fontSize: '0.68rem', color: INK3, fontFamily: MONO }}>
                as of {data.as_of} · session {data.session_date} · data {data.data_mode}
                {data.oi_live ? ' · OI live' : ' · OI EOD'}
              </Typography>
              <Button
                size="small"
                startIcon={<DownloadIcon sx={{ fontSize: '0.9rem !important' }} />}
                onClick={() => downloadPdf(data)}
                sx={{
                  ml: { sm: 'auto' }, height: 28, px: 1.5, borderRadius: 2,
                  fontSize: '0.68rem', fontWeight: 700, fontFamily: SANS, textTransform: 'none',
                  color: CYAN, border: `1px solid ${CYAN}55`, bgcolor: `${CYAN}0D`,
                  '&:hover': { bgcolor: `${CYAN}1F`, borderColor: CYAN },
                }}
              >
                Download PDF
              </Button>
            </Box>
          )}
        </Container>
      </Box>

      <Container maxWidth="xl" sx={{ py: 4 }}>
        {error && (
          <Box sx={{ ...CARD, mb: 3, p: 3, borderColor: `${RED}66` }}>
            <Typography sx={{ fontSize: '0.8rem', color: RED, fontFamily: SANS }}>
              Failed to load scan: {error}. Backend must be running on port 8000 with futures data ingested.
            </Typography>
          </Box>
        )}

        {/* Top sectors strip */}
        {data && data.top_sectors.length > 0 && (
          <Box sx={{ ...CARD, mb: 3, p: 2.5 }}>
            <SectionHead title="Best Performing Sector (today, F&O universe)" accent="#14b8a6" />
            <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap' }}>
              {data.top_sectors.map(s => (
                <Box key={s.sector} sx={{ px: 1.75, py: 1, borderRadius: 2, border: `1px solid ${BORDER}` }}>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 700, color: INK, fontFamily: SANS }}>
                    {s.sector}
                  </Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontFamily: MONO, color: pctColor(s.avg_ret) }}>
                    {fmtPct(s.avg_ret)} <Box component="span" sx={{ color: INK3 }}>· {s.count} stocks</Box>
                  </Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        {/* Bifurcated lists */}
        <Grid container spacing={2.5}>
          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title="OI Gainers — Futures Open Interest Rising"
                accent="#6366f1"
                meta={data ? `${data.oi_gainers.length} qualified` : ''}
              />
              <BucketTable
                rows={data?.oi_gainers ?? []}
                emptyNote="No OI-gainer futures currently pass a momentum qualifier."
              />
            </Box>
          </Grid>
          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title="Short Covering — Price Up, OI Falling"
                accent="#8b5cf6"
                meta={data ? `${data.short_covering.length} qualified` : ''}
              />
              <BucketTable
                rows={data?.short_covering ?? []}
                emptyNote="No short-covering futures currently pass a momentum qualifier."
              />
            </Box>
          </Grid>
        </Grid>

        {/* Live movers (unfiltered by OI/momentum criteria) */}
        <Grid container spacing={2.5} sx={{ mt: 0.5 }}>
          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title={`Live Movers — Above +${data?.thresholds.live_move_pct ?? 2}%`}
                accent={GREEN}
                meta={data ? `${data.movers_up.length} stocks` : ''}
              />
              <MoversTable
                rows={data?.movers_up ?? []}
                emptyNote="No F&O stock is currently up beyond the threshold."
              />
            </Box>
          </Grid>
          <Grid item xs={12} lg={6}>
            <Box sx={{ ...CARD, p: 2.5 }}>
              <SectionHead
                title={`Live Movers — Below -${data?.thresholds.live_move_pct ?? 2}%`}
                accent={RED}
                meta={data ? `${data.movers_down.length} stocks` : ''}
              />
              <MoversTable
                rows={data?.movers_down ?? []}
                emptyNote="No F&O stock is currently down beyond the threshold."
              />
            </Box>
          </Grid>
        </Grid>

        {/* Methodology */}
        <Box sx={{ ...CARD, mt: 3, p: 2.5 }}>
          <SectionHead title="How stocks qualify" accent={AMBER} />
          <Typography sx={{ fontSize: '0.76rem', color: INK2, fontFamily: SANS, lineHeight: 1.7 }}>
            Base signal comes from current-month <b>stock futures</b>: OI Gainers have open
            interest higher than the prior session; Short Covering pairs a rising price with
            falling OI (shorts buying back). A stock is listed only if it also meets at least
            one momentum criterion — <b>±5% PREV</b> (last completed session beyond ±5%),{' '}
            <b>TOP SECTOR</b> (its sector is today's single best-performing F&O sector by average
            change), or <b>±2% @ 9:15</b> (opening print gapped beyond ±2% vs previous
            close). Chips on each row show exactly which criteria fired. The <b>Live Movers</b>{' '}
            section below is independent of these buckets — it simply lists every F&O stock
            currently trading beyond ±{data?.thresholds.live_move_pct ?? 2}% vs previous close, split
            into gainers and losers. Live during market hours via Kite; EOD-settled data otherwise.
          </Typography>
        </Box>
      </Container>

      <Footer />
    </Box>
  )
}
