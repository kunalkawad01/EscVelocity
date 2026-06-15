import { Box, Typography, Chip, CircularProgress, Grid } from '@mui/material'
import type { RegimeClustersResponse } from '../../types/stock'

const PAPER  = '#07090F'
const INK    = '#F2EDE4'
const INK2   = '#8B95AC'
const INK3   = '#5B6880'
const BORDER = '#0F1526'

interface Props { data: RegimeClustersResponse | null; loading: boolean }

function MetricCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <Box sx={{ p: 2.5, borderRadius: '14px', border: `1px solid ${BORDER}`, background: PAPER, height: '100%' }}>
      <Typography variant="overline" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
        {title}
      </Typography>
      {children}
    </Box>
  )
}

function clusterColor(label: string): string {
  if (label.includes('Bull')) return '#22c55e'
  if (label.includes('Bear')) return '#ef4444'
  if (label.includes('Neutral')) return '#f59e0b'
  return INK3
}

function stateColor(label: string): string {
  if (label === 'Bull') return '#22c55e'
  if (label === 'Bear') return '#ef4444'
  return '#f59e0b'
}

function retColor(v: number): string {
  return v > 0 ? '#22c55e' : v < 0 ? '#ef4444' : INK3
}

export default function RegimeClusters({ data, loading }: Props) {
  if (loading) {
    return (
      <Box sx={{ height: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 1.5, flexDirection: 'column' }}>
        <CircularProgress size={24} />
        <Typography variant="caption" sx={{ color: INK3 }}>Training K-Means, GMM, HMM…</Typography>
      </Box>
    )
  }
  if (!data) return null

  const { kmeans, gmm, hmm } = data

  const kColor = clusterColor(kmeans.cluster_label)
  const hColor = stateColor(hmm.state_label)

  return (
    <Box>
      <Typography sx={{ fontSize: '0.75rem', fontWeight: 800, letterSpacing: '0.18em', color: '#14B8A6', textTransform: 'uppercase', mb: 0.5, display: 'block' }}>
        Machine Learning
      </Typography>
      <Typography sx={{ fontSize: '1.4rem', fontWeight: 800, letterSpacing: '-0.025em', color: INK, mb: 0.5, display: 'block' }}>
        Regime Clusters
      </Typography>
      <Typography sx={{ fontSize: '0.73rem', color: INK2, mb: 2.5, display: 'block', lineHeight: 1.5 }}>
        Three independent ML models classify today's market environment — consensus across K-Means, GMM, and HMM increases regime confidence; divergence signals uncertainty
      </Typography>

      <Grid container spacing={2}>
        {/* K-Means */}
        <Grid item xs={12} md={4}>
          <MetricCard title={`K-Means (${kmeans.n_clusters} clusters)`}>
            <Chip label={kmeans.cluster_label} size="small"
              sx={{ bgcolor: `${kColor}18`, color: kColor, fontWeight: 800, fontSize: '0.7rem', mb: 1.5 }} />
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
              {kmeans.cluster_description}
            </Typography>
            <Box>
              <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block' }}>
                Avg hist. 21d return for this cluster
              </Typography>
              <Typography variant="body1" sx={{ fontWeight: 800, color: retColor(kmeans.avg_fwd_return) }}>
                {kmeans.avg_fwd_return > 0 ? '+' : ''}{kmeans.avg_fwd_return.toFixed(2)}%
              </Typography>
            </Box>
          </MetricCard>
        </Grid>

        {/* GMM */}
        <Grid item xs={12} md={4}>
          <MetricCard title="Gaussian Mixture Model">
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mb: 1.5 }}>
              Probability of being in each regime
            </Typography>
            {gmm.state_labels.map((label, i) => {
              const p = gmm.state_probabilities[i] ?? 0
              const sc = stateColor(label)
              const isActive = i === gmm.current_state
              return (
                <Box key={label} sx={{ mb: 1.25 }}>
                  <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                    <Typography variant="caption" sx={{ color: isActive ? sc : INK3, fontWeight: isActive ? 700 : 400, fontSize: '0.75rem' }}>
                      {label}
                    </Typography>
                    <Typography variant="caption" sx={{ fontWeight: 700, color: isActive ? sc : INK3, fontSize: '0.75rem' }}>
                      {(p * 100).toFixed(0)}%
                    </Typography>
                  </Box>
                  <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER }}>
                    <Box sx={{ height: '100%', width: `${p * 100}%`, borderRadius: 2, bgcolor: sc, opacity: isActive ? 1 : 0.35 }} />
                  </Box>
                </Box>
              )
            })}
          </MetricCard>
        </Grid>

        {/* HMM */}
        <Grid item xs={12} md={4}>
          <MetricCard title="Hidden Markov Model">
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, mb: 1 }}>
              <Typography variant="h5" sx={{ fontWeight: 800, color: hColor }}>
                {hmm.state_label}
              </Typography>
              <Typography variant="caption" sx={{ color: INK3, fontSize: '0.75rem' }}>
                State
              </Typography>
            </Box>
            <Box sx={{ mb: 1.5 }}>
              <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
                <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem' }}>Confidence</Typography>
                <Typography variant="caption" sx={{ fontWeight: 700, color: hColor, fontSize: '0.75rem' }}>
                  {(hmm.state_probability * 100).toFixed(0)}%
                </Typography>
              </Box>
              <Box sx={{ height: 4, borderRadius: 2, bgcolor: BORDER }}>
                <Box sx={{ height: '100%', width: `${hmm.state_probability * 100}%`, borderRadius: 2, bgcolor: hColor }} />
              </Box>
            </Box>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block' }}>
              States discovered: {hmm.state_labels.join(' · ')}
            </Typography>
            <Typography variant="caption" sx={{ color: INK3, fontSize: '0.6875rem', display: 'block', mt: 0.5 }}>
              HMM accounts for regime persistence — it does not jump states on a single anomalous day
            </Typography>
          </MetricCard>
        </Grid>
      </Grid>
    </Box>
  )
}
