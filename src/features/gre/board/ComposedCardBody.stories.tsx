import type { Meta, StoryObj } from '@storybook/react-vite'
import type { CardView } from '@engine/state/gre-state'
import { Card } from './Card'
import { ComposedCardBody, cardBodyFromView } from './ComposedCardBody'
import {
  ordinaryViews,
  layoutViews,
  dynamicViews,
  lightningBolt,
  longMulticolorCard,
  textViews,
} from './ComposedCardBody.stories.fixtures'
import './ComposedCardBody.stories.css'

type FaceSize = 'mini' | 'thumbnail' | 'hand' | 'detail' | 'inspection'
type StoryArgs = { size: FaceSize; specimen: keyof typeof textViews }

const sizes: { size: FaceSize; label: string }[] = [
  { size: 'mini', label: 'Action rail · 52px' },
  { size: 'thumbnail', label: 'Thumbnail · 98px sample' },
  { size: 'hand', label: 'Hand · 132px sample' },
  { size: 'detail', label: 'Stack / public zone · 160px' },
  { size: 'inspection', label: 'Inspection · 220px default' },
]

const meta = {
  title: 'Cards/Rendering',
  id: 'board-composed-card-body',
  parameters: { layout: 'fullscreen', controls: { include: ['size'] } },
  args: { size: 'inspection', specimen: 'dense' },
  argTypes: {
    size: { control: 'select', options: sizes.map(({ size }) => size) },
    specimen: { control: 'select', options: Object.keys(textViews) },
  },
} satisfies Meta<StoryArgs>

export default meta
type Story = StoryObj<StoryArgs>

export const OrdinaryTypes: Story = {
  render: ({ size }, { globals }) => (
    <Gallery
      views={ordinaryViews}
      size={(globals['cardFaceSize'] as FaceSize | undefined) ?? size}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Do colored, multicolor, artifact, land, and token frames share consistent proportions and typography? Use Size to inspect each production role.',
      },
    },
  },
}

export const LayoutFamilies: Story = {
  render: ({ size }, { globals }) => (
    <Gallery views={layoutViews} size={(globals['cardFaceSize'] as FaceSize | undefined) ?? size} />
  ),
  parameters: {
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'inspection' },
        hand: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'hand' },
        thumbnail: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'thumbnail' },
      },
    },
    docs: {
      description: {
        story:
          'Do Saga, planeswalker, Battle, split, Adventure, two-faced, Room, progression, and supplemental layouts remain readable at the selected size?',
      },
    },
  },
}

export const DynamicStates: Story = {
  args: { size: 'hand' },
  render: ({ size }, { globals }) => (
    <Gallery
      views={dynamicViews}
      size={(globals['cardFaceSize'] as FaceSize | undefined) ?? size}
    />
  ),
  parameters: {
    docs: {
      description: {
        story:
          'Are current loyalty, defense, unlocked doors, Class level, solved Case, level counters, modified stats, gained keywords, and hidden identity visible?',
      },
    },
  },
}

export const GameplayChrome: Story = {
  render: () => (
    <StoryStage>
      <Card card={{ ...lightningBolt, playableSpell: true }} variant="hand" />
      <Card card={longMulticolorCard} variant="preview" selected />
    </StoryStage>
  ),
  parameters: {
    controls: { disable: true },
    docs: {
      description: {
        story:
          'Does the composed face preserve playable and selected highlights in the production Card wrapper?',
      },
    },
  },
}

export const ProductionSizes: Story = {
  render: ({ specimen }) => (
    <StoryStage>
      {sizes.map(({ size, label }) => (
        <figure key={size} className="card-size-example">
          <figcaption>{label}</figcaption>
          <Face size={size} view={textViews[specimen]} />
        </figure>
      ))}
    </StoryStage>
  ),
  parameters: {
    controls: { include: ['specimen'] },
    docs: {
      description: {
        story:
          'Are the five production size roles proportionate? Compare short rules, dense rules, or a six-pip cost with Specimen. Hand and thumbnail widths here are representative samples; their containers may resize them.',
      },
    },
  },
}

export const TextFit: Story = {
  render: ({ size }, { globals }) => (
    <Gallery
      views={Object.values(textViews)}
      size={(globals['cardFaceSize'] as FaceSize | undefined) ?? size}
    />
  ),
  parameters: {
    chromatic: {
      modes: {
        desktop: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'inspection' },
        hand: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'hand' },
        thumbnail: { viewport: { width: 1440, height: 900 }, cardFaceSize: 'thumbnail' },
      },
    },
    docs: {
      description: {
        story:
          'Do short rules keep their vertical inset while dense rules, long titles, and a six-pip cost fit? Size compares the same stress cases across production roles.',
      },
    },
  },
}

function Gallery({ views, size }: { views: CardView[]; size: FaceSize }) {
  return (
    <StoryStage>
      {views.map((view) => (
        <Face key={view.instanceId} size={size} view={view} />
      ))}
    </StoryStage>
  )
}

function Face({ size, view }: { size: FaceSize; view: CardView }) {
  return (
    <div style={{ width: `var(--card-face-width-${size})`, flex: '0 0 auto' }}>
      <ComposedCardBody card={cardBodyFromView(view)} />
    </div>
  )
}

function StoryStage({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'flex-start',
        justifyContent: 'center',
        gap: 28,
        padding: 40,
      }}
    >
      {children}
    </div>
  )
}
