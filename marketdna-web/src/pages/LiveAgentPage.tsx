import { useState, useEffect, useRef } from 'react'
import type { CSSProperties } from 'react'
import {
  Box, Typography, Select, MenuItem, TextField, IconButton, CircularProgress, Collapse, Chip,
} from '@mui/material'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { liveAgentApi } from '../api/liveAgentApi'
import type { LiveScan, LiveChatResponse } from '../api/liveAgentApi'

const GREEN = '#22c55e', RED = '#ef4444', AMBER = '#fbbf24'

const SEV_COLOR: Record<string, string> = { high: RED, medium: AMBER, info: '#60a5fa', low: '#94a3b8' }

export default function LiveAgentPage() {
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BORDER, BG, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()
  const [universe, setUniverse] = useState('nifty50')
  const [scan, setScan] = useState<LiveScan | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [turns, setTurns] = useState<{ question: string; loading: boolean; response?: LiveChatResponse; error?: string }[]>([])
  const endRef = useRef<HTMLDivElement>(null)

  async function refresh(u = universe) {
    setLoading(true); setErr('')
    try { setScan(await liveAgentApi.scan(u)) }
    catch (e: any) { setErr(String(e?.message || e)) }
    finally { setLoading(false) }
  }
  useEffect(() => { refresh(universe) /* eslint-disable-next-line */ }, [universe])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [turns])

  // Auto-poll every 30s while the data source is live (market hours).
  useEffect(() => {
    if (scan?.state?.source !== 'live') return
    const id = setInterval(() => refresh(universe), 30000)
    return () => clearInterval(id)
    /* eslint-disable-next-line */
  }, [scan?.state?.source, universe])

  async function ask(question: string) {
    const text = question.trim(); if (!text) return
    setQ(''); const idx = turns.length
    setTurns(t => [...t, { question: text, loading: true }])
    try {
      const response = await liveAgentApi.chat(text, universe)
      setTurns(t => t.map((x, i) => i === idx ? { ...x, loading: false, response } : x))
    } catch (e: any) {
      setTurns(t => t.map((x, i) => i === idx ? { ...x, loading: false, error: String(e?.message || e) } : x))
    }
  }

  const st = scan?.state, changes = scan?.changes?.changes || [], board = scan?.board?.board || []
  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar />
      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 6 }, pt: 5, pb: 4 }}>
        <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Box sx={{ width: 7, height: 7, borderRadius: '50%', bgcolor: GREEN, boxShadow: `0 0 0 4px ${GREEN}22`, animation: 'pulse 2s infinite' }} />
          <Typography sx={{ fontSize: '0.68rem', fontWeight: 800, letterSpacing: '0.14em', textTransform: 'uppercase', color: CYAN, fontFamily: "'IBM Plex Mono', monospace" }}>
            Live Agent · Read-only · EOD
          </Typography>
        </Box>
        <Typography sx={{ fontSize: { xs: '1.9rem', md: '2.6rem' }, fontWeight: 800, color: INK, lineHeight: 1.05, fontFamily: "'Plus Jakarta Sans','IBM Plex Sans',sans-serif" }}>
          Market <span style={{ color: CYAN }}>Observer</span>
        </Typography>
        <Typography sx={{ fontSize: '0.9rem', color: INK2, mt: 1.5, maxWidth: 760, lineHeight: 1.6 }}>
          A read-only desk analyst answering "what is changing that matters?" Detectors are deterministic;
          the agent narrates and forms hypotheses only after validating them against history. It never places orders.
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mt: 2.5 }}>
          <Typography sx={{ fontSize: '0.72rem', color: INK3, fontWeight: 700 }}>UNIVERSE</Typography>
          <Select size="small" value={universe} onChange={e => setUniverse(e.target.value)}
            sx={{ ...INPUT_SX, minWidth: 130, fontSize: '0.8rem', '& .MuiSelect-select': { py: 0.6 } }}
            MenuProps={{ PaperProps: { sx: { bgcolor: PAPER2, color: INK } } }}>
            <MenuItem value="nifty50">NIFTY 50</MenuItem>
            <MenuItem value="nse500">NSE 500</MenuItem>
          </Select>
          <Chip label={loading ? 'Loading…' : 'Refresh'} onClick={() => refresh()} clickable
            sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, fontSize: '0.72rem', '&:hover': { borderColor: CYAN } }} />
        </Box>
      </Box>

      <Box sx={{ px: { xs: 2, md: 6 }, py: 3, maxWidth: 1150, mx: 'auto' }}>
        {err && <Box sx={{ ...CARD, p: 2, mb: 2 }}><Typography sx={{ color: RED, fontSize: '0.85rem' }}>{err}</Typography></Box>}

        {/* State strip */}
        {st && !st.error && (
          <Box sx={{ ...CARD, p: 2, mb: 2.5 }}>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, alignItems: 'center' }}>
              <Stat label="Regime" value={st.regime} c={regimeColor(st.breadth)} />
              <Box>
                <Typography sx={{ fontSize: '0.6rem', color: INK3, fontWeight: 700 }}>BREADTH</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: regimeColor(st.breadth), fontFamily: "'IBM Plex Mono',monospace" }}>{st.breadth}</Typography>
                  <Box sx={{ width: 90, height: 6, bgcolor: PAPER2, borderRadius: 3, overflow: 'hidden' }}>
                    <Box sx={{ width: `${st.breadth}%`, height: '100%', bgcolor: regimeColor(st.breadth) }} />
                  </Box>
                </Box>
              </Box>
              <Stat label="Adv / Dec" value={`${st.advancers} / ${st.decliners}`} c={st.advancers >= st.decliners ? GREEN : RED} />
              <Stat label="New 52w Highs" value={st.new_high_count} c={CYAN} />
              <Stat label="Breakouts" value={st.breakout_count} c={CYAN} />
              <Box>
                <Typography sx={{ fontSize: '0.6rem', color: INK3, fontWeight: 700, letterSpacing: '0.06em' }}>SOURCE · AS OF</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.8 }}>
                  <Box sx={{ px: 0.8, py: 0.1, borderRadius: 1, bgcolor: st.source === 'live' ? GREEN + '22' : PAPER2, border: `1px solid ${st.source === 'live' ? GREEN : BORDER}` }}>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: st.source === 'live' ? GREEN : INK3, fontFamily: "'IBM Plex Mono',monospace" }}>{st.source === 'live' ? 'LIVE' : 'EOD'}</Typography>
                  </Box>
                  <Typography sx={{ fontSize: '0.8rem', color: INK2, fontFamily: "'IBM Plex Mono',monospace" }}>{st.as_of}</Typography>
                </Box>
              </Box>
            </Box>
          </Box>
        )}

        {/* Sector rotation strip */}
        {st && Array.isArray(st.sectors) && st.sectors.length > 0 && (
          <Box sx={{ ...CARD, p: 0, mb: 2.5, overflow: 'hidden' }}>
            <SectionHead title="Sector Rotation" accent="#8b5cf6" />
            <Box sx={{ p: 1.5, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
              {st.sectors.map((s: any) => (
                <Box key={s.sector} sx={{ display: 'flex', alignItems: 'center', gap: 0.8, px: 1, py: 0.5, borderRadius: 1.5, border: `1px solid ${BORDER}`, bgcolor: PAPER2 }}>
                  <Box sx={{ width: 8, height: 8, borderRadius: '50%', bgcolor: s.color || INK3 }} />
                  <Typography sx={{ fontSize: '0.72rem', color: INK2, fontWeight: 600 }}>{s.sector}</Typography>
                  <Typography sx={{ fontSize: '0.72rem', fontWeight: 800, color: s.avg_ret_20d >= 0 ? GREEN : RED, fontFamily: "'IBM Plex Mono',monospace" }}>{s.avg_ret_20d >= 0 ? '+' : ''}{s.avg_ret_20d}%</Typography>
                </Box>
              ))}
            </Box>
          </Box>
        )}

        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2.5 }}>
          {/* Opportunity board */}
          <Box sx={{ ...CARD, p: 0, overflow: 'hidden' }}>
            <SectionHead title="Opportunity Board" accent="#6366f1" />
            <Box sx={{ maxHeight: 420, overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr>
                  {['SYMBOL', 'SCORE', 'TREND', 'RS', 'VOL EXP', 'RET 20D'].map((h, i) => (
                    <th key={h} style={{ position: 'sticky', top: 0, background: PAPER2, textAlign: i === 0 ? 'left' : 'right', padding: '7px 10px', fontSize: '0.6rem', fontWeight: 800, color: INK3, letterSpacing: '0.06em' }}>{h}</th>
                  ))}
                </tr></thead>
                <tbody>
                  {board.map((r: any) => (
                    <tr key={r.symbol} style={{ borderTop: `1px solid ${BORDER}` }}>
                      <td style={{ padding: '7px 10px', fontFamily: "'IBM Plex Mono',monospace", fontWeight: 700, color: INK, fontSize: '0.78rem' }}>
                        {r.symbol}{r.breakout && <span style={{ color: CYAN, fontSize: '0.6rem', marginLeft: 4 }}>▲BO</span>}
                      </td>
                      <td style={num(CYAN)}>{r.score}</td>
                      <td style={num(INK2)}>{r.trend}</td>
                      <td style={num(INK2)}>{r.rel_strength}</td>
                      <td style={num(INK2)}>{r.volume_expansion}</td>
                      <td style={num(r.ret_20d >= 0 ? GREEN : RED)}>{r.ret_20d}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Box>
          </Box>

          {/* Change feed */}
          <Box sx={{ ...CARD, p: 0, overflow: 'hidden' }}>
            <SectionHead title="What Changed" accent="#f59e0b" />
            <Box sx={{ p: 1.5, maxHeight: 420, overflow: 'auto' }}>
              {changes.length === 0 && (
                <Typography sx={{ fontSize: '0.78rem', color: INK3 }}>No state changes since the last snapshot. The market observer alerts only on regime flips, breadth shifts, new leadership, and new-high surges — not every tick.</Typography>
              )}
              {changes.map((e: any, i: number) => (
                <Box key={i} sx={{ display: 'flex', gap: 1.2, mb: 1.2, alignItems: 'flex-start' }}>
                  <Box sx={{ mt: 0.6, width: 8, height: 8, borderRadius: '50%', bgcolor: SEV_COLOR[e.severity] || INK3, flexShrink: 0 }} />
                  <Box>
                    <Typography sx={{ fontSize: '0.6rem', fontWeight: 800, color: SEV_COLOR[e.severity] || INK3, letterSpacing: '0.06em', textTransform: 'uppercase' }}>{e.type?.replace(/_/g, ' ')}</Typography>
                    <Typography sx={{ fontSize: '0.8rem', color: INK, lineHeight: 1.45 }}>{e.text}</Typography>
                  </Box>
                </Box>
              ))}
            </Box>
          </Box>
        </Box>

        {/* Agent chat */}
        <Box sx={{ ...CARD, p: 2, mt: 2.5 }}>
          <SectionHead title="Ask the Live Agent" accent="#14b8a6" />
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, mb: 2 }}>
            {['What changed that matters today?', 'Which sectors are leading, and does history favor them?', 'Why is the top board name moving?'].map(p => (
              <Chip key={p} label={p} onClick={() => ask(p)} clickable sx={{ bgcolor: PAPER2, color: INK2, border: `1px solid ${BORDER}`, fontSize: '0.72rem', '&:hover': { borderColor: CYAN } }} />
            ))}
          </Box>
          {turns.map((t, i) => (
            <Box key={i} sx={{ mb: 2 }}>
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <Box sx={{ bgcolor: CYAN + '18', border: `1px solid ${CYAN}55`, borderRadius: 2.5, px: 1.6, py: 0.8, maxWidth: '80%' }}>
                  <Typography sx={{ fontSize: '0.82rem', color: INK, fontWeight: 600 }}>{t.question}</Typography>
                </Box>
              </Box>
              <Box sx={{ border: `1px solid ${BORDER}`, borderRadius: 2, p: 1.6 }}>
                {t.loading && <Box sx={{ display: 'flex', gap: 1.2, alignItems: 'center' }}><CircularProgress size={15} sx={{ color: CYAN }} /><Typography sx={{ fontSize: '0.78rem', color: INK3 }}>Observing…</Typography></Box>}
                {t.error && <Typography sx={{ fontSize: '0.8rem', color: RED }}>{t.error}</Typography>}
                {t.response && <>
                  <Typography sx={{ fontSize: '0.86rem', color: INK, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{t.response.answer}</Typography>
                  <ManifestPanel steps={t.response.manifest.steps} />
                </>}
              </Box>
            </Box>
          ))}
          <div ref={endRef} />
          <Box sx={{ display: 'flex', gap: 1.2, mt: 1 }}>
            <TextField fullWidth size="small" placeholder="Ask what's changing…" value={q}
              onChange={e => setQ(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); ask(q) } }}
              sx={{ ...INPUT_SX, '& .MuiInputBase-input': { fontSize: '0.84rem' } }} />
            <IconButton onClick={() => ask(q)} disabled={!q.trim()}
              sx={{ bgcolor: CYAN, color: '#001018', px: 2, borderRadius: 2, '&:hover': { bgcolor: CYAN }, '&.Mui-disabled': { bgcolor: BORDER, color: INK3 } }}>
              <span style={{ fontSize: '0.78rem', fontWeight: 800, padding: '0 4px' }}>ASK</span>
            </IconButton>
          </Box>
        </Box>
      </Box>
      <Footer />
    </Box>
  )

  function num(color: string): CSSProperties {
    return { padding: '7px 10px', textAlign: 'right', color, fontFamily: "'IBM Plex Mono',monospace", fontSize: '0.76rem' }
  }
}

function Stat({ label, value, c, mono }: { label: string; value: any; c?: string; mono?: boolean }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box>
      <Typography sx={{ fontSize: '0.6rem', color: INK3, fontWeight: 700, letterSpacing: '0.06em' }}>{label.toUpperCase()}</Typography>
      <Typography sx={{ fontSize: '1.1rem', fontWeight: 800, color: c || INK, fontFamily: mono ? "'IBM Plex Mono',monospace" : "'IBM Plex Sans',sans-serif" }}>{value}</Typography>
    </Box>
  )
}

function SectionHead({ title, accent }: { title: string; accent: string }) {
  const { INK, BORDER, PAPER2 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.2, px: 1.5, py: 1, bgcolor: PAPER2, borderBottom: `1px solid ${BORDER}` }}>
      <Box sx={{ width: 3, height: 16, borderRadius: 2, bgcolor: accent }} />
      <Typography sx={{ fontSize: '0.74rem', fontWeight: 800, color: INK, fontFamily: "'IBM Plex Sans',sans-serif" }}>{title}</Typography>
    </Box>
  )
}

function ManifestPanel({ steps }: { steps: any[] }) {
  const { INK2, INK3, CYAN, BORDER, PAPER2 } = usePalette()
  const [open, setOpen] = useState(false)
  if (!steps || steps.length === 0) return null
  return (
    <Box sx={{ mt: 1.5, borderTop: `1px dashed ${BORDER}`, pt: 1 }}>
      <Box onClick={() => setOpen(o => !o)} sx={{ cursor: 'pointer' }}>
        <Typography sx={{ fontSize: '0.64rem', fontWeight: 800, color: CYAN, letterSpacing: '0.06em' }}>
          {open ? '▾' : '▸'} HOW THIS WAS OBSERVED · {steps.length} STEP{steps.length > 1 ? 'S' : ''}
        </Typography>
      </Box>
      <Collapse in={open}>
        <Box sx={{ mt: 1, bgcolor: PAPER2, borderRadius: 1.5, p: 1 }}>
          {steps.map((s, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 1, py: 0.3 }}>
              <Typography sx={{ fontSize: '0.62rem', color: INK3, fontFamily: "'IBM Plex Mono',monospace", minWidth: 16 }}>{i + 1}.</Typography>
              <Typography sx={{ fontSize: '0.66rem', color: CYAN, fontWeight: 700, fontFamily: "'IBM Plex Mono',monospace", minWidth: 120 }}>{s.tool}</Typography>
              <Typography sx={{ fontSize: '0.64rem', color: INK2, fontFamily: "'IBM Plex Mono',monospace", flex: 1, wordBreak: 'break-all' }}>{JSON.stringify(s.input)}</Typography>
            </Box>
          ))}
        </Box>
      </Collapse>
    </Box>
  )
}

function regimeColor(breadth: number): string {
  if (breadth >= 55) return GREEN
  if (breadth >= 40) return AMBER
  return RED
}
