import { type GreStore, greStore } from '@engine/runtime/gre-store'
import { enumValue } from '@engine/wire/gre-proto'
import { fullControlOf, stopsOf, STOP_TYPES, yieldingOf, type StepKey } from './priority-policy'

export type PriorityUiState = {
  stops: Set<StepKey>
  fullControl: boolean
  passing: boolean
}

/** Translates player controls into runtime settings; the engine owns progression. */
export class PriorityController {
  private readonly store: GreStore
  private fullControlIntent = false
  private restoreAfterYield = false
  private yieldAcknowledged = false
  private requestedFullControl: boolean | null = null
  private matchId: string

  constructor(store: GreStore = greStore) {
    this.store = store
    this.matchId = store.currentMatchId
    this.store.subscribe(() => this.reconcileFullControl())
    this.reconcileFullControl()
  }

  uiSnapshot(): PriorityUiState {
    return {
      stops: stopsOf(this.store.prioritySettings),
      fullControl: this.fullControlIntent,
      passing: this.passing,
    }
  }

  subscribe(listener: () => void): () => void {
    return this.store.subscribe(listener)
  }

  get passing(): boolean {
    return yieldingOf(this.store.prioritySettings)
  }

  async toggleStop(key: StepKey): Promise<void> {
    const generation = this.store.sessionGeneration
    const [scope, step] = key.split(':')
    const stopType = step && STOP_TYPES[step]
    if (!stopType || (scope !== 'self' && scope !== 'opponent')) {
      return
    }
    await this.store.setPrioritySettings(
      {
        transientStops: [
          {
            stopType: await enumValue('StopType', stopType),
            appliesTo: await enumValue(
              'SettingScope',
              scope === 'self' ? 'Team_ac6e' : 'Opponents',
            ),
            status: await enumValue(
              'SettingStatus',
              stopsOf(this.store.prioritySettings).has(key) ? 'Clear_a3fe' : 'Set',
            ),
          },
        ],
      },
      generation,
    )
  }

  async setFullControl(enabled: boolean): Promise<void> {
    const generation = this.store.sessionGeneration
    this.fullControlIntent = enabled
    this.restoreAfterYield = false
    this.yieldAcknowledged = false
    this.requestedFullControl = enabled
    const sent = await this.store.setPrioritySettings(
      {
        autoPassOption: await enumValue('AutoPassOption', enabled ? 'FullControl' : 'Clear_a465'),
        stackAutoPassOption: await enumValue('AutoPassOption', 'Clear_a465'),
      },
      generation,
    )
    if (!sent && this.requestedFullControl === enabled) {
      this.requestedFullControl = null
      this.fullControlIntent = fullControlOf(this.store.prioritySettings)
    }
  }

  async cancelYield(): Promise<void> {
    if (this.fullControlIntent) {
      await this.setFullControl(true)
      return
    }
    const generation = this.store.sessionGeneration
    const clear = await enumValue('AutoPassOption', 'Clear_a465')
    await this.store.setPrioritySettings(
      { autoPassOption: clear, stackAutoPassOption: clear },
      generation,
    )
  }

  async passToEndOfTurn(): Promise<void> {
    this.rememberFullControlAcrossYield()
    const generation = this.store.sessionGeneration
    const sent = await this.store.setPrioritySettings(
      {
        autoPassOption: await enumValue('AutoPassOption', 'UnlessOpponentAction'),
        stackAutoPassOption: await enumValue('AutoPassOption', 'Clear_a465'),
      },
      generation,
    )
    if (sent) {
      await this.store.passPriority(generation)
    }
  }

  async resolveAll(): Promise<void> {
    this.rememberFullControlAcrossYield()
    const generation = this.store.sessionGeneration
    const sent = await this.store.setPrioritySettings(
      {
        autoPassOption: await enumValue('AutoPassOption', 'Clear_a465'),
        stackAutoPassOption: await enumValue('AutoPassOption', 'ResolveAll'),
      },
      generation,
    )
    if (sent) {
      await this.store.passPriority(generation)
    }
  }

  private rememberFullControlAcrossYield(): void {
    if (!this.fullControlIntent && !fullControlOf(this.store.prioritySettings)) {
      return
    }
    this.fullControlIntent = true
    this.restoreAfterYield = true
    this.yieldAcknowledged = false
    this.requestedFullControl = null
  }

  private reconcileFullControl(): void {
    if (this.matchId !== this.store.currentMatchId) {
      this.matchId = this.store.currentMatchId
      this.fullControlIntent = false
      this.restoreAfterYield = false
      this.yieldAcknowledged = false
      this.requestedFullControl = null
    }
    if (Object.keys(this.store.prioritySettings).length === 0) {
      return
    }
    const acknowledged = fullControlOf(this.store.prioritySettings)
    if (this.requestedFullControl != null) {
      if (acknowledged === this.requestedFullControl) {
        this.requestedFullControl = null
      } else {
        return
      }
    }
    if (!this.restoreAfterYield) {
      this.fullControlIntent = acknowledged
      return
    }
    if (yieldingOf(this.store.prioritySettings)) {
      this.yieldAcknowledged = true
      return
    }
    if (!this.yieldAcknowledged) {
      return
    }
    this.restoreAfterYield = false
    this.yieldAcknowledged = false
    if (!acknowledged) {
      void this.setFullControl(true)
    }
  }
}

export const priority = new PriorityController()
