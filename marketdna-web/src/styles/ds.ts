// ─── MarketDNA Design System ──────────────────────────────────────────────────
// Bloomberg-inspired typographic system.
// IBM Plex family throughout — authority, legibility, precision.

// ── Light palette (data/analytics pages) ──────────────────────────────────────

export const L = {
  bg:      '#F8F4EE',
  surface: '#FFFFFF',
  surface2:'#FBF8F3',
  border:  '#E6D9C8',
  border2: '#D4C4AE',
  ink:     '#18140F',
  ink2:    '#4A4238',
  ink3:    '#9A9088',
  ghost:   '#C8BDB0',
  gold:    '#B8840A',
  gold2:   '#D4A020',
} as const

// ── Dark palette (TERMINUS — all terminal pages) ──────────────────────────────

export const D = {
  bg:      '#020305',
  surface: '#06080E',
  surface2:'#0A0D18',
  border:  '#0F1422',
  border2: '#1A2236',
  ink:     '#E6E0D6',
  ink2:    '#64708A',
  ghost:   '#252E48',
  gold:    '#E8A820',
  gold2:   '#F5BC35',
} as const

// ── Typography — IBM Plex family ──────────────────────────────────────────────
// Bloomberg-inspired: condensed for display/labels, sans for body/UI,
// mono for data/numbers, serif for editorial authority.

export const FONT = {
  display:  { fontFamily: "'IBM Plex Sans Condensed', sans-serif" },
  cond:     { fontFamily: "'IBM Plex Sans Condensed', sans-serif" },
  body:     { fontFamily: "'IBM Plex Sans', sans-serif" },
  mono:     { fontFamily: "'IBM Plex Mono', monospace" },
  serif:    { fontFamily: "'IBM Plex Serif', serif" },
  doodle:   { fontFamily: "'Caveat', cursive" },
} as const

// ── Bloomberg type scale ───────────────────────────────────────────────────────
// Nothing under 11px (0.6875rem). Body text: 14px minimum.

export const TS = {
  label:    '0.6875rem',   // 11px — minimum labels, tags, metadata
  caption:  '0.75rem',     // 12px — secondary labels, nav, chips
  sm:       '0.8125rem',   // 13px — small body, table secondary
  base:     '0.875rem',    // 14px — body text minimum, table cells
  md:       '1rem',        // 16px — standard body / UI text
  lg:       '1.125rem',    // 18px — sub-section titles
  xl:       '1.375rem',    // 22px — section titles
  '2xl':    '1.75rem',     // 28px — card/panel headlines
  '3xl':    '2.5rem',      // 40px — page sub-headers
  '4xl':    '3.5rem',      // 56px — page headers
  '5xl':    '5rem',        // 80px — hero display
  '6xl':    '7rem',        // 112px — hero display XL
} as const

// ── Shared card styles ────────────────────────────────────────────────────────

export const LIGHT_CARD = {
  bgcolor: '#FFFFFF',
  border: `1px solid #E6D9C8`,
  boxShadow: '0 1px 4px rgba(24,20,15,0.06)',
} as const

export const DARK_CARD = {
  bgcolor: '#06080E',
  border: '1px solid #0F1422',
} as const

// ── Table helpers — Bloomberg table: 11px headers, 14px cells ─────────────────

export const LIGHT_TH = {
  bgcolor: '#F0E8D8',
  fontSize: '0.6875rem',
  fontWeight: 700,
  color: '#4A4238',
  textTransform: 'uppercase' as const,
  letterSpacing: '0.08em',
  py: 1,
  px: 1.5,
  whiteSpace: 'nowrap' as const,
  fontFamily: "'IBM Plex Sans Condensed', sans-serif",
}

export const LIGHT_TD = {
  py: 0.875,
  px: 1.5,
  borderColor: 'rgba(24,20,15,0.06)',
  fontSize: '0.875rem',
  color: '#18140F',
  fontFamily: "'IBM Plex Sans', sans-serif",
}

// ── Input style ───────────────────────────────────────────────────────────────

export function lightInput(gold = '#B8840A', border = '#E6D9C8', ink = '#18140F') {
  return {
    fontSize: '0.875rem', color: ink, height: 34,
    fontFamily: "'IBM Plex Sans', sans-serif",
    '& .MuiOutlinedInput-notchedOutline': { borderColor: border },
    '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: gold },
    '&.Mui-focused .MuiOutlinedInput-notchedOutline': { borderColor: gold },
    '& input': { px: 1.5, py: 0, fontSize: '0.875rem', color: ink },
  } as const
}
