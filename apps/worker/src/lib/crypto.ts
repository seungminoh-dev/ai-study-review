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

export async function sha256Hex(text: string): Promise<string> {
  return [...new Uint8Array(await sha256(text))].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** 두 문자열을 해시해서 시간 차이 없이 비교한다. */
export async function safeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  return crypto.subtle.timingSafeEqual(left, right);
}

export function byteLength(text: string): number {
  return encoder.encode(text).byteLength;
}

const hmacKeys = new Map<string, Promise<CryptoKey>>();

/** 토큰은 HMAC-SHA256(TOKEN_PEPPER, 토큰)으로만 저장한다 (설계서 §14). 키는 isolate마다 한 번만 가져온다. */
export async function hashToken(pepper: string, token: string): Promise<string> {
  if (!pepper) throw new Error('TOKEN_PEPPER is not set');
  let key = hmacKeys.get(pepper);
  if (!key) {
    key = crypto.subtle.importKey('raw', encoder.encode(pepper), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    hmacKeys.set(pepper, key);
  }
  return base64url(await crypto.subtle.sign('HMAC', await key, encoder.encode(token)));
}
