import { Box, Typography, Grid } from '@mui/material'
import { Link } from 'react-router-dom'
import AutoGraphIcon        from '@mui/icons-material/AutoGraph'
import BiotechIcon          from '@mui/icons-material/Biotech'
import CandlestickChartIcon from '@mui/icons-material/CandlestickChart'
import WaterfallChartIcon   from '@mui/icons-material/WaterfallChart'
import ShowChartIcon        from '@mui/icons-material/ShowChart'
import TimelineIcon         from '@mui/icons-material/Timeline'
import AnalyticsIcon        from '@mui/icons-material/Analytics'
import TrendingUpIcon       from '@mui/icons-material/TrendingUp'
import CompareArrowsIcon    from '@mui/icons-material/CompareArrows'
import LocalShippingIcon    from '@mui/icons-material/LocalShipping'
import TrendingDownIcon     from '@mui/icons-material/TrendingDown'
import AssessmentIcon       from '@mui/icons-material/Assessment'
import StorageIcon          from '@mui/icons-material/Storage'
import FunctionsIcon        from '@mui/icons-material/Functions'
import VerifiedIcon         from '@mui/icons-material/Verified'
import PsychologyIcon       from '@mui/icons-material/Psychology'
import ArrowForwardIcon     from '@mui/icons-material/ArrowForward'
import NorthIcon            from '@mui/icons-material/North'
import SouthIcon            from '@mui/icons-material/South'
import Navbar               from '../components/Navbar'
import type { SvgIconComponent } from '@mui/icons-material'

// ── Editorial palette ─────────────────────────────────────────────────────────
const W = {
  bg:       '#EEF2DC',   // lightest — derived pale sage base
  bg2:      '#D4DE95',   // Mossy Hollow: pale lime
  surface:  '#FFFFFF',
  border:   '#BAC095',   // Mossy Hollow: sage
  border2:  '#9AAD70',   // derived mid-olive
  text:     '#3D4127',   // Mossy Hollow: dark forest
  text2:    '#636B2F',   // Mossy Hollow: olive
  text3:    '#8A9050',   // derived muted olive
  amber:    '#636B2F',   // olive as primary accent
  amberBg:  '#EEF2DC',
  amberMid: '#7A8438',   // derived mid accent
  green:    '#037A4D',
  red:      '#C23B22',
  blue:     '#2563EB',
  purple:   '#6D28D9',
  teal:     '#0D7490',
  orange:   '#C2520A',
} as const

// ── Font helpers ──────────────────────────────────────────────────────────────
const SERIF = { fontFamily: "'IBM Plex Serif', serif"                } as const
const COND  = { fontFamily: "'IBM Plex Sans Condensed', sans-serif"  } as const
const BODY  = { fontFamily: "'IBM Plex Sans', sans-serif"            } as const
const MONO  = { fontFamily: "'IBM Plex Mono', monospace"             } as const

// ── Content ───────────────────────────────────────────────────────────────────
interface Module {
  to: string; title: string; accent: string; icon: SvgIconComponent
  tag: string; desc: string; components: number; score: string
}

const MODULES: Module[] = [
  { to: '/pattern-dna',      title: 'Pattern DNA',           accent: W.blue,    icon: ShowChartIcon,     tag: 'Pattern Detection', components: 6, score: 'Win rate · EV',        desc: 'Candlestick patterns with statistical edge. Forward returns, win rates, and expected value — validated, not charted.' },
  { to: '/markov-options',   title: 'Markov Options',        accent: W.purple,  icon: TimelineIcon,       tag: 'Options Strategy',  components: 6, score: 'Regime · IV rank',     desc: '6-regime Markov classifier for systematic options strategy grounded in validated market state transitions.' },
  { to: '/quant-strategies', title: 'Quant Strategies',      accent: W.teal,    icon: AnalyticsIcon,      tag: 'Multi-factor',      components: 8, score: 'Multi-factor score',   desc: 'Momentum, mean-reversion, and multi-factor quantitative screening models backed by 5+ years of data.' },
  { to: '/indicators',       title: 'Indicator Edge Lab',    accent: W.amber,   icon: TrendingUpIcon,     tag: 'Validation',        components: 5, score: 'Decile analysis',      desc: 'Test which indicators carry actual edge. Decile analysis, forward returns, and out-of-sample validation.' },
  { to: '/cointegration',    title: 'Cointegration',         accent: W.green,   icon: CompareArrowsIcon,  tag: 'Pair Trading',      components: 4, score: 'ADF · Johansen',      desc: 'Johansen and Engle-Granger tests to identify mean-reverting pairs from the NIFTY universe.' },
  { to: '/delivery',         title: 'Delivery Intelligence', accent: W.orange,  icon: LocalShippingIcon,  tag: 'Flow Analysis',     components: 5, score: 'Commitment ratio',     desc: 'Institutional commitment vs speculative activity. Delivery-based participation signals, quantified.' },
  { to: '/short',            title: 'Short Intel',           accent: W.red,     icon: TrendingDownIcon,   tag: 'Short Analysis',    components: 4, score: 'Squeeze probability',  desc: 'Short interest buildup, squeeze probability, and contrarian signal detection before the market reacts.' },
  { to: '/stock',            title: 'Stock DNA',             accent: '#5A6A7E',  icon: AssessmentIcon,    tag: 'Stock Profile',     components: 7, score: 'DNA 0–100',            desc: 'Composite profile: regime quality, recovery speed, drawdown risk, relative strength, and efficiency.' },
]

interface Agent {
  to: string; name: string; role: string; accent: string; icon: SvgIconComponent
  description: string; capabilities: string[]
}

const AGENTS: Agent[] = [
  {
    to: '/agents', name: 'Market Regime Agent', role: 'Market Intelligence',
    accent: W.blue, icon: AutoGraphIcon,
    description: 'Classifies structural market regime across NIFTY using breadth, DNA, and relative strength. Delivers a brief with confidence level and invalidation conditions.',
    capabilities: ['calculate_market_dna()', 'calculate_breadth()', 'get_regime_heatmap()', 'calculate_relative_strength()'],
  },
  {
    to: '/agents', name: 'Stock DNA Agent', role: 'Stock Research',
    accent: W.green, icon: BiotechIcon,
    description: 'Produces comprehensive, evidence-based DNA profiles for individual equities — covering trend quality, drawdown risk, recovery speed, and efficiency scores.',
    capabilities: ['calculate_stock_dna(symbol)', 'calculate_regime(symbol)', 'calculate_drawdown(symbol)', 'calculate_relative_strength(symbol)'],
  },
  {
    to: '/agents', name: 'Pattern Edge Agent', role: 'Pattern Analysis',
    accent: W.amber, icon: CandlestickChartIcon,
    description: 'Scans for candlestick patterns with statistically validated edge. Ranks by win rate, expected value, and sample size. Never presents a pattern without evidence.',
    capabilities: ['scan_patterns(symbol)', 'get_forward_returns()', 'calculate_win_rate()', 'run_decile_analysis()'],
  },
  {
    to: '/agents', name: 'Options Flow Agent', role: 'Options Strategy',
    accent: W.purple, icon: WaterfallChartIcon,
    description: 'Combines Markov regime classification with options flow analysis to surface systematic strategy recommendations grounded in validated state transitions.',
    capabilities: ['classify_regime()', 'get_options_chain()', 'calculate_iv_rank()', 'recommend_strategy()'],
  },
]

const PIPELINE = [
  { icon: StorageIcon,    step: '01', label: 'Raw Data',       accent: W.blue,   desc: 'Kite Connect OHLCV, futures, and options chains. Stored as immutable hive-partitioned Parquet files. Never mutated.' },
  { icon: FunctionsIcon,  step: '02', label: 'Feature Engine', accent: W.amber,  desc: 'Polars and DuckDB compute regimes, breadth scores, DNA metrics, drawdowns, and relative strength. Sub-second.' },
  { icon: VerifiedIcon,   step: '03', label: 'Validation',     accent: W.green,  desc: 'Forward return tests, decile analysis, out-of-sample checks, stability analysis. Features that fail are deleted.' },
  { icon: PsychologyIcon, step: '04', label: 'Intelligence',   accent: W.purple, desc: 'MCP-driven AI agents query validated features only. The LLM reasons over structure — it never calculates raw data.' },
]

const PRINCIPLES = [
  { n: '01', title: 'Research over opinions',   body: 'Every metric must survive rigorous out-of-sample validation. Interesting is not enough — it must be evidenced. If it fails, it gets deleted.' },
  { n: '02', title: 'Explainable by design',    body: 'Every score exposes its formula, components, and rationale. No opaque outputs. No black boxes. If you cannot explain it, you cannot use it.' },
  { n: '03', title: 'LLM as a reasoning layer', body: 'The AI never calculates metrics directly. It queries validated MCP tools and reasons over structured outputs. Intelligence requires structure.' },
  { n: '04', title: 'Validation is mandatory',  body: 'Unit tests, data quality checks, forward return tests, decile analysis, stability analysis. Every single metric. No shortcuts, no exceptions.' },
]

const TOPICS = [
  { label: 'Pattern Detection', color: W.blue   },
  { label: 'Options Strategy',  color: W.purple },
  { label: 'Market Breadth',    color: W.teal   },
  { label: 'Regime Analysis',   color: W.amber  },
  { label: 'Pair Trading',      color: W.green  },
  { label: 'Delivery Flow',     color: W.orange },
  { label: 'Short Interest',    color: W.red    },
  { label: 'DNA Scoring',       color: '#5A6A7E'},
  { label: 'Validation',        color: W.green  },
  { label: 'Quantitative',      color: W.blue   },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

function Overline({ children, color = W.amber }: { children: React.ReactNode; color?: string }) {
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2.5 }}>
      <Box sx={{ width: 28, height: 1.5, bgcolor: color, flexShrink: 0 }} />
      <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color }}>
        {children}
      </Typography>
    </Box>
  )
}

function TagPill({ label, color }: { label: string; color: string }) {
  return (
    <Box sx={{
      display: 'inline-flex', alignItems: 'center',
      px: 1.5, py: 0.5,
      border: `1px solid ${color}33`, bgcolor: `${color}0D`, flexShrink: 0,
      transition: 'all 0.15s',
      '&:hover': { bgcolor: `${color}18`, borderColor: `${color}55` },
    }}>
      <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, color, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
        {label}
      </Typography>
    </Box>
  )
}

// Fancy vertical separator: line ─ amber diamond ─ line
function StripDivider() {
  return (
    <Box sx={{
      display: { xs: 'none', md: 'flex' },
      flexDirection: 'column', alignItems: 'center',
      height: 48, flexShrink: 0,
    }}>
      <Box sx={{ width: '1px', flex: 1, background: `linear-gradient(to bottom, transparent, ${W.border2})` }} />
      <Box sx={{
        width: 6, height: 6, flexShrink: 0,
        bgcolor: W.amber, transform: 'rotate(45deg)',
        my: '4px',
        boxShadow: `0 0 6px ${W.amber}66`,
      }} />
      <Box sx={{ width: '1px', flex: 1, background: `linear-gradient(to top, transparent, ${W.border2})` }} />
    </Box>
  )
}

// ── Platform card ─────────────────────────────────────────────────────────────
function PlatformCard() {
  const scores = [
    { label: 'Market DNA Score',  value: 73, color: W.amberMid },
    { label: 'Regime Score',      value: 68, color: W.blue     },
    { label: 'Breadth › SMA 50',  value: 58, color: W.green    },
    { label: 'Recovery Index',    value: 81, color: W.teal     },
  ]
  const indices = [
    { name: 'NIFTY 50',   price: '21,842', chg: '+0.84%', up: true  },
    { name: 'BANK NIFTY', price: '47,230', chg: '+1.12%', up: true  },
    { name: 'NIFTY IT',   price: '34,450', chg: '-0.35%', up: false },
    { name: 'NIFTY MID',  price: '44,180', chg: '+0.62%', up: true  },
  ]

  return (
    <Box sx={{
      bgcolor: W.surface, border: `1px solid ${W.border}`,
      borderRadius: '16px',
      boxShadow: '0 8px 32px rgba(61,65,39,0.18), 0 2px 8px rgba(61,65,39,0.10)',
      overflow: 'hidden',
    }}>
      {/* Header */}
      <Box sx={{
        px: 2.5, py: 1.5, borderBottom: `1px solid ${W.border}`,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        bgcolor: W.bg2,
      }}>
        <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: W.text2 }}>
          Platform Overview
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Box sx={{
            width: 5, height: 5, borderRadius: '50%', bgcolor: W.green,
            animation: 'pulse 2s ease-in-out infinite',
            '@keyframes pulse': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0.3 } },
          }} />
          {/* COND not mono — ticker context */}
          <Typography sx={{ ...SERIF, fontSize: '0.625rem', fontWeight: 700, color: W.green, letterSpacing: '0.1em' }}>
            LIVE · NSE
          </Typography>
        </Box>
      </Box>

      {/* Score bars — MONO ok here, these are analytical numbers */}
      <Box sx={{ p: 2.5, borderBottom: `1px solid ${W.border}`, display: 'flex', flexDirection: 'column', gap: 2 }}>
        {scores.map(s => (
          <Box key={s.label}>
            <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.75 }}>
              <Typography sx={{ ...SERIF, fontSize: '0.75rem', color: W.text2 }}>{s.label}</Typography>
              <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 700, color: s.color }}>{s.value}</Typography>
            </Box>
            <Box sx={{ height: 3, bgcolor: W.border, position: 'relative', overflow: 'hidden' }}>
              <Box sx={{
                position: 'absolute', left: 0, top: 0, bottom: 0,
                width: `${s.value}%`, bgcolor: s.color,
                transition: 'width 0.8s cubic-bezier(0.4,0,0.2,1)',
              }} />
            </Box>
          </Box>
        ))}
      </Box>

      {/* Indices — BODY/COND, not MONO: these are tickers */}
      <Box sx={{ p: 2.5 }}>
        {indices.map((idx, i) => (
          <Box key={idx.name} sx={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            py: 0.75, borderBottom: i < indices.length - 1 ? `1px solid ${W.border}` : 'none',
          }}>
            <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 600, color: W.text2, letterSpacing: '0.04em' }}>
              {idx.name}
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
              <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 600, color: W.text }}>{idx.price}</Typography>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.375 }}>
                {idx.up
                  ? <NorthIcon sx={{ fontSize: '0.625rem', color: W.green }} />
                  : <SouthIcon sx={{ fontSize: '0.625rem', color: W.red   }} />}
                <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 600, color: idx.up ? W.green : W.red }}>{idx.chg}</Typography>
              </Box>
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  )
}

// ── Module card ───────────────────────────────────────────────────────────────
function ModuleCard({ mod }: { mod: Module }) {
  const Icon = mod.icon
  return (
    <Box
      component={Link} to={mod.to}
      sx={{
        display: 'block', textDecoration: 'none',
        bgcolor: W.surface, border: `1px solid ${W.border}`,
        borderRadius: '12px',
        boxShadow: '0 6px 24px rgba(61,65,39,0.14), 0 2px 6px rgba(61,65,39,0.08)',
        p: 3, height: '100%', overflow: 'hidden',
        transition: 'all 0.18s',
        '&:hover': { boxShadow: '0 14px 48px rgba(61,65,39,0.22), 0 4px 12px rgba(61,65,39,0.12)', borderColor: W.border2, transform: 'translateY(-2px)' },
        '&:hover .mod-arrow': { transform: 'translateX(4px)' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2.5 }}>
        <TagPill label={mod.tag} color={mod.accent} />
        <Box sx={{ width: 36, height: 36, bgcolor: `${mod.accent}12`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <Icon sx={{ fontSize: '1.125rem', color: mod.accent }} />
        </Box>
      </Box>

      <Typography sx={{ ...SERIF, fontSize: '1.25rem', fontWeight: 600, color: W.text, lineHeight: 1.3, mb: 1.25 }}>
        {mod.title}
      </Typography>

      <Typography sx={{ ...SERIF, fontSize: '0.875rem', color: W.text2, lineHeight: 1.72, mb: 2.5 }}>
        {mod.desc}
      </Typography>

      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', pt: 2, borderTop: `1px solid ${W.border}` }}>
        <Box sx={{ display: 'flex', gap: 1.5 }}>
          <Typography sx={{ ...SERIF, fontSize: '0.6875rem', color: W.text3 }}>{mod.components} components</Typography>
          <Typography sx={{ ...SERIF, fontSize: '0.6875rem', color: W.text3 }}>·</Typography>
          <Typography sx={{ ...SERIF, fontSize: '0.6875rem', color: mod.accent }}>{mod.score}</Typography>
        </Box>
        <Box className="mod-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.18s' }}>
          <ArrowForwardIcon sx={{ fontSize: '0.875rem', color: mod.accent }} />
        </Box>
      </Box>
    </Box>
  )
}

// ── Agent card ────────────────────────────────────────────────────────────────
function AgentCard({ agent }: { agent: Agent }) {
  const Icon = agent.icon
  return (
    <Box sx={{
      bgcolor: W.surface, border: `1px solid ${W.border}`,
      borderRadius: '12px',
      boxShadow: '0 6px 24px rgba(61,65,39,0.14), 0 2px 6px rgba(61,65,39,0.08)',
      p: 3, display: 'flex', flexDirection: 'column', overflow: 'hidden',
      transition: 'all 0.18s',
      '&:hover': { boxShadow: '0 14px 48px rgba(61,65,39,0.22), 0 4px 12px rgba(61,65,39,0.12)', borderColor: W.border2 },
    }}>
      <Box sx={{ width: 52, height: 52, mb: 2.5, bgcolor: `${agent.accent}15`, border: `1px solid ${agent.accent}30`, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Icon sx={{ fontSize: '1.375rem', color: agent.accent }} />
      </Box>

      <Typography sx={{ ...SERIF, fontSize: '1.125rem', fontWeight: 600, color: W.text, lineHeight: 1.3, mb: 0.5 }}>
        {agent.name}
      </Typography>
      <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, color: agent.accent, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75 }}>
        {agent.role}
      </Typography>

      <Typography sx={{ ...SERIF, fontSize: '0.875rem', color: W.text2, lineHeight: 1.72, mb: 2.5, flex: 1 }}>
        {agent.description}
      </Typography>

      {/* Capabilities — MONO is fine here, these are function signatures */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.625, mb: 2.5 }}>
        {agent.capabilities.map(cap => (
          <Box key={cap} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Box sx={{ width: 3, height: 3, bgcolor: agent.accent, flexShrink: 0 }} />
            <Typography sx={{ ...SERIF, fontSize: '0.6875rem', color: W.text3 }}>{cap}</Typography>
          </Box>
        ))}
      </Box>

      <Box
        component={Link} to={agent.to}
        sx={{
          display: 'flex', alignItems: 'center', gap: 1,
          textDecoration: 'none', color: agent.accent,
          ...SERIF, fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.06em',
          '&:hover .agent-arrow': { transform: 'translateX(4px)' },
        }}
      >
        Launch agent
        <Box className="agent-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.15s' }}>
          <ArrowForwardIcon sx={{ fontSize: '0.875rem' }} />
        </Box>
      </Box>
    </Box>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function LandingPage() {
  return (
    <Box sx={{ bgcolor: W.bg, minHeight: '100vh', color: W.text }}>
      <Navbar />

      {/* ── HERO ─────────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 8, md: 12 } }}>
          <Grid container spacing={{ xs: 6, md: 10 }} alignItems="center">
            <Grid item xs={12} md={7}>
              <Overline>Quantitative Market Intelligence · India</Overline>

              <Typography sx={{
                ...SERIF, fontWeight: 700, color: W.text, lineHeight: 1.18,
                fontSize: { xs: '2.25rem', sm: '3rem', md: '3.75rem', lg: '4.25rem' },
                letterSpacing: '-0.025em', mb: 3,
              }}>
                Where data becomes market intelligence.
              </Typography>

              <Typography sx={{
                ...SERIF, fontSize: { xs: '1rem', md: '1.125rem' },
                color: W.text2, lineHeight: 1.85, mb: 4, maxWidth: 540,
              }}>
                MarketDNA transforms raw market data into validated, explainable intelligence
                for Indian equities and options. Research precedes product. Validation is mandatory.
                Evidence over narratives, always.
              </Typography>

              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 5 }}>
                <Box
                  component={Link} to="/stock"
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 1,
                    px: 3, py: 1.5, bgcolor: W.text, color: '#FFFFFF',
                    textDecoration: 'none', ...SERIF,
                    fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    transition: 'all 0.15s', '&:hover': { bgcolor: '#2D2420' },
                    '&:hover .cta-arrow': { transform: 'translateX(4px)' },
                  }}
                >
                  Start Research
                  <Box className="cta-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.15s' }}>
                    <ArrowForwardIcon sx={{ fontSize: '0.875rem' }} />
                  </Box>
                </Box>
                <Box
                  component={Link} to="/agents"
                  sx={{
                    display: 'inline-flex', alignItems: 'center', gap: 1,
                    px: 3, py: 1.5, border: `1.5px solid ${W.border2}`, color: W.text2,
                    textDecoration: 'none', ...SERIF,
                    fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                    transition: 'all 0.15s', '&:hover': { borderColor: W.text2, color: W.text, bgcolor: `${W.text}08` },
                  }}
                >
                  Meet the Agents
                </Box>
              </Box>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1.5, alignItems: 'center' }}>
                {[
                  { label: '50+ equities',  color: W.text3 },
                  { label: '5Y+ history',   color: W.text3 },
                  { label: '8 modules',     color: W.text3 },
                  { label: '4 AI agents',   color: W.text3 },
                  { label: '0 black boxes', color: W.amber },
                ].map((b, i) => (
                  <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    {i > 0 && <Box sx={{ width: 3, height: 3, borderRadius: '50%', bgcolor: W.border2 }} />}
                    <Typography sx={{ ...SERIF, fontSize: '0.75rem', color: b.color, letterSpacing: '0.04em' }}>
                      {b.label}
                    </Typography>
                  </Box>
                ))}
              </Box>
            </Grid>

            <Grid item xs={12} md={5}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Box
                  component="img"
                  src="https://cdn.undraw.co/illustration/data-input_ot3j.svg"
                  alt="Data input"
                  sx={{ width: '100%', maxWidth: 480, height: 'auto', display: 'block' }}
                />
              </Box>
            </Grid>
          </Grid>
        </Box>
      </Box>

      {/* ── INTELLIGENCE STRIP ───────────────────────────────────────────── */}
      {/* Typography: SERIF title + BODY subtitle — editorial, consistent with rest of page */}
      <Box sx={{ bgcolor: W.bg2, borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{
          maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: 2.5,
          display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: { xs: 3, md: 0 },
          justifyContent: { xs: 'flex-start', md: 'space-between' },
        }}>
          {[
            { val: 'Nifty 50 Universe',  sub: '48 tracked equities'         },
            { val: 'Data Lake',          sub: '5+ years Parquet history'     },
            { val: 'Real-time Compute',  sub: 'Sub-500ms analytics'          },
            { val: 'Research Validated', sub: 'Every feature forward-tested' },
            { val: 'MCP Architecture',   sub: 'Structured AI tool calls'     },
          ].map((item, i) => (
            <Box key={i} sx={{ display: 'flex', alignItems: 'center', gap: { xs: 3, md: 0 } }}>
              {i > 0 && <StripDivider />}
              <Box sx={{ px: { md: i === 0 ? 0 : 3 } }}>
                <Typography sx={{ ...SERIF, fontSize: '0.9375rem', fontWeight: 600, color: W.text, lineHeight: 1.2 }}>
                  {item.val}
                </Typography>
                <Typography sx={{ ...SERIF, fontSize: '0.75rem', color: W.text3, mt: 0.375 }}>
                  {item.sub}
                </Typography>
              </Box>
            </Box>
          ))}
        </Box>
      </Box>

      {/* ── FEATURED MODULE ──────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 7, md: 10 } }}>
          <Overline color={W.text3}>Editor's pick</Overline>

          <Box
            component={Link} to="/stock"
            sx={{
              display: 'flex', flexDirection: { xs: 'column', md: 'row' },
              textDecoration: 'none', border: `1px solid ${W.border}`,
              bgcolor: W.surface, borderRadius: '16px',
              boxShadow: '0 8px 32px rgba(61,65,39,0.16), 0 2px 8px rgba(61,65,39,0.09)',
              overflow: 'hidden', transition: 'all 0.2s',
              '&:hover': { boxShadow: '0 18px 56px rgba(61,65,39,0.24), 0 4px 14px rgba(61,65,39,0.13)', borderColor: W.border2 },
              '&:hover .feat-arrow': { transform: 'translateX(6px)' },
            }}
          >
            <Box sx={{ flex: 1, p: { xs: 3, md: 5 } }}>
              <TagPill label="Stock Profile" color="#5A6A7E" />
              <Typography sx={{
                ...SERIF, fontSize: { xs: '1.75rem', md: '2.375rem' },
                fontWeight: 700, color: W.text, lineHeight: 1.2,
                mt: 2.5, mb: 1.75, letterSpacing: '-0.02em',
              }}>
                Stock DNA
              </Typography>
              <Typography sx={{ ...SERIF, fontSize: '1rem', color: W.text2, lineHeight: 1.85, mb: 3, maxWidth: 460 }}>
                The most comprehensive profile in the platform. Regime quality, recovery speed,
                maximum drawdown, relative strength versus NIFTY 50, and efficiency — all in a
                single 0–100 composite score backed by 5 years of validated data.
              </Typography>

              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 3.5 }}>
                {['Regime Score', 'Recovery Index', 'Drawdown Risk', 'Relative Strength', 'Efficiency Score', 'DNA Composite'].map(c => (
                  <Box key={c} sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                    <Box sx={{ width: 4, height: 4, bgcolor: '#5A6A7E' }} />
                    <Typography sx={{ ...SERIF, fontSize: '0.8125rem', color: W.text2 }}>{c}</Typography>
                  </Box>
                ))}
              </Box>

              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: W.text }}>
                <Typography sx={{ ...SERIF, fontSize: '0.875rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
                  Explore Stock DNA
                </Typography>
                <Box className="feat-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.2s' }}>
                  <ArrowForwardIcon sx={{ fontSize: '1rem' }} />
                </Box>
              </Box>
            </Box>

            <Box sx={{
              width: { xs: '100%', md: 320 }, flexShrink: 0,
              bgcolor: W.bg2, borderLeft: { md: `1px solid ${W.border}` },
              borderTop: { xs: `1px solid ${W.border}`, md: 'none' },
              p: 3.5, display: 'flex', flexDirection: 'column', justifyContent: 'center', gap: 2.5,
            }}>
              {[
                { label: 'DNA Score',         val: 78, suffix: '/100', color: '#5A6A7E' },
                { label: 'Regime Quality',    val: 72, suffix: '/100', color: W.amber   },
                { label: 'Relative Strength', val: 85, suffix: '/100', color: W.green   },
                { label: 'Recovery Index',    val: 68, suffix: '/100', color: W.blue    },
                { label: 'Max Drawdown',      val: 14, suffix: '%',    color: W.red     },
              ].map(s => (
                <Box key={s.label}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.875 }}>
                    <Typography sx={{ ...SERIF, fontSize: '0.8125rem', color: W.text2 }}>{s.label}</Typography>
                    <Typography sx={{ ...SERIF, fontSize: '0.8125rem', fontWeight: 700, color: s.color }}>{s.val}{s.suffix}</Typography>
                  </Box>
                  <Box sx={{ height: 3, bgcolor: W.border, overflow: 'hidden' }}>
                    <Box sx={{ height: '100%', width: `${s.label === 'Max Drawdown' ? s.val * 5 : s.val}%`, bgcolor: s.color }} />
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ── TOPICS ROW ───────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{
          maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: 2.5,
          display: 'flex', alignItems: 'center', gap: 1.5,
          overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' }, scrollbarWidth: 'none',
        }}>
          <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, color: W.text3, letterSpacing: '0.12em', textTransform: 'uppercase', flexShrink: 0, mr: 1 }}>
            Topics
          </Typography>
          {TOPICS.map(t => <TagPill key={t.label} label={t.label} color={t.color} />)}
        </Box>
      </Box>

      {/* ── MODULE GRID ──────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 7, md: 10 } }}>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', mb: 5 }}>
            <Box>
              <Overline>Research Modules</Overline>
              <Typography sx={{ ...SERIF, fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 700, color: W.text, lineHeight: 1.2, letterSpacing: '-0.02em' }}>
                Eight engines.<br />One research platform.
              </Typography>
            </Box>
            <Box
              component={Link} to="/agents"
              sx={{
                display: { xs: 'none', md: 'flex' }, alignItems: 'center', gap: 0.75,
                textDecoration: 'none', color: W.text2, ...SERIF,
                fontSize: '0.8125rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
                flexShrink: 0, ml: 3, transition: 'color 0.15s', '&:hover': { color: W.text },
                '&:hover .all-arrow': { transform: 'translateX(4px)' },
              }}
            >
              All modules
              <Box className="all-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.15s' }}>
                <ArrowForwardIcon sx={{ fontSize: '0.875rem' }} />
              </Box>
            </Box>
          </Box>

          <Grid container spacing={2.5}>
            {MODULES.map(mod => (
              <Grid key={mod.to} item xs={12} sm={6} lg={3}>
                <ModuleCard mod={mod} />
              </Grid>
            ))}
          </Grid>
        </Box>
      </Box>

      {/* ── PLATFORM STATS ───────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: W.text }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 5, md: 7 } }}>
          <Grid container>
            {[
              { val: '50+',    label: 'NIFTY equities tracked',    sub: 'Full NIFTY 50 + mid-caps'   },
              { val: '5Y+',    label: 'Years of validated history', sub: 'Daily OHLCV since 2019'    },
              { val: '100%',   label: 'Features forward-tested',   sub: 'No unvalidated metrics'     },
              { val: '<500ms', label: 'Analytics response time',    sub: 'DuckDB + Parquet engine'    },
              { val: '0',      label: 'Black boxes in the system',  sub: 'Every score is explainable' },
            ].map((s, i) => (
              <Grid key={i} item xs={6} sm={4} md={12/5 as any}>
                <Box sx={{
                  px: { xs: 0, md: 3 }, py: { xs: 2.5, md: 0 },
                  borderRight: { md: i < 4 ? `1px solid rgba(255,255,255,0.12)` : 'none' },
                  borderBottom: { xs: (i < 3) ? `1px solid rgba(255,255,255,0.08)` : 'none', md: 'none' },
                  textAlign: 'center',
                }}>
                  <Typography sx={{ ...SERIF, fontSize: { xs: '2rem', md: '2.5rem' }, fontWeight: 700, color: '#FFFFFF', lineHeight: 1, mb: 0.75 }}>
                    {s.val}
                  </Typography>
                  <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 700, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.08em', textTransform: 'uppercase', mb: 0.5 }}>
                    {s.label}
                  </Typography>
                  <Typography sx={{ ...SERIF, fontSize: '0.625rem', color: 'rgba(255,255,255,0.35)', letterSpacing: '0.04em' }}>
                    {s.sub}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      </Box>

      {/* ── AI AGENTS ────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 7, md: 10 } }}>
          <Overline>AI Research Agents</Overline>
          <Box sx={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', mb: 5 }}>
            <Typography sx={{ ...SERIF, fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 700, color: W.text, lineHeight: 1.2, letterSpacing: '-0.02em', maxWidth: 500 }}>
              Agents that reason.<br />Never guess.
            </Typography>
            <Typography sx={{ ...SERIF, fontSize: '0.9375rem', color: W.text2, lineHeight: 1.75, maxWidth: 320, display: { xs: 'none', md: 'block' } }}>
              Each agent queries validated MCP tools and synthesizes structured intelligence.
              The LLM is a reasoning layer — not an analytics engine.
            </Typography>
          </Box>

          <Grid container spacing={2.5}>
            {AGENTS.map(agent => (
              <Grid key={agent.name} item xs={12} sm={6} lg={3}>
                <AgentCard agent={agent} />
              </Grid>
            ))}
          </Grid>
        </Box>
      </Box>

      {/* ── RESEARCH PHILOSOPHY ──────────────────────────────────────────── */}
      <Box sx={{ bgcolor: W.bg2, borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 7, md: 10 } }}>
          <Overline color={W.text3}>Research Philosophy</Overline>
          <Typography sx={{ ...SERIF, fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 700, color: W.text, lineHeight: 1.2, letterSpacing: '-0.02em', mb: 6 }}>
            Four principles.<br />Non-negotiable.
          </Typography>

          <Grid container spacing={3}>
            {PRINCIPLES.map(p => (
              <Grid key={p.n} item xs={12} sm={6} md={3}>
                <Box sx={{ bgcolor: W.surface, border: `1px solid ${W.border}`, borderRadius: '12px', boxShadow: '0 6px 24px rgba(61,65,39,0.13), 0 2px 6px rgba(61,65,39,0.08)', p: 3.5, height: '100%', overflow: 'hidden' }}>
                  <Typography sx={{ ...SERIF, fontSize: '3.5rem', fontWeight: 700, color: W.border2, lineHeight: 1, mb: 2.5, userSelect: 'none' }}>
                    {p.n}
                  </Typography>
                  <Typography sx={{ ...SERIF, fontSize: '1.125rem', fontWeight: 700, color: W.text, lineHeight: 1.3, mb: 1.5 }}>
                    {p.title}
                  </Typography>
                  <Typography sx={{ ...SERIF, fontSize: '0.9375rem', color: W.text2, lineHeight: 1.8 }}>
                    {p.body}
                  </Typography>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Box>
      </Box>

      {/* ── PIPELINE ─────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 7, md: 10 } }}>
          <Overline>Architecture</Overline>
          <Typography sx={{ ...SERIF, fontSize: { xs: '1.75rem', md: '2.25rem' }, fontWeight: 700, color: W.text, lineHeight: 1.2, letterSpacing: '-0.02em', mb: 6 }}>
            From raw tick data<br />to validated intelligence.
          </Typography>

          <Grid container spacing={0}>
            {PIPELINE.map((step, i) => {
              const Icon = step.icon
              return (
                <Grid key={step.step} item xs={12} md={3}>
                  <Box sx={{
                    p: { xs: 3, md: 3.5 }, borderTop: `3px solid ${step.accent}`,
                    height: '100%', bgcolor: W.surface,
                    borderRadius: '12px',
                    border: `1px solid ${W.border}`,
                    boxShadow: '0 6px 24px rgba(61,65,39,0.12), 0 2px 6px rgba(61,65,39,0.07)',
                    overflow: 'hidden',
                  }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 2 }}>
                      <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, color: W.text3, letterSpacing: '0.1em' }}>
                        {step.step}
                      </Typography>
                      <Icon sx={{ fontSize: '1rem', color: step.accent }} />
                    </Box>
                    <Typography sx={{ ...SERIF, fontSize: '1.125rem', fontWeight: 700, color: W.text, letterSpacing: '-0.01em', mb: 1.5 }}>
                      {step.label}
                    </Typography>
                    <Typography sx={{ ...SERIF, fontSize: '0.875rem', color: W.text2, lineHeight: 1.78 }}>
                      {step.desc}
                    </Typography>
                  </Box>
                </Grid>
              )
            })}
          </Grid>
        </Box>
      </Box>

      {/* ── TECHNOLOGY STRIP ─────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: W.bg2, borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: 3, display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 3 }}>
          <Typography sx={{ ...SERIF, fontSize: '0.6875rem', fontWeight: 700, color: W.text3, letterSpacing: '0.14em', textTransform: 'uppercase', flexShrink: 0 }}>
            Built with
          </Typography>
          {['Python 3.12', 'FastAPI', 'Polars', 'DuckDB', 'Parquet', 'React', 'VectorBT', 'MCP Protocol'].map(tech => (
            <Typography key={tech} sx={{ ...SERIF, fontSize: '0.8125rem', fontWeight: 500, color: W.text2, flexShrink: 0 }}>
              {tech}
            </Typography>
          ))}
        </Box>
      </Box>

      {/* ── CTA ──────────────────────────────────────────────────────────── */}
      <Box sx={{ borderBottom: `1px solid ${W.border}` }}>
        <Box sx={{ maxWidth: 800, mx: 'auto', px: { xs: 3, md: 5 }, py: { xs: 10, md: 14 }, textAlign: 'center' }}>
          <Typography sx={{
            ...SERIF, fontSize: { xs: '2rem', md: '3rem' }, fontWeight: 700, color: W.text,
            lineHeight: 1.2, letterSpacing: '-0.025em', mb: 2.5,
          }}>
            Ready to research the market rigorously?
          </Typography>
          <Typography sx={{ ...SERIF, fontSize: '1.125rem', color: W.text2, lineHeight: 1.8, mb: 5, maxWidth: 480, mx: 'auto' }}>
            Stop trading on opinions. Start building on evidence.
            MarketDNA gives you the tools to find out what actually works.
          </Typography>
          <Box sx={{ display: 'flex', justifyContent: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Box
              component={Link} to="/stock"
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 1.25,
                px: 4, py: 1.75, bgcolor: W.text, color: '#FFFFFF',
                textDecoration: 'none', ...SERIF,
                fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                transition: 'all 0.15s', '&:hover': { bgcolor: '#2D2420' },
                '&:hover .cta2-arrow': { transform: 'translateX(5px)' },
              }}
            >
              Analyze a stock
              <Box className="cta2-arrow" sx={{ display: 'flex', alignItems: 'center', transition: 'transform 0.15s' }}>
                <ArrowForwardIcon sx={{ fontSize: '1rem' }} />
              </Box>
            </Box>
            <Box
              component={Link} to="/pattern-dna"
              sx={{
                display: 'inline-flex', alignItems: 'center', gap: 1,
                px: 4, py: 1.75, border: `1.5px solid ${W.border2}`, color: W.text2,
                textDecoration: 'none', ...SERIF,
                fontSize: '0.9375rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase',
                transition: 'all 0.15s', '&:hover': { borderColor: W.text2, color: W.text },
              }}
            >
              Explore patterns
            </Box>
          </Box>
        </Box>
      </Box>

      {/* ── FOOTER ───────────────────────────────────────────────────────── */}
      <Box sx={{ bgcolor: W.bg2 }}>
        <Box sx={{
          maxWidth: 1200, mx: 'auto', px: { xs: 3, md: 5 }, py: 4,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: 2,
        }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
            <Box sx={{ width: 6, height: 6, bgcolor: W.amber }} />
            <Typography sx={{ ...SERIF, fontSize: '0.75rem', fontWeight: 700, color: W.text2, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              MARKET<Box component="span" sx={{ color: W.amber }}>DNA</Box>
            </Typography>
          </Box>
          <Typography sx={{ ...SERIF, fontSize: '0.8125rem', color: W.text3 }}>
            Research over opinions. Evidence over narratives.
          </Typography>
          <Box sx={{ display: 'flex', gap: 3 }}>
            {[
              { label: 'Stock DNA',  to: '/stock'       },
              { label: 'Agents',     to: '/agents'      },
              { label: 'Patterns',   to: '/pattern-dna' },
            ].map(l => (
              <Box key={l.to} component={Link} to={l.to} sx={{
                textDecoration: 'none', color: W.text3, ...SERIF, fontSize: '0.8125rem',
                transition: 'color 0.12s', '&:hover': { color: W.text2 },
              }}>
                {l.label}
              </Box>
            ))}
          </Box>
        </Box>
      </Box>
    </Box>
  )
}
