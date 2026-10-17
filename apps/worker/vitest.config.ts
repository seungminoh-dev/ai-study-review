import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// 테스트마다 새 VAPID 키를 만든다. 실제 키는 `npm run gen:vapid`로 만든다.
async function testVapidKeys() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  const raw = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
  const jwk = await crypto.subtle.exportKey('jwk', pair.privateKey);
  return { publicKey: raw, privateKey: jwk.d ?? '' };
}

export default defineConfig(async () => {
  const migrations = await readD1Migrations(new URL('./migrations', import.meta.url).pathname);
  const vapid = await testVapidKeys();
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: './wrangler.jsonc' },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            APP_ORIGIN: 'https://moai.test',
            TOKEN_PEPPER: 'test-token-pepper',
            BOOTSTRAP_CODE: 'test-bootstrap-code',
            GITHUB_CLIENT_ID: 'test-github-client',
            GITHUB_CLIENT_SECRET: 'test-github-secret',
            VAPID_PUBLIC_KEY: vapid.publicKey,
            VAPID_PRIVATE_KEY: vapid.privateKey,
            VAPID_SUBJECT: 'mailto:test@example.com',
          },
        },
      }),
    ],
    test: { setupFiles: ['./test/setup.ts'] },
  };
});
