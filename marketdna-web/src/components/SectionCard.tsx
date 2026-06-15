import { Box, Typography } from '@mui/material'
import type { SxProps } from '@mui/material'
import { useTokens } from '../hooks/usePalette'

const FONT_COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const FONT_MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const TS_LABEL   = '0.6875rem'
const TS_LG      = '1.0625rem'

interface SectionCardProps {
  title?: string
  tag?: string
  accent?: string
  meta?: string
  children: React.ReactNode
  sx?: SxProps
  contentSx?: SxProps
}

// ── Section card (theme-aware) ────────────────────────────────────────────────

export function DarkSectionCard({
  title,
  tag,
  accent,
  meta,
  children,
  sx,
  contentSx,
}: SectionCardProps) {
  const { PAPER, PAPER2, BORDER, INK, INK3, CYAN } = useTokens()
  const resolvedAccent = accent ?? CYAN
  return (
    <Box sx={{
      bgcolor: PAPER,
      border: `1px solid ${BORDER}`,
      position: 'relative',
      overflow: 'hidden',
      ...sx,
    }}>
      {(title || tag) && (
        <Box sx={{
          px: { xs: 2.5, md: 3 },
          py: 1.875,
          borderBottom: `1px solid ${BORDER}`,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          bgcolor: PAPER2,
        }}>
          <Box sx={{ width: '2px', height: 20, bgcolor: resolvedAccent, flexShrink: 0 }} />
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {tag && (
              <Typography sx={{
                ...FONT_COND,
                fontSize: TS_LABEL,
                fontWeight: 700,
                color: resolvedAccent,
                letterSpacing: '0.14em',
                textTransform: 'uppercase',
                lineHeight: 1.2,
              }}>
                {tag}
              </Typography>
            )}
            {title && (
              <Typography sx={{
                ...FONT_COND,
                fontSize: TS_LG,
                fontWeight: 700,
                color: INK,
                letterSpacing: '0.01em',
                lineHeight: 1.2,
              }}>
                {title}
              </Typography>
            )}
          </Box>
          {meta && (
            <Typography sx={{ ...FONT_MONO, fontSize: TS_LABEL, color: INK3, letterSpacing: '0.06em', flexShrink: 0 }}>
              {meta}
            </Typography>
          )}
        </Box>
      )}
      <Box sx={{ px: { xs: 2.5, md: 3 }, pb: 3.5, pt: 2.5, ...contentSx }}>
        {children}
      </Box>
    </Box>
  )
}

// Alias — most existing code imports SectionCard
export const SectionCard = DarkSectionCard
export default DarkSectionCard

// ── Stat card ─────────────────────────────────────────────────────────────────

export function StatCard({
  label,
  value,
  color,
  accent,
  sx,
}: {
  label: string
  value: React.ReactNode
  color?: string
  accent?: string
  sx?: SxProps
}) {
  const { PAPER, BORDER, INK, INK2, CYAN } = useTokens()
  const resolvedAccent = accent ?? CYAN
  return (
    <Box sx={{
      flex: '1 1 100px',
      bgcolor: PAPER,
      border: `1px solid ${BORDER}`,
      borderLeft: `2px solid ${resolvedAccent}`,
      p: 2,
      ...sx,
    }}>
      <Typography sx={{
        ...FONT_COND,
        fontSize: TS_LABEL,
        color: INK2,
        textTransform: 'uppercase',
        letterSpacing: '0.1em',
        mb: 0.5,
      }}>
        {label}
      </Typography>
      <Typography sx={{
        ...FONT_MONO,
        fontSize: TS_LG,
        fontWeight: 700,
        color: color ?? INK,
        letterSpacing: '-0.01em',
      }}>
        {value}
      </Typography>
    </Box>
  )
}
