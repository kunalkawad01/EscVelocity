/**
 * MaterialTable — virtualised, theme-aware, generic data table.
 *
 * Only renders rows inside the visible viewport (+ overscan), so 500+ row
 * datasets feel instant. Sort and search run via useMemo — no re-renders
 * unless data or sort state actually change.
 */
import React, {
  useCallback,
  useMemo,
  useRef,
  useState,
  useEffect,
} from 'react'
import {
  Box,
  Typography,
  OutlinedInput,
  Skeleton,
  Tooltip,
} from '@mui/material'
import { usePalette, useTokens } from '../hooks/usePalette'

// ─── Public types ──────────────────────────────────────────────────────────────

export interface ColDef<T extends Record<string, unknown>> {
  field: keyof T & string
  headerName: string
  width?: number
  flex?: number
  align?: 'left' | 'right' | 'center'
  renderCell?: (value: T[keyof T], row: T) => React.ReactNode
  sortable?: boolean
  filterable?: boolean
  type?: 'string' | 'number' | 'date'
  mono?: boolean
}

export interface MaterialTableProps<T extends Record<string, unknown>> {
  columns: ColDef<T>[]
  rows: T[]
  loading?: boolean
  height?: number | string
  rowHeight?: number
  searchable?: boolean
  exportable?: boolean
  stickyHeader?: boolean
  onRowClick?: (row: T) => void
  emptyMessage?: string
  getRowId?: (row: T) => string | number
}

// ─── Internal types ────────────────────────────────────────────────────────────

type SortDir = 'asc' | 'desc' | 'none'

interface SortState {
  field: string | null
  dir: SortDir
}

// ─── Constants ─────────────────────────────────────────────────────────────────

const OVERSCAN      = 4
const SKELETON_ROWS = 5

// ─── Helpers ───────────────────────────────────────────────────────────────────

function exportCsv<T extends Record<string, unknown>>(
  columns: ColDef<T>[],
  rows: T[],
) {
  const headers = columns.map(c => c.headerName).join(',')
  const body = rows
    .map(r =>
      columns
        .map(c => {
          const v = r[c.field]
          const s = v == null ? '' : String(v)
          return s.includes(',') ? `"${s}"` : s
        })
        .join(','),
    )
    .join('\n')
  const blob = new Blob([`${headers}\n${body}`], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href     = url
  a.download = 'export.csv'
  a.click()
  URL.revokeObjectURL(url)
}

function compareValues(
  a: unknown,
  b: unknown,
  type: 'string' | 'number' | 'date' | undefined,
): number {
  if (a == null && b == null) return 0
  if (a == null) return -1
  if (b == null) return 1
  if (type === 'number') return (a as number) - (b as number)
  return String(a).localeCompare(String(b))
}

// ─── SortIcon ─────────────────────────────────────────────────────────────────

function SortIcon({ dir }: { dir: SortDir }) {
  if (dir === 'none') return <span style={{ opacity: 0.3, fontSize: '0.6rem', marginLeft: 3 }}>⇅</span>
  return (
    <span style={{ fontSize: '0.65rem', marginLeft: 3 }}>
      {dir === 'asc' ? '▲' : '▼'}
    </span>
  )
}

// ─── Main component ────────────────────────────────────────────────────────────

function MaterialTableInner<T extends Record<string, unknown>>(
  props: MaterialTableProps<T>,
  _ref: React.Ref<HTMLDivElement>,
) {
  const {
    columns,
    rows,
    loading = false,
    height = 420,
    rowHeight = 36,
    searchable = true,
    exportable = false,
    onRowClick,
    emptyMessage = 'No data',
    getRowId,
  } = props

  const { INK, INK2, INK3, BORDER, PAPER, PAPER2, CYAN } = usePalette()
  const { TH, TD, INPUT_SX }                              = useTokens()

  // ── Sort state ──────────────────────────────────────────────────────────────
  const [sort, setSort] = useState<SortState>({ field: null, dir: 'none' })

  const cycleSort = useCallback(
    (field: string) => {
      setSort(prev => {
        if (prev.field !== field) return { field, dir: 'asc' }
        if (prev.dir === 'asc')  return { field, dir: 'desc' }
        return { field: null, dir: 'none' }
      })
    },
    [],
  )

  // ── Search state (debounced) ─────────────────────────────────────────────────
  const [rawSearch, setRawSearch] = useState('')
  const [search, setSearch]       = useState('')
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => setSearch(rawSearch), 300)
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current) }
  }, [rawSearch])

  // ── Filter + sort (memoised) ─────────────────────────────────────────────────
  const processed = useMemo(() => {
    const filterableCols = columns.filter(c => c.filterable !== false)
    const term = search.toLowerCase().trim()

    let result = term
      ? rows.filter(r =>
          filterableCols.some(c => {
            const v = r[c.field]
            return v != null && String(v).toLowerCase().includes(term)
          }),
        )
      : rows

    if (sort.field && sort.dir !== 'none') {
      const col = columns.find(c => c.field === sort.field)
      const dir = sort.dir === 'asc' ? 1 : -1
      result = [...result].sort(
        (a, b) => dir * compareValues(a[sort.field!], b[sort.field!], col?.type),
      )
    }

    return result
  }, [rows, search, sort, columns])

  // ── Virtualisation ───────────────────────────────────────────────────────────
  const containerRef  = useRef<HTMLDivElement>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const containerH = typeof height === 'number' ? height : 420

  const THEAD_H   = 38
  const scrollableH = containerH - THEAD_H

  const onScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollTop((e.currentTarget as HTMLDivElement).scrollTop)
  }, [])

  const totalRows   = processed.length
  const totalH      = totalRows * rowHeight
  const startIdx    = Math.max(0, Math.floor(scrollTop / rowHeight) - OVERSCAN)
  const visibleCount = Math.ceil(scrollableH / rowHeight) + OVERSCAN * 2
  const endIdx      = Math.min(totalRows - 1, startIdx + visibleCount)
  const topPad      = startIdx * rowHeight
  const bottomPad   = Math.max(0, (totalRows - 1 - endIdx) * rowHeight)
  const visibleRows = processed.slice(startIdx, endIdx + 1)

  // ── Derived styles ───────────────────────────────────────────────────────────
  const MONO = "'IBM Plex Mono', monospace"
  const SANS = "'IBM Plex Sans', sans-serif"

  const colWidths = useMemo(
    () =>
      columns.map(c => {
        if (c.width) return `${c.width}px`
        if (c.flex)  return `${c.flex}fr`
        return 'auto'
      }),
    [columns],
  )

  const gridTemplate = colWidths.join(' ')

  // ─── Render ──────────────────────────────────────────────────────────────────

  return (
    <Box
      ref={_ref}
      sx={{
        border: `1px solid ${BORDER}`,
        borderRadius: '12px',
        overflow: 'hidden',
        bgcolor: PAPER,
      }}
    >
      {/* Toolbar */}
      {(searchable || exportable) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            bgcolor: PAPER2,
            borderBottom: `1px solid ${BORDER}`,
          }}
        >
          {searchable && (
            <OutlinedInput
              size="small"
              placeholder="Search…"
              value={rawSearch}
              onChange={e => setRawSearch(e.target.value)}
              sx={{ ...INPUT_SX, width: 160, bgcolor: PAPER, height: 28, fontSize: '0.72rem' }}
            />
          )}
          <Typography
            sx={{ fontSize: '0.62rem', color: INK3, fontFamily: SANS, ml: 'auto' }}
          >
            {totalRows} / {rows.length}
          </Typography>
          {exportable && (
            <Tooltip title="Export CSV">
              <Box
                component="button"
                onClick={() => exportCsv(columns, processed)}
                sx={{
                  px: 1.25, py: 0.25, borderRadius: '6px', fontSize: '0.65rem',
                  cursor: 'pointer', border: `1px solid ${BORDER}`,
                  bgcolor: 'transparent', color: INK2, fontFamily: SANS,
                  '&:hover': { color: CYAN, borderColor: CYAN },
                  transition: 'all 0.12s',
                }}
              >
                ↓ CSV
              </Box>
            </Tooltip>
          )}
        </Box>
      )}

      {/* Header */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: gridTemplate,
          bgcolor: PAPER2,
          borderBottom: `1px solid ${BORDER}`,
          position: 'sticky',
          top: 0,
          zIndex: 2,
        }}
      >
        {columns.map(col => {
          const sortable = col.sortable !== false
          const isActive = sort.field === col.field
          return (
            <Box
              key={col.field}
              onClick={() => sortable && cycleSort(col.field)}
              sx={{
                ...TH,
                display: 'flex',
                alignItems: 'center',
                textAlign: col.align ?? 'left',
                justifyContent:
                  col.align === 'right'
                    ? 'flex-end'
                    : col.align === 'center'
                    ? 'center'
                    : 'flex-start',
                cursor: sortable ? 'pointer' : 'default',
                userSelect: 'none',
                color: isActive ? CYAN : TH.color,
                transition: 'color 0.12s',
                '&:hover': sortable ? { color: INK2 } : {},
              }}
            >
              {col.headerName}
              {sortable && (
                <SortIcon dir={isActive ? sort.dir : 'none'} />
              )}
            </Box>
          )
        })}
      </Box>

      {/* Body — scrollable container */}
      <Box
        ref={containerRef}
        onScroll={onScroll}
        sx={{
          height: scrollableH,
          overflowY: 'auto',
          overflowX: 'auto',
          position: 'relative',
        }}
      >
        {loading ? (
          /* Skeleton rows */
          Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <Box
              key={i}
              sx={{
                display: 'grid',
                gridTemplateColumns: gridTemplate,
                borderBottom: `1px solid ${BORDER}`,
                height: rowHeight,
              }}
            >
              {columns.map(c => (
                <Box key={c.field} sx={{ px: 1.75, display: 'flex', alignItems: 'center' }}>
                  <Skeleton
                    variant="text"
                    width="70%"
                    height={14}
                    sx={{ bgcolor: `${BORDER}80` }}
                  />
                </Box>
              ))}
            </Box>
          ))
        ) : totalRows === 0 ? (
          <Box
            sx={{
              height: scrollableH,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Typography sx={{ fontSize: '0.78rem', color: INK3, fontFamily: SANS }}>
              {emptyMessage}
            </Typography>
          </Box>
        ) : (
          /* Virtual scroll content */
          <Box sx={{ height: totalH, position: 'relative' }}>
            {/* Top spacer */}
            <Box sx={{ height: topPad }} />

            {/* Visible rows */}
            {visibleRows.map((row, localIdx) => {
              const globalIdx = startIdx + localIdx
              const rowKey = getRowId
                ? getRowId(row)
                : (row['id'] as string | number | undefined) ?? globalIdx

              return (
                <Box
                  key={rowKey}
                  onClick={() => onRowClick?.(row)}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: gridTemplate,
                    height: rowHeight,
                    borderBottom: `1px solid ${BORDER}`,
                    bgcolor: PAPER,
                    cursor: onRowClick ? 'pointer' : 'default',
                    '&:hover': onRowClick
                      ? { bgcolor: `${CYAN}08` }
                      : { bgcolor: `${BORDER}40` },
                    transition: 'background-color 0.1s',
                  }}
                >
                  {columns.map(col => {
                    const rawVal = row[col.field]
                    const align  = col.align ?? 'left'
                    return (
                      <Box
                        key={col.field}
                        sx={{
                          ...TD,
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent:
                            align === 'right'
                              ? 'flex-end'
                              : align === 'center'
                              ? 'center'
                              : 'flex-start',
                          overflow: 'hidden',
                          whiteSpace: 'nowrap',
                          fontFamily: col.mono ? MONO : SANS,
                        }}
                      >
                        {col.renderCell
                          ? col.renderCell(rawVal, row)
                          : (
                            <Typography
                              component="span"
                              sx={{
                                fontSize: '0.78rem',
                                color: INK2,
                                fontFamily: col.mono ? MONO : SANS,
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                              }}
                            >
                              {rawVal == null ? '—' : String(rawVal)}
                            </Typography>
                          )}
                      </Box>
                    )
                  })}
                </Box>
              )
            })}

            {/* Bottom spacer */}
            <Box sx={{ height: bottomPad }} />
          </Box>
        )}
      </Box>
    </Box>
  )
}

// Forward ref wrapper to preserve generic type parameter
const MaterialTable = React.forwardRef(MaterialTableInner) as <
  T extends Record<string, unknown>,
>(
  props: MaterialTableProps<T> & { ref?: React.Ref<HTMLDivElement> },
) => React.ReactElement

export default MaterialTable
