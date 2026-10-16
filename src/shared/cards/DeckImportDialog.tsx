/** Owns import validation until the caller commits the resolved deck. */

import { useEffect, useRef, useState } from 'react'
import { trackDeckPaste } from '@shared/analytics'
import { parseManaSymbols } from '@shared/cards/mana'
import {
  formatDecklist,
  parseDecklist,
  selectCommanders,
  validateDecklist,
} from '@shared/cards/parse-decklist'
import { type DecklistCard, type ParseDecklistResponse } from '@shared/api/contracts'
import { Button } from '@shared/ui/Button'
import { SelectField, TextArea, TextField } from '@shared/ui/Field'
import { Modal } from '@shared/ui/Modal'
import styles from './DeckImportDialog.module.css'

export interface ImportedDeck {
  name: string
  deck: ParseDecklistResponse
}

export function DeckImportDialog({
  format,
  destination,
  onClose,
  onImport,
}: {
  format?: 'Commander' | 'Timeless'
  destination: 'editor' | 'play'
  onClose: () => void
  onImport: (data: ImportedDeck) => void | Promise<void>
}) {
  const [deckText, setDeckText] = useState('')
  const [deckName, setDeckName] = useState('')
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState(false)
  const [mainboard, setMainboard] = useState<DecklistCard[]>([])
  const [sideboard, setSideboard] = useState<DecklistCard[]>([])
  const [commandZone, setCommandZone] = useState<DecklistCard[]>([])
  const [errors, setErrors] = useState<string[]>([])
  const [commanderIndex, setCommanderIndex] = useState('')
  const [partnerIndex, setPartnerIndex] = useState('')
  const requestVersion = useRef(0)
  const [saving, setSaving] = useState(false)

  useEffect(
    () => () => {
      requestVersion.current += 1
    },
    [],
  )

  function invalidateRequest(): void {
    requestVersion.current += 1
    setParsing(false)
    setErrors([])
  }

  async function handleParse(): Promise<void> {
    if (!deckText.trim()) {
      return
    }
    const version = ++requestVersion.current
    setParsing(true)
    setErrors([])
    try {
      const result = await parseDecklist(deckText)
      if (version !== requestVersion.current) {
        return
      }
      if (result.ok) {
        setMainboard(result.deck.mainboard)
        setSideboard(result.deck.sideboard)
        setCommandZone(result.deck.commandZone)
        setCommanderIndex('')
        setPartnerIndex('')
        setParsed(true)
      } else {
        setErrors(result.errors)
      }
    } finally {
      if (version === requestVersion.current) {
        setParsing(false)
      }
    }
  }

  async function handleImport(): Promise<void> {
    const selected =
      commandZone.length || commanderIndex === ''
        ? { mainboard, sideboard, commandZone }
        : selectCommanders(
            { mainboard, sideboard, commandZone },
            [commanderIndex, partnerIndex].filter((index) => index !== '').map(Number),
          )
    const version = ++requestVersion.current
    setParsing(true)
    setErrors([])
    try {
      if (format) {
        const mainCount = selected.mainboard.reduce((total, card) => total + card.quantity, 0)
        const commandCount = selected.commandZone.reduce((total, card) => total + card.quantity, 0)
        if (format === 'Commander' && !commandCount) {
          setErrors(['Choose a commander for this deck.'])
          return
        }
        if (format === 'Timeless' && commandCount) {
          setErrors(['Choose Commander to import a deck with a commander.'])
          return
        }
        if (format === 'Commander' ? mainCount + commandCount !== 100 : mainCount < 60) {
          setErrors([
            format === 'Commander'
              ? 'Commander decks need 100 cards including the commanders.'
              : 'Constructed decks need at least 60 main-deck cards. Sideboard cards do not count.',
          ])
          return
        }
      }
      const validation = await validateDecklist(formatDecklist(selected))
      if (version !== requestVersion.current) {
        return
      }
      if (!validation.ok) {
        setErrors(validation.errors)
        return
      }
      trackDeckPaste({
        cardCount: [...selected.mainboard, ...selected.sideboard, ...selected.commandZone].reduce(
          (total, card) => total + card.quantity,
          0,
        ),
        inputLength: deckText.length,
        lineCount: deckText.split('\n').filter((line) => line.trim()).length,
      })
      setSaving(true)
      await onImport({ name: deckName.trim() || 'Imported deck', deck: selected })
    } catch (cause) {
      if (version === requestVersion.current) {
        setErrors([
          cause instanceof Error ? cause.message : 'Could not import your deck. Try again.',
        ])
      }
    } finally {
      setSaving(false)
      if (version === requestVersion.current) {
        setParsing(false)
      }
    }
  }

  function reset(): void {
    invalidateRequest()
    setDeckText('')
    setDeckName('')
    setParsed(false)
    setMainboard([])
    setSideboard([])
    setCommandZone([])
    setErrors([])
    setCommanderIndex('')
    setPartnerIndex('')
  }

  function handleClose(): void {
    if (saving) {
      return
    }
    reset()
    onClose()
  }

  return (
    <Modal
      open
      onClose={handleClose}
      title={
        format === 'Commander'
          ? 'Import Commander deck'
          : format === 'Timeless'
            ? 'Import Constructed deck'
            : 'Import a deck'
      }
      maxWidth="640px"
    >
      <div className={styles.importDialog}>
        <p>
          Paste your deck list. Include a [Commander] section or choose a commander after checking
          it.
        </p>

        {!parsed ? (
          <>
            <label>
              Deck list
              <TextArea
                className={styles.importTextarea}
                placeholder={'[Deck]\n4 Llanowar Elves\n4 Giant Growth\n…\n\n[Sideboard]\n2 Negate'}
                value={deckText}
                disabled={parsing}
                onChange={(e) => {
                  invalidateRequest()
                  setDeckText(e.currentTarget.value)
                }}
                rows={7}
              />
            </label>
            <details className={styles.formatHelp}>
              <summary>Supported formats</summary>
              <pre>
                {
                  '1 Card Name\n1x Card Name (SET) 18a\nDeck / Sideboard / Commander\n[Deck] / [Sideboard] / [Commander]'
                }
              </pre>
            </details>

            {errors.length > 0 && (
              <div className={styles.importErrors} role="alert">
                {errors.map((err, i) => (
                  <div key={i} className={styles.errorLine}>
                    {err}
                  </div>
                ))}
              </div>
            )}

            <div className={styles.importActions}>
              <Button
                size="compact"
                onClick={() => void handleParse()}
                disabled={parsing || !deckText.trim()}
              >
                {parsing ? 'Checking deck…' : 'Check deck'}
              </Button>
            </div>
          </>
        ) : (
          <>
            <label>
              Deck name
              <TextField
                type="text"
                placeholder="Deck name..."
                value={deckName}
                disabled={parsing}
                onChange={(e) => {
                  invalidateRequest()
                  setDeckName(e.currentTarget.value)
                }}
              />
            </label>

            {commandZone.length > 0 && (
              <p>Commander: {commandZone.map((c) => c.card.name).join(' / ')}</p>
            )}
            {commandZone.length === 0 && format !== 'Timeless' && (
              <label>
                {format === 'Commander' ? 'Choose commander' : 'Commander (optional)'}
                <SelectField
                  disabled={parsing}
                  value={commanderIndex}
                  onChange={(e) => {
                    invalidateRequest()
                    setCommanderIndex(e.target.value)
                    setPartnerIndex('')
                  }}
                >
                  <option value="">No commander</option>
                  {mainboard.map((card, index) => (
                    <option key={`${card.grpId}-${index}`} value={index}>
                      {card.card.name}
                    </option>
                  ))}
                </SelectField>
              </label>
            )}
            {commandZone.length === 0 && format !== 'Timeless' && commanderIndex !== '' && (
              <label>
                Second commander (optional)
                <SelectField
                  disabled={parsing}
                  value={partnerIndex}
                  onChange={(e) => {
                    invalidateRequest()
                    setPartnerIndex(e.target.value)
                  }}
                >
                  <option value="">No second commander</option>
                  {mainboard.map((card, index) =>
                    index === Number(commanderIndex) ? null : (
                      <option key={`${card.grpId}-${index}`} value={index}>
                        {card.card.name}
                      </option>
                    ),
                  )}
                </SelectField>
                Choose a compatible Partner, Background, or Doctor's companion.
              </label>
            )}
            {errors.length > 0 && (
              <div className={styles.importErrors} role="alert">
                {errors.map((err, i) => (
                  <div key={i} className={styles.errorLine}>
                    {err}
                  </div>
                ))}
              </div>
            )}
            <div className={styles.parsedList}>
              <div className={styles.parsedSection}>
                <div className={styles.sectionHeader}>
                  Mainboard ({mainboard.reduce((s, c) => s + c.quantity, 0)})
                </div>
                {mainboard.map((c, i) => (
                  <div key={i} className={styles.parsedCard}>
                    <span className={styles.cardQty}>{c.quantity}x</span>
                    <span className={styles.cardName}>{c.card.name}</span>
                    {c.card.manaCost && (
                      <span className={styles.cardMana}>
                        {parseManaSymbols(c.card.manaCost).map((sym, j) => (
                          <i key={j} className={sym.classes} title={sym.label} />
                        ))}
                      </span>
                    )}
                  </div>
                ))}
              </div>

              {sideboard.length > 0 && (
                <div className={styles.parsedSection}>
                  <div className={styles.sectionHeader}>
                    Sideboard ({sideboard.reduce((s, c) => s + c.quantity, 0)})
                  </div>
                  {sideboard.map((c, i) => (
                    <div key={i} className={styles.parsedCard}>
                      <span className={styles.cardQty}>{c.quantity}x</span>
                      <span className={styles.cardName}>{c.card.name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className={styles.importActions}>
              <Button size="compact" onClick={() => void handleImport()} disabled={parsing}>
                {destination === 'editor' ? 'Open in Editor' : 'Import and select'}
              </Button>
              <Button variant="secondary" size="compact" onClick={reset} disabled={saving}>
                Back
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
