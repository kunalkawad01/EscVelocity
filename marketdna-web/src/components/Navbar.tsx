import { Link, useLocation } from 'react-router-dom'
import { Box, Typography, Drawer, Divider, Collapse } from '@mui/material'
import { useState, useEffect, useRef } from 'react'
import { useThemeMode } from '../contexts/ThemeModeContext'

// ── Typography helpers ────────────────────────────────────────────────────────
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

// ── Nav groups (15 items → 4 groups + 1 direct link) ─────────────────────────
const NAV_GROUPS = [
  {
    label: 'Analysis',
    items: [
      { to: '/stock',        label: 'Stock DNA',    desc: 'Per-stock regime & DNA scores'  },
      { to: '/stock-health', label: 'Stock Health', desc: 'Behavioral archetype scanner'   },
      { to: '/pattern-dna',  label: 'Pattern DNA',  desc: 'Formation detection & history'  },
      { to: '/randomness',   label: 'Randomness',   desc: 'Luck vs skill decomposition'    },
    ],
  },
  {
    label: 'Market',
    items: [
      { to: '/indicators',       label: 'Indicators',    desc: 'Signal scan & edge lab'       },
      { to: '/cointegration',    label: 'Cointegration', desc: 'Pair spreads & ADF scan'      },
      { to: '/markov-options',   label: 'Markov',        desc: '6-regime transition matrix'   },
      { to: '/quant-strategies', label: 'Quant',         desc: 'Momentum, MR, Vol, Rotation'  },
      { to: '/dataviz',          label: 'DataViz',       desc: 'NSE 500 return visualisation' },
    ],
  },
  {
    label: 'Signals',
    items: [
      { to: '/trade-decision',   label: 'Trade Intel', desc: '5-agent GO/NO-GO trade verdict'       },
      { to: '/live-trading',     label: 'Live',        desc: 'Sector scatter & breakthrough signals' },
      { to: '/delivery',         label: 'Delivery',  desc: 'Accumulation & distribution signals'   },
      { to: '/short',            label: 'Short',     desc: 'Short candidates & squeeze watch'       },
      { to: '/breakout-scanner', label: 'Breakout',  desc: 'Live breakout scanner'                  },
    ],
  },
  {
    label: 'Options',
    items: [
      { to: '/options',       label: 'Options OI', desc: 'Open interest & OI buildup'  },
      { to: '/expected-move', label: 'Exp. Move',  desc: 'IV-based expected move scan' },
    ],
  },
]

const AGENTS_ITEM = { to: '/agents', label: 'Agents' }

// ── Dark palette ──────────────────────────────────────────────────────────────
const DK = {
  bg:      'rgba(2,3,5,0.97)',
  popover: '#0B1020',
  rule:    '#0F1422',
  text:    '#E6E0D6',
  muted:   '#64708A',
  ghost:   '#252E48',
  amber:   '#E8A820',
  hover:   'rgba(232,168,32,0.05)',
}

// ── Light palette ─────────────────────────────────────────────────────────────
const LT = {
  bg:      'rgba(250,250,247,0.97)',
  popover: '#FAFAF7',
  rule:    '#E8E2D8',
  text:    '#1A1714',
  muted:   '#6B6257',
  ghost:   '#C4BAB0',
  amber:   '#B8840A',
  hover:   'rgba(184,132,10,0.06)',
}

// ── Live clock ────────────────────────────────────────────────────────────────
function LiveClock({ p }: { p: typeof DK }) {
  const [time, setTime] = useState(() => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}:${String(n.getSeconds()).padStart(2, '0')}`
  })

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}:${String(n.getSeconds()).padStart(2, '0')}`)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  return (
    <Box sx={{
      height: '100%', px: 2,
      display: 'flex', alignItems: 'center', gap: 1,
      borderLeft: `1px solid ${p.rule}`, flexShrink: 0,
    }}>
      <Box sx={{
        width: 5, height: 5, borderRadius: '50%', bgcolor: p.amber,
        animation: 'pulse 2.4s ease-in-out infinite',
        '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.2 } },
      }} />
      <Typography sx={{
        ...MONO, fontSize: '0.6875rem',
        color: p.muted, letterSpacing: '0.06em',
        minWidth: 58, userSelect: 'none',
      }}>
        {time}
      </Typography>
    </Box>
  )
}

// ── Dropdown group ────────────────────────────────────────────────────────────
function NavGroup({
  group, p, isActive,
}: {
  group: typeof NAV_GROUPS[0]
  p: typeof DK
  isActive: (to: string) => boolean
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const hasActive = group.items.some(i => isActive(i.to))

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  return (
    <Box
      ref={ref}
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => setOpen(false)}
      sx={{ position: 'relative', display: 'flex', alignItems: 'stretch' }}
    >
      {/* Group trigger */}
      <Box sx={{
        px: 2.25, height: 48, display: 'flex', alignItems: 'center', gap: 0.75,
        ...COND, fontSize: '0.8125rem',
        fontWeight: hasActive ? 700 : 500, letterSpacing: '0.06em',
        textTransform: 'uppercase',
        color: hasActive ? p.amber : open ? p.text : p.muted,
        borderLeft: `1px solid ${p.rule}`,
        borderBottom: hasActive ? `2px solid ${p.amber}` : open ? `2px solid ${p.ghost}` : '2px solid transparent',
        transition: 'all 0.12s', whiteSpace: 'nowrap',
        cursor: 'pointer',
        '&:hover': { color: hasActive ? p.amber : p.text, bgcolor: p.hover },
      }}>
        {group.label}
        <Box component="span" sx={{
          fontSize: '0.55rem', opacity: 0.5,
          transform: open ? 'rotate(180deg)' : 'none',
          transition: 'transform 0.15s',
          display: 'inline-block',
        }}>▼</Box>
      </Box>

      {/* Dropdown panel */}
      <Box sx={{
        position: 'absolute', top: '100%', left: 0, zIndex: 1200,
        bgcolor: p.popover,
        border: `1px solid ${p.rule}`,
        borderTop: `2px solid ${p.amber}`,
        minWidth: 200,
        boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
        opacity: open ? 1 : 0,
        transform: open ? 'translateY(0)' : 'translateY(-4px)',
        transition: 'opacity 0.12s, transform 0.12s',
        pointerEvents: open ? 'auto' : 'none',
      }}>
        {group.items.map(item => {
          const active = isActive(item.to)
          return (
            <Link key={item.to} to={item.to} style={{ textDecoration: 'none', display: 'block' }} onClick={() => setOpen(false)}>
              <Box sx={{
                px: 2.25, py: 1.25,
                display: 'flex', flexDirection: 'column', gap: 0.25,
                borderLeft: active ? `2px solid ${p.amber}` : '2px solid transparent',
                transition: 'all 0.1s',
                '&:hover': { bgcolor: p.hover },
              }}>
                <Typography sx={{
                  ...COND, fontSize: '0.8rem',
                  fontWeight: active ? 700 : 500,
                  color: active ? p.amber : p.text,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  {item.label}
                </Typography>
                <Typography sx={{
                  fontSize: '0.65rem', color: p.muted,
                  fontFamily: "'IBM Plex Sans', sans-serif",
                }}>
                  {item.desc}
                </Typography>
              </Box>
            </Link>
          )
        })}
      </Box>
    </Box>
  )
}

// ── Mobile drawer ─────────────────────────────────────────────────────────────
function MobileDrawer({
  open, onClose, p, pathname, isHome,
}: {
  open: boolean
  onClose: () => void
  p: typeof DK
  pathname: string
  isHome: boolean
}) {
  const { mode, toggle } = useThemeMode()
  const [expandedGroup, setExpandedGroup] = useState<string | null>(null)

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + '/')

  return (
    <Drawer
      anchor="right"
      open={open}
      onClose={onClose}
      PaperProps={{
        sx: {
          width: 280, bgcolor: p.popover,
          borderLeft: `1px solid ${p.rule}`,
        },
      }}
    >
      {/* Drawer header */}
      <Box sx={{
        px: 2.5, py: 2,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        borderBottom: `1px solid ${p.rule}`,
      }}>
        <Typography sx={{
          ...MONO, fontWeight: 700, fontSize: '0.875rem',
          letterSpacing: '0.1em', color: p.text, textTransform: 'uppercase',
        }}>
          MARKET<Box component="span" sx={{ color: p.amber }}>DNA</Box>
        </Typography>
        <Box component="button" onClick={onClose} sx={{
          background: 'none', border: 'none', cursor: 'pointer',
          color: p.muted, fontSize: '1.2rem', p: 0.5, lineHeight: 1,
          '&:hover': { color: p.text },
        }}>✕</Box>
      </Box>

      {/* Group sections */}
      <Box sx={{ overflowY: 'auto', flex: 1, pb: 2 }}>
        {NAV_GROUPS.map(group => {
          const hasActive = group.items.some(i => isActive(i.to))
          const expanded = expandedGroup === group.label

          return (
            <Box key={group.label}>
              <Box
                onClick={() => setExpandedGroup(expanded ? null : group.label)}
                sx={{
                  px: 2.5, py: 1.25,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  cursor: 'pointer',
                  '&:hover': { bgcolor: p.hover },
                  borderLeft: hasActive ? `2px solid ${p.amber}` : '2px solid transparent',
                }}
              >
                <Typography sx={{
                  ...COND, fontSize: '0.8125rem', fontWeight: hasActive ? 700 : 500,
                  color: hasActive ? p.amber : p.text,
                  letterSpacing: '0.08em', textTransform: 'uppercase',
                }}>
                  {group.label}
                </Typography>
                <Box component="span" sx={{
                  fontSize: '0.55rem', color: p.muted,
                  transform: expanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 0.15s', display: 'inline-block',
                }}>▼</Box>
              </Box>

              <Collapse in={expanded || hasActive}>
                {group.items.map(item => {
                  const active = isActive(item.to)
                  return (
                    <Link key={item.to} to={item.to} style={{ textDecoration: 'none' }} onClick={onClose}>
                      <Box sx={{
                        pl: 4, pr: 2.5, py: 1,
                        borderLeft: active ? `2px solid ${p.amber}` : '2px solid transparent',
                        '&:hover': { bgcolor: p.hover },
                      }}>
                        <Typography sx={{
                          ...COND, fontSize: '0.75rem',
                          fontWeight: active ? 700 : 400,
                          color: active ? p.amber : p.muted,
                          letterSpacing: '0.06em', textTransform: 'uppercase',
                        }}>
                          {item.label}
                        </Typography>
                      </Box>
                    </Link>
                  )
                })}
              </Collapse>

              <Divider sx={{ borderColor: p.rule, mx: 2.5 }} />
            </Box>
          )
        })}

        {/* Agents direct link */}
        <Link to={AGENTS_ITEM.to} style={{ textDecoration: 'none' }} onClick={onClose}>
          <Box sx={{
            px: 2.5, py: 1.25, cursor: 'pointer',
            borderLeft: isActive(AGENTS_ITEM.to) ? `2px solid ${p.amber}` : '2px solid transparent',
            '&:hover': { bgcolor: p.hover },
          }}>
            <Typography sx={{
              ...COND, fontSize: '0.8125rem',
              fontWeight: isActive(AGENTS_ITEM.to) ? 700 : 500,
              color: isActive(AGENTS_ITEM.to) ? p.amber : p.text,
              letterSpacing: '0.08em', textTransform: 'uppercase',
            }}>
              Agents
            </Typography>
          </Box>
        </Link>
      </Box>

      {/* Footer: theme toggle + home */}
      {!isHome && (
        <Box sx={{
          px: 2.5, py: 1.5, borderTop: `1px solid ${p.rule}`,
          display: 'flex', gap: 1.5,
        }}>
          <Box component="button" onClick={toggle} sx={{
            flex: 1, py: 0.75, borderRadius: '8px',
            background: 'none', border: `1px solid ${p.rule}`,
            cursor: 'pointer', color: p.muted, fontSize: '0.75rem',
            ...COND, letterSpacing: '0.06em', textTransform: 'uppercase',
            '&:hover': { color: p.text, borderColor: p.ghost },
          }}>
            {mode === 'dark' ? '☀ Light' : '☾ Dark'}
          </Box>
          <Link to="/" style={{ textDecoration: 'none', flex: 1 }} onClick={onClose}>
            <Box sx={{
              py: 0.75, borderRadius: '8px', textAlign: 'center',
              border: `1px solid ${p.rule}`,
              color: p.muted, fontSize: '0.75rem',
              ...COND, letterSpacing: '0.06em', textTransform: 'uppercase',
              '&:hover': { color: p.text, borderColor: p.ghost },
            }}>
              ← Home
            </Box>
          </Link>
        </Box>
      )}
    </Drawer>
  )
}

// ── Main Navbar ───────────────────────────────────────────────────────────────
interface NavbarProps {
  sections?: { label: string; anchor: string }[]
}

export default function Navbar({ sections }: NavbarProps) {
  const { pathname } = useLocation()
  const { mode, toggle } = useThemeMode()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const isActive = (to: string) => pathname === to || pathname.startsWith(to + '/')
  const isHome   = pathname === '/'
  const p        = isHome ? LT : (mode === 'dark' ? DK : LT)

  return (
    <>
      <Box
        component="nav"
        sx={{
          position: 'sticky', top: 0, zIndex: 1000,
          height: 48,
          bgcolor: p.bg,
          backdropFilter: 'blur(16px)',
          WebkitBackdropFilter: 'blur(16px)',
          borderBottom: `1px solid ${p.rule}`,
          display: 'flex', alignItems: 'stretch', overflow: 'visible',
          transition: 'background 0.2s, border-color 0.2s',
        }}
      >
        {/* Brand */}
        <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
          <Box sx={{
            px: { xs: 2, md: 3 }, height: '100%',
            display: 'flex', alignItems: 'center', gap: 1.25,
            borderRight: `1px solid ${p.rule}`,
            '&:hover .brand-text': { color: p.amber },
            transition: 'all 0.12s',
          }}>
            <Box sx={{
              width: 7, height: 7, bgcolor: p.amber, flexShrink: 0,
              animation: 'cursor-blink 1.4s step-end infinite',
              '@keyframes cursor-blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } },
            }} />
            <Typography
              className="brand-text"
              sx={{
                ...MONO, fontWeight: 700, fontSize: '0.875rem',
                letterSpacing: '0.1em', color: p.text,
                textTransform: 'uppercase', transition: 'color 0.12s', userSelect: 'none',
              }}
            >
              MARKET<Box component="span" sx={{ color: p.amber }}>DNA</Box>
            </Typography>
          </Box>
        </Link>

        {/* Page section anchors (e.g. Markov Options page) */}
        {sections && sections.length > 0 && (
          <Box sx={{
            display: { xs: 'none', lg: 'flex' }, alignItems: 'stretch',
            borderRight: `1px solid ${p.rule}`, overflowX: 'auto',
            '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none',
          }}>
            {sections.map(({ label, anchor }) => (
              <Box
                key={anchor}
                component="a" href={`#${anchor}`}
                sx={{
                  px: 1.75, height: '100%', display: 'flex', alignItems: 'center',
                  ...COND, fontSize: '0.6875rem', fontWeight: 600,
                  color: p.ghost, textDecoration: 'none',
                  textTransform: 'uppercase', letterSpacing: '0.1em', whiteSpace: 'nowrap',
                  borderBottom: '2px solid transparent', transition: 'all 0.12s',
                  '&:hover': { color: p.amber, bgcolor: p.hover, borderBottomColor: `${p.amber}4D` },
                }}
              >
                {label}
              </Box>
            ))}
          </Box>
        )}

        {/* Right area */}
        <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>

          {/* Desktop nav groups */}
          <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'stretch' }}>
            {NAV_GROUPS.map(group => (
              <NavGroup key={group.label} group={group} p={p} isActive={isActive} />
            ))}

            {/* Agents — direct link (single item, no dropdown needed) */}
            <Link to={AGENTS_ITEM.to} style={{ textDecoration: 'none', display: 'flex', alignItems: 'stretch' }}>
              <Box sx={{
                px: 2.25, height: '100%', display: 'flex', alignItems: 'center',
                ...COND, fontSize: '0.8125rem',
                fontWeight: isActive(AGENTS_ITEM.to) ? 700 : 500, letterSpacing: '0.06em',
                textTransform: 'uppercase',
                color: isActive(AGENTS_ITEM.to) ? p.amber : p.muted,
                borderLeft: `1px solid ${p.rule}`,
                borderBottom: isActive(AGENTS_ITEM.to) ? `2px solid ${p.amber}` : '2px solid transparent',
                transition: 'all 0.12s', whiteSpace: 'nowrap',
                '&:hover': { color: isActive(AGENTS_ITEM.to) ? p.amber : p.text, bgcolor: p.hover },
              }}>
                Agents
              </Box>
            </Link>
          </Box>

          {/* Theme toggle — hidden on home */}
          {!isHome && (
            <Box
              component="button"
              onClick={toggle}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              sx={{
                px: 1.5, height: '100%', display: { xs: 'none', md: 'flex' }, alignItems: 'center',
                background: 'none', border: 'none', cursor: 'pointer',
                borderLeft: `1px solid ${p.rule}`, color: p.muted,
                fontSize: '0.9rem', lineHeight: 1, transition: 'color 0.12s',
                '&:hover': { color: p.text },
              }}
            >
              {mode === 'dark' ? '☀' : '☾'}
            </Box>
          )}

          {/* Clock */}
          <Box sx={{ display: { xs: 'none', sm: 'flex' } }}>
            <LiveClock p={p} />
          </Box>

          {/* Mobile hamburger */}
          <Box
            component="button"
            onClick={() => setDrawerOpen(true)}
            sx={{
              display: { xs: 'flex', md: 'none' },
              alignItems: 'center', justifyContent: 'center',
              px: 2, height: '100%',
              background: 'none', border: 'none', cursor: 'pointer',
              borderLeft: `1px solid ${p.rule}`, color: p.muted,
              transition: 'color 0.12s',
              '&:hover': { color: p.text },
            }}
          >
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              <Box sx={{ width: 18, height: 1.5, bgcolor: 'currentColor', borderRadius: 1 }} />
              <Box sx={{ width: 14, height: 1.5, bgcolor: 'currentColor', borderRadius: 1 }} />
              <Box sx={{ width: 18, height: 1.5, bgcolor: 'currentColor', borderRadius: 1 }} />
            </Box>
          </Box>
        </Box>
      </Box>

      {/* Mobile drawer */}
      <MobileDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        p={p}
        pathname={pathname}
        isHome={isHome}
      />
    </>
  )
}
