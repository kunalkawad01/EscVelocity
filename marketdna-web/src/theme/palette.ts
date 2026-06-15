export interface Palette {
  BG: string; PAPER: string; PAPER2: string
  INK: string; INK2: string; INK3: string
  BORDER: string; CYAN: string
}

export const LIGHT: Palette = {
  BG:     '#F7F9FC',
  PAPER:  '#FFFFFF',
  PAPER2: '#EEF3FA',
  INK:    '#0B1829',
  INK2:   '#3D5270',
  INK3:   '#8696AC',
  BORDER: '#D1DCEA',
  CYAN:   '#0099CC',
}

export const DARK: Palette = {
  BG:     '#060C1A',
  PAPER:  '#0B1429',
  PAPER2: '#0F1C3A',
  INK:    '#E4EDFF',
  INK2:   '#7A90B4',
  INK3:   '#4B607A',
  BORDER: '#1E3055',
  CYAN:   '#00C8FF',
}

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

export function makeTokens(p: Palette) {
  return {
    CARD: {
      borderRadius: '16px',
      bgcolor: p.PAPER,
      border: `1px solid ${p.BORDER}`,
      boxShadow: p.BG === LIGHT.BG
        ? '0 2px 16px rgba(0,0,0,0.08)'
        : '0 4px 24px rgba(0,0,0,0.35)',
      p: 2.5,
    } as const,
    TH: {
      bgcolor: p.PAPER2,
      fontSize: '0.65rem', fontWeight: 600, color: p.INK3,
      textTransform: 'uppercase' as const, letterSpacing: '0.1em',
      py: 1, px: 1.75, whiteSpace: 'nowrap' as const,
      fontFamily: "'IBM Plex Sans', sans-serif",
      borderBottom: `1px solid ${p.BORDER}`,
    },
    TD: {
      py: 1.125, px: 1.75,
      borderColor: p.BORDER,
      fontFamily: "'IBM Plex Sans', sans-serif",
    },
    t1: { fontSize: '0.875rem', fontWeight: 700, color: p.INK,  fontVariantNumeric: 'tabular-nums' as const },
    t2: { fontSize: '0.8rem',   fontWeight: 500, color: p.INK2, fontVariantNumeric: 'tabular-nums' as const },
    t3: { fontSize: '0.72rem',  fontWeight: 400, color: p.INK3, fontVariantNumeric: 'tabular-nums' as const },
    INPUT_SX: {
      fontSize: '0.8rem', color: p.INK, height: 32,
      ...JAKARTA,
      '& .MuiOutlinedInput-notchedOutline': { borderColor: p.BORDER },
      '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: p.CYAN },
      '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: p.CYAN },
      '& .MuiSelect-icon': { color: p.INK3 },
      '& input': { color: p.INK },
      '& input::placeholder': { color: p.INK3, opacity: 1 },
    } as const,
  }
}
