import { expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { CardNamePrompt } from './CardNamePrompt'
import type { CardNamePromptView } from '@engine/state/gre-state'

const view: CardNamePromptView = {
  kind: 'cardNameInput',
  interactionKey: 3,
  message: 'Choose a card name',
  value: '',
  validationError: '',
  canSubmit: false,
}

test('card-name input has a visible label and an explicit disabled empty commitment', () => {
  const html = renderToStaticMarkup(
    <CardNamePrompt view={view} controls={{ edit: () => true, submit: async () => true }} />,
  )
  expect(html).toContain('<label>Card name<input')
  expect(html).toContain('type="submit"')
  expect(html).toContain('disabled=""')
  expect(html).toContain('Name card')
})

test('validation feedback is visible and read-only input is disabled', () => {
  const html = renderToStaticMarkup(
    <CardNamePrompt
      view={{ ...view, validationError: 'Enter a valid card name allowed by this effect.' }}
      controls={null}
    />,
  )
  expect(html).toContain('role="alert"')
  expect(html).toContain('aria-invalid="true"')
  expect(html).toContain('Enter a valid card name')
  expect(html).toContain('disabled=""')
})
