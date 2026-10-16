import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import Ajv2020 from 'ajv/dist/2020'
import { responseSchemas } from '../src/shared/api/wire-schemas'
import type { z } from 'zod'

const directory = resolve(import.meta.dirname, '../server/build/generated/openapi')
const document = JSON.parse(readFileSync(resolve(directory, 'openapi.json'), 'utf8'))
const ajv = new Ajv2020({ strictSchema: false, allErrors: true })
ajv.addFormat('int32', {
  type: 'number',
  validate: (n: number) => Number.isInteger(n) && n >= -2147483648 && n <= 2147483647,
})
ajv.addFormat('int64', { type: 'number', validate: Number.isInteger })
// OpenAPI stores schemas under components instead of JSON Schema's $defs.
ajv.addSchema({ $id: 'urn:forge-web:http', components: document.components })
const compile = (schema: object) => ajv.compile({ ...schema, components: document.components })
for (const schema of Object.values(document.components.schemas)) {
  compile(schema as object)
}
for (const operations of Object.values(document.paths)) {
  for (const operation of Object.values(
    operations as Record<
      string,
      {
        parameters?: { schema: object }[]
        requestBody?: { content: Record<string, { schema: object }> }
        responses: Record<string, { content?: Record<string, { schema: object }> }>
      }
    >,
  )) {
    for (const parameter of operation.parameters ?? []) {
      compile(parameter.schema)
    }
    for (const media of Object.values(operation.requestBody?.content ?? {})) {
      compile(media.schema)
    }
    for (const response of Object.values(operation.responses)) {
      for (const media of Object.values(response.content ?? {})) {
        compile(media.schema)
      }
    }
  }
}
const decoders: Record<string, Record<number, z.ZodType>> = responseSchemas
const files = readdirSync(resolve(directory, 'responses')).filter((name) => name.endsWith('.json'))
if (files.length === 0) {
  throw new Error('No actual HTTP responses were exported')
}
for (const file of files) {
  const sample = JSON.parse(readFileSync(resolve(directory, 'responses', file), 'utf8'))
  const [method, path] = sample.endpoint.split(' ')
  const response = document.paths[path]?.[method.toLowerCase()]?.responses[sample.status]
  if (!response) {
    throw new Error(`Undeclared HTTP response: ${sample.endpoint} ${sample.status}`)
  }
  if (!sample.body) {
    if (response.content) {
      throw new Error(`Missing HTTP body: ${sample.endpoint} ${sample.status}`)
    }
    continue
  }
  const schema = response.content?.[sample.contentType]?.schema
  if (!schema) {
    throw new Error(`Undeclared content type: ${file} ${sample.contentType}`)
  }
  const body = sample.contentType === 'application/json' ? JSON.parse(sample.body) : sample.body
  const validate = compile(schema)
  if (!validate(body)) {
    throw new Error(`HTTP response violates OpenAPI: ${file}\n${ajv.errorsText(validate.errors)}`)
  }
  if (sample.contentType === 'application/json') {
    const decoder = decoders[sample.endpoint]?.[sample.status]
    if (!decoder) {
      throw new Error(`No generated decoder: ${file}`)
    }
    decoder.parse(body)
  }
}
console.log(
  `HTTP contracts valid; ${files.length} actual responses agree with OpenAPI and frontend decoding.`,
)
