// 웹 푸시용 VAPID 키 쌍을 만든다 (P-256).
// 공개 키는 wrangler.jsonc의 VAPID_PUBLIC_KEY에, 개인 키는 `npx wrangler secret put VAPID_PRIVATE_KEY`로 넣는다.
const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
const publicKey = Buffer.from(await crypto.subtle.exportKey('raw', pair.publicKey)).toString('base64url');
const { d: privateKey } = await crypto.subtle.exportKey('jwk', pair.privateKey);

console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.error('\n공개 키는 apps/worker/wrangler.jsonc의 vars에, 개인 키는 secret으로 넣어요. 개인 키는 어디에도 커밋하지 마세요.');
