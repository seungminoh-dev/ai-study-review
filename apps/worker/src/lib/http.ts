export function errorJson(status: number, code: string, message: string): Response {
  return Response.json({ error: { code, message } }, { status });
}
