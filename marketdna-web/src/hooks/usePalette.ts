import { useThemeMode } from '../contexts/ThemeModeContext'
import { LIGHT, DARK, makeTokens } from '../theme/palette'

export function usePalette() {
  const { mode } = useThemeMode()
  return mode === 'dark' ? DARK : LIGHT
}

export function useTokens() {
  const p = usePalette()
  return { ...p, ...makeTokens(p) }
}
