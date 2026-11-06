import { useEffect, useState } from 'react'
import { Box, Button, CircularProgress, Grid, Typography } from '@mui/material'
import PictureAsPdfIcon from '@mui/icons-material/PictureAsPdf'
import RefreshIcon from '@mui/icons-material/Refresh'
import Navbar from '../components/Navbar'
import Footer from '../components/Footer'
import { ChartTile } from '../components/charts/ChartTile'
import { MONO, SANS, RED, pct } from '../components/charts/chartsCommon'
import { usePalette, useTokens } from '../hooks/usePalette'
import { useThemeMode } from '../contexts/ThemeModeContext'
import { useFoTicker } from '../hooks/useFoTicker'
import { useChartsCart } from '../hooks/useChartsCart'
import { fnoReportsApi } from '../api/fnoReportsApi'
import type { ClusterSnapshotResponse, ReportJob, ReportJobStatus } from '../types/fnoReports'

// Same palette used server-side (scripts/generate_fno_cluster_report.py CLUSTER_PALETTE)
// so a cluster's color means the same thing here and in the PDF.
const CLUSTER_PALETTE = ['#1d4ed8', '#d73027', '#1a9850', '#f59e0b', '#7c3aed', '#0891b2', '#be185d']

function SectionHead({ title, accent, meta }: { title: string; accent: string; meta: string }) {
  const { INK, INK3 } = usePalette()
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1.5, mb: 1.5, flexWrap: 'wrap' }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5 }}>
        <Box sx={{ width: 3, height: 20, borderRadius: 2, bgcolor: accent }} />
        <Typography sx={{ ...SANS, fontSize: '0.82rem', fontWeight: 800, color: INK }}>{title}</Typography>
      </Box>
      <Typography sx={{ ...MONO, fontSize: '0.66rem', color: INK3 }}>{meta}</Typography>
    </Box>
  )
}

const JOB_META: Record<ReportJob, { title: string; desc: string }> = {
  returns: {
    title: 'FNO Returns Report',
    desc: 'Daily tile report — 6 charts (Yday/1D/5D/1M/3M/1Y) + news & research links per symbol. Needs live backend data.',
  },
  cluster: {
    title: 'Cluster Report',
    desc: 'This PCA + K-Means return-profile analysis as a PDF — diagnostics, scatter, loadings, per-cluster symbol tables.',
  },
}

function useReportJob(job: ReportJob) {
  const [status, setStatus] = useState<ReportJobStatus | null>(null)

  useEffect(() => {
    fnoReportsApi.getStatus(job).then(setStatus).catch(() => {})
  }, [job])

  useEffect(() => {
    if (status?.state !== 'running') return
    const t = setInterval(() => {
      fnoReportsApi.getStatus(job).then(setStatus).catch(() => {})
    }, 3000)
    return () => clearInterval(t)
  }, [status?.state, job])

  const trigger = () => {
    fnoReportsApi.generate(job).then(setStatus).catch(() => {})
  }

  return { status, trigger }
}

function ReportButtonCard({ job }: { job: ReportJob }) {
  const { INK, INK3, CYAN, BORDER } = usePalette()
  const { CARD } = useTokens()
  const { status, trigger } = useReportJob(job)
  const meta = JOB_META[job]
  const running = status?.state === 'running'
  const done = status?.state === 'done'
  const errored = status?.state === 'error'

  return (
    <Box sx={{ ...CARD, p: 2.5, flex: '1 1 320px', minWidth: 280 }}>
      <Typography sx={{ ...SANS, fontSize: '0.92rem', fontWeight: 800, color: INK, mb: 0.5 }}>{meta.title}</Typography>
      <Typography sx={{ ...SANS, fontSize: '0.74rem', color: INK3, mb: 1.75, lineHeight: 1.4 }}>{meta.desc}</Typography>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flexWrap: 'wrap' }}>
        <Button
          variant="contained"
          disabled={running}
          onClick={trigger}
          startIcon={running ? <CircularProgress size={14} sx={{ color: '#fff' }} /> : <PictureAsPdfIcon sx={{ fontSize: '1rem' }} />}
          sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, textTransform: 'none', bgcolor: CYAN, color: '#061018', '&:hover': { bgcolor: CYAN, opacity: 0.9 } }}
        >
          {running ? 'Generating…' : done ? 'Regenerate PDF' : 'Generate PDF'}
        </Button>
        {done && status?.pdf_filename && (
          <Button
            component="a"
            href={fnoReportsApi.downloadUrl(job)}
            target="_blank"
            rel="noreferrer"
            variant="outlined"
            sx={{ ...SANS, fontSize: '0.72rem', fontWeight: 700, textTransform: 'none', borderColor: BORDER, color: INK }}
          >
            Download {status.pdf_filename}
          </Button>
        )}
      </Box>
      {errored && (
        <Typography sx={{ ...MONO, fontSize: '0.64rem', color: RED, mt: 1.25, lineHeight: 1.5 }}>
          Failed: {status?.error ? status.error.slice(0, 220) : 'unknown error'}
        </Typography>
      )}
      {status?.state && status.state !== 'idle' && (
        <Typography sx={{ ...MONO, fontSize: '0.6rem', color: INK3, mt: 1 }}>
          {running ? `Started ${status.started_at}` : status?.finished_at ? `Finished ${status.finished_at}` : ''}
        </Typography>
      )}
    </Box>
  )
}

export default function ClustersPage() {
  const { INK, INK2, INK3, CYAN, BG, BORDER } = usePalette()
  const { mode } = useThemeMode()
  const { ticks } = useFoTicker()
  const cart = useChartsCart()
  const [snapshot, setSnapshot] = useState<ClusterSnapshotResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const loadSnapshot = (force = false) => {
    setLoading(true)
    setError(null)
    fnoReportsApi.getClusterSnapshot(force)
      .then(setSnapshot)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }

  useEffect(() => { loadSnapshot(false) }, [])

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: BG }}>
      <Navbar />

      {/* Hero */}
      <Box sx={{
        px: { xs: 2, md: 4 }, pt: 4, pb: 3,
        background: mode === 'dark'
          ? `linear-gradient(160deg, #0A1628 0%, #060C1A 60%, ${BG} 100%)`
          : `linear-gradient(160deg, #EBF3FC 0%, #F2F7FD 50%, ${BG} 100%)`,
        borderBottom: `1px solid ${BORDER}`,
      }}>
        <Typography sx={{ ...MONO, fontSize: '0.62rem', fontWeight: 700, color: CYAN, letterSpacing: '0.18em', textTransform: 'uppercase', mb: 1 }}>
          ● PCA + K-Means
        </Typography>
        <Typography sx={{ ...SANS, fontSize: { xs: '1.6rem', md: '2.1rem' }, fontWeight: 800, color: INK, letterSpacing: '-0.02em', lineHeight: 1.1 }}>
          Return <Box component="span" sx={{ color: CYAN }}>Clusters</Box>
        </Typography>
        <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK2, maxWidth: 700, mt: 1 }}>
          Every F&amp;O underlying grouped by its 1D/5D/1M/3M/1Y return profile — standardized
          features, K-Means (k chosen by silhouette score), PCA for the loadings. Live
          candlestick tiles below, sectioned by cluster. Generate either daily PDF on demand
          instead of remembering the CLI command.
        </Typography>
      </Box>

      {/* Report generation buttons */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 3, borderBottom: `1px solid ${BORDER}` }}>
        <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          <ReportButtonCard job="returns" />
          <ReportButtonCard job="cluster" />
        </Box>
      </Box>

      {/* Cluster-grouped chart grid */}
      <Box sx={{ px: { xs: 2, md: 4 }, py: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2, flexWrap: 'wrap', gap: 1 }}>
          <Typography sx={{ ...MONO, fontSize: '0.64rem', color: INK3 }}>
            {snapshot
              ? `as of ${snapshot.as_of_date} · k=${snapshot.k} · silhouette ${snapshot.silhouette.toFixed(3)} · ${snapshot.items.length} symbols${snapshot.excluded ? ` (${snapshot.excluded} excluded, insufficient history)` : ''}`
              : ' '}
          </Typography>
          <Button
            size="small"
            onClick={() => loadSnapshot(true)}
            disabled={loading}
            startIcon={<RefreshIcon sx={{ fontSize: '0.9rem' }} />}
            sx={{ ...SANS, fontSize: '0.68rem', fontWeight: 700, textTransform: 'none', color: INK3 }}
          >
            Recompute
          </Button>
        </Box>

        {loading && !snapshot && (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: INK3, textAlign: 'center', py: 6 }}>
            Running PCA + K-Means over the F&amp;O universe…
          </Typography>
        )}
        {error && (
          <Typography sx={{ ...SANS, fontSize: '0.8rem', color: RED, textAlign: 'center', py: 6 }}>
            {error}
          </Typography>
        )}

        {snapshot?.groups.map((g, i) => {
          const color = CLUSTER_PALETTE[i % CLUSTER_PALETTE.length]
          return (
            <Box key={g.cluster} sx={{ mb: 5 }}>
              <SectionHead
                title={`Cluster ${g.cluster} — ${g.character}`}
                accent={color}
                meta={`${g.n} symbols · 1D ${pct(g.mean_1d)} · 5D ${pct(g.mean_5d)} · 1M ${pct(g.mean_1m)} · 3M ${pct(g.mean_3m)} · 1Y ${pct(g.mean_1y)}`}
              />
              <Grid container spacing={2}>
                {g.symbols.map(sym => (
                  <Grid item xs={12} sm={6} md={4} key={sym}>
                    <ChartTile symbol={sym} tick={ticks[sym]} isInCart={cart.isInCart} onToggleCart={cart.toggle} />
                  </Grid>
                ))}
              </Grid>
            </Box>
          )
        })}
      </Box>

      <Footer />
    </Box>
  )
}
