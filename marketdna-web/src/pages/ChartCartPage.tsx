import { useMemo, useState } from 'react'
import { Box, Grid, IconButton, Typography } from '@mui/material'
import CloseIcon from '@mui/icons-material/Close'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import SearchBox from '../components/shared/SearchBox'
import { ChartTile } from '../components/charts/ChartTile'
import { IndicatorFilterBar } from '../components/charts/IndicatorFilterBar'
import { LiveReturnFilterBar } from '../components/charts/LiveReturnFilterBar'
import { MONO, SANS, GREEN, RED, TF_LABELS, pct, CART_SECTIONS } from '../components/charts/chartsCommon'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useFoTicker } from '../hooks/useFoTicker'
import { useChartsCart } from '../hooks/useChartsCart'
import type { CartItem, CartDirection } from '../hooks/useChartsCart'
import { useIndicatorFilters } from '../hooks/useIndicatorFilters'
import { useLiveReturnFilters } from '../hooks/useLiveReturnFilters'
import { CHARTS_TFS } from '../types/charts'
import type { ChartsTf } from '../types/charts'

type DirFilter = 'all' | CartDirection
type TfFilter = 'all' | ChartsTf
type SortBy = 'newest' | 'oldest' | 'az' | 'change'
type ViewMode = 'sections' | 'grid'

// Small single-select pill row -- same visual language as the timeframe tabs on
// ChartTile, used here for every filter/sort/view control so this page reads as
// part of the same design system rather than inventing new widgets.
function PillRow<T extends string>({
  label, options, value, onChange,
}: {
  label: string
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (v: T) => void
}) {
  const { INK3, CYAN, BORDER } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.9, flexWrap: 'wrap' }}>
      <Typography sx={{ ...MONO, fontSize: '0.6rem', fontWeight: 700, color: INK3, letterSpacing: '0.08em', textTransform: 'uppercase', flexShrink: 0 }}>
        {label}
      </Typography>
      <Box sx={{ display: 'flex', gap: 0.35, flexWrap: 'wrap' }}>
        {options.map(o => (
          <Box
            key={o.value}
            onClick={() => onChange(o.value)}
            sx={{
              px: 0.9, py: 0.3, borderRadius: 1, cursor: 'pointer',
              bgcolor: value === o.value ? `${CYAN}20` : 'transparent',
              border: `1px solid ${value === o.value ? CYAN : BORDER}`,
            }}
          >
            <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: value === o.value ? 800 : 600, color: value === o.value ? CYAN : INK3 }}>
              {o.label}
            </Typography>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// One cart entry: a small direction/timeframe badge + remove button above the
// full ChartTile (identical chart to /charts, defaulted to the entry's own tf).
function CartEntryTile({
  item, tick, isInCart, onToggleCart, onRemove,
}: {
  item: CartItem
  tick: ReturnType<typeof useFoTicker>['ticks'][string] | undefined
  isInCart: ReturnType<typeof useChartsCart>['isInCart']
  onToggleCart: ReturnType<typeof useChartsCart>['toggle']
  onRemove: () => void
}) {
  const { INK, INK3 } = usePalette()
  const dirColor = item.direction === 'bullish' ? GREEN : RED
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.6 }}>
          <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: dirColor }} />
          <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 800, color: dirColor, letterSpacing: '0.04em' }}>
            {TF_LABELS[item.tf]} {item.direction === 'bullish' ? 'BULLISH' : 'BEARISH'}
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.58rem', color: INK3 }}>
            {item.price.toFixed(2)} ({pct(item.changePct)})
          </Typography>
        </Box>
        <IconButton size="small" onClick={onRemove} sx={{ p: 0.2 }}>
          <CloseIcon sx={{ fontSize: '0.85rem', color: INK3 }} />
        </IconButton>
      </Box>
      <ChartTile symbol={item.symbol} tick={tick} isInCart={isInCart} onToggleCart={onToggleCart} initialTf={item.tf} />
    </Box>
  )
}

export default function ChartCartPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { mode } = useThemeMode()
  const { ticks } = useFoTicker()
  const cart = useChartsCart()

  const [search, setSearch] = useState('')
  const [dirFilter, setDirFilter] = useState<DirFilter>('all')
  const [tfFilter, setTfFilter] = useState<TfFilter>('all')
  const [sortBy, setSortBy] = useState<SortBy>('newest')
  const [viewMode, setViewMode] = useState<ViewMode>('sections')
  const indicatorFilters = useIndicatorFilters()
  const liveFilters = useLiveReturnFilters(ticks)

  const filtered = useMemo(() => {
    const q = search.trim().toUpperCase()
    return cart.items.filter(i =>
      (!q || i.symbol.includes(q)) &&
      (dirFilter === 'all' || i.direction === dirFilter) &&
      (tfFilter === 'all' || i.tf === tfFilter) &&
      (!indicatorFilters.active || indicatorFilters.passes(i.symbol)) &&
      (!liveFilters.active || liveFilters.passes(i.symbol)),
    )
  }, [cart.items, search, dirFilter, tfFilter, indicatorFilters, liveFilters])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    switch (sortBy) {
      case 'oldest': return arr.sort((a, b) => a.addedAt - b.addedAt)
      case 'az': return arr.sort((a, b) => a.symbol.localeCompare(b.symbol))
      case 'change': return arr.sort((a, b) => b.changePct - a.changePct)
      default: return arr.sort((a, b) => b.addedAt - a.addedAt)
    }
  }, [filtered, sortBy])

  const bullishCount = cart.items.filter(i => i.direction === 'bullish').length
  const bearishCount = cart.items.filter(i => i.direction === 'bearish').length

  const renderTile = (item: CartItem) => (
    <Grid item xs={12} sm={6} md={4} key={`${item.symbol}-${item.tf}-${item.direction}`}>
      <CartEntryTile
        item={item}
        tick={ticks[item.symbol]}
        isInCart={cart.isInCart}
        onToggleCart={cart.toggle}
        onRemove={() => cart.remove(item.symbol, item.tf, item.direction)}
      />
    </Grid>
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
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase', mb: 1 }}>
          ● Chart Cart
        </Typography>
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Your Saved <Box component="span" sx={{ color: CYAN }}>Setups</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 640, mt: 1, mb: 2 }}>
          Every chart bookmarked from the Charts page, filterable by timeframe and
          direction, each shown as a full live candlestick tile — not just a list.
        </Typography>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }}>
            <Box component="span" sx={{ color: INK, fontWeight: 800 }}>{cart.items.length}</Box> total
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }}>
            <Box component="span" sx={{ color: GREEN, fontWeight: 800 }}>{bullishCount}</Box> bullish
          </Typography>
          <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }}>
            <Box component="span" sx={{ color: RED, fontWeight: 800 }}>{bearishCount}</Box> bearish
          </Typography>
        </Box>
      </Box>

      {/* Filters / sort / view controls */}
      {cart.items.length > 0 && (
        <Box sx={{
          px: { xs: 2, md: 4 }, py: 2, borderBottom: `1px solid ${BORDER}`,
          display: 'flex', flexDirection: 'column', gap: 1.25,
        }}>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <SearchBox value={search} onChange={setSearch} placeholder="Search symbol…" width={220} />
            <PillRow label="Direction" value={dirFilter} onChange={setDirFilter} options={[
              { value: 'all', label: 'All' }, { value: 'bullish', label: 'Bullish' }, { value: 'bearish', label: 'Bearish' },
            ]} />
          </Box>
          <PillRow label="Cart Section TF" value={tfFilter} onChange={setTfFilter} options={[
            { value: 'all', label: 'All' },
            ...CHARTS_TFS.map(t => ({ value: t, label: TF_LABELS[t] })),
          ]} />
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between' }}>
            <PillRow label="Sort" value={sortBy} onChange={setSortBy} options={[
              { value: 'newest', label: 'Newest' }, { value: 'oldest', label: 'Oldest' },
              { value: 'az', label: 'A–Z' }, { value: 'change', label: 'Change %' },
            ]} />
            <PillRow label="View" value={viewMode} onChange={setViewMode} options={[
              { value: 'sections', label: 'By Section' }, { value: 'grid', label: 'Flat Grid' },
            ]} />
          </Box>
          <Box sx={{ ...CARD, p: 1.5 }}>
            <IndicatorFilterBar f={indicatorFilters} />
          </Box>
          <Box sx={{ ...CARD, p: 1.5 }}>
            <LiveReturnFilterBar f={liveFilters} />
          </Box>
          <Typography sx={{ ...MONO, fontSize: '0.62rem', color: INK3 }}>
            {sorted.length} / {cart.items.length} shown
          </Typography>
        </Box>
      )}

      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        {!cart.items.length ? (
          <Box sx={{ ...CARD, p: 6, textAlign: 'center', maxWidth: 480, mx: 'auto' }}>
            <Typography sx={{ ...SANS, fontSize: '0.9rem', fontWeight: 700, color: INK, mb: 1 }}>
              Your chart cart is empty
            </Typography>
            <Typography sx={{ ...SANS, fontSize: '0.78rem', color: INK3 }}>
              Head to the Charts page and use the ▲ bullish / ▼ bearish buttons on any
              tile to bookmark a setup — it'll show up here, grouped by timeframe and
              direction.
            </Typography>
          </Box>
        ) : !sorted.length ? (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            No cart items match the current filters.
          </Typography>
        ) : viewMode === 'grid' ? (
          <Grid container spacing={2}>
            {sorted.map(renderTile)}
          </Grid>
        ) : (
          CART_SECTIONS
            .filter(({ tf, direction }) => (tfFilter === 'all' || tfFilter === tf) && (dirFilter === 'all' || dirFilter === direction))
            .map(({ tf, direction }) => {
              const sectionItems = sorted.filter(i => i.tf === tf && i.direction === direction)
              if (!sectionItems.length) return null
              const dirColor = direction === 'bullish' ? GREEN : RED
              return (
                <Box key={`${tf}-${direction}`} sx={{ mb: 3.5 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
                    <Box sx={{ width: 3, height: 18, borderRadius: 2, bgcolor: dirColor }} />
                    <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
                      {TF_LABELS[tf]} {direction === 'bullish' ? 'Bullish' : 'Bearish'}
                    </Typography>
                    <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }}>({sectionItems.length})</Typography>
                  </Box>
                  <Grid container spacing={2}>
                    {sectionItems.map(renderTile)}
                  </Grid>
                </Box>
              )
            })
        )}
      </Box>

      <Footer />
    </Box>
  )
}
