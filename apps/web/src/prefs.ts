// 기기마다 정하는 화면 설정 (localStorage). 저장소를 못 쓰면 기본값을 쓴다.

export type Theme = 'auto' | 'light' | 'dark';

const THEME = 'moai:theme';
const VIBRATE = 'moai:vibrate';
const SOUND = 'moai:sound';
/** index.html의 theme-color와 같다 (styles.css의 --bg) */
const BAR_COLOR = { light: '#FBF7F0', dark: '#0F1626' };

/** 기기에 적어 둔 값. 저장소를 못 쓰면 null이라 부르는 쪽의 기본값을 쓴다 */
export function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

/** JSON으로 적어 둔 값. 없거나 읽지 못하면 null */
export function readStoredJson(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

/** 기기에 적는다. null이면 지운다. 저장하지 못하면 이번 실행에서만 적용된다 */
export function writeStored(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // 저장소를 못 쓰는 기기다
  }
}

export function theme(): Theme {
  const value = readStored(THEME);
  return value === 'light' || value === 'dark' ? value : 'auto';
}

/** html의 data-theme과 주소창 색을 맞춘다. auto면 기기 설정(prefers-color-scheme)을 따른다 */
export function applyTheme(value: Theme = theme()): void {
  if (value === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = value;
  for (const meta of document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')) {
    meta.content = BAR_COLOR[value === 'auto' ? (meta.media.includes('dark') ? 'dark' : 'light') : value];
  }
}

export function setTheme(value: Theme): void {
  writeStored(THEME, value);
  applyTheme(value);
}

export function vibrateOn(): boolean {
  return readStored(VIBRATE) !== 'off';
}

export function setVibrate(on: boolean): void {
  writeStored(VIBRATE, on ? 'on' : 'off');
}

export function soundOn(): boolean {
  return readStored(SOUND) !== 'off';
}

export function setSound(on: boolean): void {
  writeStored(SOUND, on ? 'on' : 'off');
}

/** 짧은 진동. 설정에서 끈 기기와 진동을 못 하는 기기(iPhone)에서는 아무것도 하지 않는다 */
export function buzz(pattern: number | number[]): void {
  if (vibrateOn()) navigator.vibrate?.(pattern);
}
