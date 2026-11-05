import { useCallback, useEffect, useState } from 'react'
import type { ChartsTf } from '../types/charts'

export type CartDirection = 'bullish' | 'bearish'

export interface CartItem {
  symbol: string
  tf: ChartsTf
  direction: CartDirection
  price: number
  changePct: number
  addedAt: number
}

const STORAGE_KEY = 'charts_cart_v1'
const itemKey = (symbol: string, tf: ChartsTf, direction: CartDirection) => `${symbol}__${tf}__${direction}`

function loadCart(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

// Persisted client-side (localStorage) — this is a personal watchlist/trade-idea
// tracker scoped to one browser, not shared data, so no backend endpoint needed.
export function useChartsCart() {
  const [items, setItems] = useState<CartItem[]>(() => loadCart())

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items))
    } catch {
      // private mode / storage quota — cart just won't persist this session
    }
  }, [items])

  // The native `storage` event only fires in OTHER tabs/documents, never the one that
  // made the write — so this purely handles cross-tab sync (e.g. clearing the cart on
  // the Charts page while /chart-cart is already open in another tab) without fighting
  // the effect above for same-tab updates.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key !== STORAGE_KEY) return
      setItems(loadCart())
    }
    window.addEventListener('storage', onStorage)
    return () => window.removeEventListener('storage', onStorage)
  }, [])

  // Bullish/bearish are independent entries for the same (symbol, tf) -- a trader
  // can mark a chart either way, or both, since direction is the trader's own call,
  // not something derived from price action.
  const isInCart = useCallback(
    (symbol: string, tf: ChartsTf, direction: CartDirection) =>
      items.some(i => itemKey(i.symbol, i.tf, i.direction) === itemKey(symbol, tf, direction)),
    [items],
  )

  const toggle = useCallback((item: Omit<CartItem, 'addedAt'>) => {
    setItems(prev => {
      const k = itemKey(item.symbol, item.tf, item.direction)
      if (prev.some(i => itemKey(i.symbol, i.tf, i.direction) === k)) {
        return prev.filter(i => itemKey(i.symbol, i.tf, i.direction) !== k)
      }
      return [{ ...item, addedAt: Date.now() }, ...prev]
    })
  }, [])

  const remove = useCallback((symbol: string, tf: ChartsTf, direction: CartDirection) => {
    setItems(prev => prev.filter(i => itemKey(i.symbol, i.tf, i.direction) !== itemKey(symbol, tf, direction)))
  }, [])

  const clearSection = useCallback((tf: ChartsTf, direction: CartDirection) => {
    setItems(prev => prev.filter(i => !(i.tf === tf && i.direction === direction)))
  }, [])

  const clearAll = useCallback(() => setItems([]), [])

  return { items, isInCart, toggle, remove, clearSection, clearAll }
}
