import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'

const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

interface FilterChipProps {
  label: string
  value: string
  current: string
  onChange: (value: string) => void
  /** Override active color (defaults to CYAN) */
  accent?: string
  /** Show a colored dot before the label */
  dot?: string
  count?: number
}

export default function FilterChip({ label, value, current, onChange, accent, dot, count }: FilterChipProps) {
  const { CYAN, BORDER, PAPER2, INK3 } = usePalette()
  const color  = accent ?? CYAN
  const active = current === value

  return (
    <Box
      onClick={() => onChange(value)}
      sx={{
        display: 'inline-flex', alignItems: 'center', gap: 0.75,
        px: 1.5, py: 0.5, borderRadius: '6px', cursor: 'pointer',
        border: `1px solid ${active ? `${color}50` : BORDER}`,
        bgcolor: active ? `${color}18` : PAPER2,
        transition: 'all 0.12s',
        '&:hover': {
          borderColor: `${color}50`,
          bgcolor: `${color}12`,
        },
      }}
    >
      {dot && (
        <Box sx={{
          width: 6, height: 6, borderRadius: '50%', bgcolor: dot, flexShrink: 0,
          boxShadow: active ? `0 0 5px ${dot}` : 'none',
        }} />
      )}
      <Typography sx={{
        ...SANS,
        fontSize: '0.68rem', fontWeight: active ? 700 : 500,
        color: active ? color : INK3,
        letterSpacing: '0.02em', userSelect: 'none',
      }}>
        {label}
      </Typography>
      {count !== undefined && (
        <Box sx={{
          px: 0.75, py: 0.1, borderRadius: '4px',
          bgcolor: active ? `${color}25` : `${INK3}18`,
          minWidth: 20, textAlign: 'center',
        }}>
          <Typography sx={{
            ...SANS, fontSize: '0.62rem', fontWeight: 700,
            color: active ? color : INK3,
          }}>
            {count}
          </Typography>
        </Box>
      )}
    </Box>
  )
}
