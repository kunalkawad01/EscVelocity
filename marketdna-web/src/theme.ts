import { createTheme } from '@mui/material/styles'

// ── TERMINUS palette ──────────────────────────────────────────────────────────
export const T = {
  bg:      '#020305',
  panel:   '#06080E',
  surface: '#0A0D18',
  rule:    '#0F1422',
  rule2:   '#1A2236',
  text:    '#E6E0D6',
  text2:   '#64708A',
  text3:   '#252E48',
  amber:   '#E8A820',
  amber2:  '#F5BC35',
  green:   '#00C97A',
  red:     '#E83535',
  blue:    '#4490FF',
  purple:  '#9B7FE8',
  teal:    '#14B8A6',
  orange:  '#F59340',
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary:    { main: T.amber,  light: T.amber2, dark: '#C08018', contrastText: T.bg },
    secondary:  { main: T.blue,   light: '#6AAAFF', dark: '#2D70DD' },
    success:    { main: T.green,  light: '#33D98F', dark: '#009958' },
    warning:    { main: T.amber },
    error:      { main: T.red,    light: '#F06060', dark: '#C02020' },
    info:       { main: T.blue },
    background: { default: T.bg, paper: T.panel },
    text:       { primary: T.text, secondary: T.text2, disabled: T.text3 },
    divider:    T.rule,
  },

  typography: {
    fontFamily: "'IBM Plex Sans', system-ui, -apple-system, sans-serif",
    fontSize: 14,

    h1: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 700, letterSpacing: '-0.025em', color: T.text },
    h2: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 700, letterSpacing: '-0.02em',  color: T.text },
    h3: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 700, letterSpacing: '-0.015em', color: T.text },
    h4: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 700, letterSpacing: '-0.01em',  color: T.text },
    h5: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 600, color: T.text },
    h6: { fontFamily: "'IBM Plex Sans Condensed', sans-serif", fontWeight: 600, color: T.text },

    body1: { fontSize: '0.9375rem', lineHeight: 1.7,  color: T.text,  fontFamily: "'IBM Plex Sans', sans-serif" },
    body2: { fontSize: '0.875rem',  lineHeight: 1.65, color: T.text2, fontFamily: "'IBM Plex Sans', sans-serif" },

    subtitle1: { fontSize: '0.875rem',  color: T.text,  letterSpacing: '0.01em' },
    subtitle2: { fontSize: '0.8125rem', color: T.text2, letterSpacing: '0.01em' },

    overline: {
      fontFamily: "'IBM Plex Sans Condensed', sans-serif",
      fontWeight: 700,
      letterSpacing: '0.14em',
      fontSize: '0.6875rem',
      textTransform: 'uppercase' as const,
      color: T.text2,
    },

    caption: {
      fontFamily: "'IBM Plex Mono', monospace",
      fontSize: '0.75rem',
      color: T.text2,
      letterSpacing: '0.04em',
    },
  },

  shape: { borderRadius: 0 },

  components: {
    MuiCssBaseline: {
      styleOverrides: {
        ':root': {
          '--font-cond': "'IBM Plex Sans Condensed', sans-serif",
          '--font-mono': "'IBM Plex Mono', monospace",
          '--font-body': "'IBM Plex Sans', sans-serif",
        },
        body: {
          background: T.bg,
          minHeight: '100vh',
          fontFeatureSettings: '"tnum", "ss01"',
          WebkitFontSmoothing: 'antialiased',
          MozOsxFontSmoothing: 'grayscale',
        },
        '*': { boxSizing: 'border-box', scrollbarWidth: 'thin', scrollbarColor: `${T.rule2} transparent` },
        '*::-webkit-scrollbar':       { width: '4px', height: '4px' },
        '*::-webkit-scrollbar-track': { background: 'transparent' },
        '*::-webkit-scrollbar-thumb': { background: T.rule2, borderRadius: 0 },
        'a': { color: 'inherit', textDecoration: 'none' },
        '@keyframes fadeUp': {
          from: { opacity: 0, transform: 'translateY(20px)' },
          to:   { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes ticker': {
          from: { transform: 'translateX(0)' },
          to:   { transform: 'translateX(-50%)' },
        },
        '@keyframes pulse': {
          '0%, 100%': { opacity: 1 },
          '50%': { opacity: 0.25 },
        },
        '@keyframes scan': {
          '0%':   { transform: 'translateY(-100%)', opacity: 0 },
          '10%':  { opacity: 0.7 },
          '90%':  { opacity: 0.7 },
          '100%': { transform: 'translateY(100%)', opacity: 0 },
        },
        '@keyframes cursor-blink': {
          '0%, 100%': { opacity: 1 },
          '50%':      { opacity: 0 },
        },
      },
    },

    MuiPaper: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundImage: 'none',
          backgroundColor: T.panel,
          border: `1px solid ${T.rule}`,
        },
      },
    },

    MuiCard: {
      defaultProps: { elevation: 0 },
      styleOverrides: {
        root: {
          backgroundColor: T.panel,
          border: `1px solid ${T.rule}`,
          backgroundImage: 'none',
          boxShadow: 'none',
          transition: 'border-color 0.15s',
          '&:hover': { borderColor: T.rule2 },
        },
      },
    },

    MuiButton: {
      defaultProps: { disableElevation: true, disableRipple: false },
      styleOverrides: {
        root: {
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontWeight: 700,
          letterSpacing: '0.1em',
          fontSize: '0.875rem',
          textTransform: 'uppercase' as const,
          borderRadius: 0,
          boxShadow: 'none !important',
          transition: 'all 0.15s',
        },
        containedPrimary: {
          background: T.amber,
          color: T.bg,
          '&:hover': { background: T.amber2 },
        },
        containedSecondary: {
          background: T.blue,
          color: '#fff',
          '&:hover': { background: '#6AAAFF' },
        },
        outlinedPrimary: {
          borderColor: T.rule2,
          color: T.text2,
          '&:hover': { borderColor: T.amber, color: T.amber, background: 'transparent' },
        },
        outlinedSecondary: {
          borderColor: T.rule2,
          color: T.text2,
          '&:hover': { borderColor: T.blue, color: T.blue, background: 'transparent' },
        },
        text: {
          color: T.text2,
          '&:hover': { background: `rgba(255,255,255,0.04)`, color: T.text },
        },
      },
    },

    MuiIconButton: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          color: T.text2,
          '&:hover': { background: `rgba(255,255,255,0.04)`, color: T.text },
        },
      },
    },

    MuiChip: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontWeight: 700,
          fontSize: '0.6875rem',
          letterSpacing: '0.08em',
          height: 22,
          border: 'none',
        },
        label: { paddingLeft: 8, paddingRight: 8 },
      },
    },

    MuiTableContainer: {
      styleOverrides: { root: { borderRadius: 0, border: `1px solid ${T.rule}` } },
    },

    MuiTableCell: {
      styleOverrides: {
        head: {
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          background: T.surface,
          color: T.text2,
          fontWeight: 700,
          fontSize: '0.6875rem',
          textTransform: 'uppercase' as const,
          letterSpacing: '0.1em',
          borderBottom: `1px solid ${T.rule}`,
          padding: '9px 14px',
          whiteSpace: 'nowrap' as const,
        },
        root: {
          fontFamily: "'IBM Plex Mono', monospace",
          fontSize: '0.8125rem',
          color: T.text,
          borderBottom: `1px solid ${T.rule}`,
          padding: '10px 14px',
        },
        body: {
          '&:first-of-type': { color: T.text2 },
        },
      },
    },

    MuiTableRow: {
      styleOverrides: {
        root: {
          transition: 'background 0.1s',
          '&:hover': { background: `rgba(255,255,255,0.02)` },
        },
      },
    },

    MuiDivider: {
      styleOverrides: { root: { borderColor: T.rule } },
    },

    MuiSelect: {
      styleOverrides: {
        select: {
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontSize: '0.875rem',
          fontWeight: 600,
          letterSpacing: '0.04em',
        },
        icon: { color: T.text2 },
      },
    },

    MuiMenuItem: {
      styleOverrides: {
        root: {
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: '0.875rem',
          minHeight: 36,
          '&.Mui-selected': { background: T.rule2 },
          '&:hover':        { background: `rgba(255,255,255,0.04)` },
          '&.Mui-selected:hover': { background: T.rule2 },
        },
      },
    },

    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            background: T.surface,
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: '0.875rem',
            borderRadius: 0,
            '& fieldset':            { borderColor: T.rule },
            '&:hover fieldset':      { borderColor: T.rule2 },
            '&.Mui-focused fieldset':{ borderColor: T.amber, borderWidth: 1 },
          },
          '& .MuiInputLabel-root': {
            fontFamily: "'IBM Plex Sans', sans-serif",
            fontSize: '0.875rem',
            color: T.text2,
            '&.Mui-focused': { color: T.amber },
          },
        },
      },
    },

    MuiInputBase: {
      styleOverrides: {
        root: {
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: '0.875rem',
          borderRadius: '0 !important',
        },
      },
    },

    MuiLinearProgress: {
      styleOverrides: {
        root: { backgroundColor: T.rule, borderRadius: 0, height: 3 },
        bar:  { borderRadius: 0 },
      },
    },

    MuiCircularProgress: {
      styleOverrides: { root: { color: T.amber } },
    },

    MuiTooltip: {
      styleOverrides: {
        tooltip: {
          backgroundColor: T.surface,
          border: `1px solid ${T.rule2}`,
          color: T.text,
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: '0.75rem',
          borderRadius: 0,
          padding: '6px 10px',
        },
        arrow: { color: T.rule2 },
      },
    },

    MuiAccordion: {
      defaultProps: { elevation: 0, disableGutters: true },
      styleOverrides: {
        root: {
          background: 'transparent',
          border: `1px solid ${T.rule}`,
          borderRadius: '0 !important',
          '&::before': { display: 'none' },
          '&.Mui-expanded': { margin: 0 },
        },
      },
    },

    MuiAccordionSummary: {
      styleOverrides: {
        root: {
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontWeight: 700,
          fontSize: '0.875rem',
          letterSpacing: '0.04em',
          minHeight: 48,
          '&.Mui-expanded': { minHeight: 48 },
        },
        expandIconWrapper: { color: T.text2 },
      },
    },

    MuiTabs: {
      styleOverrides: {
        root: { borderBottom: `1px solid ${T.rule}` },
        indicator: { backgroundColor: T.amber, height: 2 },
      },
    },

    MuiTab: {
      styleOverrides: {
        root: {
          fontFamily: "'IBM Plex Sans Condensed', sans-serif",
          fontWeight: 700,
          fontSize: '0.8125rem',
          letterSpacing: '0.08em',
          textTransform: 'uppercase' as const,
          color: T.text2,
          minHeight: 44,
          '&.Mui-selected': { color: T.text },
        },
      },
    },

    MuiAlert: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          fontFamily: "'IBM Plex Sans', sans-serif",
          fontSize: '0.875rem',
          border: `1px solid`,
        },
        standardSuccess: { background: `${T.green}10`, borderColor: `${T.green}30`, color: T.text },
        standardError:   { background: `${T.red}10`,   borderColor: `${T.red}30`,   color: T.text },
        standardWarning: { background: `${T.amber}10`, borderColor: `${T.amber}30`, color: T.text },
        standardInfo:    { background: `${T.blue}10`,  borderColor: `${T.blue}30`,  color: T.text },
      },
    },
  },
})

// ── Highcharts theme ──────────────────────────────────────────────────────────
export const hcTheme = {
  chart: {
    backgroundColor: 'transparent',
    style: { fontFamily: "'IBM Plex Sans', sans-serif" },
    plotBorderColor: T.rule,
  },
  colors: [T.amber, T.blue, T.green, T.red, T.purple, T.teal, T.orange],
  title: {
    style: { color: T.text, fontWeight: '700', fontSize: '12px', fontFamily: "'IBM Plex Sans Condensed', sans-serif" },
  },
  subtitle: { style: { color: T.text2, fontSize: '11px' } },
  xAxis: {
    lineColor:     T.rule,
    tickColor:     T.rule,
    gridLineColor: T.rule,
    gridLineWidth: 1,
    labels: { style: { color: T.text2, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } },
  },
  yAxis: {
    lineColor:     T.rule,
    tickColor:     T.rule,
    gridLineColor: T.rule,
    gridLineWidth: 1,
    labels: { style: { color: T.text2, fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px' } },
    title:  { style: { color: T.text2, fontFamily: "'IBM Plex Sans Condensed', sans-serif" } },
  },
  tooltip: {
    backgroundColor: T.surface,
    borderColor: T.amber,
    borderWidth: 1,
    shadow: false,
    style: { color: T.text, fontFamily: "'IBM Plex Sans', sans-serif", fontSize: '12px' },
  },
  legend: {
    itemStyle: {
      color: T.text2, fontWeight: '600', fontSize: '11px',
      fontFamily: "'IBM Plex Sans Condensed', sans-serif",
    },
    itemHoverStyle: { color: T.text },
  },
  plotOptions: {
    series: {
      dataLabels: {
        style: { textOutline: 'none', fontFamily: "'IBM Plex Mono', monospace", fontSize: '11px', fontWeight: '600' },
      },
    },
    candlestick: {
      color: T.red,
      upColor: T.green,
      lineColor: T.red,
      upLineColor: T.green,
    },
  },
  credits: { enabled: false },
  navigation: { buttonOptions: { enabled: false } },
}
