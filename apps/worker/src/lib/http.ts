import type { Context } from 'hono';
import type { z } from 'zod';

export function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}

/** 요청 본문을 스키마로 검증한다. 실패하면 400 응답을 돌려준다. */
export async function readJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.output<S> | Response> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return errorJson(400, 'invalid_json', 'JSON 본문이 필요해요.');
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const where = first?.path.length ? ` (${first.path.join('.')})` : '';
    return errorJson(400, 'invalid_body', `입력값이 올바르지 않아요${where}: ${first?.message ?? ''}`.trim());
  }
  return parsed.data;
}
