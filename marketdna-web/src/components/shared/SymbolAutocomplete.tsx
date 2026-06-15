import { Autocomplete, TextField } from '@mui/material'
import { usePalette } from '../../hooks/usePalette'
import { useSymbols } from '../../hooks/useSymbols'

interface Props {
  value: string
  onChange: (v: string) => void
  /** Pass a pre-fetched list to share it; omit to fetch internally */
  symbols?: string[]
  minWidth?: number | string
  height?: number
  fontSize?: string
}

export default function SymbolAutocomplete({
  value,
  onChange,
  symbols: propSymbols,
  minWidth = 150,
  height = 32,
  fontSize = '0.78rem',
}: Props) {
  const fetched = useSymbols()
  const options = propSymbols ?? fetched
  const { CYAN, BORDER, PAPER2, INK, INK3 } = usePalette()

  return (
    <Autocomplete
      value={value || null}
      onChange={(_, v) => v && onChange(v)}
      options={options}
      filterOptions={(opts, { inputValue }) => {
        const q = inputValue.trim().toUpperCase()
        if (!q) return opts.slice(0, 200)
        const starts = opts.filter(o => o.startsWith(q))
        const contains = opts.filter(o => !o.startsWith(q) && o.includes(q))
        return [...starts, ...contains].slice(0, 150)
      }}
      disableClearable
      autoHighlight
      selectOnFocus
      sx={{ minWidth, flexShrink: 0 }}
      slotProps={{
        paper: {
          sx: {
            bgcolor: PAPER2,
            border: `1px solid ${BORDER}`,
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          },
        },
        listbox: {
          sx: {
            '& .MuiAutocomplete-option': {
              fontSize: '0.72rem',
              fontFamily: "'IBM Plex Mono', monospace",
              color: INK,
              minHeight: 32,
              py: '4px',
            },
            '& .MuiAutocomplete-option.Mui-focused': {
              bgcolor: `${CYAN}18`,
            },
          },
        },
      }}
      renderInput={(params) => (
        <TextField
          {...params}
          size="small"
          sx={{
            '& .MuiOutlinedInput-root': {
              fontSize,
              fontFamily: "'IBM Plex Mono', monospace",
              color: INK,
              height,
              pr: '28px !important',
              '& .MuiOutlinedInput-notchedOutline': { borderColor: BORDER },
              '&:hover .MuiOutlinedInput-notchedOutline': { borderColor: CYAN },
              '&.Mui-focused .MuiOutlinedInput-notchedOutline': {
                borderColor: CYAN,
                boxShadow: `0 0 0 2px ${CYAN}22`,
              },
              '& input': {
                color: INK,
                fontFamily: "'IBM Plex Mono', monospace",
                padding: '4px 8px',
                '&::placeholder': { color: INK3, opacity: 1 },
              },
            },
            '& .MuiAutocomplete-endAdornment .MuiSvgIcon-root': {
              color: INK3,
              fontSize: '1rem',
            },
          }}
        />
      )}
    />
  )
}
