import { useState } from 'react'
import { Box, Typography, Collapse } from '@mui/material'
import { usePalette, useTokens } from '../../hooks/usePalette'
import SectionHead from '../shared/SectionHead'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

type Tier = 'no-code' | 'developer'

interface Method {
  n: string
  title: string
  tier: Tier
  who: string
  body: string
  examples?: string[]
  note?: string
}

// The three ways a new field / column can enter a portfolio rule. Method 1 is fully
// self-service; Methods 2–3 are the (deliberately code-gated) extension path — surfaced
// here as documentation so users understand what is and isn't in their reach.
const METHODS: Method[] = [
  {
    n: '01',
    title: 'Compose inline with arithmetic',
    tier: 'no-code',
    who: 'Any user — no code',
    body: 'Combine any existing fields with + − × ÷ directly inside a rule. This covers most ideas without touching the backend: distances from a moving average, ratios, spreads, and z-scores are all one expression.',
    examples: [
      '(close - sma50) / std20 > 2',
      'vol_surge * ret_1m > 0.05',
      'high252 / low252 - 1 > 0.8',
    ],
    note: 'Division guards against zero automatically. Only + − × ÷ and comparisons are allowed — no functions or code.',
  },
  {
    n: '02',
    title: 'Add a convenience field',
    tier: 'developer',
    who: 'Developer — one-line change',
    body: 'A frequently-used expression can be pre-computed once and exposed as a named field, so everyone writes the short form. This is a single line in build_features() on the backend.',
    examples: [
      'z20            = (close - sma20) / std20',
      'dist_sma50_pct = close / sma50 - 1',
    ],
    note: 'Reusable and self-documenting. Requires a backend change + redeploy — request it from an admin.',
  },
  {
    n: '03',
    title: 'Add a new base metric',
    tier: 'developer',
    who: 'Developer — panel-query change',
    body: 'A genuinely new measurement (not derivable from existing fields) is added to the feature panel query itself, then becomes available to every rule and convenience field above it.',
    note: 'Deeper backend change to the feature panel SQL + redeploy. Use when Methods 01 and 02 cannot express the idea.',
  },
]

function TierBadge({ tier }: { tier: Tier }) {
  const { CYAN, INK3, BORDER } = usePalette()
  const isNoCode = tier === 'no-code'
  return (
    <Box sx={{
      ...MONO, fontSize: '0.58rem', fontWeight: 700, letterSpacing: '0.08em',
      px: 0.85, py: 0.35, borderRadius: '6px', whiteSpace: 'nowrap',
      color: isNoCode ? '#04121F' : INK3,
      bgcolor: isNoCode ? CYAN : 'transparent',
      border: isNoCode ? 'none' : `1px solid ${BORDER}`,
    }}>
      {isNoCode ? 'NO CODE' : 'DEVELOPER'}
    </Box>
  )
}

function MethodRow({ m }: { m: Method }) {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  return (
    <Box sx={{ display: 'flex', gap: 1.75, py: 2, borderTop: `1px solid ${BORDER}` }}>
      <Typography sx={{ ...MONO, fontSize: '0.72rem', color: CYAN, pt: 0.15, flexShrink: 0 }}>{m.n}</Typography>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5, flexWrap: 'wrap' }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.86rem', fontWeight: 800, color: INK }}>{m.title}</Typography>
          <TierBadge tier={m.tier} />
        </Box>
        <Typography sx={{ ...MONO, fontSize: '0.6rem', letterSpacing: '0.06em', color: INK3, mb: 1 }}>
          {m.who.toUpperCase()}
        </Typography>
        <Typography sx={{ ...JAKARTA, fontSize: '0.78rem', color: INK2, lineHeight: 1.5, mb: m.examples ? 1.25 : 0 }}>
          {m.body}
        </Typography>
        {m.examples && (
          <Box sx={{ bgcolor: PAPER2, border: `1px solid ${BORDER}`, borderRadius: '8px', p: 1.25, mb: m.note ? 1 : 0, overflowX: 'auto' }}>
            {m.examples.map((ex, i) => (
              <Typography key={i} sx={{ ...MONO, fontSize: '0.72rem', color: INK, lineHeight: 1.8, whiteSpace: 'pre' }}>
                {ex}
              </Typography>
            ))}
          </Box>
        )}
        {m.note && (
          <Typography sx={{ ...JAKARTA, fontSize: '0.7rem', color: INK3, lineHeight: 1.45, fontStyle: 'italic' }}>
            {m.note}
          </Typography>
        )}
      </Box>
    </Box>
  )
}

/**
 * Help section explaining the three ways to add a field/column to a portfolio rule.
 * Collapsible; collapsed by default so it never crowds the main content.
 */
export default function RuleFieldHelp() {
  const { INK2, INK3, CYAN, BORDER, PAPER } = usePalette()
  const { CARD } = useTokens()
  const [open, setOpen] = useState(false)

  return (
    <Box id="rule-help" sx={{ mt: 4 }}>
      <SectionHead title="Adding fields to your rules" accent="#8b5cf6" meta="3 methods" />
      <Box sx={{ ...CARD, bgcolor: PAPER, border: `1px solid ${BORDER}` }}>
        <Box
          onClick={() => setOpen(o => !o)}
          sx={{
            display: 'flex', alignItems: 'center', gap: 1.25, p: 2, cursor: 'pointer',
            '&:hover .rh-chevron': { color: CYAN },
          }}
        >
          <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 700, color: INK2, flex: 1 }}>
            Rules are handwritten expressions over the feature fields. Here are the three ways to
            get the field you need — from zero-code composition to backend extensions.
          </Typography>
          <Typography className="rh-chevron" sx={{ ...MONO, fontSize: '0.75rem', color: INK3, transition: 'color 0.15s, transform 0.2s', transform: open ? 'rotate(90deg)' : 'none' }}>
            ▶
          </Typography>
        </Box>
        <Collapse in={open} timeout="auto" unmountOnExit>
          <Box sx={{ px: 2, pb: 1 }}>
            {METHODS.map(m => <MethodRow key={m.n} m={m} />)}
          </Box>
        </Collapse>
      </Box>
    </Box>
  )
}
