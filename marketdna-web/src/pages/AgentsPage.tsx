import { Box, Typography, Grid } from '@mui/material'
import { Link } from 'react-router-dom'
import AutoGraphIcon from '@mui/icons-material/AutoGraph'
import BiotechIcon from '@mui/icons-material/Biotech'
import CandlestickChartIcon from '@mui/icons-material/CandlestickChart'
import WaterfallChartIcon from '@mui/icons-material/WaterfallChart'
import ArrowForwardIcon from '@mui/icons-material/ArrowForward'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { usePalette } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const DISP   = { fontFamily: "'IBM Plex Sans Condensed', sans-serif" } as const
const BODY   = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO   = { fontFamily: "'IBM Plex Mono', monospace" } as const
const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

const AGENTS = [
  {
    id: 'market-regime',
    name: 'Market Regime Agent',
    role: 'Market Intelligence Analyst',
    description: 'Classifies the structural market regime across the NIFTY universe using breadth, DNA, and relative strength metrics. Delivers a regime brief with confidence level and invalidation conditions.',
    accent: '#4B8EF5',
    to: '/pattern-dna',
    icon: AutoGraphIcon,
    capabilities: [
      'calculate_market_dna()',
      'calculate_breadth()',
      'get_regime_heatmap()',
      'calculate_relative_strength()',
    ],
    outputLabel: 'Regime Brief',
    status: 'Active',
  },
  {
    id: 'stock-dna',
    name: 'Stock DNA Agent',
    role: 'Stock Research Analyst',
    description: 'Produces comprehensive, evidence-based DNA profiles for individual equities — covering trend quality, drawdown risk, recovery speed, relative strength, and efficiency scores.',
    accent: '#34D399',
    to: '/stock',
    icon: BiotechIcon,
    capabilities: [
      'calculate_stock_dna(symbol)',
      'calculate_regime(symbol)',
      'calculate_drawdown(symbol)',
      'calculate_relative_strength(symbol)',
    ],
    outputLabel: 'DNA Report',
    status: 'Active',
  },
  {
    id: 'pattern-edge',
    name: 'Pattern Edge Agent',
    role: 'Pattern Research Analyst',
    description: 'Scans for candlestick patterns with statistically validated forward-return edge. Ranks signals by win rate, expected value, and historical sample size. Never presents a pattern without its evidence.',
    accent: '#E8B84B',
    to: '/pattern-dna',
    icon: CandlestickChartIcon,
    capabilities: [
      'scan_patterns(timeframe)',
      'get_pattern_edge(pattern)',
      'get_pattern_decile_analysis()',
      'get_market_pattern_heatmap()',
    ],
    outputLabel: 'Edge Scan',
    status: 'Active',
  },
  {
    id: 'options-flow',
    name: 'Options Flow Agent',
    role: 'Options Strategy Analyst',
    description: 'Recommends systematic options strategies grounded in Markov regime classification and delivery flow. Applies regime-to-strategy mapping and always includes defined invalidation conditions.',
    accent: '#9B7FE8',
    to: '/markov-options',
    icon: WaterfallChartIcon,
    capabilities: [
      'get_markov_regime()',
      'calculate_iv_percentile(symbol)',
      'get_delivery_flow(symbol)',
      'get_oi_analysis(symbol)',
    ],
    outputLabel: 'Strategy Brief',
    status: 'Active',
  },
]

const PRINCIPLES = [
  { label: 'TOOL-GROUNDED', desc: 'Every agent output is derived from validated MCP tool calls — never estimated or hallucinated.' },
  { label: 'EXPLAINABLE',   desc: 'All reasoning is transparent. Every score, every threshold, every invalidation condition is stated.' },
  { label: 'DETERMINISTIC', desc: 'Given identical inputs, agents produce identical outputs. No hidden state, no randomness.' },
]


export default function AgentsPage() {
  const { BG, PAPER, PAPER2, BORDER, CYAN, INK, INK2 } = usePalette()
  const { mode } = useThemeMode()

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK }}>
      <Navbar />

      {/* ── HERO ───────────────────────────────────────────────────────────── */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -100, right: '10%', width: 500, height: 400, borderRadius: '50%', background: `radial-gradient(ellipse, ${CYAN}12 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <Box sx={{ position: 'absolute', bottom: -60, left: '5%', width: 300, height: 300, borderRadius: '50%', background: `radial-gradient(ellipse, #4B8EF518 0%, transparent 70%)`, pointerEvents: 'none' }} />
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 9 }, position: 'relative' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5, px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${CYAN}40`, bgcolor: `${CYAN}0D` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: CYAN, animation: 'hpulse 2s ease-in-out infinite', '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${CYAN}` }, '50%': { boxShadow: `0 0 14px ${CYAN}` } } }} />
            <Typography sx={{ ...BODY, fontSize: '0.68rem', fontWeight: 700, color: CYAN, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              AI Research Layer
            </Typography>
          </Box>
          <Typography sx={{ ...DISP, fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.02em', mb: 1.5 }}>
            AI Research{' '}
            <Box component="span" sx={{ color: CYAN, textShadow: `0 0 32px ${CYAN}70` }}>Agents</Box>
          </Typography>
          <Typography sx={{ ...BODY, color: INK2, fontSize: '0.9375rem', maxWidth: 560, lineHeight: 1.72 }}>
            Four specialised agents that query validated MCP tools, reason over structured data, and deliver research-grade output. The LLM reasons — it never calculates.
          </Typography>
          {/* Principles strip */}
          <Box sx={{ display: 'flex', gap: 0, mt: 6, borderTop: `1px solid ${BORDER}`, pt: 4, flexWrap: 'wrap' }}>
            {PRINCIPLES.map(({ label, desc }, i) => (
              <Box key={label} sx={{ flex: 1, minWidth: 200, pr: { md: 6 }, borderRight: { md: i < 2 ? `1px solid ${BORDER}` : 'none' }, pl: { md: i > 0 ? 6 : 0 }, mb: { xs: 3, md: 0 } }}>
                <Typography sx={{ ...MONO, fontSize: '0.75rem', color: CYAN, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1.5 }}>{label}</Typography>
                <Typography sx={{ ...BODY, fontSize: '0.9375rem', color: INK2, lineHeight: 1.68 }}>{desc}</Typography>
              </Box>
            ))}
          </Box>
        </Box>
      </Box>

      {/* ── AGENT CARDS ────────────────────────────────────────────────────── */}
      <Box sx={{ px: { xs: 3, md: 8, lg: 12 }, py: { xs: 9, md: 13 } }}>
        <Grid container spacing={0}>
          {AGENTS.map(({ id, name, role, description, accent, to, icon: Icon, capabilities, outputLabel, status }, idx) => (
            <Grid item xs={12} md={6} key={id}>
              <Box sx={{
                p: { xs: 4.5, md: 5.5 },
                minHeight: 440,
                display: 'flex',
                flexDirection: 'column',
                bgcolor: PAPER,
                borderRight: { md: idx % 2 === 0 ? `1px solid ${BORDER}` : 'none' },
                borderBottom: `1px solid ${BORDER}`,
                position: 'relative',
                overflow: 'hidden',
                transition: 'background 0.25s',
                '&:hover': {
                  background: `${accent}05`,
                  '& .agent-arrow': { opacity: 1, transform: 'translateX(4px)' },
                },
                '&::before': {
                  content: '""',
                  position: 'absolute',
                  top: 0, left: 0,
                  height: '1px',
                  width: '0%',
                  bgcolor: accent,
                  transition: 'width 0.4s cubic-bezier(0.16,1,0.3,1)',
                },
                '&:hover::before': { width: '100%' },
              }}>
                {/* Header */}
                <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', mb: 4.5 }}>
                  <Box sx={{
                    width: 52, height: 52,
                    bgcolor: `${accent}12`,
                    border: `1px solid ${accent}25`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}>
                    <Icon sx={{ fontSize: 24, color: accent }} />
                  </Box>

                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Box sx={{
                      width: 7, height: 7, borderRadius: '50%', bgcolor: '#3DD68C',
                      '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
                      animation: 'pulse 2s infinite',
                    }} />
                    <Typography sx={{ ...MONO, fontSize: '0.6875rem', color: '#3DD68C', letterSpacing: '0.09em', textTransform: 'uppercase' }}>
                      {status}
                    </Typography>
                  </Box>
                </Box>

                {/* Identity */}
                <Typography sx={{ ...MONO, fontSize: '0.75rem', color: INK2, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 1 }}>
                  {role}
                </Typography>
                <Typography sx={{ ...DISP, fontSize: '1.875rem', fontWeight: 700, color: INK, letterSpacing: '0.01em', mb: 2.5 }}>
                  {name}
                </Typography>
                <Typography sx={{ ...BODY, fontSize: '0.9375rem', color: INK2, lineHeight: 1.72, mb: 4.5, flexGrow: 1 }}>
                  {description}
                </Typography>

                {/* Capabilities */}
                <Box sx={{ mb: 4.5 }}>
                  <Typography sx={{ ...MONO, fontSize: '0.6875rem', color: INK2, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 2 }}>
                    MCP Tools
                  </Typography>
                  <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                    {capabilities.map(cap => (
                      <Box key={cap} sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Box sx={{ width: 4, height: 4, borderRadius: '50%', bgcolor: `${accent}60`, flexShrink: 0 }} />
                        <Typography sx={{ ...MONO, fontSize: '0.8125rem', color: `${accent}BB`, letterSpacing: '0.02em' }}>
                          {cap}
                        </Typography>
                      </Box>
                    ))}
                  </Box>
                </Box>

                {/* CTA */}
                <Box
                  component={Link}
                  to={to}
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    textDecoration: 'none',
                    pt: 3.5,
                    borderTop: `1px solid ${BORDER}`,
                  }}
                >
                  <Box>
                    <Typography sx={{ ...MONO, fontSize: '0.6875rem', color: INK2, letterSpacing: '0.1em', textTransform: 'uppercase', mb: 0.5 }}>
                      Output
                    </Typography>
                    <Typography sx={{ ...DISP, fontSize: '1.125rem', fontWeight: 700, color: accent, letterSpacing: '0.03em' }}>
                      {outputLabel}
                    </Typography>
                  </Box>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
                    <Typography sx={{ ...DISP, fontSize: '1rem', fontWeight: 700, color: INK2, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
                      Launch
                    </Typography>
                    <ArrowForwardIcon
                      className="agent-arrow"
                      sx={{ fontSize: 15, color: accent, opacity: 0.4, transform: 'translateX(0)', transition: 'all 0.2s' }}
                    />
                  </Box>
                </Box>
              </Box>
            </Grid>
          ))}
        </Grid>
      </Box>

      {/* ── ARCHITECTURE NOTE ──────────────────────────────────────────────── */}
      <Box sx={{
        mx: { xs: 3, md: 8, lg: 12 },
        mb: { xs: 9, md: 13 },
        p: { xs: 4.5, md: 5.5 },
        border: `1px solid ${BORDER}`,
        bgcolor: PAPER,
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.75rem', color: '#4B8EF5', letterSpacing: '0.12em', textTransform: 'uppercase', mb: 2.5 }}>
          Architecture
        </Typography>
        <Typography sx={{ ...DISP, fontSize: { xs: '1.5rem', md: '2rem' }, fontWeight: 700, color: INK, mb: 2.5, letterSpacing: '0.01em' }}>
          The LLM Never Touches Raw Data
        </Typography>
        <Typography sx={{ ...BODY, fontSize: '0.9375rem', color: INK2, lineHeight: 1.72, maxWidth: 660 }}>
          Every agent routes all computation through the MCP tool layer. The LLM receives
          structured, validated outputs — not raw OHLCV data. This enforces determinism,
          explainability, and prevents the model from hallucinating financial metrics.
        </Typography>
        <Box sx={{
          mt: 4.5, p: 3.5,
          bgcolor: PAPER2,
          border: `1px solid ${BORDER}`,
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '0.8125rem',
          color: '#4A5168',
          lineHeight: 2,
          letterSpacing: '0.02em',
        }}>
          <Box component="span" sx={{ color: INK2 }}>User Query</Box>
          {' → '}
          <Box component="span" sx={{ color: '#4B8EF5' }}>Agent</Box>
          {' → '}
          <Box component="span" sx={{ color: '#E8B84B' }}>MCP Tools</Box>
          {' → '}
          <Box component="span" sx={{ color: '#34D399' }}>Feature Store</Box>
          {' → '}
          <Box component="span" sx={{ color: '#9B7FE8' }}>Validated Output</Box>
          {' → '}
          <Box component="span" sx={{ color: INK2 }}>Agent Reasoning</Box>
          {' → '}
          <Box component="span" sx={{ color: INK }}>Research Brief</Box>
        </Box>
      </Box>

      <Footer />
    </Box>
  )
}
