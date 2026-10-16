const allowed = new Set([
  '$ref',
  'type',
  'title',
  'properties',
  'required',
  'items',
  'additionalProperties',
  'enum',
  'format',
  'minimum',
  'maximum',
  'description',
])

/** Only the serializer-derived subset is supported; additions must fail visibly. */
export function generateWireSchemas(document) {
  if (!document.openapi?.startsWith('3.1.') || !document.paths) {
    throw new Error('Expected OpenAPI 3.1')
  }
  const components = document.components?.schemas ?? {}
  const expression = (schema) => {
    for (const key of Object.keys(schema)) {
      if (!allowed.has(key)) {
        throw new Error(`Unsupported schema keyword: ${key}`)
      }
    }
    if (schema.$ref) {
      const name = schema.$ref.replace('#/components/schemas/', '')
      if (!(name in components)) {
        throw new Error(`Unresolved schema: ${schema.$ref}`)
      }
      return `z.lazy(() => ${name}Schema)`
    }
    const types = Array.isArray(schema.type) ? schema.type : [schema.type]
    const nullable = types.includes('null')
    const type = types.find((value) => value !== 'null')
    if (types.filter((value) => value !== 'null').length !== 1) {
      throw new Error(`Unsupported schema type: ${types}`)
    }
    if (schema.format && !['int32', 'int64'].includes(schema.format)) {
      throw new Error(`Unsupported schema format: ${schema.format}`)
    }
    let result
    if (schema.enum) {
      result = `z.enum(${JSON.stringify(schema.enum.filter((value) => value !== null))})`
    } else if (type === 'string') {
      result = 'z.string()'
    } else if (type === 'boolean') {
      result = 'z.boolean()'
    } else if (type === 'integer' || type === 'number') {
      result = type === 'integer' ? 'z.number().int()' : 'z.number()'
      if (schema.format === 'int64') {
        result += '.safe()'
      }
      if (schema.minimum !== undefined) {
        result += `.min(${schema.minimum})`
      }
      if (schema.maximum !== undefined) {
        result += `.max(${schema.maximum})`
      }
    } else if (type === 'array') {
      result = `z.array(${expression(schema.items)})`
    } else if (type === 'object') {
      if (schema.additionalProperties && schema.properties) {
        throw new Error('Mixed properties/map schema')
      }
      if (schema.additionalProperties) {
        result = `z.record(z.string(), ${expression(schema.additionalProperties)})`
      } else {
        const properties = schema.properties ?? {}
        for (const name of schema.required ?? []) {
          if (!(name in properties)) {
            throw new Error(`Unknown required property: ${name}`)
          }
        }
        result = `z.object({${Object.entries(properties)
          .map(
            ([name, field]) =>
              `${JSON.stringify(name)}: ${expression(field)}${schema.required?.includes(name) ? '' : '.optional()'}`,
          )
          .join(',\n')}})`
      }
    } else {
      throw new Error(`Unsupported schema type: ${type}`)
    }
    return result + (nullable ? '.nullable()' : '')
  }
  const lines = [
    '// Generated from the registered Kotlin HTTP contract. Run bun run api:types.',
    "import { z } from 'zod'",
    "import type { components } from './types'",
  ]
  for (const [name, schema] of Object.entries(components)) {
    if (!/^[A-Za-z_$][\w$]*$/.test(name)) {
      throw new Error(`Unsupported schema name: ${name}`)
    }
    lines.push(
      `export const ${name}Schema: z.ZodType<components['schemas'][${JSON.stringify(name)}]> = ${expression(schema)}`,
    )
  }
  lines.push('export const responseSchemas = {')
  for (const [path, operations] of Object.entries(document.paths)) {
    for (const [method, operation] of Object.entries(operations)) {
      if (!['get', 'post', 'put', 'delete', 'patch', 'head', 'options'].includes(method)) {
        throw new Error(`Unsupported method: ${method}`)
      }
      lines.push(`${JSON.stringify(`${method.toUpperCase()} ${path}`)}: {`)
      for (const [status, response] of Object.entries(operation.responses)) {
        const json = response.content?.['application/json']?.schema
        // Non-JSON outcomes stay in OpenAPI; JSON consumers cannot decode them.
        if (json) {
          lines.push(`${JSON.stringify(status)}: ${expression(json)},`)
        }
      }
      lines.push('},')
    }
  }
  lines.push('} as const\n')
  return lines.join('\n')
}
