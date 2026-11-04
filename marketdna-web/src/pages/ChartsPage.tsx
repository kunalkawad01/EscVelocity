import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Box, Drawer, Grid, IconButton, Tooltip, Typography } from '@mui/material'
import ShoppingCartIcon from '@mui/icons-material/ShoppingCart'
import CloseIcon from '@mui/icons-material/Close'
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SearchBox from '../components/shared/SearchBox'
import { ChartTile } from '../components/charts/ChartTile'
import { IndicatorFilterBar } from '../components/charts/IndicatorFilterBar'
import { MONO, SANS, GREEN, RED, TF_LABELS, pct, CART_SECTIONS } from '../components/charts/chartsCommon'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useFoTicker } from '../hooks/useFoTicker'
import { chartsApi } from '../api/chartsApi'
import { useChartsCart } from '../hooks/useChartsCart'
import { useIndicatorFilters } from '../hooks/useIndicatorFilters'

export default function ChartsPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER, PAPER, PAPER2 } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const { ticks, wsConnected } = useFoTicker()
  const [symbols, setSymbols] = useState<string[]>([])
  const [search, setSearch] = useState('')
  const cart = useChartsCart()
  const [cartOpen, setCartOpen] = useState(false)
  const indicatorFilters = useIndicatorFilters()

  useEffect(() => {
    chartsApi.getSymbols().then(r => setSymbols(r.symbols)).catch(() => {})
  }, [])

  const searched = useMemo(() => {
    const q = search.trim().toUpperCase()
    if (!q) return symbols
    return symbols.filter(s => s.includes(q))
  }, [symbols, search])

  const filtered = useMemo(
    () => (indicatorFilters.active ? searched.filter(s => indicatorFilters.passes(s)) : searched),
    [searched, indicatorFilters],
  )

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
          Live <Box component="span" sx={{ color: CYAN }}>Charts</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 640, mt: 1, mb: 2 }}>
          Every F&amp;O underlying, one square candlestick per tile, 8 timeframes each —
          1D through 5Y. The 1D tab tracks a live Kite WebSocket tick; every other
          timeframe is EOD daily history. Research/monitoring view — no order placement.
        </Typography>
        <SearchBox value={search} onChange={setSearch} placeholder="Search symbol…" width={260} />
        <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3, mt: 1 }}>
          {filtered.length} / {symbols.length} symbols
        </Typography>
      </Box>

      {/* RSI / ATR% / Returns% filter bar */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 2, borderBottom: `1px solid ${BORDER}` }}>
        <Box sx={{ ...CARD, p: 1.5 }}>
          <IndicatorFilterBar f={indicatorFilters} />
        </Box>
      </Box>

      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        {!symbols.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            Loading F&amp;O universe…
          </Typography>
        ) : !filtered.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            {search ? `No symbols match "${search}".` : 'No symbols match the current indicator filters.'}
          </Typography>
        ) : (
          <Grid container spacing={2}>
            {filtered.map(sym => (
              <Grid item xs={12} sm={6} md={4} key={sym}>
                <ChartTile symbol={sym} tick={ticks[sym]} isInCart={cart.isInCart} onToggleCart={cart.toggle} />
              </Grid>
            ))}
          </Grid>
        )}
      </Box>

      <Footer />

      {/* Floating cart trigger */}
      <Tooltip title="Chart cart">
        <IconButton
          onClick={() => setCartOpen(true)}
          sx={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 1200,
            width: 52, height: 52, bgcolor: PAPER, border: `1px solid ${BORDER}`,
            boxShadow: mode === 'dark' ? '0 4px 16px rgba(0,0,0,0.5)' : '0 4px 16px rgba(0,0,0,0.15)',
            '&:hover': { bgcolor: PAPER2 },
          }}
        >
          <ShoppingCartIcon sx={{ color: CYAN, fontSize: '1.3rem' }} />
          {cart.items.length > 0 && (
            <Box sx={{
              position: 'absolute', top: 2, right: 2, minWidth: 18, height: 18, px: 0.4,
              borderRadius: '9px', bgcolor: CYAN, display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 800, color: mode === 'dark' ? '#061018' : '#fff' }}>
                {cart.items.length}
              </Typography>
            </Box>
          )}
        </IconButton>
      </Tooltip>

      {/* Cart drawer: sections grouped by timeframe x direction, e.g. "1D Bullish" */}
      <Drawer anchor="right" open={cartOpen} onClose={() => setCartOpen(false)}>
        <Box sx={{ width: { xs: 320, sm: 380 }, height: '100%', bgcolor: BG, display: 'flex', flexDirection: 'column' }}>
          <Box sx={{ px: 2, py: 1.75, borderBottom: `1px solid ${BORDER}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <Typography sx={{ ...SANS, fontSize: '0.95rem', fontWeight: 800, color: INK }}>
              Chart Cart <Typography component="span" sx={{ ...MONO, fontSize: '0.7rem', color: INK3, fontWeight: 700 }}>({cart.items.length})</Typography>
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              {cart.items.length > 0 && (
                <Typography
                  onClick={cart.clearAll}
                  sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: RED, cursor: 'pointer', letterSpacing: '0.04em' }}
                >
                  CLEAR ALL
                </Typography>
              )}
              <IconButton size="small" onClick={() => setCartOpen(false)}>
                <CloseIcon sx={{ fontSize: '1.1rem', color: INK3 }} />
              </IconButton>
            </Box>
          </Box>

          <Box sx={{ flex: 1, overflowY: 'auto', px: 2, py: 1.5 }}>
            {!cart.items.length ? (
              <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3, textAlign: 'center', mt: 4 }}>
                No charts added yet. Use the cart icon on any tile to save a setup by
                timeframe and direction.
              </Typography>
            ) : (
              <>
                {CART_SECTIONS.map(({ tf, direction }) => {
                  const sectionItems = cart.items
                    .filter(i => i.tf === tf && i.direction === direction)
                    .sort((a, b) => b.addedAt - a.addedAt)
                  if (!sectionItems.length) return null
                  const dirColor = direction === 'bullish' ? GREEN : RED
                  return (
                    <Box key={`${tf}-${direction}`} sx={{ mb: 2 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                          <Box sx={{ width: 3, height: 14, borderRadius: 2, bgcolor: dirColor }} />
                          <Typography sx={{ ...MONO, fontSize: '0.68rem', fontWeight: 800, color: INK, letterSpacing: '0.04em' }}>
                            {TF_LABELS[tf]} {direction === 'bullish' ? 'BULLISH' : 'BEARISH'}
                          </Typography>
                          <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>({sectionItems.length})</Typography>
                        </Box>
                        <Typography
                          onClick={() => cart.clearSection(tf, direction)}
                          sx={{ ...MONO, fontSize: '0.58rem', color: INK3, cursor: 'pointer', '&:hover': { color: RED } }}
                        >
                          clear
                        </Typography>
                      </Box>
                      {sectionItems.map(item => (
                        <Box
                          key={`${item.symbol}-${item.tf}-${item.direction}`}
                          sx={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            px: 1, py: 0.6, mb: 0.5, borderRadius: 1, bgcolor: PAPER2,
                          }}
                        >
                          <Box>
                            <Typography sx={{ ...MONO, fontSize: '0.72rem', fontWeight: 700, color: INK }}>{item.symbol}</Typography>
                            <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3 }}>
                              {item.price.toFixed(2)} ({pct(item.changePct)})
                            </Typography>
                          </Box>
                          <IconButton size="small" onClick={() => cart.remove(item.symbol, item.tf, item.direction)} sx={{ p: 0.3 }}>
                            <DeleteOutlineIcon sx={{ fontSize: '0.95rem', color: INK3 }} />
                          </IconButton>
                        </Box>
                      ))}
                    </Box>
                  )
                })}
                <Typography
                  component={Link}
                  to="/chart-cart"
                  onClick={() => setCartOpen(false)}
                  sx={{
                    ...MONO, display: 'block', textAlign: 'center', mt: 1, fontSize: '0.64rem',
                    fontWeight: 700, color: CYAN, letterSpacing: '0.04em', textDecoration: 'none',
                    '&:hover': { textDecoration: 'underline' },
                  }}
                >
                  OPEN FULL CART PAGE →
                </Typography>
              </>
            )}
          </Box>
        </Box>
      </Drawer>
    </Box>
  )
}
