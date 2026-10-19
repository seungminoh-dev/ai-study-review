import { soundOn } from './prefs';

// 효과음 (4단계). 소리 파일 없이 Web Audio로 짧은 음을 만든다. 설정에서 끌 수 있고, 기본은 켬이다.
// 브라우저는 사용자가 누른 뒤에만 소리를 낸다. 첫 답을 누를 때 열린 AudioContext를 계속 쓴다.

export type Sound = 'right' | 'wrong' | 'finish' | 'perfect' | 'levelup' | 'achievement';

/** [주파수 Hz, 시작 초, 길이 초] */
type Note = [number, number, number];

const SOUNDS: Record<Sound, { wave: OscillatorType; volume: number; notes: Note[] }> = {
  right: { wave: 'triangle', volume: 0.14, notes: [[659, 0, 0.09], [988, 0.07, 0.16]] },
  wrong: { wave: 'sine', volume: 0.16, notes: [[233, 0, 0.12], [185, 0.1, 0.2]] },
  finish: { wave: 'triangle', volume: 0.12, notes: [[523, 0, 0.1], [659, 0.09, 0.1], [784, 0.18, 0.1], [1047, 0.27, 0.3]] },
  perfect: { wave: 'triangle', volume: 0.12, notes: [[784, 0, 0.08], [988, 0.07, 0.08], [1175, 0.14, 0.08], [1568, 0.21, 0.12], [2093, 0.3, 0.35]] },
  levelup: { wave: 'square', volume: 0.05, notes: [[392, 0, 0.08], [523, 0.08, 0.08], [659, 0.16, 0.08], [784, 0.24, 0.3]] },
  achievement: { wave: 'sine', volume: 0.16, notes: [[1319, 0, 0.5], [1760, 0.12, 0.6], [2637, 0.24, 0.7]] },
};

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (!soundOn() || typeof AudioContext === 'undefined') return null;
  // iPhone: 무음 스위치를 따르고, 듣고 있던 음악을 멈추지 않는다 (Safari 17+)
  const session = (navigator as Navigator & { audioSession?: { type: string } }).audioSession;
  if (session) session.type = 'ambient';
  context ??= new AudioContext();
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  return context;
}

export function play(name: Sound): void {
  let ctx: AudioContext | null;
  try {
    ctx = audio();
  } catch {
    return;
  }
  if (!ctx) return;
  const { wave, volume, notes } = SOUNDS[name];
  const start = ctx.currentTime + 0.01;
  for (const [frequency, at, length] of notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = wave;
    oscillator.frequency.value = frequency;
    // 딸깍 소리가 나지 않게 아주 짧게 키웠다가 줄인다
    gain.gain.setValueAtTime(0.0001, start + at);
    gain.gain.exponentialRampToValueAtTime(volume, start + at + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + at + length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(start + at);
    oscillator.stop(start + at + length + 0.02);
  }
}
