import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'

const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const

type Accent = 'primary' | 'success' | 'error' | 'secondary' | 'default'

const accentColors: Record<Accent, string> = {
  primary:   '#3b82f6',
  success:   '#22c55e',
  error:     '#ef4444',
  secondary: '#6366f1',
  default:   '#94a3b8',
}

interface Props {
  label: string
  value: string | number
  sub?: string
  accent?: Accent
  fullWidth?: boolean
}

export default function StatCard({ label, value, sub, accent = 'default', fullWidth }: Props) {
  const { PAPER, BORDER, INK2 } = usePalette()
  const color = accentColors[accent]
  return (
    <Box
      sx={{
        flex: fullWidth ? '1 1 100%' : '1 1 auto',
        minWidth: 110,
        px: 2,
        py: 1.75,
        borderRadius: '12px',
        bgcolor: PAPER,
        border: `1.5px solid ${BORDER}`,
        borderLeft: `3px solid ${color}`,
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: `${color}60` },
      }}
    >
      <Typography sx={{ ...COND, fontSize: '0.7rem', fontWeight: 700, color: INK2, textTransform: 'uppercase', letterSpacing: '0.1em', display: 'block', mb: 0.3 }}>
        {label}
      </Typography>
      <Typography sx={{ ...MONO, fontSize: '1.25rem', fontWeight: 700, color, lineHeight: 1.1, letterSpacing: '-0.02em' }}>
        {value}
      </Typography>
      {sub && (
        <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK2, mt: 0.25, display: 'block' }}>
          {sub}
        </Typography>
      )}
    </Box>
  )
}
