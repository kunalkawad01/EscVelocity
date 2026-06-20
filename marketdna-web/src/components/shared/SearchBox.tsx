import { OutlinedInput, InputAdornment } from '@mui/material'
import { useTokens } from '../../hooks/usePalette'

interface SearchBoxProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  width?: number | string
}

export default function SearchBox({ value, onChange, placeholder = 'Search…', width = 140 }: SearchBoxProps) {
  const { INPUT_SX, PAPER2 } = useTokens()

  return (
    <OutlinedInput
      size="small"
      value={value}
      placeholder={placeholder}
      onChange={e => onChange(e.target.value)}
      startAdornment={
        <InputAdornment position="start">
          <span style={{ fontSize: '0.7rem', opacity: 0.45, marginRight: -4 }}>⌕</span>
        </InputAdornment>
      }
      sx={{
        ...INPUT_SX,
        width,
        bgcolor: PAPER2,
        '& .MuiInputAdornment-root': { mr: 0.5 },
      }}
    />
  )
}
