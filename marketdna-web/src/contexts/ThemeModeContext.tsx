import { createContext, useContext, useState, type ReactNode } from 'react'

type Mode = 'light' | 'dark'

const Ctx = createContext<{ mode: Mode; toggle: () => void }>({ mode: 'light', toggle: () => {} })

export function ThemeModeProvider({ children }: { children: ReactNode }) {
  const [mode, setMode] = useState<Mode>(
    () => (localStorage.getItem('mdna-theme') as Mode) ?? 'light'
  )
  const toggle = () =>
    setMode(m => {
      const next = m === 'light' ? 'dark' : 'light'
      localStorage.setItem('mdna-theme', next)
      return next
    })
  return <Ctx.Provider value={{ mode, toggle }}>{children}</Ctx.Provider>
}

export const useThemeMode = () => useContext(Ctx)
