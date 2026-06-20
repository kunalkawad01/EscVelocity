import { createContext, useContext, useState, useEffect, type ReactNode } from 'react'

type Mode = 'light' | 'dark'

const Ctx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} })

function applyTheme(mode: Mode) {
  document.documentElement.setAttribute('data-mdna-theme', mode)
}

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('mdna-theme') as Mode) ?? 'light'
  )

  useEffect(() => { applyTheme(mode) }, [mode])

  const toggle = () =>
    setMode(m => {
      const next = m === 'light' ? 'dark' : 'light'
      localStorage.setItem('mdna-theme', next)
      return next
    })
  return <Ctx.Provider value={{ mode, toggle }}>{children}</Ctx.Provider>
}

export const useThemeMode = () => useContext(Ctx)
