import { Link, useLocation } from 'react-router-dom'
import { Box, Typography } from '@mui/material'
import { useState, useEffect } from 'react'
import { useThemeMode } from '../contexts/ThemeModeContext'

// ── Shared ────────────────────────────────────────────────────────────────────
const COND = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const

const NAV_ITEMS = [
  { to: '/stock',            label: 'Stock DNA'    },
  { to: '/pattern-dna',      label: 'Pattern DNA'  },
  { to: '/markov-options',   label: 'Markov'       },
  { to: '/quant-strategies', label: 'Quant'        },
  { to: '/indicators',       label: 'Indicators'   },
  { to: '/cointegration',    label: 'Cointegration'},
  { to: '/delivery',         label: 'Delivery'     },
  { to: '/short',            label: 'Short'        },
  { to: '/agents',           label: 'Agents'       },
  { to: '/dataviz',          label: 'DataViz'      },
  { to: '/stock-health',     label: 'Health'       },
]

// ── Dark palette (analysis pages) ─────────────────────────────────────────────
const DK = {
  bg:    'rgba(2,3,5,0.97)',
  rule:  '#0F1422',
  text:  '#E6E0D6',
  muted: '#64708A',
  ghost: '#252E48',
  amber: '#E8A820',
}

// ── Light palette (landing page) ──────────────────────────────────────────────
const LT = {
  bg:    'rgba(250,250,247,0.97)',
  rule:  '#E8E2D8',
  text:  '#1A1714',
  muted: '#6B6257',
  ghost: '#C4BAB0',
  amber: '#B8840A',
}

interface NavbarProps {
  sections?: { label: string; anchor: string }[]
}

function LiveClock({ isLight }: { isLight: boolean }) {
  const [time, setTime] = useState(() => {
    const n = new Date()
    return `${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`
  })

  useEffect(() => {
    const id = setInterval(() => {
      const n = new Date()
      setTime(`${String(n.getHours()).padStart(2,'0')}:${String(n.getMinutes()).padStart(2,'0')}:${String(n.getSeconds()).padStart(2,'0')}`)
    }, 1000)
    return () => clearInterval(id)
  }, [])

  const p = isLight ? LT : DK

  return (
    <Box sx={{
      height: '100%', px: 2.5,
      display: 'flex', alignItems: 'center', gap: 1,
      borderLeft: `1px solid ${p.rule}`, flexShrink: 0,
    }}>
      <Box sx={{
        width: 5, height: 5, borderRadius: '50%',
        bgcolor: isLight ? '#037A4D' : '#00C97A',
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

export default function Navbar({ sections }: NavbarProps) {
  const { pathname } = useLocation()
  const { mode, toggle } = useThemeMode()
  const isActive = (to: string) => pathname === to || pathname.startsWith(to + '/')
  const isHome   = pathname === '/'
  const p        = isHome ? LT : (mode === 'dark' ? DK : LT)

  return (
    <Box
      component="nav"
      sx={{
        position: 'sticky', top: 0, zIndex: 1000,
        height: 48,
        bgcolor: p.bg,
        backdropFilter: 'blur(16px)',
        WebkitBackdropFilter: 'blur(16px)',
        borderBottom: `1px solid ${p.rule}`,
        display: 'flex', alignItems: 'stretch', overflow: 'hidden',
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

      {/* Section anchors */}
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
                '&:hover': { color: p.amber, bgcolor: isHome ? `${p.amber}0D` : `rgba(232,168,32,0.05)`, borderBottomColor: `${p.amber}4D` },
              }}
            >
              {label}
            </Box>
          ))}
        </Box>
      )}

      {/* Right area */}
      <Box sx={{ ml: 'auto', display: 'flex', alignItems: 'stretch', flexShrink: 0 }}>
        {!isHome && (
          <Link to="/" style={{ textDecoration: 'none', display: 'flex', alignItems: 'stretch' }}>
            <Box sx={{
              px: 2, height: '100%', display: 'flex', alignItems: 'center',
              ...COND, fontSize: '0.75rem', fontWeight: 600,
              color: p.ghost, textTransform: 'uppercase', letterSpacing: '0.1em',
              borderLeft: `1px solid ${p.rule}`, transition: 'all 0.12s',
              '&:hover': { color: p.text, bgcolor: isHome ? `${p.amber}0D` : `rgba(255,255,255,0.02)` },
            }}>
              ← Home
            </Box>
          </Link>
        )}

        <Box sx={{ display: { xs: 'none', md: 'flex' }, alignItems: 'stretch' }}>
          {NAV_ITEMS.map(({ to, label }) => {
            const active = isActive(to)
            return (
              <Link key={to} to={to} style={{ textDecoration: 'none', display: 'flex', alignItems: 'stretch' }}>
                <Box sx={{
                  px: { md: 1.75, lg: 2.25 }, height: '100%',
                  display: 'flex', alignItems: 'center',
                  ...COND, fontSize: '0.8125rem',
                  fontWeight: active ? 700 : 500, letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: active ? p.amber : p.muted,
                  borderLeft: `1px solid ${p.rule}`,
                  borderBottom: active ? `2px solid ${p.amber}` : '2px solid transparent',
                  transition: 'all 0.12s', whiteSpace: 'nowrap',
                  '&:hover': {
                    color: active ? p.amber : p.text,
                    bgcolor: isHome
                      ? (active ? `${p.amber}0D` : `${p.amber}08`)
                      : (active ? `rgba(232,168,32,0.04)` : `rgba(255,255,255,0.02)`),
                  },
                }}>
                  {label}
                </Box>
              </Link>
            )
          })}
        </Box>

        {/* Theme toggle — hidden on home (landing is always light) */}
        {!isHome && (
          <Box
            component="button"
            onClick={toggle}
            title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            sx={{
              px: 1.5, height: '100%', display: 'flex', alignItems: 'center',
              background: 'none', border: 'none', cursor: 'pointer',
              borderLeft: `1px solid ${p.rule}`, color: p.muted,
              fontSize: '0.9rem', lineHeight: 1, transition: 'color 0.12s',
              '&:hover': { color: p.text },
            }}
          >
            {mode === 'dark' ? '☀' : '☾'}
          </Box>
        )}
        <LiveClock isLight={isHome || mode === 'light'} />
      </Box>
    </Box>
  )
}
