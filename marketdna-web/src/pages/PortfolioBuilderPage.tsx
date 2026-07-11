import { useState, useEffect, useRef, useMemo } from 'react'
import { useNavigate, useParams, Link } from 'react-router-dom'
import {
  Box, Typography, TextField, Select, MenuItem, CircularProgress, Button, Chip, Tooltip,
} from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import SectionHead from '../components/shared/SectionHead'
import { portfoliosApi } from '../api/portfoliosApi'
import type {
  FieldInfo, PortfolioSpec, Universe, WeightScheme, EvictionWeight, RebalanceFreq,
} from '../types/portfolios'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO    = { fontFamily: "'IBM Plex Mono', monospace" } as const

const WEIGHT_SCHEMES: { value: WeightScheme; label: string }[] = [
  { value: 'equal', label: 'Equal weight' },
  { value: 'score', label: 'By score (rank metric)' },
  { value: 'inverse_vol', label: 'Inverse volatility (1 / ATR%)' },
  { value: 'by_field', label: 'By a field' },
]
const FREQS: { value: RebalanceFreq; label: string }[] = [
  { value: 'W', label: 'Weekly' }, { value: 'M', label: 'Monthly' }, { value: 'Q', label: 'Quarterly' },
]
const EVICT_WEIGHTS: { value: EvictionWeight; label: string }[] = [
  { value: 'redistribute', label: 'Redistribute to survivors' },
  { value: 'hold_cash', label: 'Hold as cash until rebalance' },
]

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40)
}

export default function PortfolioBuilderPage() {
  const { key: editKey } = useParams<{ key: string }>()
  const isEdit = Boolean(editKey)
  const navigate = useNavigate()
  const { mode } = useThemeMode()
  const { INK, INK2, INK3, CYAN, BG, BORDER, PAPER, PAPER2 } = usePalette()
  const { CARD, INPUT_SX } = useTokens()

  const [fields, setFields] = useState<FieldInfo[]>([])
  const [loading, setLoading] = useState(isEdit)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // form state
  const [name, setName] = useState('')
  const [keyName, setKeyName] = useState('')
  const [keyTouched, setKeyTouched] = useState(false)
  const [description, setDescription] = useState('')
  const [universe, setUniverse] = useState<Universe>('nifty500')
  const [maxHoldings, setMaxHoldings] = useState(20)
  const [volatility, setVolatility] = useState(3)
  const [entry, setEntry] = useState('')
  const [rankBy, setRankBy] = useState('mom_score')
  const [weightScheme, setWeightScheme] = useState<WeightScheme>('equal')
  const [weightField, setWeightField] = useState('')
  const [fill, setFill] = useState('')
  const [fillRankBy, setFillRankBy] = useState('')
  const [eviction, setEviction] = useState('')
  const [evictionWeight, setEvictionWeight] = useState<EvictionWeight>('redistribute')
  const [rebalanceFreq, setRebalanceFreq] = useState<RebalanceFreq>('M')
  const [rebalance, setRebalance] = useState('')
  const [rebWeightScheme, setRebWeightScheme] = useState<WeightScheme>('equal')
  const [rebWeightField, setRebWeightField] = useState('')

  // catalog insertion — which rule input is focused + its DOM ref
  const activeRef = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null)
  const activeSetter = useRef<((v: string) => void) | null>(null)

  useEffect(() => {
    portfoliosApi.getFields().then(r => setFields(r.fields)).catch(() => {})
  }, [])

  useEffect(() => {
    if (!isEdit || !editKey) return
    portfoliosApi.getCustomSpec(editKey)
      .then(s => {
        setName(s.name); setKeyName(s.key); setKeyTouched(true)
        setDescription(s.description ?? ''); setUniverse((s.universe as Universe) ?? 'nifty500')
        setMaxHoldings(s.max_holdings ?? 20); setVolatility(s.volatility_stars ?? 3)
        setEntry(s.entry); setRankBy(s.rank_by ?? 'mom_score')
        setWeightScheme(s.weight?.scheme ?? 'equal'); setWeightField(s.weight?.field ?? '')
        setFill(s.fill ?? ''); setFillRankBy(s.fill_rank_by ?? '')
        setEviction(s.eviction ?? ''); setEvictionWeight(s.eviction_weight ?? 'redistribute')
        setRebalanceFreq(s.rebalance_freq ?? 'M'); setRebalance(s.rebalance ?? '')
        setRebWeightScheme(s.rebalance_weight?.scheme ?? 'equal'); setRebWeightField(s.rebalance_weight?.field ?? '')
      })
      .catch(e => setError(String(e.message ?? e)))
      .finally(() => setLoading(false))
  }, [isEdit, editKey])

  // keep key synced to name until the user edits key manually (create mode only)
  useEffect(() => {
    if (!isEdit && !keyTouched) setKeyName(slug(name))
  }, [name, keyTouched, isEdit])

  const grouped = useMemo(() => {
    const g: Record<string, FieldInfo[]> = {}
    for (const f of fields) (g[f.group ?? 'other'] ??= []).push(f)
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]))
  }, [fields])

  function insertToken(tok: string) {
    const el = activeRef.current, set = activeSetter.current
    if (!el || !set) { setError('Click into a rule box first, then pick a field.'); return }
    const start = el.selectionStart ?? el.value.length
    const end = el.selectionEnd ?? el.value.length
    const pad = start > 0 && el.value[start - 1] !== ' ' ? ' ' : ''
    const next = el.value.slice(0, start) + pad + tok + ' ' + el.value.slice(end)
    set(next)
    requestAnimationFrame(() => {
      el.focus()
      const pos = start + pad.length + tok.length + 1
      el.setSelectionRange(pos, pos)
    })
  }

  function bindRule(setter: (v: string) => void) {
    return {
      onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
        activeRef.current = e.target; activeSetter.current = setter
      },
    }
  }

  async function submit() {
    setError(null)
    if (slug(keyName).length < 3) { setError('Key must be at least 3 characters (a-z, 0-9, _).'); return }
    if (!name.trim()) { setError('Name is required.'); return }
    if (!entry.trim()) { setError('An entry rule is required.'); return }
    const spec: PortfolioSpec = {
      key: slug(keyName), name: name.trim(), description: description.trim(), universe,
      max_holdings: maxHoldings, volatility_stars: volatility,
      entry: entry.trim(), rank_by: rankBy.trim() || 'mom_score',
      weight: { scheme: weightScheme, field: weightScheme === 'by_field' ? weightField.trim() : null },
      fill: fill.trim() || null, fill_rank_by: fillRankBy.trim() || null,
      eviction: eviction.trim() || null, eviction_weight: evictionWeight,
      rebalance_freq: rebalanceFreq, rebalance: rebalance.trim() || null,
      rebalance_weight: { scheme: rebWeightScheme, field: rebWeightScheme === 'by_field' ? rebWeightField.trim() : null },
    }
    setSubmitting(true)
    try {
      if (isEdit && editKey) await portfoliosApi.updateCustom(editKey, spec)
      else await portfoliosApi.createCustom(spec)
      navigate(`/portfolios/${spec.key}?universe=${universe}`)
    } catch (e: any) {
      setError(String(e.message ?? e))
    } finally {
      setSubmitting(false)
    }
  }

  const heroBg = mode === 'dark'
    ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
    : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`

  const menuProps = { PaperProps: { sx: { bgcolor: PAPER2, backgroundImage: 'none' } } }
  const label = (t: string) => (
    <Typography sx={{ ...MONO, fontSize: '0.62rem', letterSpacing: '0.1em', color: INK3, mb: 0.6 }}>{t}</Typography>
  )

  if (loading) {
    return (
      <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
        <Navbar sections={[]} />
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 10 }}><CircularProgress size={26} sx={{ color: CYAN }} /></Box>
      </Box>
    )
  }

  return (
    <Box sx={{ bgcolor: BG, minHeight: '100vh' }}>
      <Navbar sections={[]} />

      <Box sx={{ background: heroBg, borderBottom: `1px solid ${BORDER}`, px: { xs: 2, md: 5 }, pt: 5, pb: 4 }}>
        <Box sx={{ maxWidth: 1180, mx: 'auto' }}>
          <Link to="/portfolios" style={{ textDecoration: 'none' }}>
            <Typography sx={{ ...MONO, fontSize: '0.65rem', color: CYAN, mb: 1.5 }}>← ALL PORTFOLIOS</Typography>
          </Link>
          <Typography sx={{ ...JAKARTA, fontSize: { xs: '1.7rem', md: '2.2rem' }, fontWeight: 800, color: INK, lineHeight: 1.05 }}>
            {isEdit ? 'Edit' : 'Create'} <span style={{ color: CYAN }}>Portfolio</span>
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.88rem', color: INK2, maxWidth: 680, mt: 1.25 }}>
            Define the rules of formation and rebalancing. Everything else — the ₹100 growth curve from
            10 Jul 2026, performance, and rebalance log — works exactly like the built-in portfolios.
          </Typography>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 1180, mx: 'auto', px: { xs: 2, md: 5 }, py: 4,
                 display: 'grid', gridTemplateColumns: { xs: '1fr', lg: '1fr 340px' }, gap: 3, alignItems: 'start' }}>
        {/* ── left: the form ── */}
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3 }}>

          {/* identity */}
          <Box sx={{ ...CARD, p: 2.5, bgcolor: PAPER }}>
            <SectionHead title="Identity" accent="#6366f1" />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box>{label('NAME')}
                <TextField fullWidth size="small" value={name} onChange={e => setName(e.target.value)}
                  placeholder="Oversold Quality Dip" sx={INPUT_SX} /></Box>
              <Box>{label('KEY (URL ID)')}
                <TextField fullWidth size="small" value={keyName} disabled={isEdit}
                  onChange={e => { setKeyTouched(true); setKeyName(slug(e.target.value)) }}
                  placeholder="oversold_quality_dip" sx={INPUT_SX} /></Box>
              <Box sx={{ gridColumn: { sm: '1 / -1' } }}>{label('DESCRIPTION')}
                <TextField fullWidth size="small" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="What this basket captures and why." sx={INPUT_SX} /></Box>
              <Box>{label('UNIVERSE')}
                <Select fullWidth size="small" value={universe} onChange={e => setUniverse(e.target.value as Universe)}
                  MenuProps={menuProps} sx={INPUT_SX}>
                  <MenuItem value="nifty200">Nifty 200</MenuItem>
                  <MenuItem value="nifty500">Nifty 500</MenuItem>
                </Select></Box>
              <Box sx={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 2 }}>
                <Box>{label('MAX HOLDINGS')}
                  <TextField fullWidth size="small" type="number" value={maxHoldings}
                    onChange={e => setMaxHoldings(Math.max(1, Math.min(100, Number(e.target.value) || 1)))} sx={INPUT_SX} /></Box>
                <Box>{label('VOLATILITY ★')}
                  <TextField fullWidth size="small" type="number" value={volatility}
                    onChange={e => setVolatility(Math.max(1, Math.min(5, Number(e.target.value) || 1)))} sx={INPUT_SX} /></Box>
              </Box>
            </Box>
          </Box>

          {/* formation */}
          <Box sx={{ ...CARD, p: 2.5, bgcolor: PAPER }}>
            <SectionHead title="Formation" accent="#22c55e" meta="entry + weight" />
            {label('ENTRY RULE')}
            <TextField fullWidth multiline minRows={2} value={entry} onChange={e => setEntry(e.target.value)}
              {...bindRule(setEntry)} placeholder="rsi14 < 40 and above_sma200 and vol_surge > 1.2"
              sx={{ ...INPUT_SX, '& textarea': { ...MONO, fontSize: '0.8rem' } }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, mt: 0.6 }}>
              A condition over the fields on the right. Arithmetic (+ − × ÷) is allowed, e.g. <code>(close - sma50) / std20 &gt; 2</code>.
            </Typography>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2, mt: 2 }}>
              <Box>{label('RANK BY (score)')}
                <TextField fullWidth size="small" value={rankBy} onChange={e => setRankBy(e.target.value)}
                  {...bindRule(setRankBy)} placeholder="mom_score"
                  sx={{ ...INPUT_SX, '& input': { ...MONO, fontSize: '0.78rem' } }} /></Box>
              <Box>{label('WEIGHT')}
                <Select fullWidth size="small" value={weightScheme} onChange={e => setWeightScheme(e.target.value as WeightScheme)}
                  MenuProps={menuProps} sx={INPUT_SX}>
                  {WEIGHT_SCHEMES.map(w => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
                </Select></Box>
              {weightScheme === 'by_field' && (
                <Box>{label('WEIGHT FIELD')}
                  <TextField fullWidth size="small" value={weightField} onChange={e => setWeightField(e.target.value)}
                    {...bindRule(setWeightField)} placeholder="mom_score"
                    sx={{ ...INPUT_SX, '& input': { ...MONO, fontSize: '0.78rem' } }} /></Box>
              )}
            </Box>
            <Box sx={{ mt: 2 }}>
              {label('FILL RULE (optional — top-up pool when the entry rule yields fewer than max holdings)')}
              <TextField fullWidth multiline minRows={2} value={fill} onChange={e => setFill(e.target.value)}
                {...bindRule(setFill)} placeholder="ret_12m_rank <= 40"
                sx={{ ...INPUT_SX, '& textarea': { ...MONO, fontSize: '0.8rem' } }} />
              <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, mt: 0.6 }}>
                Core = entry names; if fewer than {maxHoldings}, top up from this pool (ordered by the fill rank, or by rank-by if blank). Leave blank for no fill.
              </Typography>
            </Box>
            <Box sx={{ mt: 1.5, maxWidth: 360 }}>{label('FILL RANK BY (optional)')}
              <TextField fullWidth size="small" value={fillRankBy} onChange={e => setFillRankBy(e.target.value)}
                {...bindRule(setFillRankBy)} placeholder="ret_12m  (defaults to rank-by)"
                sx={{ ...INPUT_SX, '& input': { ...MONO, fontSize: '0.78rem' } }} /></Box>
          </Box>

          {/* risk / eviction */}
          <Box sx={{ ...CARD, p: 2.5, bgcolor: PAPER }}>
            <SectionHead title="Eviction / Stop-loss" accent="#ef4444" meta="optional · between rebalances" />
            {label('EVICTION RULE')}
            <TextField fullWidth multiline minRows={2} value={eviction} onChange={e => setEviction(e.target.value)}
              {...bindRule(setEviction)} placeholder="since_entry_pct < -8 or close < sma50"
              sx={{ ...INPUT_SX, '& textarea': { ...MONO, fontSize: '0.8rem' } }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, mt: 0.6 }}>
              Evaluated on each EOD snapshot. May use the position fields <code>since_entry_pct</code> and <code>days_held</code>. Leave blank for none.
            </Typography>
            <Box sx={{ mt: 2, maxWidth: 360 }}>{label('WEIGHT AFTER EVICTION')}
              <Select fullWidth size="small" value={evictionWeight} onChange={e => setEvictionWeight(e.target.value as EvictionWeight)}
                MenuProps={menuProps} sx={INPUT_SX}>
                {EVICT_WEIGHTS.map(w => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
              </Select></Box>
          </Box>

          {/* rebalance */}
          <Box sx={{ ...CARD, p: 2.5, bgcolor: PAPER }}>
            <SectionHead title="Rebalance" accent="#f59e0b" meta="frequency + rules" />
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 2 }}>
              <Box>{label('FREQUENCY')}
                <Select fullWidth size="small" value={rebalanceFreq} onChange={e => setRebalanceFreq(e.target.value as RebalanceFreq)}
                  MenuProps={menuProps} sx={INPUT_SX}>
                  {FREQS.map(f => <MenuItem key={f.value} value={f.value}>{f.label}</MenuItem>)}
                </Select></Box>
              <Box>{label('WEIGHT AFTER REBALANCE')}
                <Select fullWidth size="small" value={rebWeightScheme} onChange={e => setRebWeightScheme(e.target.value as WeightScheme)}
                  MenuProps={menuProps} sx={INPUT_SX}>
                  {WEIGHT_SCHEMES.map(w => <MenuItem key={w.value} value={w.value}>{w.label}</MenuItem>)}
                </Select></Box>
              {rebWeightScheme === 'by_field' && (
                <Box>{label('REBALANCE WEIGHT FIELD')}
                  <TextField fullWidth size="small" value={rebWeightField} onChange={e => setRebWeightField(e.target.value)}
                    {...bindRule(setRebWeightField)} placeholder="mom_score"
                    sx={{ ...INPUT_SX, '& input': { ...MONO, fontSize: '0.78rem' } }} /></Box>
              )}
              <Box sx={{ gridColumn: { sm: '1 / -1' } }}>{label('REBALANCE RULE (optional — defaults to entry)')}
                <TextField fullWidth multiline minRows={2} value={rebalance} onChange={e => setRebalance(e.target.value)}
                  {...bindRule(setRebalance)} placeholder="Leave blank to re-run the entry rule"
                  sx={{ ...INPUT_SX, '& textarea': { ...MONO, fontSize: '0.8rem' } }} /></Box>
            </Box>
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, mt: 1 }}>
              At each rebalance the rule is re-run, candidates ranked by score, and the top {maxHoldings} kept.
            </Typography>
          </Box>

          {error && (
            <Box sx={{ ...CARD, p: 1.75, border: '1px solid #EF444455', bgcolor: mode === 'dark' ? '#EF444411' : '#FEF2F2' }}>
              <Typography sx={{ ...MONO, fontSize: '0.74rem', color: '#EF4444', lineHeight: 1.5 }}>{error}</Typography>
            </Box>
          )}

          <Box sx={{ display: 'flex', gap: 1.5 }}>
            <Button onClick={submit} disabled={submitting} variant="contained"
              sx={{ ...JAKARTA, fontWeight: 700, textTransform: 'none', bgcolor: CYAN, color: '#04121F',
                    '&:hover': { bgcolor: CYAN, filter: 'brightness(1.1)' } }}>
              {submitting ? 'Saving…' : isEdit ? 'Save changes' : 'Create portfolio'}
            </Button>
            <Button component={Link} to="/portfolios"
              sx={{ ...JAKARTA, fontWeight: 600, textTransform: 'none', color: INK3 }}>Cancel</Button>
          </Box>
        </Box>

        {/* ── right: field catalog ── */}
        <Box sx={{ ...CARD, p: 2, bgcolor: PAPER, position: { lg: 'sticky' }, top: { lg: 16 },
                   maxHeight: { lg: 'calc(100vh - 32px)' }, overflowY: 'auto' }}>
          <SectionHead title="Fields" accent="#8b5cf6" meta={`${fields.length}`} />
          <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, mb: 1.5 }}>
            Click a rule box, then a field to insert it. Amber = position fields (eviction only).
          </Typography>
          {grouped.map(([group, fs]) => (
            <Box key={group} sx={{ mb: 1.5 }}>
              <Typography sx={{ ...MONO, fontSize: '0.58rem', letterSpacing: '0.1em', color: INK3, mb: 0.6, textTransform: 'uppercase' }}>
                {group}
              </Typography>
              <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
                {fs.map(f => (
                  <Tooltip key={f.name} title={`${f.label}${f.unit ? ` (${f.unit})` : ''}`} arrow>
                    <Chip label={f.name} size="small" onClick={() => insertToken(f.name)}
                      sx={{ ...MONO, fontSize: '0.64rem', height: 22, cursor: 'pointer', borderRadius: '6px',
                            bgcolor: PAPER2, color: f.position_only ? '#f59e0b' : INK2,
                            border: `1px solid ${f.position_only ? '#f59e0b55' : BORDER}`,
                            '&:hover': { borderColor: CYAN, color: INK } }} />
                  </Tooltip>
                ))}
              </Box>
            </Box>
          ))}
          <Box sx={{ borderTop: `1px solid ${BORDER}`, mt: 1, pt: 1.25 }}>
            <Typography sx={{ ...MONO, fontSize: '0.58rem', letterSpacing: '0.1em', color: INK3, mb: 0.6 }}>OPERATORS</Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.6 }}>
              {['<', '<=', '>', '>=', '==', '!=', 'and', 'or', 'not', '+', '-', '*', '/'].map(op => (
                <Chip key={op} label={op} size="small" onClick={() => insertToken(op)}
                  sx={{ ...MONO, fontSize: '0.64rem', height: 22, cursor: 'pointer', borderRadius: '6px',
                        bgcolor: 'transparent', color: CYAN, border: `1px solid ${BORDER}`,
                        '&:hover': { borderColor: CYAN } }} />
              ))}
            </Box>
          </Box>
        </Box>
      </Box>
      <Footer />
    </Box>
  )
}
