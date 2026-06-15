import { Box, Typography } from '@mui/material'

// ── Design tokens ─────────────────────────────────────────────────────────────

const PAPER  = '#07090F'
const INK    = '#F2EDE4'
const INK2   = '#8B95AC'
const BORDER = '#0F1526'
const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

// ─────────────────────────────────────────────────────────────────────────────

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
        boxShadow: '1px 2px 8px rgba(0,0,0,0.4)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        '&:hover': { borderColor: `${color}60`, boxShadow: `0 2px 16px rgba(0,0,0,0.6)` },
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: INK2,
          textTransform: 'uppercase',
          letterSpacing: '0.08em',
          fontSize: '0.75rem',
          display: 'block',
          ...JAKARTA,
        }}
      >
        {label}
      </Typography>
      <Typography variant="h5" sx={{ fontWeight: 700, color, mt: 0.4, lineHeight: 1.1, letterSpacing: '-0.02em', ...JAKARTA }}>
        {value}
      </Typography>
      {sub && (
        <Typography variant="caption" sx={{ color: INK2, fontSize: '0.75rem', ...JAKARTA }}>
          {sub}
        </Typography>
      )}
    </Box>
  )
}
