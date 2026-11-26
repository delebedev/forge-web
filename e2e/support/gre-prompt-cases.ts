import type { loadAcceptanceSuite } from './gre-acceptance'

/** Partition existing journeys by their family-owned player action. */
export function isFamilyPromptScenario(
  scenario: ReturnType<typeof loadAcceptanceSuite>['scenarios'][number],
): boolean {
  return scenario.steps.some((step) =>
    ['group_keep', 'search_cards', 'order_cards', 'distribute', 'optional_action'].some(
      (action) => action in step,
    ),
  )
}
