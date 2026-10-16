import { expect, test } from 'bun:test'
import { generateWireSchemas } from './web-wire-schemas.mjs'

const document = (schema: object) => ({
  openapi: '3.1.1',
  paths: {},
  components: { schemas: { Probe: schema } },
})

test('unsupported schema keywords and unresolved references stop generation', () => {
  expect(() => generateWireSchemas(document({ type: 'string', pattern: '.*' }))).toThrow(
    'Unsupported schema keyword',
  )
  expect(() => generateWireSchemas(document({ $ref: '#/components/schemas/Missing' }))).toThrow(
    'Unresolved schema',
  )
  expect(() => generateWireSchemas(document({ type: 'unknown' }))).toThrow(
    'Unsupported schema type',
  )
})

test('required and nullable fields are independent in generated decoding', () => {
  const generated = generateWireSchemas(
    document({
      type: 'object',
      required: ['nullable'],
      properties: {
        nullable: { type: ['string', 'null'] },
        optional: { type: 'integer', format: 'int64' },
      },
    }),
  )
  expect(generated).toContain('"nullable": z.string().nullable()')
  expect(generated).toContain('"optional": z.number().int().safe().optional()')
})
