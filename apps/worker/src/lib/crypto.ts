const encoder = new TextEncoder();

export function base64url(bytes: ArrayBuffer | Uint8Array): string {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let binary = '';
  for (const byte of view) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function randomToken(byteLength = 32): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

export async function sha256(text: string): Promise<ArrayBuffer> {
  return crypto.subtle.digest('SHA-256', encoder.encode(text));
}

/** 두 문자열을 해시해서 시간 차이 없이 비교한다. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(left, right);
}

export function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}
