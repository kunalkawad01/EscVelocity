import { Box, Typography, CircularProgress } from '@mui/material'
import type { OIAnalysis, StrikeData } from '../../types/stock'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

function diffDays(expiry: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const exp = new Date(expiry)
  return Math.max(0, Math.round((exp.getTime() - today.getTime()) / 86_400_000))
}

function fmt(n: number, dec = 0): string {
  return n.toLocaleString('en-IN', { maximumFractionDigits: dec })
}

function fmtCr(oi: number): string {
  if (oi >= 10_000_000) return `${(oi / 10_000_000).toFixed(1)}Cr`
  if (oi >= 100_000) return `${(oi / 100_000).toFixed(1)}L`
  return oi.toLocaleString('en-IN')
}

// ── Stat card ─────────────────────────────────────────────────────────────────

function Stat({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  const { INK, INK2, INK3, BORDER, PAPER2 } = usePalette()
  return (
    <Box sx={{
      flex: 1, minWidth: 100, px: 2, py: 1.5,
      border: `1px solid ${BORDER}`, bgcolor: PAPER2,
    }}>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 0.5 }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '0.95rem', fontWeight: 700, color: color ?? INK, lineHeight: 1.2 }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK2, mt: 0.25 }}>
          {sub}
        </Typography>
      )}
    </Box>
  )
}

// ── Strike chain ──────────────────────────────────────────────────────────────

function StrikeChain({ strikes, atm, ceWall, peWall, maxPain, spot }: {
  strikes: StrikeData[]
  atm: number
  ceWall: number
  peWall: number
  maxPain: number
  spot: number
}) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()

  // Filter to ATM ±10 strikes
  const sorted = [...strikes].sort((a, b) => a.strike - b.strike)
  const atmIdx = sorted.findIndex(s => s.strike === atm)
  const lo = Math.max(0, atmIdx - 10)
  const hi = Math.min(sorted.length - 1, atmIdx + 10)
  const visible = sorted.slice(lo, hi + 1)

  const maxCeOi = Math.max(...visible.map(s => s.ce_oi), 1)
  const maxPeOi = Math.max(...visible.map(s => s.pe_oi), 1)

  return (
    <Box>
      {/* Header */}
      <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 56px 80px 56px 1fr', gap: 0.5, mb: 0.5 }}>
        {['CE OI', 'CE IV', 'STRIKE', 'PE IV', 'PE OI'].map((h, i) => (
          <Typography key={i} sx={{
            ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em',
            textTransform: 'uppercase',
            textAlign: i === 0 ? 'right' : i === 4 ? 'left' : 'center',
          }}>
            {h}
          </Typography>
        ))}
      </Box>

      {/* Rows */}
      {visible.map(s => {
        const isAtm = s.strike === atm
        const isCeWall = s.strike === ceWall
        const isPeWall = s.strike === peWall
        const isMaxPain = s.strike === maxPain

        const ceBarW = Math.round((s.ce_oi / maxCeOi) * 100)
        const peBarW = Math.round((s.pe_oi / maxPeOi) * 100)

        const rowBg = isAtm ? `${CYAN}14` : 'transparent'
        const strikeColor = isAtm ? CYAN : INK2

        let badge: string | null = null
        if (isCeWall && isPeWall) badge = 'CE+PE Wall'
        else if (isCeWall) badge = 'CE Wall'
        else if (isPeWall) badge = 'PE Wall'
        else if (isMaxPain) badge = 'Max Pain'

        return (
          <Box key={s.strike} sx={{
            display: 'grid', gridTemplateColumns: '1fr 56px 80px 56px 1fr',
            gap: 0.5, py: '3px', px: 0.5,
            bgcolor: rowBg,
            borderLeft: isAtm ? `2px solid ${CYAN}` : '2px solid transparent',
            alignItems: 'center',
          }}>
            {/* CE OI bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 0.5 }}>
              <Typography sx={{ ...MONO, fontSize: '0.68rem', color: '#ef4444' }}>
                {fmtCr(s.ce_oi)}
              </Typography>
              <Box sx={{ width: 40, height: 6, bgcolor: BORDER, flexShrink: 0 }}>
                <Box sx={{ width: `${ceBarW}%`, height: '100%', bgcolor: '#ef444466' }} />
              </Box>
            </Box>

            {/* CE IV */}
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: '#ef4444', textAlign: 'center' }}>
              {s.ce_iv != null ? `${s.ce_iv.toFixed(1)}%` : '—'}
            </Typography>

            {/* Strike */}
            <Box sx={{ textAlign: 'center' }}>
              <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: strikeColor }}>
                {fmt(s.strike)}
              </Typography>
              {badge && (
                <Typography sx={{ ...MONO, fontSize: '0.55rem', color: INK3, lineHeight: 1 }}>
                  {badge}
                </Typography>
              )}
            </Box>

            {/* PE IV */}
            <Typography sx={{ ...MONO, fontSize: '0.68rem', color: '#22c55e', textAlign: 'center' }}>
              {s.pe_iv != null ? `${s.pe_iv.toFixed(1)}%` : '—'}
            </Typography>

            {/* PE OI bar */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
              <Box sx={{ width: 40, height: 6, bgcolor: BORDER, flexShrink: 0 }}>
                <Box sx={{ width: `${peBarW}%`, height: '100%', bgcolor: '#22c55e66' }} />
              </Box>
              <Typography sx={{ ...MONO, fontSize: '0.68rem', color: '#22c55e' }}>
                {fmtCr(s.pe_oi)}
              </Typography>
            </Box>
          </Box>
        )
      })}
    </Box>
  )
}

// ── Level map ─────────────────────────────────────────────────────────────────

function LevelMap({ spot, ceWall, peWall, maxPain }: {
  spot: number; ceWall: number; peWall: number; maxPain: number
}) {
  const { INK, INK2, INK3, BORDER, PAPER2, CYAN } = usePalette()

  const lo = Math.min(peWall, maxPain, spot) * 0.99
  const hi = Math.max(ceWall, maxPain, spot) * 1.01
  const range = hi - lo

  const pct = (v: number) => `${((v - lo) / range) * 100}%`

  const levels = [
    { label: 'CE Wall', value: ceWall, color: '#ef4444', desc: 'Resistance' },
    { label: 'Max Pain', value: maxPain, color: '#f59e0b', desc: 'Expiry magnet' },
    { label: 'Spot', value: spot, color: CYAN, desc: 'Current price' },
    { label: 'PE Wall', value: peWall, color: '#22c55e', desc: 'Support' },
  ].sort((a, b) => b.value - a.value)

  return (
    <Box>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1.5 }}>
        Key Levels
      </Typography>
      {/* Horizontal bar */}
      <Box sx={{ position: 'relative', height: 8, bgcolor: BORDER, mb: 3, mx: 1 }}>
        {[
          { value: peWall, color: '#22c55e' },
          { value: maxPain, color: '#f59e0b' },
          { value: spot, color: CYAN },
          { value: ceWall, color: '#ef4444' },
        ].map(({ value, color }) => (
          <Box key={value} sx={{
            position: 'absolute', left: pct(value),
            top: -4, width: 2, height: 16,
            bgcolor: color, transform: 'translateX(-50%)',
          }} />
        ))}
      </Box>

      {/* Level list */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
        {levels.map(l => (
          <Box key={l.label} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
            <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: l.color, flexShrink: 0 }} />
            <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK2, flex: 1 }}>{l.label}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>
              ₹{fmt(l.value, 0)}
            </Typography>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, width: 80, textAlign: 'right' }}>
              {l.value === spot ? '←' : `${((l.value - spot) / spot * 100).toFixed(1)}%`}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  data: OIAnalysis | null
  loading: boolean
}

export default function OptionsIntelligence({ data, loading }: Props) {
  const { INK2, INK3, BORDER, PAPER2 } = usePalette()

  if (loading) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, py: 4 }}>
        <CircularProgress size={18} sx={{ color: '#8B5CF6' }} />
        <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK3 }}>Loading options chain…</Typography>
      </Box>
    )
  }

  if (!data) {
    return (
      <Box sx={{ py: 3 }}>
        <Typography sx={{ ...MONO, fontSize: '0.8rem', color: INK3 }}>
          No options data — this symbol is not an F&O instrument.
        </Typography>
      </Box>
    )
  }

  const dte = diffDays(data.expiry)
  const pcrColor = data.pcr > 1.2 ? '#22c55e' : data.pcr < 0.8 ? '#ef4444' : '#f59e0b'
  const maxPainDist = ((data.max_pain - data.spot) / data.spot * 100)
  const basisColor = data.basis_pct == null ? INK3
    : data.basis_pct > 0.5 ? '#22c55e'
    : data.basis_pct < -0.5 ? '#ef4444'
    : '#f59e0b'

  return (
    <Box>
      {/* Date / expiry strip */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 2 }}>
        <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
          Data: {data.date}
        </Typography>
        <Box sx={{ width: 1, height: 12, bgcolor: BORDER }} />
        <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
          Expiry: {data.expiry} ({dte} DTE)
        </Typography>
        <Box sx={{ width: 1, height: 12, bgcolor: BORDER }} />
        <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>
          ATM: ₹{fmt(data.atm_strike)}
        </Typography>
      </Box>

      {/* Stat row */}
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mb: 2.5 }}>
        <Stat
          label="ATM IV"
          value={data.atm_iv != null ? `${data.atm_iv.toFixed(1)}%` : '—'}
          sub="Implied Volatility"
        />
        <Stat
          label="PCR"
          value={data.pcr.toFixed(2)}
          sub={data.pcr > 1 ? 'Bullish bias' : 'Bearish bias'}
          color={pcrColor}
        />
        <Stat
          label="Max Pain"
          value={`₹${fmt(data.max_pain)}`}
          sub={`${maxPainDist >= 0 ? '+' : ''}${maxPainDist.toFixed(1)}% from spot`}
          color="#f59e0b"
        />
        <Stat
          label="CE Wall"
          value={`₹${fmt(data.ce_wall)}`}
          sub="Call resistance"
          color="#ef4444"
        />
        <Stat
          label="PE Wall"
          value={`₹${fmt(data.pe_wall)}`}
          sub="Put support"
          color="#22c55e"
        />
        {data.futures_ltp != null && (
          <Stat
            label="Futures"
            value={`₹${fmt(data.futures_ltp, 1)}`}
            sub={data.basis_pct != null
              ? `Basis: ${data.basis_pct >= 0 ? '+' : ''}${data.basis_pct.toFixed(2)}%`
              : undefined}
            color={basisColor}
          />
        )}
      </Box>

      {/* OI totals */}
      <Box sx={{ display: 'flex', gap: 1, mb: 2.5 }}>
        <Box sx={{ flex: 1, px: 1.5, py: 1, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#ef4444', letterSpacing: '0.1em', textTransform: 'uppercase', mb: 0.25 }}>
            Total CE OI
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.85rem', fontWeight: 700, color: '#ef4444' }}>
            {fmtCr(data.total_ce_oi)}
          </Typography>
        </Box>
        <Box sx={{ flex: 1, px: 1.5, py: 1, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: '#22c55e', letterSpacing: '0.1em', textTransform: 'uppercase', mb: 0.25 }}>
            Total PE OI
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.85rem', fontWeight: 700, color: '#22c55e' }}>
            {fmtCr(data.total_pe_oi)}
          </Typography>
        </Box>
        <Box sx={{ flex: 2, px: 1.5, py: 1, border: `1px solid ${BORDER}`, bgcolor: PAPER2, display: 'flex', alignItems: 'center', gap: 1 }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            OI Ratio
          </Typography>
          {/* CE / PE bar */}
          <Box sx={{ flex: 1, height: 8, bgcolor: BORDER, position: 'relative', overflow: 'hidden' }}>
            {(() => {
              const total = data.total_ce_oi + data.total_pe_oi
              const pePct = total > 0 ? (data.total_pe_oi / total) * 100 : 50
              return (
                <>
                  <Box sx={{ position: 'absolute', right: 0, top: 0, width: `${100 - pePct}%`, height: '100%', bgcolor: '#ef444466' }} />
                  <Box sx={{ position: 'absolute', left: 0, top: 0, width: `${pePct}%`, height: '100%', bgcolor: '#22c55e66' }} />
                </>
              )
            })()}
          </Box>
        </Box>
      </Box>

      {/* Main two-column layout */}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '3fr 2fr' }, gap: 3 }}>
        {/* Strike chain */}
        <Box sx={{ border: `1px solid ${BORDER}`, p: 1.5 }}>
          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
            Strike Chain (ATM ±10)
          </Typography>
          <StrikeChain
            strikes={data.strikes}
            atm={data.atm_strike}
            ceWall={data.ce_wall}
            peWall={data.pe_wall}
            maxPain={data.max_pain}
            spot={data.spot}
          />
        </Box>

        {/* Level map */}
        <Box sx={{ border: `1px solid ${BORDER}`, p: 1.5 }}>
          <LevelMap
            spot={data.spot}
            ceWall={data.ce_wall}
            peWall={data.pe_wall}
            maxPain={data.max_pain}
          />
        </Box>
      </Box>
    </Box>
  )
}
