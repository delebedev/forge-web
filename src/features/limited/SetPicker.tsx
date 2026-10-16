/**
 * Leaf: choose the set to draft or open sealed packs from. Search-filtered
 * popup with a compact summary of the selected set.
 */

import { useMemo, useState } from 'react'
import type { SealedSet } from '@shared/api/contracts'
import { cx } from '@shared/react/cx'
import { Button } from '@shared/ui/Button'
import { TextField } from '@shared/ui/Field'
import { Modal } from '@shared/ui/Modal'
import styles from './SetPicker.module.css'

const COLOR_CSS: Record<string, string> = {
  W: '#f9faf4',
  U: '#0e68ab',
  B: '#150b00',
  R: '#d3202a',
  G: '#00733e',
}

function pairColors(pair: string): [string, string] {
  return [COLOR_CSS[pair[0]!] ?? '#888', COLOR_CSS[pair[1]!] ?? '#888']
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) {
    return ''
  }
  try {
    const d = new Date(dateStr)
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short' })
  } catch {
    return dateStr
  }
}

export function SetPicker({
  sets,
  selectedCode,
  loading = false,
  onSelect,
}: {
  sets: SealedSet[]
  selectedCode: string
  loading?: boolean
  onSelect: (code: string) => void
}) {
  const [search, setSearch] = useState('')
  const [open, setOpen] = useState(false)
  const selected = sets.find((set) => set.code === selectedCode)

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) {
      return sets
    }
    return sets.filter((s) => s.name.toLowerCase().includes(q) || s.code.toLowerCase().includes(q))
  }, [sets, search])

  if (loading) {
    return <div className={styles.pickerLoading}>Loading sets...</div>
  }

  return (
    <div className={styles.setPicker}>
      <div className={styles.selection}>
        <span className={styles.setCode}>{selected?.code ?? selectedCode}</span>
        <span className={styles.selectionName}>{selected?.name ?? 'Choose a set'}</span>
        {selected?.description && <p className={styles.selectionDesc}>{selected.description}</p>}
        {selected?.cardCount && <span className={styles.setCards}>{selected.cardCount} cards</span>}
      </div>
      <Button
        variant="secondary"
        onClick={() => {
          setSearch('')
          setOpen(true)
        }}
      >
        Change set
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Choose a set" maxWidth="760px">
        <div className={styles.popupContent}>
          <TextField
            aria-label="Search sets"
            className={styles.searchInput}
            type="text"
            placeholder="Search sets..."
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
          />
          <div className={styles.setList}>
            {filtered.map((set) => (
              <button
                key={set.code}
                className={cx(styles.setRow, set.code === selectedCode && styles.selected)}
                type="button"
                aria-pressed={set.code === selectedCode}
                onClick={() => {
                  onSelect(set.code)
                  setOpen(false)
                }}
              >
                <div className={styles.setMain}>
                  <div className={styles.setTopLine}>
                    <span className={styles.setCode}>{set.code}</span>
                    <span className={styles.setName}>{set.name}</span>
                    {set.cardCount && (
                      <span className={styles.setCards}>{set.cardCount} cards</span>
                    )}
                    {set.date && <span className={styles.setDate}>{formatDate(set.date)}</span>}
                  </div>
                  {set.description && <div className={styles.setDesc}>{set.description}</div>}
                </div>
                {set.archetypes && set.archetypes.length > 0 && (
                  <div className={styles.archetypePills}>
                    {set.archetypes.map((arch) => {
                      const [c1, c2] = pairColors(arch.pair)
                      return (
                        <span
                          key={arch.pair}
                          className={styles.archPill}
                          title={`${arch.pair}: ${arch.name} — ${arch.strategy ?? ''}`}
                        >
                          <span className={styles.pip} style={{ background: c1 }} />
                          <span className={styles.pip} style={{ background: c2 }} />
                          <span className={styles.archName}>{arch.name}</span>
                        </span>
                      )
                    })}
                  </div>
                )}
              </button>
            ))}
            {filtered.length === 0 && (
              <div className={styles.noResults}>No sets match "{search}"</div>
            )}
          </div>
        </div>
      </Modal>
    </div>
  )
}
