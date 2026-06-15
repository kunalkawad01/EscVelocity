import { Box, Typography } from '@mui/material'
import type { SxProps } from '@mui/material'
import { SquiggleUnderline, DoodleDots, DoodleTag } from './DoodleDecor'
import { L, FONT, TS } from '../styles/ds'

export interface PageStat {
  value: string
  label: string
  color?: string
}

interface PageHeaderProps {
  tag: string
  title: string
  description: string
  accent?: string
  stats?: PageStat[]
  note?: string
  sx?: SxProps
}

export default function PageHeader({
  tag,
  title,
  description,
  accent = L.gold,
  stats,
  note,
  sx,
}: PageHeaderProps) {
  return (
    <Box sx={{
      position: 'relative',
      px: { xs: 3, md: 8, lg: 12 },
      pt: { xs: 7, md: 10 },
      pb: { xs: 5, md: 7 },
      bgcolor: L.bg,
      borderBottom: `1px solid ${L.border}`,
      overflow: 'hidden',
      backgroundImage: `
        radial-gradient(circle, rgba(184,132,10,0.09) 1px, transparent 1px),
        radial-gradient(ellipse 60% 50% at 85% 50%, rgba(184,132,10,0.04) 0%, transparent 60%)
      `,
      backgroundSize: '24px 24px, 100% 100%',
      ...sx,
    }}>
      <Box sx={{ position: 'absolute', top: 28, right: { xs: 20, md: 64 }, opacity: 0.55, display: { xs: 'none', md: 'block' } }}>
        <DoodleDots rows={4} cols={5} gap={14} r={2} color={`${accent}35`} />
      </Box>

      {/* Tag / eyebrow */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <Box sx={{ width: 16, height: '1px', bgcolor: accent }} />
        <Typography sx={{
          ...FONT.cond,
          fontSize: TS.caption,
          fontWeight: 700,
          color: accent,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
        }}>
          {tag}
        </Typography>
      </Box>

      {/* Title */}
      <Typography component="h1" sx={{
        ...FONT.display,
        fontSize: { xs: TS['3xl'], md: TS['4xl'], lg: '4.5rem' },
        lineHeight: 0.94,
        fontWeight: 700,
        color: L.ink,
        maxWidth: 760,
        mb: 0,
      }}>
        {title}
      </Typography>

      <SquiggleUnderline
        width={Math.min(title.length * 16, 380)}
        color={accent}
        sx={{ mb: 3 }}
      />

      {/* Description */}
      <Typography sx={{
        ...FONT.body,
        fontSize: TS.md,
        color: L.ink2,
        maxWidth: 600,
        lineHeight: 1.72,
        mb: stats ? 4.5 : 0,
      }}>
        {description}
      </Typography>

      {note && (
        <Box sx={{ mt: 2.5 }}>
          <DoodleTag color={accent}>✎ {note}</DoodleTag>
        </Box>
      )}

      {stats && stats.length > 0 && (
        <Box sx={{
          display: 'flex', gap: { xs: 4, md: 7 }, flexWrap: 'wrap',
          pt: 3.5, borderTop: `1px solid ${L.border}`,
        }}>
          {stats.map(({ value, label, color }) => (
            <Box key={label}>
              <Typography sx={{
                ...FONT.display,
                fontSize: { xs: TS['3xl'], md: '3rem' },
                lineHeight: 1,
                fontWeight: 700,
                color: color ?? L.ink,
              }}>
                {value}
              </Typography>
              <Typography sx={{
                ...FONT.mono,
                fontSize: TS.label,
                color: L.ghost,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
                mt: 0.5,
              }}>
                {label}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}

// ─── Dark variant ─────────────────────────────────────────────────────────────

export function DarkPageHeader({
  tag,
  title,
  description,
  accent = '#D4AA47',
  stats,
  sx,
}: PageHeaderProps) {
  return (
    <Box sx={{
      px: { xs: 3, md: 6 },
      pt: { xs: 6, md: 9 },
      pb: { xs: 4.5, md: 6 },
      borderBottom: '1px solid rgba(255,255,255,0.06)',
      position: 'relative',
      overflow: 'hidden',
      backgroundImage: 'radial-gradient(ellipse 55% 60% at 0% 50%, rgba(212,170,71,0.04) 0%, transparent 60%)',
      ...sx,
    }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
        <Box sx={{ width: 16, height: '1px', bgcolor: accent }} />
        <Typography sx={{
          ...FONT.cond, fontSize: TS.caption, fontWeight: 700,
          color: accent, letterSpacing: '0.16em', textTransform: 'uppercase',
        }}>
          {tag}
        </Typography>
      </Box>

      <Typography component="h1" sx={{
        ...FONT.display,
        fontSize: { xs: TS['3xl'], md: TS['4xl'], lg: '4.5rem' },
        lineHeight: 0.94, fontWeight: 700, color: '#F2EDE4', maxWidth: 760,
      }}>
        {title}
      </Typography>
      <SquiggleUnderline width={Math.min(title.length * 16, 360)} color={accent} sx={{ mb: 3 }} />

      <Typography sx={{
        ...FONT.body, fontSize: TS.md,
        color: 'rgba(242,237,228,0.55)', maxWidth: 580, lineHeight: 1.72,
        mb: stats ? 4.5 : 0,
      }}>
        {description}
      </Typography>

      {stats && stats.length > 0 && (
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', pt: 3.5, borderTop: '1px solid rgba(255,255,255,0.07)' }}>
          {stats.map(({ value, label, color }) => (
            <Box key={label}>
              <Typography sx={{ ...FONT.display, fontSize: '3rem', lineHeight: 1, fontWeight: 700, color: color ?? '#F2EDE4' }}>
                {value}
              </Typography>
              <Typography sx={{ ...FONT.mono, fontSize: TS.label, color: '#2A3048', letterSpacing: '0.12em', textTransform: 'uppercase', mt: 0.5 }}>
                {label}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  )
}
