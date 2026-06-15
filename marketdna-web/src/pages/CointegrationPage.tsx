import { useState, useEffect } from 'react'
import { Box, Typography, CircularProgress } from '@mui/material'
import Navbar from '../components/Navbar'
import { SectionCard, StatCard } from '../components/SectionCard'
import PairScannerTable from '../components/cointegration/PairScannerTable'
import { cointegrationApi } from '../api/cointegrationApi'
import type { CointegrationScanResult } from '../types/cointegration'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const ACCENT = '#34D399'

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
              <Typography sx={{ ...JAKARTA, fontWeight: 800, fontSize: '1rem', color: INK, letterSpacing: '0.08em' }}>
                MARKET<Box component="span" sx={{ color: CYAN }}>DNA</Box>
              </Typography>
            </Box>
            <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK3, lineHeight: 1.7 }}>
              Quantitative market intelligence for Indian equities and options. Research precedes product. Validation is mandatory.
            </Typography>
          </Box>
          {NAV.map(col => (
            <Box key={col.label} sx={{ flex: '1 1 140px' }}>
              <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75 }}>
                {col.label}
              </Typography>
              {col.links.map(link => (
                <Typography key={link} sx={{ ...JAKARTA, fontSize: '0.8rem', color: INK3, mb: 0.875, cursor: 'default', transition: 'color 0.12s', '&:hover': { color: INK2 } }}>
                  {link}
                </Typography>
              ))}
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 3, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK3 }}>© 2024 MarketDNA · Data sourced from NSE via Kite Connect · For research purposes only</Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK3 }}>Not investment advice · Past performance is not indicative of future results</Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default function CointegrationPage() {
  const { BG, PAPER, BORDER, CYAN, INK, INK2, INK3 } = useTokens()
  const { mode } = useThemeMode()
  const [scan, setScan]       = useState<CointegrationScanResult | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError]     = useState<string | null>(null)

  useEffect(() => {
    setLoading(true)
    cointegrationApi.getScan()
      .then(setScan)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const activeSignals = scan?.pairs.filter(p => Math.abs(p.current_zscore) >= 2) ?? []

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK, transition: 'background 0.2s' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -100, right: '10%', width: 500, height: 400, borderRadius: '50%', background: `radial-gradient(ellipse, ${ACCENT}12 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: '5%', width: 300, height: 300, borderRadius: '50%', background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
          {/* Left — text content */}
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5, px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${ACCENT}40`, bgcolor: `${ACCENT}0D` }}>
              <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT, animation: 'hpulse 2s ease-in-out infinite', '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${ACCENT}` }, '50%': { boxShadow: `0 0 14px ${ACCENT}` } } }} />
              <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: ACCENT, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
                Pair Trading · Statistical Arbitrage
              </Typography>
            </Box>
            <Typography sx={{ ...JAKARTA, fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5 }}>
              Cointegration{' '}
              <Box component="span" sx={{ color: ACCENT, textShadow: `0 0 32px ${ACCENT}70` }}>Pairs</Box>
            </Typography>
            <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: scan ? 3 : 0, maxWidth: 520 }}>
              NIFTY 50 pairs with statistically significant long-run equilibrium relationships — Engle-Granger test · Signal validation · Z-score monitoring.
            </Typography>
            {scan && (
              <Typography sx={{ ...MONO, fontSize: '0.7rem', color: INK3 }}>
                p &lt; {scan.pvalue_threshold} · |r| ≥ {scan.correlation_threshold} correlation filter
              </Typography>
            )}
          </Box>

          {/* Right — undraw illustration (desktop only) */}
          <Box sx={{ display: { xs: 'none', lg: 'flex' }, flexShrink: 0, alignItems: 'center', justifyContent: 'center', width: 420, opacity: 0.9 }}>
            <Box component="img"
              src="/illustrations/pair-analysis.svg"
              alt="Cointegration pair analysis"
              sx={{ width: '100%', height: 'auto', maxHeight: 300, objectFit: 'contain', filter: mode === 'dark' ? 'brightness(0.92)' : 'brightness(0.97)' }}
            />
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1400, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>

        {/* Active signal alert */}
        {activeSignals.length > 0 && (
          <Box sx={{ mb: 3, p: 1.5, borderRadius: '8px', bgcolor: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', display: 'flex', alignItems: 'center', gap: 1 }}>
            <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: '#f59e0b' }}>
              ⚠ {activeSignals.length} active signal{activeSignals.length > 1 ? 's' : ''} — Z-score ≥ ±2 on{' '}
              {activeSignals.slice(0, 5).map(p => `${p.symbol_y}/${p.symbol_x}`).join(', ')}
              {activeSignals.length > 5 ? ` +${activeSignals.length - 5} more` : ''}
            </Typography>
          </Box>
        )}

        {/* Stats row */}
        {scan && (
          <Box sx={{ display: 'flex', gap: 2, mb: 3, flexWrap: 'wrap' }}>
            {([
              ['Universe', `${scan.total_pairs_universe} pairs`, undefined],
              ['Correlation passed', `${scan.total_correlation_passed}`, undefined],
              ['Cointegrated', `${scan.total_cointegrated}`, ACCENT],
              ['Computed', scan.computed_at, undefined],
            ] as [string, string, string | undefined][]).map(([label, val, color]) => (
              <StatCard key={label} label={label} value={val} color={color} accent={ACCENT} />
            ))}
          </Box>
        )}

        {/* Table */}
        <SectionCard tag="Engle-Granger · Johansen" title="Cointegrated Pairs Scanner" accent={ACCENT}>
          {loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, py: 5 }}>
              <Box component="img"
                src="/illustrations/data-scan.svg"
                alt="Scanning pairs"
                sx={{ width: 160, height: 'auto', opacity: 0.85 }}
              />
              <CircularProgress size={22} sx={{ color: ACCENT, mt: 0.5 }} />
              <Typography sx={{ ...JAKARTA, fontSize: '0.78rem', color: INK2 }}>Running cointegration scan across NIFTY 50…</Typography>
              <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>First load ~3–5s · subsequent loads cached</Typography>
            </Box>
          ) : error ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 5 }}>
              <Box component="img"
                src="/illustrations/no-pairs.svg"
                alt="Error loading data"
                sx={{ width: 180, height: 'auto', opacity: 0.75 }}
              />
              <Typography sx={{ ...JAKARTA, color: '#EF4444', fontSize: '0.8rem', mt: 0.5 }}>Error: {error}</Typography>
            </Box>
          ) : scan?.pairs.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 1.5, py: 5 }}>
              <Box component="img"
                src="/illustrations/no-pairs.svg"
                alt="No pairs found"
                sx={{ width: 180, height: 'auto', opacity: 0.75 }}
              />
              <Typography sx={{ ...JAKARTA, color: INK2, fontSize: '0.8rem', mt: 0.5 }}>No cointegrated pairs found in the current universe.</Typography>
            </Box>
          ) : (
            <PairScannerTable pairs={scan!.pairs} />
          )}
        </SectionCard>
      </Box>

      <Footer />
    </Box>
  )
}
