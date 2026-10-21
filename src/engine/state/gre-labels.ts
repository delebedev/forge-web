export type ViewerResult = 'win' | 'loss' | 'draw' | 'unknown'

export function outcomeTitle(result: ViewerResult, winningTeamId: number): string {
  switch (result) {
    case 'win':
      return 'Victory'
    case 'loss':
      return 'Defeat'
    case 'draw':
      return 'Draw'
    default:
      return winningTeamId > 0 ? `Team ${winningTeamId} wins` : 'Game over'
  }
}

export function outcomeDetail(result: ViewerResult, winningTeamId: number, reason: number): string {
  const reasonText = resultReasonLabel(reason)
  switch (result) {
    case 'win':
      return `You won by ${reasonText}`
    case 'loss':
      return `You lost by ${reasonText}`
    case 'draw':
      return `Draw by ${reasonText}`
    default:
      return winningTeamId > 0
        ? `Team ${winningTeamId} won by ${reasonText}`
        : `Game ended by ${reasonText}`
  }
}

export function greMessageTypeLabel(type: number): string {
  switch (type) {
    case 1:
      return 'GameStateMessage'
    case 2:
      return 'ActionsAvailableReq'
    case 7:
      return 'ConnectResp'
    case 11:
      return 'GroupReq'
    case 15:
      return 'MulliganReq'
    case 17:
      return 'OrderReq'
    case 22:
      return 'SelectNReq'
    case 26:
      return 'DeclareAttackersReq'
    case 27:
      return 'SubmitAttackersResp'
    case 28:
      return 'DeclareBlockersReq'
    case 29:
      return 'SubmitBlockersResp'
    case 30:
      return 'AssignDamageReq'
    case 31:
      return 'AssignDamageConfirmation'
    case 34:
      return 'SelectTargetsReq'
    case 35:
      return 'SubmitTargetsResp'
    case 36:
      return 'PayCostsReq'
    case 37:
      return 'IntermissionReq'
    case 38:
      return 'ChooseStartingPlayerReq'
    case 43:
      return 'NumericInputReq'
    case 58:
      return 'StringInputReq'
    case 44:
      return 'SearchReq'
    case 45:
      return 'OptionalActionMessage'
    case 46:
      return 'CastingTimeOptionsReq'
    case 51:
      return 'QueuedGameStateMessage'
    default:
      return `GRE type ${type}`
  }
}

export function castingOptionLabel(optionType: number): string {
  switch (optionType) {
    case 1:
      return 'Cast without an additional cost'
    case 3:
      return 'Pay kicker'
    case 4:
      return 'Pay multikicker'
    case 5:
      return 'Pay the additional cost'
    case 6:
      return 'Pay the optional cost'
    case 10:
      return 'Choose a mode'
    case 11:
      return 'Choose a cost'
    case 17:
      return 'Bargain'
    case 18:
      return 'Use the paid optional cost'
    default:
      return 'Choose this casting option'
  }
}

export function costChoiceLabel(promptId: number): string {
  switch (promptId) {
    case 1024:
      return 'Discard a card'
    case 1523:
      return 'Sacrifice an artifact'
    case 1029:
      return 'Sacrifice cost'
    case 4275:
      return 'Pay 3 life'
    case 4160:
      return 'Mana cost'
    case 5500:
      return 'Exile graveyard cost'
    case 15008:
      return 'Blight cost'
    default:
      return 'Choose this cost option'
  }
}

export function manaColorLabel(color: number): string {
  return (
    [
      'Mana',
      'White',
      'Blue',
      'Black',
      'Red',
      'Green',
      'Phyrexian',
      'Generic',
      'X',
      'Y',
      'Two generic',
      'Any color',
      'Colorless',
      'Snow',
    ][color] ?? 'Mana'
  )
}

function resultReasonLabel(reason: number): string {
  switch (reason) {
    case 1:
      return 'game action'
    case 2:
      return 'concession'
    case 3:
      return 'timeout'
    case 4:
      return 'loop'
    case 5:
      return 'force result'
    default:
      return 'unknown result'
  }
}
