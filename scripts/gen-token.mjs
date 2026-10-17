// 무작위 토큰(256비트, base64url)을 만든다. TOKEN_PEPPER, BOOTSTRAP_CODE에 쓴다.
import { randomBytes } from 'node:crypto';

console.log(randomBytes(32).toString('base64url'));
