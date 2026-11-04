import { useState } from 'react'
import { Box, Typography, TextField, IconButton } from '@mui/material'
import Navbar from '../components/Navbar'
import { Footer } from '../components/Footer'
import { useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useTradingRules, type TradingRuleCategory } from '../hooks/useTradingRules'

const JAKARTA = { fontFamily: "'IBM Plex Sans', sans-serif" } as const
const MONO = { fontFamily: "'IBM Plex Mono', monospace" } as const
const ACCENT = '#38BDF8'

function SectionHead({ title, accent, meta, onDelete }: { title: string; accent: string; meta: string; onDelete: () => void }) {
  const { INK, INK3 } = useTokens()
  const [confirming, setConfirming] = useState(false)
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.75 }}>
      <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent, flexShrink: 0 }} />
      <Typography sx={{ ...JAKARTA, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      <Typography sx={{ ...MONO, fontSize: '0.68rem', color: INK3 }}>{meta}</Typography>
      <Box sx={{ flex: 1 }} />
      {confirming ? (
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', color: '#ef4444' }}>Delete section?</Typography>
          <Box component="button" onClick={onDelete} sx={{ ...JAKARTA, fontSize: '0.68rem', color: '#ef4444', fontWeight: 700, background: 'none', border: 'none', cursor: 'pointer', px: 0.5 }}>Yes</Box>
          <Box component="button" onClick={() => setConfirming(false)} sx={{ ...JAKARTA, fontSize: '0.68rem', color: INK3, background: 'none', border: 'none', cursor: 'pointer', px: 0.5 }}>No</Box>
        </Box>
      ) : (
        <Box component="button" onClick={() => setConfirming(true)} title="Delete section" sx={{
          background: 'none', border: 'none', cursor: 'pointer', color: INK3, fontSize: '0.78rem', lineHeight: 1, px: 0.5,
          '&:hover': { color: '#ef4444' },
        }}>✕</Box>
      )}
    </Box>
  )
}

function RuleRow({ index, text, accent, onSave, onDelete }: { index: number; text: string; accent: string; onSave: (text: string) => void; onDelete: () => void }) {
  const { INK, INK3, BORDER, PAPER2 } = useTokens()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(text)

  const commit = () => {
    setEditing(false)
    const trimmed = draft.trim()
    if (trimmed && trimmed !== text) onSave(trimmed)
    else setDraft(text)
  }

  return (
    <Box sx={{
      display: 'flex', alignItems: 'flex-start', gap: 1.25, py: 1, px: 1.25,
      borderRadius: '8px',
      '&:hover': { bgcolor: PAPER2 },
      '&:hover .rule-del': { opacity: 1 },
    }}>
      <Typography sx={{ ...MONO, fontSize: '0.7rem', color: accent, fontWeight: 700, mt: 0.3, flexShrink: 0, minWidth: 20 }}>
        {String(index + 1).padStart(2, '0')}
      </Typography>
      {editing ? (
        <TextField
          autoFocus
          multiline
          fullWidth
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onFocus={e => { const len = e.target.value.length; e.target.setSelectionRange(len, len) }}
          onBlur={commit}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commit() }
            if (e.key === 'Escape') { setDraft(text); setEditing(false) }
          }}
          variant="standard"
          sx={{ '& .MuiInputBase-root': { ...JAKARTA, fontSize: '0.82rem', color: INK, lineHeight: 1.6 } }}
        />
      ) : (
        <Typography
          onClick={() => setEditing(true)}
          sx={{ ...JAKARTA, fontSize: '0.82rem', color: INK, lineHeight: 1.6, flex: 1, cursor: 'text' }}
        >
          {text}
        </Typography>
      )}
      <IconButton
        className="rule-del"
        onClick={onDelete}
        size="small"
        sx={{ opacity: 0, transition: 'opacity 0.12s', color: INK3, fontSize: '0.75rem', mt: 0.1, '&:hover': { color: '#ef4444' } }}
      >
        ✕
      </IconButton>
    </Box>
  )
}

function AddRuleRow({ accent, onAdd }: { accent: string; onAdd: (text: string) => void }) {
  const { INK3 } = useTokens()
  const [text, setText] = useState('')
  const submit = () => {
    if (text.trim()) { onAdd(text.trim()); setText('') }
  }
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.25, py: 1, px: 1.25 }}>
      <Typography sx={{ ...MONO, fontSize: '0.7rem', color: accent, fontWeight: 700, minWidth: 20 }}>+</Typography>
      <TextField
        placeholder="Add a rule…"
        value={text}
        onChange={e => setText(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); submit() } }}
        variant="standard"
        fullWidth
        sx={{ '& .MuiInputBase-root': { ...JAKARTA, fontSize: '0.82rem', color: INK3 } }}
      />
      {text.trim() && (
        <Box component="button" onClick={submit} sx={{ ...JAKARTA, fontSize: '0.7rem', fontWeight: 700, color: accent, background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}>
          Add
        </Box>
      )}
    </Box>
  )
}

function CategoryCard({ category, onAddRule, onUpdateRule, onDeleteRule, onDeleteCategory }: {
  category: TradingRuleCategory
  onAddRule: (text: string) => void
  onUpdateRule: (ruleId: string, text: string) => void
  onDeleteRule: (ruleId: string) => void
  onDeleteCategory: () => void
}) {
  const { CARD, BORDER } = useTokens()
  return (
    <Box sx={{ ...CARD, mb: 2.5 }}>
      <SectionHead title={category.title} accent={category.accent} meta={`${category.rules.length} rule${category.rules.length === 1 ? '' : 's'}`} onDelete={onDeleteCategory} />
      <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 0.5 }}>
        {category.rules.map((rule, i) => (
          <RuleRow
            key={rule.id}
            index={i}
            text={rule.text}
            accent={category.accent}
            onSave={t => onUpdateRule(rule.id, t)}
            onDelete={() => onDeleteRule(rule.id)}
          />
        ))}
        <AddRuleRow accent={category.accent} onAdd={onAddRule} />
      </Box>
    </Box>
  )
}

function AddCategoryCard({ onAdd }: { onAdd: (title: string) => void }) {
  const { CARD, INK3, BORDER } = useTokens()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')
  const submit = () => {
    if (title.trim()) { onAdd(title.trim()); setTitle(''); setOpen(false) }
  }
  if (!open) {
    return (
      <Box
        onClick={() => setOpen(true)}
        sx={{
          ...CARD, mb: 2.5, borderStyle: 'dashed', display: 'flex', alignItems: 'center', justifyContent: 'center',
          py: 2, cursor: 'pointer', color: INK3,
          '&:hover': { borderColor: ACCENT, color: ACCENT },
        }}
      >
        <Typography sx={{ ...JAKARTA, fontSize: '0.8rem', fontWeight: 600 }}>+ New Section</Typography>
      </Box>
    )
  }
  return (
    <Box sx={{ ...CARD, mb: 2.5, display: 'flex', alignItems: 'center', gap: 1.5 }}>
      <TextField
        autoFocus
        placeholder="Section title…"
        value={title}
        onChange={e => setTitle(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') setOpen(false) }}
        variant="standard"
        fullWidth
        sx={{ '& .MuiInputBase-root': { ...JAKARTA, fontSize: '0.85rem' } }}
      />
      <Box component="button" onClick={submit} sx={{ ...JAKARTA, fontSize: '0.75rem', fontWeight: 700, color: ACCENT, background: 'none', border: `1px solid ${BORDER}`, borderRadius: '6px', px: 1.5, py: 0.5, cursor: 'pointer', whiteSpace: 'nowrap' }}>
        Add
      </Box>
    </Box>
  )
}

export default function TradingRulesPage() {
  const { BG, BORDER, CYAN, INK, INK2, INK3 } = useTokens()
  const { mode } = useThemeMode()
  const { categories, totalRules, addRule, updateRule, deleteRule, addCategory, deleteCategory, resetToDefaults } = useTradingRules()
  const [resetConfirming, setResetConfirming] = useState(false)

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG, color: INK, transition: 'background 0.2s' }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        borderBottom: `1px solid ${BORDER}`,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        position: 'relative', overflow: 'hidden',
      }}>
        <Box sx={{ position: 'absolute', top: -100, right: '10%', width: 500, height: 400, borderRadius: '50%', background: `radial-gradient(ellipse, ${ACCENT}12 0%, transparent 65%)`, pointerEvents: 'none' }} />
        <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, py: { xs: 6, md: 8 }, position: 'relative' }}>
          <Box sx={{ display: 'inline-flex', alignItems: 'center', gap: 1.25, mb: 2.5, px: 1.5, py: 0.5, borderRadius: '20px', border: `1px solid ${ACCENT}40`, bgcolor: `${ACCENT}0D` }}>
            <Box sx={{ width: 6, height: 6, borderRadius: '50%', bgcolor: ACCENT, animation: 'hpulse 2s ease-in-out infinite', '@keyframes hpulse': { '0%,100%': { boxShadow: `0 0 4px ${ACCENT}` }, '50%': { boxShadow: `0 0 14px ${ACCENT}` } } }} />
            <Typography sx={{ ...JAKARTA, fontSize: '0.68rem', fontWeight: 700, color: ACCENT, letterSpacing: '0.14em', textTransform: 'uppercase' }}>
              Personal Playbook · Risk Discipline
            </Typography>
          </Box>
          <Typography sx={{ ...JAKARTA, fontWeight: 800, color: INK, fontSize: { xs: '2rem', sm: '2.75rem', md: '3.25rem' }, lineHeight: 1.1, letterSpacing: '-0.03em', mb: 1.5 }}>
            Trading{' '}
            <Box component="span" sx={{ color: ACCENT, textShadow: `0 0 32px ${ACCENT}70` }}>Rules</Box>
          </Typography>
          <Typography sx={{ ...JAKARTA, fontSize: '0.9375rem', color: INK2, lineHeight: 1.75, mb: 2.5, maxWidth: 640 }}>
            Your own rulebook — discipline, risk, planning, and the lessons already paid for. Click any line to edit it, add new rules inline, or start a new section. Stored only in this browser.
          </Typography>

          <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
            <Typography sx={{ ...MONO, fontSize: '0.72rem', color: INK3 }}>
              {categories.length} sections · {totalRules} rules
            </Typography>
            {resetConfirming ? (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                <Typography sx={{ ...JAKARTA, fontSize: '0.72rem', color: '#ef4444' }}>Discard your edits and restore the original list?</Typography>
                <Box component="button" onClick={() => { resetToDefaults(); setResetConfirming(false) }} sx={{ ...JAKARTA, fontSize: '0.72rem', fontWeight: 700, color: '#ef4444', background: 'none', border: 'none', cursor: 'pointer' }}>Yes, reset</Box>
                <Box component="button" onClick={() => setResetConfirming(false)} sx={{ ...JAKARTA, fontSize: '0.72rem', color: INK3, background: 'none', border: 'none', cursor: 'pointer' }}>Cancel</Box>
              </Box>
            ) : (
              <Box component="button" onClick={() => setResetConfirming(true)} sx={{
                ...JAKARTA, fontSize: '0.72rem', color: INK3, background: 'none', border: `1px solid ${BORDER}`, borderRadius: '6px',
                px: 1.25, py: 0.4, cursor: 'pointer', '&:hover': { color: INK, borderColor: CYAN },
              }}>
                ↺ Reset to defaults
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      <Box sx={{ maxWidth: 900, mx: 'auto', px: { xs: 2.5, md: 8, lg: 12 }, py: 4 }}>
        {categories.map(category => (
          <CategoryCard
            key={category.id}
            category={category}
            onAddRule={text => addRule(category.id, text)}
            onUpdateRule={(ruleId, text) => updateRule(category.id, ruleId, text)}
            onDeleteRule={ruleId => deleteRule(category.id, ruleId)}
            onDeleteCategory={() => deleteCategory(category.id)}
          />
        ))}
        <AddCategoryCard onAdd={addCategory} />
      </Box>

      <Footer />
    </Box>
  )
}
