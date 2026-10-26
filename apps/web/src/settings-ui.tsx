import { useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

// 설정·관리 화면이 같이 쓰는 부품 (설정 정리 시안): 흰 카드, 라벨 왼쪽·조절 오른쪽의 행, 켜고 끄는 스위치, 하나 고르는 알약,
// 접어 두는 행, 잠깐 떴다 사라지는 알림. 모양은 styles.css의 .set-* 규칙이다.

export function SetCard({ id, title, aside, children }: { id?: string; title: string; aside?: ReactNode; children: ReactNode }) {
  return (
    <section id={id} className="set-card" aria-labelledby={id ? `${id}-title` : undefined}>
      <h2 id={id ? `${id}-title` : undefined}>
        {title}
        {aside}
      </h2>
      {children}
    </section>
  );
}

/** 한 줄 설정. 라벨과 한 줄 설명이 왼쪽, 조절(children)이 오른쪽이다. stack이면 조절을 라벨 아래 한 줄에 놓는다 */
export function SetRow({ label, sub, tags, stack = false, children }: { label: ReactNode; sub?: ReactNode; tags?: ReactNode; stack?: boolean; children?: ReactNode }) {
  return (
    <div className={stack ? 'set-row stack' : 'set-row'}>
      <div className="set-label">
        <strong>
          {label}
          {tags}
        </strong>
        {sub ? <span>{sub}</span> : null}
      </div>
      {children}
    </div>
  );
}

/** 켜고 끄는 행. 행 전체가 label이라 어디를 눌러도 바뀐다 */
export function SwitchRow({ label, sub, tags, checked, onChange }: { label: ReactNode; sub?: ReactNode; tags?: ReactNode; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="set-row">
      <span className="set-label">
        <strong>
          {label}
          {tags}
        </strong>
        {sub ? <span>{sub}</span> : null}
      </span>
      <input type="checkbox" role="switch" className="set-switch" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

/** 하나 고르기. 하루 목표와 테마가 같은 모양을 쓴다 */
export function Pills<T extends string | number>({
  label,
  options,
  value,
  onPick,
  className = 'set-pills',
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T;
  onPick: (value: T) => void;
  className?: string;
}) {
  return (
    <div className={className} role="group" aria-label={label}>
      {options.map((option) => (
        <button key={String(option.value)} type="button" className={option.value === value ? 'current' : undefined} aria-pressed={option.value === value} onClick={() => onPick(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 접어 두는 행. 안쪽은 펼쳤을 때만 그린다 (닫힌 채로 무거운 글 상자를 만들지 않게) */
export function Disclosure({ label, sub, badge, defaultOpen = false, children }: { label: string; sub?: string; badge?: ReactNode; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details className="set-disclosure" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="set-row">
        <span className="set-label">
          <strong>{label}</strong>
          {sub ? <span>{sub}</span> : null}
        </span>
        {badge}
        <span className="set-chevron" aria-hidden="true">
          ›
        </span>
      </summary>
      {open ? <div className="set-more">{children}</div> : null}
    </details>
  );
}

export function Badge({ tone = 'muted', children }: { tone?: 'good' | 'warn' | 'muted'; children: ReactNode }) {
  return <span className={`set-badge ${tone}`}>{children}</span>;
}

export const Tag = ({ accent = false, children }: { accent?: boolean; children: ReactNode }) => <span className={accent ? 'set-tag accent' : 'set-tag'}>{children}</span>;

/** 고칠 때까지 남는 오류 한 줄. 성공은 toast로 알린다 */
export const RowError = ({ text }: { text: string | null }) => (text ? <p className="set-error">{text}</p> : null);

const TOAST_MS = 2500;
const toastListeners = new Set<(text: string) => void>();

/** 저장·복사가 됐다고 잠깐 알린다. 화면을 밀지 않는다 */
export function toast(text: string): void {
  for (const listener of toastListeners) listener(text);
}

export function Toaster() {
  const [shown, setShown] = useState<{ text: string; key: number } | null>(null);
  // 화면이 처음 그려질 때 다른 부품이 바로 알리는 것(예: GitHub 연결 결과)도 받게, 모든 useEffect보다 먼저 듣기 시작한다
  useLayoutEffect(() => {
    const listener = (text: string) => setShown((previous) => ({ text, key: (previous?.key ?? 0) + 1 }));
    toastListeners.add(listener);
    return () => {
      toastListeners.delete(listener);
    };
  }, []);
  useEffect(() => {
    if (!shown) return;
    const timer = setTimeout(() => setShown(null), TOAST_MS);
    return () => clearTimeout(timer);
  }, [shown]);
  return (
    <div className="set-toast-area" role="status" aria-live="polite">
      {shown ? (
        <p key={shown.key} className="set-toast">
          {shown.text}
        </p>
      ) : null}
    </div>
  );
}
