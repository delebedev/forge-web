import type { CardMeta, CardView, GameObject } from './gre-state'

/** Emblem identity belongs to the object; display metadata belongs to its creator. */
export function emblemCardView(object: GameObject, cardMeta: Map<number, CardMeta>): CardView {
  const source = cardMeta.get(object.objectSourceGrpId ?? 0)
  const rulesText =
    object.uniqueAbilities
      ?.map((ability) => source?.abilities?.[ability.grpId]?.text)
      .filter(Boolean)
      .join('\n') ?? ''
  return {
    instanceId: object.instanceId,
    grpId: object.grpId ?? 0,
    objectType: object.type,
    name: source?.name ?? 'Emblem',
    typeLine: 'Emblem',
    manaCost: '',
    powerToughness: '',
    rulesText,
    imageUrl: source?.imageUrl ?? '',
    tapped: false,
    attacking: false,
    playableLand: false,
    playableSpell: false,
    playableActivation: false,
    controllerSeatId: object.controllerSeatId ?? object.ownerSeatId ?? 0,
  }
}
