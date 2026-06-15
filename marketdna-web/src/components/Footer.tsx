import { Box, Typography } from '@mui/material'
import { usePalette } from '../hooks/usePalette'

export function Footer() {
  const { PAPER, BORDER, CYAN, INK, INK2, INK3 } = usePalette()
  const NAV = [
    { label: 'Platform',     links: ['Stock DNA', 'Pattern DNA', 'Markov Options', 'Quant Strategies', 'Indicators'] },
    { label: 'Intelligence', links: ['Market Regime', 'Breadth Score', 'Edge Lab', 'Cointegration', 'Delivery Intel'] },
    { label: 'Research',     links: ['Validation Framework', 'MCP Architecture', 'AI Agents', 'Feature Store', 'Backtests'] },
  ]
  return (
    <Box component="footer" sx={{ bgcolor: PAPER, borderTop: `1px solid ${BORDER}`, mt: 8 }}>
      <Box sx={{ maxWidth: 1280, mx: 'auto', px: { xs: 3, md: 8, lg: 12 }, pt: 6, pb: 4 }}>
        <Box sx={{ display: 'flex', gap: 6, flexWrap: 'wrap', mb: 5 }}>
          <Box sx={{ flex: '0 0 auto', maxWidth: 260 }}>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
              <Box sx={{ width: 7, height: 7, bgcolor: CYAN, animation: 'blink 1.4s step-end infinite', '@keyframes blink': { '0%,100%': { opacity: 1 }, '50%': { opacity: 0 } } }} />
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontWeight: 800, fontSize: '1rem', color: INK, letterSpacing: '0.08em' }}>
                MARKET<Box component="span" sx={{ color: CYAN }}>DNA</Box>
              </Typography>
            </Box>
            <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, lineHeight: 1.7 }}>
              Quantitative market intelligence for Indian equities and options. Research precedes product. Validation is mandatory.
            </Typography>
          </Box>
          {NAV.map(col => (
            <Box key={col.label} sx={{ flex: '1 1 140px' }}>
              <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', fontWeight: 700, color: CYAN, letterSpacing: '0.12em', textTransform: 'uppercase', mb: 1.75 }}>{col.label}</Typography>
              {col.links.map(link => (
                <Typography key={link} sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.8rem', color: INK3, mb: 0.875, cursor: 'default', transition: 'color 0.12s', '&:hover': { color: INK2 } }}>{link}</Typography>
              ))}
            </Box>
          ))}
        </Box>
        <Box sx={{ borderTop: `1px solid ${BORDER}`, pt: 3, display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 1.5 }}>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>© 2024 MarketDNA · For research purposes only</Typography>
          <Typography sx={{ fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '0.7rem', color: INK3 }}>Not investment advice</Typography>
        </Box>
      </Box>
    </Box>
  )
}

export default Footer
