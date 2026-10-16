import type { Preview } from '@storybook/react-vite'
import isChromatic from 'chromatic/isChromatic'
import { expect } from 'storybook/test'
import '../src/app/app.css'
import '../src/shared/cards/mana.css'
import './preview.css'

const productRequests: string[] = []

const preview: Preview = {
  beforeAll: () => {
    const fetch = window.fetch
    window.fetch = (input, init) => {
      const url = input instanceof Request ? input.url : String(input)
      if (new URL(url, window.location.href).pathname.startsWith('/api/')) {
        productRequests.push(url)
      }
      return fetch.call(window, input, init)
    }
    return () => {
      window.fetch = fetch
    }
  },
  afterEach: async () => {
    await expect(productRequests).toEqual([])
  },
  tags: ['autodocs'],
  globalTypes: {
    castingVariant: {},
    selectionVariant: {},
    numericInputVariant: {},
    cardFaceSize: { description: 'Card size used by Chromatic modes' },
    mechanicHelpDensity: { description: 'Mechanic help density used by Chromatic modes' },
    cardArt: {
      toolbar: {
        icon: 'image',
        title: 'Card art',
        items: [
          { value: 'on', title: 'Show card art' },
          { value: 'off', title: 'Hide card art' },
        ],
      },
    },
  },
  decorators: [
    (Story, context) => (
      <div data-card-art={isChromatic() ? 'off' : context.globals['cardArt']}>
        <Story />
      </div>
    ),
  ],
  parameters: {
    chromatic: { modes: { desktop: { viewport: { width: 1440, height: 900 } } } },
    options: {
      storySort: {
        order: [
          'Gameplay',
          ['Board', 'Draft', 'Actions', 'Decisions', 'Objects', 'Motion', 'Replay', 'Session'],
          'Cards',
          ['Rendering', 'Mechanic help'],
          'Shared UI',
          ['Button', 'Field', 'Modal'],
        ],
      },
    },
    backgrounds: {
      options: {
        game: { name: 'Game', value: '#1b1a19' },
      },
    },
    viewport: {
      options: {
        desktop: { name: 'Desktop', styles: { width: '1440px', height: '900px' }, type: 'desktop' },
        phonePortrait: {
          name: 'Phone portrait',
          styles: { width: '390px', height: '844px' },
          type: 'mobile',
        },
        phoneLandscape: {
          name: 'Phone landscape',
          styles: { width: '844px', height: '390px' },
          type: 'mobile',
        },
      },
    },
  },
  initialGlobals: {
    backgrounds: { value: 'game' },
    viewport: { value: undefined, isRotated: false },
    cardArt: 'on',
  },
}

export default preview
