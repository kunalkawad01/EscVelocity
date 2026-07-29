import { useState, useRef, useEffect } from 'react'
import {
  Box, Typography, TextField, Select, MenuItem, Chip, Collapse,
  CircularProgress, IconButton,
} from '@mui/material'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { researchApi } from '../api/researchApi'
import type { ResearchChatResponse, ResearchArtifact, ManifestStep } from '../api/researchApi'

interface Turn {
  question: string
  loading: boolean
  response?: ResearchChatResponse
  error?: string
}

const PRESETS = [
  'All stocks below 20 RSI',
  'Stocks with RSI < 30 and volume more than 2x average',
  'Profile RELIANCE — returns, volatility, drawdown',
  'Stocks where EMA20 is above EMA50 sorted by 20-day return',
  'Which NIFTY 50 stocks are within 3% of their 52-week high?',
]

export default function ResearchCopilotPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()
  const [q, setQ] = useState('')
  const [universe, setUniverse] = useState('nse500')
  const [turns, setTurns] = useState<Turn[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns])

  async function ask(question: string) {
    const text = question.trim()
    if (!text) return
    setQ('')
    const idx = turns.length
    setTurns(t => [...t, { question: text, loading: true }])
    try {
      const response = await researchApi.chat(text, universe)
      setTurns(t => t.map((x, i) => i === idx ? { ...x, loading: false, response } : x))
    } catch (e: any) {
      setTurns(t => t.map((x, i) => i === idx ? { ...x, loading: false, error: String(e?.message || e) } : x))
    }
  }

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 6 }, pt: 5, pb: 4 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: CYAN,
            boxShadow: `0 0 0 4px ${CYAN}22`, animation: 'pulse 2s infinite' }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.14em',
            textTransform: 'uppercase', color: CYAN, fontFamily: "'IBM Plex Mono', monospace" }}>
            Research Copilot · Phase 1
          </Typography>
        </Box>
        <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.6rem' }, fontWeight: 800, color: INK,
          lineHeight: 1.05, fontFamily: "'Plus Jakarta Sans','IBM Plex Sans',sans-serif" }}>
          Research <span style={{ color: CYAN }}>Copilot</span>
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', color: INK2, mt: 1.5, maxWidth: 760, lineHeight: 1.6 }}>
          A quantitative analyst over your OHLCV lake. It never estimates a number — every answer is
          computed by a deterministic tool (screen, indicators, stats, EDA) and ships a reproducible
          computation manifest. Ask in plain English.
        </Typography>

        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5, flexWrap: 'wrap' }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK3, fontWeight: 700 }}>UNIVERSE</Typography>
          <Select size="small" value={universe} onChange={e => setUniverse(e.target.value)}
            sx={{ ...INPUT_SX, minWidth: 130, fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.6 } }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, color: INK } } }}>
            <MenuItem value="nse500">NSE 500</MenuItem>
            <MenuItem value="nifty50">NIFTY 50</MenuItem>
          </Select>
        </Box>
      </Box>

      {/* Conversation */}
      <Box sx={{ px: { xs: 2, md: 6 }, py: 3, maxWidth: 1000, mx: 'auto' }}>
        {turns.length === 0 && (
          <Box sx={{ ...CARD, p: 3, mb: 3 }}>
            <Typography sx={{ fontSize: '0.8rem', fontWeight: 700, color: INK, mb: 1.5 }}>
              Try one of these
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {PRESETS.map(p => (
                <Chip key={p} label={p} onClick={() => ask(p)} clickable
                  sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`,
                    fontSize: '0.75rem', '&:hover': { borderColor: CYAN, color: INK } }} />
              ))}
            </Box>
          </Box>
        )}

        {turns.map((t, i) => (
          <Box key={i} sx={{ mb: 3 }}>
            {/* question */}
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
              <Box sx={{ bgcolor: CYAN + '18', border: `1px solid ${CYAN}55`, borderRadius: 2.5,
                px: 2, py: 1, maxWidth: '80%' }}>
                <Typography sx={{ fontSize: '0.85rem', color: INK, fontWeight: 600 }}>{t.question}</Typography>
              </Box>
            </Box>
            {/* answer */}
            <Box sx={{ ...CARD, p: 2.5 }}>
              {t.loading && (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
                  <CircularProgress size={16} sx={{ color: CYAN }} />
                  <Typography sx={{ fontSize: '0.8rem', color: INK3 }}>Computing…</Typography>
                </Box>
              )}
              {t.error && (
                <Typography sx={{ fontSize: '0.82rem', color: '#ef4444' }}>{t.error}</Typography>
              )}
              {t.response && (
                <>
                  <Typography sx={{ fontSize: '0.87rem', color: INK, lineHeight: 1.65, whiteSpace: 'pre-wrap' }}>
                    {t.response.answer}
                  </Typography>
                  {t.response.artifacts.map((a, j) => (
                    <ArtifactView key={j} artifact={a} />
                  ))}
                  <ManifestPanel steps={t.response.manifest.steps}
                    dataVersion={t.response.manifest.data_version}
                    methodology={t.response.manifest.methodology_version} />
                </>
              )}
            </Box>
          </Box>
        ))}
        <div ref={endRef} />
      </Box>

      {/* Composer */}
      <Box sx={{ position: 'sticky', bottom: 0, bgcolor: PAPER, borderTop: `1px solid ${BORDER}`,
        px: { xs: 2, md: 6 }, py: 2 }}>
        <Box sx={{ maxWidth: 1000, mx: 'auto', display: 'flex', gap: 1.5 }}>
          <TextField fullWidth size="small" placeholder="Ask a research question…"
            value={q} onChange={e => setQ(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q) } }}
            sx={{ ...INPUT_SX, '& .MuiInputBase-input': { fontSize: '0.85rem' } }} />
          <IconButton onClick={() => ask(q)} disabled={!q.trim()}
            sx={{ bgcolor: CYAN, color: '#001018', px: 2, borderRadius: 2,
              '&:hover': { bgcolor: CYAN }, '&.Mui-disabled': { bgcolor: BORDER, color: INK3 } }}>
            <span style={{ fontSize: '0.8rem', fontWeight: 800, padding: '0 6px' }}>ASK</span>
          </IconButton>
        </Box>
      </Box>
      <Footer />
    </Box>
  )
}

// ── Artifact renderer ─────────────────────────────────────────────────────────
function ArtifactView({ artifact }: { artifact: ResearchArtifact }) {
  const { INK, INK2, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  const { TH, TD } = useTokens()
  const r = artifact.result || {}

  // run_python sandbox result
  if (artifact.tool === 'run_python') {
    if (r.ok === false) {
      return (
        <Box sx={{ mt: 2, border: `1px solid ${r.blocked ? '#ef4444' : BORDER}`, borderRadius: 2, p: 1.5 }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: r.blocked ? '#ef4444' : INK3, letterSpacing: '0.08em', mb: 0.5 }}>
            SANDBOX · {r.blocked ? 'BLOCKED' : 'ERROR'}
          </Typography>
          <Typography sx={{ fontSize: '0.75rem', color: '#ef4444', fontFamily: "'IBM Plex Mono',monospace" }}>{r.error}</Typography>
        </Box>
      )
    }
    const res = r.result
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.8 }}>
          <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: CYAN, letterSpacing: '0.08em' }}>SANDBOX RESULT</Typography>
          <Typography sx={{ fontSize: '0.6rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>#{r.result_hash}</Typography>
        </Box>
        {res && res.type === 'dataframe'
          ? <DataFrameTable columns={res.columns} rows={res.rows} shape={res.shape} />
          : <Box component="pre" sx={{ m: 0, fontSize: '0.72rem', color: INK, fontFamily: "'IBM Plex Mono',monospace",
              whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 240, overflow: 'auto' }}>
              {JSON.stringify(res && res.values ? res.values : res, null, 2)}
            </Box>}
      </Box>
    )
  }

  // screen result → table
  if (Array.isArray(r.matches)) {
    const rows = r.matches as Record<string, any>[]
    if (rows.length === 0)
      return <Note text={`No matches (${artifact.tool}).`} />
    const cols = Object.keys(rows[0]).filter(k => k !== 'symbol')
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 1.5, py: 0.8, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}`,
          display: 'flex', justifyContent: 'space-between' }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em' }}>
            SCREEN · {r.universe?.toUpperCase()} · {r.match_count} MATCHES
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>
            #{r.result_hash}
          </Typography>
        </Box>
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={{ ...(TH as any), textAlign: 'left', padding: '6px 10px' }}>SYMBOL</th>
              {cols.map(c => <th key={c} style={{ ...(TH as any), textAlign: 'right', padding: '6px 10px' }}>{c.toUpperCase()}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ ...(TD as any), padding: '6px 10px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: INK }}>{row.symbol}</td>
                  {cols.map(c => <td key={c} style={{ ...(TD as any), padding: '6px 10px', textAlign: 'right', fontFamily: "'IBM Plex Mono',monospace", color: INK2 }}>{fmt(row[c])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Box>
    )
  }

  // eda result → summary panel
  if (r.moments && r.return_distribution) {
    const m = r.moments
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em', mb: 1 }}>
          EDA · {r.target} · as of {r.as_of}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <Metric label="Ann. Vol" value={`${m.annualized_vol_pct}%`} c={CYAN} />
          <Metric label="Mean/day" value={`${m.mean_pct}%`} />
          <Metric label="Skew" value={m.skewness} />
          <Metric label="Kurtosis" value={m.kurtosis} />
          <Metric label="Curr. DD" value={`${r.drawdown?.current_pct}%`} c="#ef4444" />
          <Metric label="Max DD" value={`${r.drawdown?.max_pct}%`} c="#ef4444" />
          <Metric label={`Corr→${r.benchmark}`} value={r.rolling_correlation?.current ?? '—'} />
        </Box>
      </Box>
    )
  }

  // backtest result → stat cards + equity curve
  if (r.portfolio && r.trade_stats) {
    const p = r.portfolio, ts = r.trade_stats
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 1 }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em' }}>
            BACKTEST · {(r.symbols || []).length} SYMBOL{(r.symbols || []).length > 1 ? 'S' : ''} · {r.costs_bps}bps
          </Typography>
          <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>#{r.result_hash}</Typography>
        </Box>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1.5 }}>
          <Metric label="CAGR" value={`${p.cagr_pct}%`} c={p.cagr_pct >= 0 ? '#22c55e' : '#ef4444'} />
          <Metric label="Total" value={`${p.total_return_pct}%`} />
          <Metric label="Sharpe" value={p.sharpe} c={CYAN} />
          <Metric label="Max DD" value={`${p.max_drawdown_pct}%`} c="#ef4444" />
          <Metric label="Win Rate" value={`${ts.win_rate_pct}%`} />
          <Metric label="Trades" value={ts.num_trades} />
          <Metric label="Profit Factor" value={ts.profit_factor ?? '—'} />
          <Metric label="Expectancy" value={`${ts.expectancy_pct}%`} />
        </Box>
        <Sparkline data={r.equity_curve || []} />
        <Note text="In-sample results overstate live edge — validate out-of-sample (walk-forward, Phase 4)." />
      </Box>
    )
  }

  // event_study → per-horizon table
  if (r.horizons && r.occurrences !== undefined) {
    const hs = Object.entries(r.horizons) as [string, any][]
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 1.5, py: 0.8, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em' }}>
            EVENT STUDY · {r.direction?.toUpperCase()} · n={r.occurrences} {r.sufficient_sample ? '' : '· ⚠ SMALL SAMPLE'}
          </Typography>
        </Box>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {['HORIZON', 'N', 'HIT %', 'MEAN %', 'MEDIAN %', 'WORST %', 'BEST %'].map(h => (
              <th key={h} style={{ ...(TH as any), textAlign: h === 'HORIZON' ? 'left' : 'right', padding: '6px 10px' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {hs.map(([k, v]) => (
              <tr key={k} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ ...(TD as any), padding: '6px 10px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: INK }}>{k}</td>
                <td style={cell(TD, INK2)}>{v.n ?? 0}</td>
                <td style={cell(TD, (v.hit_rate_pct ?? 0) >= 50 ? '#22c55e' : '#ef4444')}>{v.hit_rate_pct ?? '—'}</td>
                <td style={cell(TD, (v.mean_pct ?? 0) >= 0 ? '#22c55e' : '#ef4444')}>{v.mean_pct ?? '—'}</td>
                <td style={cell(TD, INK2)}>{v.median_pct ?? '—'}</td>
                <td style={cell(TD, '#ef4444')}>{v.worst_pct ?? '—'}</td>
                <td style={cell(TD, INK2)}>{v.best_pct ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    )
  }

  // ranking → table
  if (Array.isArray(r.ranked)) {
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, overflow: 'hidden' }}>
        <Box sx={{ px: 1.5, py: 0.8, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em' }}>
            RANKING · {String(r.factor).toUpperCase()} · {r.universe?.toUpperCase()}
          </Typography>
        </Box>
        <Box sx={{ maxHeight: 320, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['#', 'SYMBOL', 'SCORE', 'MOM 12-1', 'VOL', 'RET 6M', 'MAX DD'].map((h, i) => (
                <th key={h} style={{ ...(TH as any), textAlign: i < 2 ? 'left' : 'right', padding: '6px 10px' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {r.ranked.map((row: any) => (
                <tr key={row.rank} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={cell(TD, INK3, 'left')}>{row.rank}</td>
                  <td style={{ ...(TD as any), padding: '6px 10px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: INK }}>{row.symbol}</td>
                  <td style={cell(TD, CYAN)}>{row.score}</td>
                  <td style={cell(TD, INK2)}>{row.momentum_12_1_pct}%</td>
                  <td style={cell(TD, INK2)}>{row.volatility_pct}%</td>
                  <td style={cell(TD, INK2)}>{row.ret_6m_pct}%</td>
                  <td style={cell(TD, '#ef4444')}>{row.max_dd_pct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
      </Box>
    )
  }

  // optimize → best cards + grid table
  if (r.grid_results && r.best_params) {
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em', mb: 1 }}>
          OPTIMIZE · {String(r.objective).toUpperCase()} · {r.combos_tested} COMBOS{r.truncated ? ' (capped)' : ''}
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
          <Metric label="Best Params" value={Object.entries(r.best_params).map(([k, v]) => `${k}=${v}`).join(' ')} c={CYAN} />
          <Metric label="Sharpe" value={r.best.sharpe} />
          <Metric label="CAGR" value={`${r.best.cagr_pct}%`} c={r.best.cagr_pct >= 0 ? '#22c55e' : '#ef4444'} />
          <Metric label="Max DD" value={`${r.best.max_drawdown_pct}%`} c="#ef4444" />
        </Box>
        <Box sx={{ maxHeight: 240, overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              {['PARAMS', 'SHARPE', 'CAGR %', 'MAX DD %', 'TRADES'].map((h, i) => (
                <th key={h} style={{ ...(TH as any), textAlign: i === 0 ? 'left' : 'right', padding: '5px 9px' }}>{h}</th>
              ))}
            </tr></thead>
            <tbody>
              {r.grid_results.map((g: any, i: number) => (
                <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                  <td style={{ ...(TD as any), padding: '5px 9px', fontFamily: "'IBM Plex Mono',monospace", color: INK }}>{Object.entries(g.params).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                  <td style={cell(TD, CYAN)}>{g.sharpe}</td>
                  <td style={cell(TD, g.cagr_pct >= 0 ? '#22c55e' : '#ef4444')}>{g.cagr_pct}</td>
                  <td style={cell(TD, '#ef4444')}>{g.max_drawdown_pct}</td>
                  <td style={cell(TD, INK2)}>{g.num_trades}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Box>
        <Note text={r.note} />
      </Box>
    )
  }

  // walk_forward → aggregate + folds table
  if (r.folds && r.aggregate) {
    const a = r.aggregate
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em', mb: 1 }}>
          WALK-FORWARD · {a.total_folds} FOLDS · {a.oos_positive_folds} POSITIVE OOS
        </Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
          <Metric label="Mean OOS Sharpe" value={a.mean_oos_sharpe} c={a.mean_oos_sharpe >= 0 ? '#22c55e' : '#ef4444'} />
          <Metric label="Mean OOS CAGR" value={`${a.mean_oos_cagr_pct}%`} />
          <Metric label="Mean IS Sharpe" value={a.mean_is_sharpe} />
          <Metric label="Degradation" value={a.degradation} c="#fbbf24" />
        </Box>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            {['TEST', 'PARAMS', 'IS SH', 'OOS SH', 'OOS CAGR%', 'OOS DD%'].map((h, i) => (
              <th key={h} style={{ ...(TH as any), textAlign: i < 2 ? 'left' : 'right', padding: '5px 9px' }}>{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {r.folds.map((fo: any, i: number) => (
              <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                <td style={{ ...(TD as any), padding: '5px 9px', fontFamily: "'IBM Plex Mono',monospace", color: INK2 }}>{fo.test}</td>
                <td style={{ ...(TD as any), padding: '5px 9px', fontFamily: "'IBM Plex Mono',monospace", color: INK }}>{Object.entries(fo.params).map(([k, v]) => `${k}=${v}`).join(' ')}</td>
                <td style={cell(TD, INK3)}>{fo.is_sharpe}</td>
                <td style={cell(TD, fo.oos_sharpe >= 0 ? '#22c55e' : '#ef4444')}>{fo.oos_sharpe}</td>
                <td style={cell(TD, fo.oos_cagr_pct >= 0 ? '#22c55e' : '#ef4444')}>{fo.oos_cagr_pct}</td>
                <td style={cell(TD, '#ef4444')}>{fo.oos_max_dd_pct}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <Note text={r.note} />
      </Box>
    )
  }

  // monte_carlo → percentile cards
  if (r.total_return_pct && r.prob_loss_pct !== undefined) {
    const tr = r.total_return_pct, dd = r.max_drawdown_pct
    return (
      <Box sx={{ mt: 2, border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.5 }}>
        <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, color: INK3, letterSpacing: '0.08em', mb: 1 }}>
          MONTE CARLO · {r.n_sims} SIMS · {r.method} · {r.trades_per_sim} trades/sim
        </Typography>
        <Typography sx={{ fontSize: '0.62rem', color: INK3, mb: 0.5 }}>TOTAL RETURN DISTRIBUTION</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2, mb: 1 }}>
          <Metric label="p5" value={`${tr.p5}%`} c="#ef4444" />
          <Metric label="p25" value={`${tr.p25}%`} />
          <Metric label="Median" value={`${tr.p50}%`} c={CYAN} />
          <Metric label="p75" value={`${tr.p75}%`} />
          <Metric label="p95" value={`${tr.p95}%`} c="#22c55e" />
          <Metric label="Prob Loss" value={`${r.prob_loss_pct}%`} c="#fbbf24" />
        </Box>
        <Typography sx={{ fontSize: '0.62rem', color: INK3, mb: 0.5 }}>MAX DRAWDOWN</Typography>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
          <Metric label="Median DD" value={`${dd.p50}%`} c="#ef4444" />
          <Metric label="p95 DD" value={`${dd.p95}%`} c="#ef4444" />
          <Metric label="Worst DD" value={`${dd.worst}%`} c="#ef4444" />
        </Box>
        <Note text={r.note} />
      </Box>
    )
  }

  return null // indicators/stats are already summarized in the prose answer
}

function DataFrameTable({ columns, rows, shape }: { columns: string[]; rows: any[]; shape?: number[] }) {
  const { INK, INK2, INK3, BORDER, PAPER2 } = usePalette()
  const { TH, TD } = useTokens()
  if (!rows || rows.length === 0) return <Note text="Empty result." />
  return (
    <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 1.5, overflow: 'hidden' }}>
      {shape && (
        <Box sx={{ px: 1.2, py: 0.5, bgcolor: PAPER2 }}>
          <Typography sx={{ fontSize: '0.6rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>
            DataFrame {shape[0]}×{shape[1]}{rows.length < shape[0] ? ` · first ${rows.length}` : ''}
          </Typography>
        </Box>
      )}
      <Box sx={{ maxHeight: 300, overflow: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>{columns.map(c => (
            <th key={c} style={{ ...(TH as any), textAlign: 'right', padding: '5px 9px' }}>{c}</th>
          ))}</tr></thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i} style={{ borderTop: `1px solid ${BORDER}` }}>
                {columns.map(c => (
                  <td key={c} style={{ ...(TD as any), padding: '5px 9px', textAlign: 'right',
                    fontFamily: "'IBM Plex Mono',monospace", color: INK2 }}>{fmt(row[c])}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Box>
    </Box>
  )
}

function cell(TD: any, color: string, align: 'left' | 'right' = 'right') {
  return { ...(TD as any), padding: '6px 10px', textAlign: align, color, fontFamily: "'IBM Plex Mono',monospace" }
}

function Sparkline({ data }: { data: number[] }) {
  const { CYAN, BORDER } = usePalette()
  if (!data || data.length < 2) return null
  const w = 100, h = 28
  const min = Math.min(...data), max = Math.max(...data)
  const rng = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - ((v - min) / rng) * h}`).join(' ')
  const up = data[data.length - 1] >= data[0]
  return (
    <Box sx={{ mt: 0.5 }}>
      <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 40, border: `1px solid ${BORDER}`, borderRadius: 4 }}>
        <polyline points={pts} fill="none" stroke={up ? '#22c55e' : '#ef4444'} strokeWidth={0.8} vectorEffect="non-scaling-stroke" />
      </svg>
      <Typography sx={{ fontSize: '0.58rem', color: CYAN, mt: 0.3, fontFamily: "'IBM Plex Mono',monospace" }}>EQUITY CURVE (portfolio, equal-weight)</Typography>
    </Box>
  )
}

function Metric({ label, value, c }: { label: string; value: any; c?: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box>
      <Typography sx={{ fontSize: '0.6rem', color: INK3, fontWeight: 700, letterSpacing: '0.06em' }}>{label.toUpperCase()}</Typography>
      <Typography sx={{ fontSize: '0.95rem', fontWeight: 800, color: c || INK, fontFamily: "'IBM Plex Mono',monospace" }}>{value}</Typography>
    </Box>
  )
}

function Note({ text }: { text: string }) {
  const { INK3, BORDER } = usePalette()
  return <Typography sx={{ mt: 1.5, fontSize: '0.78rem', color: INK3, borderLeft: `2px solid ${BORDER}`, pl: 1.5 }}>{text}</Typography>
}

// ── Manifest panel ────────────────────────────────────────────────────────────
function ManifestPanel({ steps, dataVersion, methodology }:
  { steps: ManifestStep[]; dataVersion: string; methodology: string }) {
  const { INK2, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  const [open, setOpen] = useState(false)
  if (!steps || steps.length === 0) return null
  return (
    <Box sx={{ mt: 2, borderTop: `1px dashed ${BORDER}`, pt: 1.5 }}>
      <Box onClick={() => setOpen(o => !o)} sx={{ display: 'flex', alignItems: 'center', gap: 0.8, cursor: 'pointer' }}>
        <Typography sx={{ fontSize: '0.66rem', fontWeight: 800, color: CYAN, letterSpacing: '0.08em' }}>
          {open ? '▾' : '▸'} HOW THIS WAS COMPUTED · {steps.length} STEP{steps.length > 1 ? 'S' : ''}
        </Typography>
        <Typography sx={{ fontSize: '0.6rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>
          {methodology} · data {dataVersion.slice(0, 8)}
        </Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ mt: 1, bgcolor: PAPER2, borderRadius: 1.5, p: 1.2 }}>
          {steps.map((s, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.4, alignItems: 'baseline' }}>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace", minWidth: 18 }}>{i + 1}.</Typography>
              <Typography sx={{ fontSize: '0.68rem', color: CYAN, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", minWidth: 130 }}>{s.tool}</Typography>
              <Typography sx={{ fontSize: '0.66rem', color: INK2, fontFamily: "'IBM Plex Mono',monospace", flex: 1, wordBreak: 'break-all' }}>
                {JSON.stringify(s.input)}
              </Typography>
              <Typography sx={{ fontSize: '0.6rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace" }}>{s.ms}ms · #{s.result_hash.slice(0, 6)}</Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

function fmt(v: any): string {
  if (v === null || v === undefined) return '—'
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : v.toFixed(2)
  return String(v)
}
