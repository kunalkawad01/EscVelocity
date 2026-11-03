import { useEffect, useState } from 'react'
import { chartsApi } from '../api/chartsApi'
import type { ChartsTick, ChartsWsMessage } from '../types/charts'

// Live ticks: one socket, one combined message/second for every F&O underlying.
// Shared by /charts and /chart-cart -- each page opens its own websocket connection,
// but both ride the same single-combined-message pattern off the backend's one
// KiteTicker (fno_charts_service.py), never a socket per symbol.
export function useFoTicker() {
  const [ticks, setTicks] = useState<Record<string, ChartsTick>>({})
  const [wsConnected, setWsConnected] = useState(false)

  useEffect(() => {
    let cancelled = false
    let ws: WebSocket | null = null
    let retryTimer: ReturnType<typeof setTimeout> | null = null

    const connect = () => {
      ws = new WebSocket(chartsApi.wsUrl())
      ws.onopen = () => setWsConnected(true)
      ws.onmessage = ev => {
        try {
          const msg: ChartsWsMessage = JSON.parse(ev.data)
          if (msg.ticks) setTicks(msg.ticks)
        } catch { /* ignore malformed frame */ }
      }
      ws.onclose = () => {
        setWsConnected(false)
        if (!cancelled) retryTimer = setTimeout(connect, 3000)
      }
      ws.onerror = () => ws?.close()
    }
    connect()

    return () => {
      cancelled = true
      if (retryTimer) clearTimeout(retryTimer)
      ws?.close()
    }
  }, [])

  return { ticks, wsConnected }
}
