export function phaseShort(label: string): string {
  const normalized = label.toLowerCase()
  if (normalized.includes('untap')) {
    return 'UN'
  }
  if (normalized.includes('upkeep')) {
    return 'UP'
  }
  if (normalized.includes('draw')) {
    return 'DR'
  }
  if (normalized.includes('main1')) {
    return 'M1'
  }
  if (normalized.includes('combat')) {
    return 'CB'
  }
  if (normalized.includes('main2')) {
    return 'M2'
  }
  if (normalized.includes('end')) {
    return 'EN'
  }
  return label.slice(0, 2).toUpperCase()
}

export function phaseStopKey(label: string): string {
  switch (label) {
    case 'Untap':
      return 'untap'
    case 'Upkeep':
      return 'upkeep'
    case 'Draw':
      return 'draw'
    case 'Main1':
      return 'main1'
    case 'Combat':
      return 'begincombat'
    case 'Main2':
      return 'main2'
    case 'End':
      return 'end'
    default:
      return label.toLowerCase()
  }
}

export function phaseIsActive(label: string, phaseName: string, stepName: string): boolean {
  const current = `${phaseName} ${stepName}`.toLowerCase()
  if (label === 'Main1') {
    return current.includes('main1')
  }
  if (label === 'Main2') {
    return current.includes('main2')
  }
  return current.includes(label.toLowerCase())
}
