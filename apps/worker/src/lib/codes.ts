// 사람이 옮겨 적는 코드 (초대 코드, 다른 기기 로그인 코드). Crockford Base32라 0/O, 1/I/L을 헷갈려도 같은 코드로 읽는다.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/** 초대 코드 10자 (약 50비트), 7일 */
export const INVITE_CODE_LENGTH = 10;
/** 로그인 코드 8자 (약 40비트), 10분. 10분 안에 맞히려면 초당 수억 번을 시도해야 한다 */
export const LOGIN_CODE_LENGTH = 8;

export function randomCode(length: number): string {
  // 256은 32의 배수라 & 31로 고르면 치우침이 없다
  return [...crypto.getRandomValues(new Uint8Array(length))].map((byte) => ALPHABET[byte & 31]).join('');
}

/** 보여 줄 때는 앞에서부터 4~5자씩 끊는다: 'K7QM-4XPT', 'K7QM4-XPTA9' */
export function formatCode(code: string): string {
  const size = code.length % 4 === 0 ? 4 : 5;
  return code.match(new RegExp(`.{1,${size}}`, 'g'))!.join('-');
}

/** 입력을 저장할 때와 같은 꼴로 바꾼다. 길이나 글자가 맞지 않으면 null */
export function normalizeCode(input: string, length: number): string | null {
  const code = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
  if (code.length !== length) return null;
  for (const char of code) if (!ALPHABET.includes(char)) return null;
  return code;
}
