import { useEffect, useRef, useState } from 'react'

// Lazy-mount: an element only flips `inView` true once it scrolls near the viewport,
// and stays true afterward. Used by ChartTile so a grid of many chart tiles (full F&O
// universe on /charts, or a large cart on /chart-cart) only fetches history + mounts
// Highcharts for tiles actually scrolled near, instead of all at once.
export function useInView<T extends Element>(rootMargin = '300px') {
  const ref = useRef<T | null>(null)
  const [inView, setInView] = useState(false)

  useEffect(() => {
    if (inView || !ref.current) return
    const el = ref.current
    const obs = new IntersectionObserver(
      entries => { if (entries[0]?.isIntersecting) setInView(true) },
      { rootMargin },
    )
    obs.observe(el)
    return () => obs.disconnect()
  }, [inView, rootMargin])

  return { ref, inView }
}
