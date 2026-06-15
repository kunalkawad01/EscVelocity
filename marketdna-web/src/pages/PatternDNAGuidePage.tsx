import { Box, Container, Typography, Chip } from '@mui/material'
import { Link } from 'react-router-dom'
import { SquiggleUnderline } from '../components/DoodleDecor'
import { usePalette } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { Footer } from '../components/Footer'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const

function Accent({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <Box component="span" sx={{ color, fontWeight: 800 }}>{children}</Box>
  )
}

function SectionCard({
  num, title, accent = '#60A5FA', children,
}: {
  num: string; title: string; accent?: string; children: React.ReactNode
}) {
  const { INK, PAPER, PAPER2, BORDER } = usePalette()
  return (
    <Box
      id={`s${num}`}
      sx={{
        mb: 2, borderRadius: 0,
        bgcolor: PAPER,
        border: `1px solid ${BORDER}`,
        overflow: 'hidden', position: 'relative',
      }}
    >
      <Box sx={{
        position: 'absolute', top: 0, left: 0, right: 0, height: '2px', zIndex: 2,
        background: `linear-gradient(90deg, transparent 0%, ${accent}40 35%, rgba(20,184,166,0.25) 65%, transparent 100%)`,
      }} />
      <Box sx={{
        px: { xs: 2.5, md: 3.5 }, py: 1.5,
        bgcolor: PAPER2,
        borderBottom: `1px solid ${BORDER}`,
        display: 'flex', alignItems: 'center', gap: 1.5,
      }}>
        <Box sx={{
          minWidth: 26, height: 26, borderRadius: '8px',
          background: `${accent}18`, border: `1px solid ${accent}30`,
          display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
        }}>
          <Typography sx={{ fontSize: '0.62rem', fontWeight: 900, color: accent }}>{num}</Typography>
        </Box>
        <Typography sx={{ fontSize: '0.85rem', fontWeight: 800, letterSpacing: '-0.01em', color: INK, ...JAKARTA }}>
          {title}
        </Typography>
      </Box>
      <Box sx={{ px: { xs: 2.5, md: 3.5 }, py: 2.5 }}>{children}</Box>
    </Box>
  )
}

function RowEntry({ label, value }: { label: string; value: string }) {
  const { INK2, BORDER } = usePalette()
  return (
    <Box sx={{
      display: 'flex', gap: 2, py: 1.1,
      borderBottom: `1px solid ${BORDER}`,
      '&:last-child': { borderBottom: 'none' },
    }}>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, color: INK2, minWidth: 130, flexShrink: 0, ...JAKARTA }}>
        {label}
      </Typography>
      <Typography sx={{ fontSize: '0.75rem', color: INK2, lineHeight: 1.55, ...JAKARTA }}>
        {value}
      </Typography>
    </Box>
  )
}

function TableCard({ rows }: { rows: [string, string][] }) {
  const { BORDER } = usePalette()
  return (
    <Box sx={{ borderRadius: '12px', border: `1.5px solid ${BORDER}`, overflow: 'hidden' }}>
      {rows.map(([label, value]) => (
        <RowEntry key={label} label={label} value={value} />
      ))}
    </Box>
  )
}

function StatusChip({ label, color }: { label: string; color: string }) {
  return (
    <Chip
      label={label}
      size="small"
      sx={{ bgcolor: `${color}18`, color, fontSize: '0.65rem', fontWeight: 700, height: 20, border: `1px solid ${color}28` }}
    />
  )
}

function Note({ children }: { children: React.ReactNode }) {
  const { INK2, CYAN } = usePalette()
  return (
    <Box sx={{
      mt: 1.5, px: 2, py: 1.5, borderRadius: '10px',
      background: `${CYAN}08`, border: `1px solid ${CYAN}22`,
      borderLeft: `3px solid ${CYAN}55`,
    }}>
      <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6, ...JAKARTA }}>{children}</Typography>
    </Box>
  )
}

export default function PatternDNAGuidePage() {
  const { BG, CYAN, INK, INK2, INK3, BORDER, PAPER } = usePalette()
  const { mode } = useThemeMode()

  const SECTIONS = [
    { num: '1',  label: 'Daily / Weekly',          accent: '#60A5FA' },
    { num: '2',  label: 'Active Scanner',           accent: '#60A5FA' },
    { num: '3',  label: 'Confirmed Forming',        accent: '#8B5CF6' },
    { num: '4',  label: 'Pattern Screener',         accent: '#8B5CF6' },
    { num: '5',  label: 'Pattern Genome',           accent: '#F59E0B' },
    { num: '6',  label: 'Market Heatmap',           accent: '#14B8A6' },
    { num: '7',  label: 'Breakout Tracker',         accent: '#F59E0B' },
    { num: '8',  label: 'Failure Analysis',         accent: '#EF4444' },
    { num: '9',  label: 'Regime-Conditioned DNA',   accent: '#A78BFA' },
    { num: '10', label: 'History Timeline',         accent: '#F59E0B' },
    { num: '11', label: 'Validation Suite',         accent: '#22C55E' },
    { num: '12', label: 'Typical Workflow',         accent: CYAN },
  ]

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>

      {/* Nav */}
      <Box sx={{
        px: { xs: 2, md: 5 }, py: 1.5,
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        position: 'sticky', top: 0, zIndex: 100,
        bgcolor: mode === 'dark' ? 'rgba(6,12,26,0.92)' : 'rgba(247,249,252,0.92)',
        backdropFilter: 'blur(20px)',
        WebkitBackdropFilter: 'blur(20px)',
        borderBottom: `1px solid ${BORDER}`,
        boxShadow: mode === 'dark' ? '0 2px 12px rgba(0,0,0,0.3)' : '0 2px 12px rgba(28,25,23,0.07)',
      }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 3 }}>
          <Link to="/" style={{ textDecoration: 'none' }}>
            <Typography sx={{
              fontWeight: 900, letterSpacing: '-0.03em', fontSize: '1.15rem',
              color: INK,
              fontFamily: "'IBM Plex Sans Condensed', sans-serif",
            }}>
              Market<span style={{ color: CYAN }}>DNA</span>
            </Typography>
          </Link>
          <Box sx={{ px: 1.5, py: 0.4, borderRadius: '8px', bgcolor: 'rgba(139,92,246,0.08)', border: '1px solid rgba(139,92,246,0.18)' }}>
            <Typography sx={{ fontSize: '0.65rem', fontWeight: 700, color: '#8B5CF6', letterSpacing: '0.08em', ...JAKARTA }}>
              PATTERN DNA — GUIDE
            </Typography>
          </Box>
        </Box>
        <Link to="/" style={{ textDecoration: 'none' }}>
          <Typography sx={{ fontSize: '0.78rem', fontWeight: 600, color: CYAN, '&:hover': { opacity: 0.8 }, ...JAKARTA }}>
            ← Pattern DNA
          </Typography>
        </Link>
      </Box>

      {/* Hero */}
      <Box sx={{
        px: { xs: 2.5, md: 8, lg: 12 }, pt: 5, pb: 4,
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `radial-gradient(circle at 18% 50%, ${CYAN}12 0%, transparent 55%)`
          : `radial-gradient(circle at 18% 50%, ${CYAN}08 0%, transparent 55%)`,
      }}>
        <Typography sx={{
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.18em',
          color: '#8B5CF6', textTransform: 'uppercase', mb: 1.25, display: 'block',
        }}>
          User Guide · Pattern Research
        </Typography>
        <Typography sx={{
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontSize: { xs: '2.2rem', md: '3rem' }, letterSpacing: '0.01em',
          color: INK, mb: 0.5, display: 'block', lineHeight: 1,
        }}>
          How to use Pattern DNA
        </Typography>
        <SquiggleUnderline width={220} color={CYAN} sx={{ mb: 1.5 }} />
        <Typography sx={{ fontSize: '0.875rem', color: INK2, maxWidth: 560, lineHeight: 1.65, ...JAKARTA }}>
          Pattern DNA does not give signals. It shows which patterns are forming right now and which patterns have historically worked for each stock — ranked by evidence, not opinion.
        </Typography>
      </Box>

      <Container maxWidth="xl" sx={{ pb: 8 }}>

        {/* TOC */}
        <Box sx={{
          mb: 3, p: 2.5, borderRadius: 0,
          bgcolor: PAPER,
          border: `1px solid ${BORDER}`,
        }}>
          <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, letterSpacing: '0.14em', color: INK3, textTransform: 'uppercase', mb: 1.5, ...JAKARTA }}>
            Jump to section
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
            {SECTIONS.map(s => (
              <Box
                key={s.num}
                component="a"
                href={`#s${s.num}`}
                sx={{
                  textDecoration: 'none',
                  px: 1.5, py: 0.6, borderRadius: '8px',
                  background: `${s.accent}10`,
                  border: `1px solid ${s.accent}22`,
                  display: 'flex', alignItems: 'center', gap: 1,
                  transition: 'background 0.15s, border-color 0.15s',
                  '&:hover': { background: `${s.accent}1E`, borderColor: `${s.accent}40` },
                }}
              >
                <Typography sx={{ fontSize: '0.58rem', fontWeight: 900, color: s.accent }}>{s.num}</Typography>
                <Typography sx={{ fontSize: '0.68rem', fontWeight: 600, color: INK2, ...JAKARTA }}>{s.label}</Typography>
              </Box>
            ))}
          </Box>
        </Box>

        {/* ── Section 1: Timeframe ─────────────────────────────────────────── */}
        <SectionCard num="1" title="Daily / Weekly toggle" accent="#60A5FA">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Located in the hero area at the top of the page. Switches all detection-based sections simultaneously — Scanner, Confirmed Forming, Heatmap, and the Pattern Genome chart.
          </Typography>
          <TableCard rows={[
            ['Daily',  'More detections, shorter pattern durations, faster breakouts. Best for intraday and short-swing research.'],
            ['Weekly', 'Higher-quality signals, fewer false starts, larger structures. Better for positional and swing views.'],
          ]} />
          <Note>The DNA scores, Success Rate, and forward-return figures in the Screener and Genome sections are always computed on Daily bars regardless of this toggle — Weekly data is too sparse for statistically significant per-pattern statistics.</Note>
        </SectionCard>

        {/* ── Section 2: Scanner ───────────────────────────────────────────── */}
        <SectionCard num="2" title="Active Pattern Scanner" accent="#60A5FA">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            A live table of every NIFTY 50 stock currently forming a recognisable chart pattern. Click any symbol to open the full Stock Analysis page.
          </Typography>
          <TableCard rows={[
            ['Stage',      'Where in its lifecycle the pattern is.'],
            ['Confidence', 'Pattern completeness score 0–100. The ring turns green ≥ 80, amber ≥ 65, grey below.'],
            ['Days',       'Number of bars the structure has been building.'],
            ['Breakout',   'Price level that would confirm and complete the pattern.'],
          ]} />
          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <StatusChip label="Forming"        color="#94A3B8" />
            <StatusChip label="Maturing"       color="#60A5FA" />
            <StatusChip label="Breakout Watch" color="#F59E0B" />
            <StatusChip label="Confirmed"      color="#22C55E" />
          </Box>
          <Box sx={{ mt: 1 }}>
            <Typography sx={{ fontSize: '0.65rem', color: INK3, lineHeight: 1.7, ...JAKARTA }}>
              <Accent color="#94A3B8">Forming</Accent> → early structure &nbsp;·&nbsp; <Accent color="#60A5FA">Maturing</Accent> → well-developed &nbsp;·&nbsp; <Accent color="#F59E0B">Breakout Watch</Accent> → price near trigger level &nbsp;·&nbsp; <Accent color="#22C55E">Confirmed</Accent> → breakout has occurred
            </Typography>
          </Box>
        </SectionCard>

        {/* ── Section 3: Confirmed Forming ────────────────────────────────── */}
        <SectionCard num="3" title="Confirmed Forming" accent="#8B5CF6">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            A filtered subset of the Scanner. Only stocks where two conditions are both true:
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
            {[
              ['High DNA Score', 'The stock has a strong historical track record with this specific pattern — measured by success rate, average forward returns, and number of occurrences.'],
              ['Currently Forming', 'The pattern is active right now in the current price structure (any stage).'],
            ].map(([label, desc]) => (
              <Box key={label} sx={{ display: 'flex', gap: 1.5, p: 1.5, borderRadius: '10px', background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.12)' }}>
                <Box sx={{ mt: 0.3, width: 6, height: 6, borderRadius: '50%', bgcolor: '#8B5CF6', flexShrink: 0 }} />
                <Box>
                  <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, color: INK, mb: 0.25, ...JAKARTA }}>{label}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.55, ...JAKARTA }}>{desc}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
          <Note>This is the highest-signal list on the page. Use it as your starting shortlist before doing deeper research in Pattern Genome.</Note>
        </SectionCard>

        {/* ── Section 4: Screener ─────────────────────────────────────────── */}
        <SectionCard num="4" title="Pattern Screener" accent="#8B5CF6">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Answers the question: <Box component="em" sx={{ color: INK, fontStyle: 'italic' }}>"Which stocks have the best historical track record with a specific pattern?"</Box>
            <br /><br />
            Select a pattern from the dropdown. The table ranks all stocks by <Accent color="#8B5CF6">DNA Score</Accent> — a composite of success rate, average 1-month and 3-month forward returns, and number of historical occurrences.
          </Typography>
          <TableCard rows={[
            ['DNA Score',    'Composite 0–100 score. Higher = this stock consistently shows strong forward returns after this pattern.'],
            ['Success Rate', 'Percentage of historical detections where the 21-day forward return was positive.'],
            ['1M / 3M Avg',  'Average forward return over 21 and 63 trading days after detection.'],
            ['Occurrences',  'How many times this pattern has been detected historically. Low counts make scores less reliable.'],
          ]} />
          <Note>Use the Screener to pre-qualify before looking at the formation chart. A stock with DNA Score &lt; 50 for a pattern is not worth acting on even if the formation looks perfect.</Note>
        </SectionCard>

        {/* ── Section 5: Genome ───────────────────────────────────────────── */}
        <SectionCard num="5" title="Pattern Genome (per-stock deep-dive)" accent="#F59E0B">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Select a stock from the dropdown. The Genome section shows three things at once:
          </Typography>
          {[
            {
              title: 'Formation Chart',
              desc: 'Candlestick chart of the current detection. The formation zone is shaded in the pattern\'s category colour. Horizontal dashed lines mark Support, Resistance, and Breakout levels. Y-axis uses compact INR values (e.g. ₹25K).',
            },
            {
              title: 'Forming Right Now cards',
              desc: 'All active patterns for the stock with their confidence ring, stage chip, days forming, risk/reward ratio, and key price levels.',
            },
            {
              title: 'Historical DNA bars',
              desc: 'For every pattern ever detected on this stock, a genome bar shows its DNA Score (0–100) colour-coded by category. This is the stock\'s pattern "fingerprint" — which patterns it responds to best.',
            },
          ].map(item => (
            <Box key={item.title} sx={{ mb: 1.5, p: 1.75, borderRadius: '12px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.14)' }}>
              <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: '#F59E0B', mb: 0.5, ...JAKARTA }}>{item.title}</Typography>
              <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6, ...JAKARTA }}>{item.desc}</Typography>
            </Box>
          ))}
        </SectionCard>

        {/* ── Section 6: Heatmap ──────────────────────────────────────────── */}
        <SectionCard num="6" title="Market Pattern Heatmap" accent="#14B8A6">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            A tile view of which patterns are clustering across the market right now. Each tile shows:
          </Typography>
          <TableCard rows={[
            ['Pattern name',       'The classical pattern type.'],
            ['Count badge',        'How many NIFTY 50 stocks are currently forming it.'],
            ['Category chip',      'Bullish Reversal / Bullish Continuation / Bearish Reversal / Bearish Continuation / Neutral.'],
            ['Avg confidence',     'Mean completeness score across all active detections of this pattern.'],
            ['Symbol list',        'First 6 stocks forming this pattern right now. "+N more" if additional stocks are present.'],
          ]} />
          <Note>The Heatmap reflects the current timeframe (Daily or Weekly). A high-count tile means many stocks are in a similar structural setup — potential sector-level move.</Note>
        </SectionCard>

        {/* ── Section 7: Breakout Tracker ─────────────────────────────────── */}
        <SectionCard num="7" title="Breakout Tracker" accent="#F59E0B">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Retrospective view of patterns detected in the last N trading days (configurable: 30 / 45 / 60 / 90). For each detection it tracks what happened next.
          </Typography>
          <TableCard rows={[
            ['Change %',  'Current price vs. entry price at the time of detection.'],
            ['Status',    'Confirmed (broke out and held) · Forming (still developing) · Failed (reversed).'],
            ['Days since','Trading days elapsed since the pattern was first detected.'],
          ]} />
          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <StatusChip label="Confirmed" color="#22C55E" />
            <StatusChip label="Forming"   color="#F59E0B" />
            <StatusChip label="Failed"    color="#EF4444" />
          </Box>
          <Note>Click "Load Breakout Data" to trigger the scan — it runs on demand because it scans the full universe. Use this section to audit how recent detections have played out.</Note>
        </SectionCard>

        {/* ── Section 8: Failure Analysis ─────────────────────────────────── */}
        <SectionCard num="8" title="Pattern Failure Analysis" accent="#EF4444">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            The inverse of the Screener. Select a pattern and see which stocks have the highest historical failure rate for it — ranked by failure rate descending.
          </Typography>
          <TableCard rows={[
            ['Failure Rate', 'Percentage of historical detections where the 21-day forward return was negative.'],
            ['Avg Loss',     'Average forward return across failed detections only — shows magnitude of typical loss.'],
            ['DNA Score',    'Composite score for context — low score confirms the pattern consistently underperforms on this stock.'],
          ]} />
          <Note>Use this defensively. Before acting on any pattern formation, check Failure Analysis for that stock. A stock consistently in this list for a pattern is a pass, regardless of how clean the chart looks.</Note>
        </SectionCard>

        {/* ── Section 9: Regime DNA ────────────────────────────────────────── */}
        <SectionCard num="9" title="Regime-Conditioned DNA" accent="#A78BFA">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Pattern DNA split by the market regime at the time each historical detection occurred. Uses the same stock selector as Pattern Genome.
          </Typography>
          <TableCard rows={[
            ['Bull',     'Price was above SMA200 at detection time.'],
            ['Sideways', 'Price was between SMA50 and SMA200.'],
            ['Bear',     'Price was below SMA50.'],
          ]} />
          <Typography sx={{ fontSize: '0.78rem', color: INK2, mt: 2, mb: 1, lineHeight: 1.65, ...JAKARTA }}>
            Each bucket shows: <Accent color={INK}>n</Accent> (sample count), <Accent color="#22C55E">success rate</Accent>, and <Accent color="#60A5FA">avg 21d return</Accent>. The <Accent color="#A78BFA">Best Regime</Accent> badge highlights when a pattern on this stock statistically only works in one specific market environment.
          </Typography>
          <Note>Low n values (single digits) make regime buckets unreliable. Treat regime splits with fewer than 5 occurrences as indicative only, not statistically actionable.</Note>
        </SectionCard>

        {/* ── Section 10: History Timeline ────────────────────────────────── */}
        <SectionCard num="10" title="Pattern History Timeline" accent="#F59E0B">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            Scrollable month-grouped log of every historical detection on the selected stock with the actual forward-return outcome. Uses the same stock selector as Pattern Genome.
          </Typography>
          <TableCard rows={[
            ['Date chip',       'Detection date in YYYY-MM-DD format.'],
            ['Pattern name',    'Which pattern was detected, colour-coded by category.'],
            ['Outcome chip',    'Win (fwd 21d > 0) · Loss (fwd 21d < 0) · Pending (insufficient forward data yet).'],
            ['Return figure',   '21-day forward return percentage at time of detection.'],
          ]} />
          <Box sx={{ mt: 2, display: 'flex', gap: 1 }}>
            <StatusChip label="Win"     color="#22C55E" />
            <StatusChip label="Loss"    color="#EF4444" />
            <StatusChip label="Pending" color="#64748B" />
          </Box>
          <Typography sx={{ fontSize: '0.72rem', color: INK3, mt: 1.5, ...JAKARTA }}>
            The summary bar at the top shows total detections, resolved win rate, and pending count.
          </Typography>
        </SectionCard>

        {/* ── Section 11: Validation ──────────────────────────────────────── */}
        <SectionCard num="11" title="Validation Suite" accent="#22C55E">
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2, lineHeight: 1.65, ...JAKARTA }}>
            One-click rigorous back-test of all 9 supported patterns. Takes <Accent color={INK}>60–180 seconds</Accent> on first run, then cached until you click Invalidate Cache.
          </Typography>

          {[
            { step: 'Step 1', title: 'Minimum occurrences', desc: 'Requires at least 12 historical detections per stock per pattern. Filters out noise from sparse data.' },
            { step: 'Step 2', title: 'Out-of-Sample split', desc: 'Splits history into in-sample (IS) and out-of-sample (OOS) halves. Flags patterns where OOS success rate degrades > 20% vs IS — a sign of overfitting.' },
            { step: 'Step 3', title: 'Decile analysis', desc: 'High-confidence detections (top quintile) should produce better forward returns than low-confidence ones. Validates that the confidence score is predictive, not decorative.' },
            { step: 'Step 4', title: 'Confidence calibration', desc: 'Detections scored 80–100 should have a higher actual win rate than 60–80, which should be higher than 40–60. Checks that score bands are calibrated to real outcomes.' },
          ].map(item => (
            <Box key={item.step} sx={{ mb: 1.25, p: 1.75, borderRadius: '12px', background: 'rgba(34,197,94,0.05)', border: '1px solid rgba(34,197,94,0.12)' }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
                <Chip label={item.step} size="small" sx={{ bgcolor: 'rgba(34,197,94,0.12)', color: '#22C55E', fontSize: '0.58rem', fontWeight: 800, height: 18 }} />
                <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: INK, ...JAKARTA }}>{item.title}</Typography>
              </Box>
              <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6, ...JAKARTA }}>{item.desc}</Typography>
            </Box>
          ))}

          <Box sx={{ mt: 2, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <StatusChip label="Validated" color="#22C55E" />
            <StatusChip label="Marginal"  color="#F59E0B" />
            <StatusChip label="Rejected"  color="#EF4444" />
          </Box>
          <Note>Per the MarketDNA research principle — if a pattern fails validation it is removed, not kept because it sounds interesting. The Validation Suite is how that principle is enforced.</Note>
        </SectionCard>

        {/* ── Section 12: Workflow ─────────────────────────────────────────── */}
        <SectionCard num="12" title="Typical Research Workflow" accent={CYAN}>
          <Typography sx={{ fontSize: '0.8rem', color: INK2, mb: 2.5, lineHeight: 1.65, ...JAKARTA }}>
            How to move through the page systematically rather than jumping around.
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1.25 }}>
            {[
              { n: '1', color: '#14B8A6', label: 'Market Heatmap',              detail: 'Open the Heatmap to see which patterns are clustering across the market. A high-count bullish tile means multiple stocks are setting up the same way.' },
              { n: '2', color: '#8B5CF6', label: 'Confirmed Forming',           detail: 'Cross-reference with Confirmed Forming. This narrows to stocks where the active pattern has a validated historical track record for that stock.' },
              { n: '3', color: '#F59E0B', label: 'Pattern Genome',              detail: 'Open Pattern Genome for a shortlisted stock. Check the formation chart visually, confirm the stage and confidence ring, review the DNA bars to ensure the pattern has edge for this ticker.' },
              { n: '4', color: '#A78BFA', label: 'Regime-Conditioned DNA',      detail: 'Check if the current market regime (Bull / Sideways / Bear) matches the regime where this pattern historically performs on this stock.' },
              { n: '5', color: '#F59E0B', label: 'Pattern History Timeline',    detail: 'Review the recent Win / Loss record. A stock with 3 consecutive recent Losses on the same pattern is a warning even if the long-run DNA Score is good.' },
              { n: '6', color: '#EF4444', label: 'Pattern Failure Analysis',    detail: 'Run a final check to confirm the stock does not appear high up in the Failure Analysis for this pattern.' },
              { n: '7', color: '#F59E0B', label: 'Breakout Tracker (ongoing)',  detail: 'Once a position is in play, monitor status in the Breakout Tracker. The Confirmed / Forming / Failed classification updates as price evolves.' },
            ].map(step => (
              <Box key={step.n} sx={{
                display: 'flex', gap: 2, p: 1.75, borderRadius: '12px',
                background: `${step.color}06`, border: `1px solid ${step.color}18`,
              }}>
                <Box sx={{
                  minWidth: 28, height: 28, borderRadius: '50%',
                  background: `${step.color}20`, border: `1px solid ${step.color}40`,
                  display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, mt: 0.15,
                }}>
                  <Typography sx={{ fontSize: '0.65rem', fontWeight: 900, color: step.color }}>{step.n}</Typography>
                </Box>
                <Box>
                  <Typography sx={{ fontSize: '0.76rem', fontWeight: 800, color: INK, mb: 0.35, ...JAKARTA }}>{step.label}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', color: INK2, lineHeight: 1.6, ...JAKARTA }}>{step.detail}</Typography>
                </Box>
              </Box>
            ))}
          </Box>
        </SectionCard>

      </Container>
      <Footer />
    </Box>
  )
}
