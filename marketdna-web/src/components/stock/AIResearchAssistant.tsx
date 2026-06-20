import { useState, useRef, useEffect } from 'react'
import { usePalette } from '../../hooks/usePalette'
import {
  Box, Typography, TextField, IconButton, Chip, Paper,
  Collapse, Divider, Stack, Tooltip,
} from '@mui/material'
import SendIcon from '@mui/icons-material/Send'
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome'
import CodeIcon from '@mui/icons-material/Code'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import { stockApi, type ChatResponse } from '../../api/stockApi'

interface ChatMessage {
  id: number
  role: 'user' | 'assistant' | 'error'
  content: string
  queries?: ChatResponse['queries']
}

const SUGGESTIONS = [
  'What was the best month for returns?',
  'How many times did price close above SMA200?',
  'What is the longest winning streak?',
  'Which year had the highest volatility?',
  'What are the top 5 largest single-day gains?',
  'Show average monthly volume trend',
]

let msgId = 0

export default function AIResearchAssistant({ symbol }: { symbol: string }) {
  const { BORDER, PAPER2, INK2, INK3 } = usePalette()
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [expandedQueries, setExpandedQueries] = useState<Set<number>>(new Set())
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setMessages([])
    setInput('')
    setExpandedQueries(new Set())
  }, [symbol])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, loading])

  const send = async (question: string) => {
    const q = question.trim()
    if (!q || loading) return
    setInput('')

    const userMsg: ChatMessage = { id: ++msgId, role: 'user', content: q }
    setMessages(prev => [...prev, userMsg])
    setLoading(true)

    try {
      const res = await stockApi.askQuestion(symbol, q)
      setMessages(prev => [
        ...prev,
        { id: ++msgId, role: 'assistant', content: res.answer, queries: res.queries },
      ])
    } catch (e) {
      setMessages(prev => [
        ...prev,
        { id: ++msgId, role: 'error', content: (e as Error).message },
      ])
    } finally {
      setLoading(false)
    }
  }

  const toggleQueries = (id: number) => {
    setExpandedQueries(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  return (
    <Box>
      {/* Header */}
      <Box mb={2.5}>
        <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#A78BFA', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
          Natural Language · DuckDB Backed
        </Typography>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 0.5 }}>
          <AutoAwesomeIcon sx={{ color: '#A78BFA', fontSize: 22 }} />
          <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', background: 'linear-gradient(135deg, #FFFFFF 30%, #94A3B8 100%)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent', backgroundClip: 'text' }}>
            AI Research Assistant
          </Typography>
          <Box sx={{ px: 1.25, py: 0.3, borderRadius: '8px', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.2)' }}>
            <Typography sx={{ fontSize: '0.6875rem', fontWeight: 700, color: '#A78BFA' }}>llama3.2</Typography>
          </Box>
        </Box>
        <Typography sx={{ fontSize: '0.73rem', color: INK3, lineHeight: 1.5 }}>
          Ask any question about this stock — answers backed by live DuckDB queries on historical price data
        </Typography>
      </Box>

      {/* Suggested questions */}
      {messages.length === 0 && (
        <Box sx={{ mb: 2.5 }}>
          <Typography sx={{ fontSize: '0.75rem', fontWeight: 700, letterSpacing: '0.1em', color: '#374151', textTransform: 'uppercase', mb: 1.25, display: 'block' }}>
            Try asking
          </Typography>
          <Stack direction="row" flexWrap="wrap" gap={1}>
            {SUGGESTIONS.map(s => (
              <Box
                key={s}
                onClick={() => send(s)}
                sx={{
                  px: 1.5, py: 0.6,
                  borderRadius: '10px',
                  background: 'rgba(167,139,250,0.06)',
                  border: '1px solid rgba(167,139,250,0.15)',
                  cursor: 'pointer',
                  transition: 'all 0.15s ease',
                  '&:hover': {
                    background: 'rgba(167,139,250,0.12)',
                    borderColor: 'rgba(167,139,250,0.35)',
                    transform: 'translateY(-1px)',
                  },
                }}
              >
                <Typography sx={{ fontSize: '0.75rem', color: '#C4B5FD', fontWeight: 500 }}>{s}</Typography>
              </Box>
            ))}
          </Stack>
        </Box>
      )}

      {/* Chat area */}
      {(messages.length > 0 || loading) && (
        <Box
          sx={{
            maxHeight: 480,
            overflowY: 'auto',
            mb: 2,
            pr: 0.5,
            '&::-webkit-scrollbar': { width: 4 },
            '&::-webkit-scrollbar-thumb': { bgcolor: INK3, borderRadius: 2 },
          }}
        >
          {messages.map(msg => (
            <Box
              key={msg.id}
              sx={{
                display: 'flex',
                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                mb: 1.5,
              }}
            >
              {msg.role === 'user' ? (
                <Paper
                  sx={{
                    px: 2,
                    py: 1,
                    maxWidth: '75%',
                    background: 'rgba(59,130,246,0.15)',
                    border: '1px solid rgba(59,130,246,0.28)',
                    borderRadius: '16px 16px 4px 16px',
                  }}
                >
                  <Typography variant="body2">{msg.content}</Typography>
                </Paper>
              ) : (
                <Box sx={{ maxWidth: '85%' }}>
                  <Paper
                    sx={{
                      px: 2,
                      py: 1.5,
                      bgcolor: PAPER2,
                      border: `1px solid ${BORDER}`,
                      borderLeft: '3px solid rgba(167,139,250,0.4)',
                      borderRadius: '4px 16px 16px 16px',
                    }}
                  >
                    <Typography
                      variant="body2"
                      component="pre"
                      sx={{
                        whiteSpace: 'pre-wrap',
                        fontFamily: 'inherit',
                        m: 0,
                        color: msg.role === 'error' ? 'error.main' : 'text.primary',
                        lineHeight: 1.7,
                      }}
                    >
                      {msg.content}
                    </Typography>

                    {msg.queries && msg.queries.length > 0 && (
                      <Box sx={{ mt: 1.5 }}>
                        <Divider sx={{ mb: 1, opacity: 0.3 }} />
                        <Tooltip title={expandedQueries.has(msg.id) ? 'Hide queries' : 'Show queries'}>
                          <Box
                            onClick={() => toggleQueries(msg.id)}
                            sx={{
                              display: 'flex',
                              alignItems: 'center',
                              gap: 0.5,
                              cursor: 'pointer',
                              color: 'text.secondary',
                              '&:hover': { color: 'text.primary' },
                            }}
                          >
                            <CodeIcon sx={{ fontSize: 14 }} />
                            <Typography variant="caption">
                              {msg.queries.length} {msg.queries.length === 1 ? 'query' : 'queries'} used
                            </Typography>
                            {expandedQueries.has(msg.id) ? (
                              <ExpandLessIcon sx={{ fontSize: 14 }} />
                            ) : (
                              <ExpandMoreIcon sx={{ fontSize: 14 }} />
                            )}
                          </Box>
                        </Tooltip>
                        <Collapse in={expandedQueries.has(msg.id)}>
                          <Box sx={{ mt: 1 }}>
                            {msg.queries.map((q, i) => (
                              <Box key={i} sx={{ mb: 1 }}>
                                {q.label && (
                                  <Typography
                                    variant="caption"
                                    sx={{ color: 'primary.light', display: 'block', mb: 0.25 }}
                                  >
                                    {q.label}
                                  </Typography>
                                )}
                                <Box
                                  component="pre"
                                  sx={{
                                    m: 0,
                                    p: 1,
                                    bgcolor: 'rgba(0,0,0,0.3)',
                                    borderRadius: 1,
                                    fontSize: '0.7rem',
                                    fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
                                    color: INK2,
                                    overflowX: 'auto',
                                    whiteSpace: 'pre-wrap',
                                    wordBreak: 'break-all',
                                  }}
                                >
                                  {q.sql}
                                </Box>
                              </Box>
                            ))}
                          </Box>
                        </Collapse>
                      </Box>
                    )}
                  </Paper>
                </Box>
              )}
            </Box>
          ))}

          {loading && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'center', mb: 1.5, px: 0.5 }}>
              {[0, 1, 2].map(i => (
                <Box key={i} sx={{
                  width: 6, height: 6, borderRadius: '50%', bgcolor: '#A78BFA',
                  animation: 'pulse 1.2s ease-in-out infinite',
                  animationDelay: `${i * 0.2}s`,
                  '@keyframes pulse': { '0%,80%,100%': { opacity: 0.2 }, '40%': { opacity: 1 } },
                }} />
              ))}
              <Typography variant="caption" sx={{ color: 'text.secondary', ml: 1 }}>
                Analysing {symbol}…
              </Typography>
            </Box>
          )}

          <div ref={bottomRef} />
        </Box>
      )}

      {/* Input */}
      <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
        <TextField
          fullWidth
          multiline
          maxRows={3}
          size="small"
          placeholder={`Ask anything about ${symbol}…`}
          value={input}
          onChange={e => setInput(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              send(input)
            }
          }}
          disabled={loading}
          sx={{
            '& .MuiOutlinedInput-root': {
              bgcolor: PAPER2,
              '& fieldset': { borderColor: BORDER },
              '&:hover fieldset': { borderColor: INK3 },
              '&.Mui-focused fieldset': { borderColor: 'rgba(167,139,250,0.5) !important' },
            },
          }}
        />
        <IconButton
          onClick={() => send(input)}
          disabled={loading || !input.trim()}
          size="medium"
          sx={{
            bgcolor: 'primary.main',
            color: '#fff',
            '&:hover': { bgcolor: 'primary.dark' },
            '&.Mui-disabled': { bgcolor: BORDER, color: INK3 },
            flexShrink: 0,
          }}
        >
          <SendIcon fontSize="small" />
        </IconButton>
      </Box>

      {messages.length > 0 && (
        <Typography variant="caption" sx={{ color: 'text.secondary', mt: 0.75, display: 'block' }}>
          Press Enter to send · Shift+Enter for new line · answers backed by live DuckDB queries
        </Typography>
      )}
    </Box>
  )
}
