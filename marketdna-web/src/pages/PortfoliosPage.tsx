import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Box, Typography, CircularProgress, Button } from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import SectionHead from '../components/shared/SectionHead'
import RuleFieldHelp from '../components/portfolios/RuleFieldHelp'
import { portfoliosApi } from '../api/portfoliosApi'
import type { PortfolioMeta, Universe } from '../types/portfolios'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

const UNIVERSES: { key: Universe; label: string }[] = [
  { key: 'nifty200', label: 'Nifty 200' },
  { key: 'nifty500', label: 'Nifty 500' },
]

function UniverseToggle({ value, onChange }: { value: Universe; onChange: (u: Universe) => void }) {
  const { INK, INK3, CYAN, BORDER, PAPER } = usePalette()
  return (
    <Box sx={{ display: 'inline-flex', border: `1px solid ${BORDER}`, borderRadius: '10px', overflow: 'hidden', bgcolor: PAPER }}>
      {UNIVERSES.map(u => {
        const active = u.key === value
        return (
          <Box key={u.key} onClick={() => onChange(u.key)} sx={{
            px: 2, py: 0.85, cursor: 'pointer', ...MONO, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.05em',
            color: active ? '#04121F' : INK3, bgcolor: active ? CYAN : 'transparent',
            transition: 'background-color 0.15s, color 0.15s',
            '&:hover': { color: active ? '#04121F' : INK },
          }}>{u.label.toUpperCase()}</Box>
        )
      })}
    </Box>
  )
}

function Stars({ n }: { n: number }) {
  const { CYAN, INK3 } = usePalette()
  return (
    <Box component="span" sx={{ ...MONO, fontSize: '0.7rem', letterSpacing: '0.08em' }}>
      <span style={{ color: CYAN }}>{'★'.repeat(n)}</span>
      <span style={{ color: INK3 }}>{'☆'.repeat(5 - n)}</span>
    </Box>
  )
}

function PortfolioCard({ p, universe }: { p: PortfolioMeta; universe: Universe }) {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER } = usePalette()
  const { CARD } = useTokens()
  return (
    <Link to={`/portfolios/${p.key}?universe=${universe}`} style={{ textDecoration: 'none' }}>
      <Box sx={{
        ...CARD, p: 2, cursor: 'pointer', bgcolor: PAPER, height: '100%',
        border: `1px solid ${BORDER}`, transition: 'border-color 0.2s, transform 0.1s',
        '&:hover': { borderColor: CYAN, transform: 'translateY(-1px)' },
      }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75 }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.9rem', fontWeight: 800, color: INK }}>{p.name}</Typography>
          <Stars n={p.volatility_stars} />
        </Box>
        <Typography sx={{ ...JAKARTA, fontSize: '0.74rem', color: INK2, lineHeight: 1.45, mb: 1.25, minHeight: 44 }}>
          {p.description}
        </Typography>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Box sx={{ display: 'flex', gap: 2 }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>HOLD {p.expected_holding}</Typography>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>REBAL {p.rebalance}</Typography>
          </Box>
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: CYAN }}>OPEN →</Typography>
        </Box>
      </Box>
    </Link>
  )
}

function CustomCard({ p, universe, onDelete }: { p: PortfolioMeta; universe: Universe; onDelete: (k: string) => void }) {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER } = usePalette()
  const { CARD } = useTokens()
  const navigate = useNavigate()
  return (
    <Box onClick={() => navigate(`/portfolios/${p.key}?universe=${universe}`)} sx={{
      ...CARD, p: 2, cursor: 'pointer', bgcolor: PAPER, height: '100%', position: 'relative',
      border: `1px solid ${BORDER}`, transition: 'border-color 0.2s, transform 0.1s',
      '&:hover': { borderColor: CYAN, transform: 'translateY(-1px)' },
    }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.75, gap: 1 }}>
        <Typography sx={{ ...JAKARTA, fontSize: '0.9rem', fontWeight: 800, color: INK }}>{p.name}</Typography>
        <Typography sx={{ ...MONO, fontSize: '0.55rem', fontWeight: 700, letterSpacing: '0.08em', color: '#04121F',
                          bgcolor: CYAN, px: 0.7, py: 0.25, borderRadius: '5px', flexShrink: 0 }}>CUSTOM</Typography>
      </Box>
      <Typography sx={{ ...JAKARTA, fontSize: '0.74rem', color: INK2, lineHeight: 1.45, mb: 1.25, minHeight: 44 }}>
        {p.description || 'User-defined rules.'}
      </Typography>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <Box sx={{ display: 'flex', gap: 2 }}>
          <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3 }}>REBAL {p.rebalance}</Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1.5 }} onClick={e => e.stopPropagation()}>
          <Link to={`/portfolios/edit/${p.key}`} style={{ textDecoration: 'none' }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: INK3, '&:hover': { color: CYAN } }}>EDIT</Typography>
          </Link>
          <Typography onClick={() => onDelete(p.key)} sx={{ ...MONO, fontSize: '0.65rem', color: INK3, cursor: 'pointer', '&:hover': { color: '#ef4444' } }}>DELETE</Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default function PortfoliosPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { CARD } = useTokens()

  const [universe, setUniverse] = useState<Universe>('nifty500')
  const [metas, setMetas] = useState<PortfolioMeta[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  function refresh() {
    portfoliosApi.list()
      .then(r => setMetas(r.portfolios))
      .catch(e => setError(String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(() => { refresh() }, [])

  async function handleDelete(key: string) {
    if (!window.confirm(`Delete portfolio "${key}"? Its tracked history will be removed.`)) return
    try { await portfoliosApi.deleteCustom(key); refresh() }
    catch (e: any) { setError(String(e.message ?? e)) }
  }

  const customs = metas.filter(m => m.is_custom)
  const builtins = metas.filter(m => !m.is_custom)

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  const activeUniverseLabel = UNIVERSES.find(u => u.key === universe)?.label ?? universe

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar sections={[{ label: 'Discover', anchor: 'discover' }, { label: 'Rule Help', anchor: 'rule-help' }]} />

      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 5 }, pt: 6, pb: 5 }}>
        <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
            <Box sx={{
              width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, boxShadow: `0 0 6px ${CYAN}`,
              '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.35 } },
              animation: 'pulse 2s ease-in-out infinite',
            }} />
            <Typography sx={{ ...MONO, fontSize: '0.65rem', letterSpacing: '0.15em', color: CYAN }}>
              OHLCV-ONLY · FULLY QUANTITATIVE
            </Typography>
          </Box>
          <Typography sx={{ ...JAKARTA, fontSize: { xs: '1.9rem', md: '2.6rem' }, fontWeight: 800, color: INK, lineHeight: 1.05 }}>
            Quant <span style={{ color: CYAN }}>Portfolios</span>
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.92rem', color: INK2, maxWidth: 640, mt: 1.5 }}>
            Smallcase for traders. Each basket is a forward-tracked paper portfolio generated from price
            and volume alone — ₹100 invested at inception, growth tracked live, every holding explained.
            Open one to see its growth curve, holdings, and rebalance log.
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5, flexWrap: 'wrap' }}>
            <Typography sx={{ ...MONO, fontSize: '0.62rem', letterSpacing: '0.1em', color: INK3 }}>UNIVERSE</Typography>
            <UniverseToggle value={universe} onChange={setUniverse} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3 }}>
              Portfolios screen the {activeUniverseLabel} constituents
            </Typography>
            <Box sx={{ flex: 1 }} />
            <Button component={Link} to="/portfolios/new" variant="contained"
              sx={{ ...JAKARTA, fontWeight: 700, textTransform: 'none', fontSize: '0.78rem', bgcolor: CYAN, color: '#04121F',
                    '&:hover': { bgcolor: CYAN, filter: 'brightness(1.1)' } }}>
              ＋ Create Portfolio
            </Button>
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 2, md: 5 }, py: 4 }}>
        {error && (
          <Box sx={{ ...CARD, p: 2, mb: 3, border: `1px solid #EF444455` }}>
            <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', color: '#EF4444' }}>{error}</Typography>
          </Box>
        )}

        {!loading && customs.length > 0 && (
          <Box id="yours" sx={{ mb: 4 }}>
            <SectionHead title="Your Portfolios" accent="#8b5cf6" meta={`${customs.length} custom`} />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
              {customs.map(p => <CustomCard key={p.key} p={p} universe={universe} onDelete={handleDelete} />)}
            </Box>
          </Box>
        )}

        <Box id="discover">
          <SectionHead title="Discover" accent={CYAN} meta={`${builtins.length} portfolios`} />
          {loading ? (
            <Box sx={{ display: 'flex', justifyContent: 'center', py: 6 }}><CircularProgress size={26} sx={{ color: CYAN }} /></Box>
          ) : (
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', lg: '1fr 1fr 1fr' }, gap: 2 }}>
              {builtins.map(p => <PortfolioCard key={p.key} p={p} universe={universe} />)}
            </Box>
          )}
        </Box>

        <RuleFieldHelp />
      </Box>
      <Footer />
    </Box>
  )
}
