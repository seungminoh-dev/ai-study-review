// structured outputs가 받는 JSON Schema로 바꾼다 (Anthropic TypeScript SDK의 transformJSONSchema와 같은 규칙, MIT).
// 지원하지 않는 제약(길이, 범위, 패턴 등)은 description으로 옮긴다. 응답은 어차피 서버에서 zod로 다시 검사한다.

type Schema = Record<string, unknown>;

const SUPPORTED_STRING_FORMATS = new Set(['date-time', 'time', 'date', 'duration', 'email', 'hostname', 'uri', 'ipv4', 'ipv6', 'uuid']);

function take(schema: Schema, key: string): unknown {
  const value = schema[key];
  delete schema[key];
  return value;
}

function strict(input: Schema): Schema {
  const schema = { ...input };
  const out: Schema = {};
  const defs = take(schema, '$defs') as Record<string, Schema> | undefined;
  if (defs) out.$defs = Object.fromEntries(Object.entries(defs).map(([name, def]) => [name, strict(def)]));
  const ref = take(schema, '$ref');
  if (ref !== undefined) {
    out.$ref = ref;
    return out;
  }
  take(schema, '$schema');
  const type = take(schema, 'type');
  const anyOf = (take(schema, 'anyOf') ?? take(schema, 'oneOf')) as Schema[] | undefined;
  const allOf = take(schema, 'allOf') as Schema[] | undefined;
  if (Array.isArray(anyOf)) out.anyOf = anyOf.map(strict);
  else if (Array.isArray(allOf)) out.allOf = allOf.map(strict);
  else if (type !== undefined) out.type = type;
  for (const key of ['description', 'title', 'enum']) {
    const value = take(schema, key);
    if (value !== undefined) out[key] = value;
  }
  const constant = take(schema, 'const');
  if (constant !== undefined) out.enum = [constant];
  if (type === 'object') {
    const properties = (take(schema, 'properties') ?? {}) as Record<string, Schema>;
    out.properties = Object.fromEntries(Object.entries(properties).map(([key, value]) => [key, strict(value)]));
    take(schema, 'additionalProperties');
    out.additionalProperties = false;
    const required = take(schema, 'required');
    if (required !== undefined) out.required = required;
  } else if (type === 'string') {
    const format = take(schema, 'format');
    if (typeof format === 'string' && SUPPORTED_STRING_FORMATS.has(format)) out.format = format;
    else if (format !== undefined) schema.format = format;
  } else if (type === 'array') {
    const items = take(schema, 'items') as Schema | undefined;
    if (items) out.items = strict(items);
    const minItems = take(schema, 'minItems');
    if (minItems === 0 || minItems === 1) out.minItems = minItems;
    else if (minItems !== undefined) schema.minItems = minItems;
  }
  take(schema, 'default');
  const rest = Object.entries(schema);
  if (rest.length > 0) {
    const note = `{${rest.map(([key, value]) => `${key}: ${JSON.stringify(value)}`).join(', ')}}`;
    out.description = typeof out.description === 'string' ? `${out.description}\n\n${note}` : note;
  }
  return out;
}

export function toOutputSchema(jsonSchema: Schema): Schema {
  return strict(JSON.parse(JSON.stringify(jsonSchema)) as Schema);
}
