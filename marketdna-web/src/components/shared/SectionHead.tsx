import { Box, Typography } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'

const SANS = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

interface SectionHeadProps {
  title: string
  accent: string
  meta?: string
}

export default function SectionHead({ title, accent, meta }: SectionHeadProps) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: '2px', bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>
        {title}
      </Typography>
      {meta && (
        <Typography sx={{ ...SANS, fontSize: '0.62rem', color: INK3, ml: 'auto' }}>
          {meta}
        </Typography>
      )}
    </Box>
  )
}
