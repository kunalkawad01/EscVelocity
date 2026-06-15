// ─── MarketDNA Doodle Decorators ──────────────────────────────────────────────
// Hand-drawn style SVG accents. Used in page headers, empty states, annotations.

import { Box, Typography } from '@mui/material'
import type { SxProps } from '@mui/material'

// ── Squiggle underline ────────────────────────────────────────────────────────

function buildSquigglePath(width: number): string {
  // Cubic bezier sine wave. Each wave = 16px. Center Y = 4, amplitude = 3.
  const parts = ['M 0,4']
  let x = 0
  let up = true
  while (x < width) {
    const cx1 = x + 5
    const cy1 = up ? 0 : 8
    const cx2 = x + 11
    const cy2 = up ? 0 : 8
    const ex  = Math.min(x + 16, width)
    parts.push(`C ${cx1},${cy1} ${cx2},${cy2} ${ex},4`)
    x  += 16
    up = !up
  }
  return parts.join(' ')
}

export function SquiggleUnderline({
  width = 180,
  color = '#B8840A',
  sx,
}: {
  width?: number
  color?: string
  sx?: SxProps
}) {
  return (
    <Box component="svg"
      width={width} height={8}
      viewBox={`0 0 ${width} 8`}
      fill="none"
      sx={{ display: 'block', mt: 0.75, ...sx }}
    >
      <path
        d={buildSquigglePath(width)}
        stroke={color}
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Box>
  )
}

// ── Doodle dots grid ──────────────────────────────────────────────────────────

export function DoodleDots({
  rows = 3, cols = 4, gap = 10, r = 1.5,
  color = 'rgba(184,132,10,0.25)',
  sx,
}: {
  rows?: number; cols?: number; gap?: number; r?: number
  color?: string; sx?: SxProps
}) {
  const w = (cols - 1) * gap + r * 2 + 4
  const h = (rows - 1) * gap + r * 2 + 4
  return (
    <Box component="svg"
      width={w} height={h}
      viewBox={`0 0 ${w} ${h}`}
      fill="none"
      sx={{ display: 'block', ...sx }}
    >
      {Array.from({ length: rows }, (_, row) =>
        Array.from({ length: cols }, (_, col) => (
          <circle
            key={`${row}-${col}`}
            cx={r + 2 + col * gap}
            cy={r + 2 + row * gap}
            r={r}
            fill={color}
          />
        ))
      )}
    </Box>
  )
}

// ── Doodle cross-hatch lines ──────────────────────────────────────────────────

export function DoodleCross({ color = 'rgba(184,132,10,0.2)', size = 10, sx }: {
  color?: string; size?: number; sx?: SxProps
}) {
  return (
    <Box component="svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      fill="none" sx={{ display: 'inline-block', ...sx }}
    >
      <line x1="0" y1={size/2} x2={size} y2={size/2} stroke={color} strokeWidth={1.2} />
      <line x1={size/2} y1="0" x2={size/2} y2={size} stroke={color} strokeWidth={1.2} />
    </Box>
  )
}

// ── Doodle arrow ─────────────────────────────────────────────────────────────

export function DoodleArrow({
  direction = 'right',
  color = '#B8840A',
  size = 20,
  sx,
}: {
  direction?: 'right' | 'down'
  color?: string
  size?: number
  sx?: SxProps
}) {
  const d = direction === 'right'
    ? `M 2,${size/2} C 6,${size/2 - 4} ${size-8},${size/2 - 4} ${size-4},${size/2} M ${size-8},${size/2 - 5} L ${size-4},${size/2} L ${size-8},${size/2+4}`
    : `M ${size/2},2 C ${size/2-4},6 ${size/2-4},${size-8} ${size/2},${size-4} M ${size/2-5},${size-8} L ${size/2},${size-4} L ${size/2+4},${size-8}`
  return (
    <Box component="svg" width={size} height={size} viewBox={`0 0 ${size} ${size}`}
      fill="none" sx={{ display: 'inline-block', ...sx }}
    >
      <path d={d} stroke={color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </Box>
  )
}

// ── Caveat annotation tag ─────────────────────────────────────────────────────

export function DoodleTag({
  children,
  color = '#B8840A',
  sx,
}: {
  children: React.ReactNode
  color?: string
  sx?: SxProps
}) {
  return (
    <Box component="span" sx={{
      display: 'inline-flex', alignItems: 'center', gap: 0.5,
      fontFamily: "'Caveat', cursive",
      fontSize: '0.95rem',
      fontWeight: 600,
      color,
      lineHeight: 1.2,
      ...sx,
    }}>
      {children}
    </Box>
  )
}

// ── Research note callout ─────────────────────────────────────────────────────

export function ResearchNote({
  children,
  accent = '#B8840A',
  sx,
}: {
  children: React.ReactNode
  accent?: string
  sx?: SxProps
}) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'flex-start', gap: 1,
      bgcolor: `${accent}0A`,
      border: `1px solid ${accent}28`,
      borderLeft: `2px solid ${accent}`,
      px: 2, py: 1,
      ...sx,
    }}>
      <Typography sx={{
        fontFamily: "'Caveat', cursive",
        fontSize: '0.95rem',
        fontWeight: 500,
        color: accent,
        lineHeight: 1.5,
      }}>
        {children}
      </Typography>
    </Box>
  )
}

// ── Dot-grid background Box ───────────────────────────────────────────────────

export function DotGridBg({
  color = 'rgba(184,132,10,0.12)',
  spacing = 20,
  children,
  sx,
}: {
  color?: string
  spacing?: number
  children?: React.ReactNode
  sx?: SxProps
}) {
  return (
    <Box sx={{
      position: 'relative',
      backgroundImage: `radial-gradient(circle, ${color} 1px, transparent 1px)`,
      backgroundSize: `${spacing}px ${spacing}px`,
      ...sx,
    }}>
      {children}
    </Box>
  )
}
