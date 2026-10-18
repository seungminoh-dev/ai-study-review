import type { McpTokenStatus, Reminder, SessionSummary } from '@moai/shared';
import { MAX_REMINDERS } from '@moai/shared/client';
import { AnimatePresence } from 'motion/react';
import { useEffect, useState, type ReactNode } from 'react';
import { errorMessage, request } from '../api';
import { DemoDeck } from '../cards/DemoDeck';
import { Confetti } from '../Confetti';
import { copyText } from '../copy';
import { IconCheck, IconCopy } from '../icons';
import { installApp, useInstall } from '../install';
import { Mascot } from '../Mascot';
import { LEAVE, Presence, SOFT } from '../motion';
import { enablePush, isIos, isStandalone, pushState, type PushState } from '../push';
import { goTab, useLocation } from '../router';
import { formatDateTime, useApi } from '../useApi';

// 시작 가이드 (3단계 시안): 가입 직후, 그리고 오늘 화면의 "시작하기"에서 연다 (?step=으로 그 단계부터).
// 환영 → 홈 화면에 추가 → claude.ai 연결 → 첫 저장 → 알림 → 준비 끝. 단계마다 실제 기능(설치, 연결 주소, 알림)을 그대로 쓴다.

interface Note {
  text: string;
  tone: 'good' | 'bad' | 'muted' | 'warn';
}

const LAST = 5;

export function Welcome({ name }: { name: string }) {
  const { query } = useLocation();
  const [step, setStep] = useState(() => Math.min(Math.max(Number(query.get('step')) || 0, 0), LAST));
  /** 방금 설치했는지. 설치해도 지금 브라우저 탭에서는 홈 화면 앱이 아니라서 따로 기억한다 */
  const [installedNow, setInstalledNow] = useState(false);
  const next = () => setStep((value) => Math.min(value + 1, LAST));
  const finish = () => void goTab('/');
  return (
    <div className="welcome">
      {step >= 1 && step < LAST ? (
        <header className="welcome-top">
          <div className="welcome-progress" role="progressbar" aria-label="시작 가이드 진행" aria-valuemin={0} aria-valuemax={4} aria-valuenow={step}>
            {[1, 2, 3, 4].map((n) => (
              <span key={n} className={n <= step ? 'on' : undefined} />
            ))}
          </div>
          <button type="button" className="text-button" onClick={finish}>
            건너뛰기
          </button>
        </header>
      ) : null}
      <AnimatePresence mode="wait" initial={false}>
        <Presence
          key={step}
          className="welcome-step"
          initial={{ opacity: 0, x: 28 }}
          animate={{ opacity: 1, x: 0, transition: SOFT }}
          exit={{ opacity: 0, x: -28, transition: LEAVE }}
        >
          {step === 0 ? <Hello name={name} onNext={next} onLater={finish} /> : null}
          {step === 1 ? <InstallStep onNext={next} onInstalled={() => setInstalledNow(true)} /> : null}
          {step === 2 ? <ConnectorStep onNext={next} /> : null}
          {step === 3 ? <SaveStep onNext={next} /> : null}
          {step === 4 ? <PushStep onNext={next} /> : null}
          {step === LAST ? <Ready installedNow={installedNow} onFinish={finish} onRestart={() => setStep(0)} /> : null}
        </Presence>
      </AnimatePresence>
    </div>
  );
}

function Actions({ children }: { children: ReactNode }) {
  return <div className="welcome-actions">{children}</div>;
}

function Hello({ name, onNext, onLater }: { name: string; onNext: () => void; onLater: () => void }) {
  return (
    <>
      <div className="welcome-body welcome-hello">
        <div className="welcome-art">
          <Mascot mood="wave" size={144} />
          <span className="landing-bubble">반가워요!</span>
        </div>
        <h1>{name}님, 환영해요</h1>
        <p className="muted">모아이는 Claude와 공부한 내용을 복습 카드로 바꿔 줘요. 세 가지만 하면 바로 시작할 수 있어요.</p>
        <ol className="welcome-list">
          <li>
            <span>1</span>
            <strong>홈 화면에 추가하기</strong>
            <small>30초</small>
          </li>
          <li>
            <span>2</span>
            <strong>claude.ai에 연결하기</strong>
            <small>1분</small>
          </li>
          <li>
            <span>3</span>
            <strong>알림 시간 정하기</strong>
            <small>10초</small>
          </li>
        </ol>
      </div>
      <Actions>
        <button type="button" className="button primary" onClick={onNext}>
          시작하기
        </button>
        <button type="button" className="text-button" onClick={onLater}>
          나중에 할게요
        </button>
      </Actions>
    </>
  );
}

function InstallStep({ onNext, onInstalled }: { onNext: () => void; onInstalled: () => void }) {
  const { canInstall, installed } = useInstall();
  const [device, setDevice] = useState<'android' | 'ios'>(() => (isIos() ? 'ios' : 'android'));
  const [note, setNote] = useState<Note | null>(null);
  const oneTap = !installed && device === 'android' && canInstall;
  const install = async () => {
    if (await installApp()) {
      onInstalled();
      onNext();
    } else setNote({ text: '설치를 취소했어요. 나중에 브라우저 메뉴에서도 할 수 있어요.', tone: 'muted' });
  };
  return (
    <>
      <div className="welcome-body">
        <span className="welcome-label">1/4 · 홈 화면에 추가</span>
        <div className="home-mock" aria-hidden="true">
          {Array.from({ length: 12 }, (_, index) =>
            index === 5 ? (
              <span key={index} className="home-app me">
                <Mascot size={26} still />
              </span>
            ) : (
              <span key={index} className="home-app" />
            ),
          )}
        </div>
        <h2>홈 화면에 모아이를 두세요</h2>
        <p className="muted">앱처럼 바로 열리고, 복습 알림도 받을 수 있어요.</p>
        {installed ? (
          <p className="notice good">이미 홈 화면 앱으로 열었어요.</p>
        ) : (
          <>
            <div className="segmented" role="tablist" aria-label="기기">
              <button type="button" role="tab" aria-selected={device === 'android'} className={device === 'android' ? 'current' : undefined} onClick={() => setDevice('android')}>
                Android
              </button>
              <button type="button" role="tab" aria-selected={device === 'ios'} className={device === 'ios' ? 'current' : undefined} onClick={() => setDevice('ios')}>
                iPhone
              </button>
            </div>
            {device === 'ios' ? (
              <ol className="steps">
                <li>Safari 아래쪽 공유 버튼을 눌러요</li>
                <li>"홈 화면에 추가"를 골라요</li>
                <li>오른쪽 위 "추가"를 눌러요</li>
              </ol>
            ) : canInstall ? (
              <p>아래 버튼을 누르면 바로 설치 창이 떠요.</p>
            ) : (
              <ol className="steps">
                <li>Chrome 오른쪽 위 메뉴(⋮)를 눌러요</li>
                <li>"앱 설치" 또는 "홈 화면에 추가"를 골라요</li>
              </ol>
            )}
          </>
        )}
        {note ? <p className={`notice ${note.tone}`}>{note.text}</p> : null}
      </div>
      <Actions>
        {oneTap ? (
          <button type="button" className="button primary" onClick={() => void install()}>
            홈 화면에 추가
          </button>
        ) : (
          <button type="button" className="button primary" onClick={onNext}>
            {installed ? '다음' : '다 했어요'}
          </button>
        )}
        {installed ? null : (
          <button type="button" className="text-button" onClick={onNext}>
            나중에 할게요
          </button>
        )}
      </Actions>
    </>
  );
}

/** 연결 주소는 비밀번호와 같아서 처음에는 가려서 보여 준다 */
const mask = (url: string) => url.replace(/(\/mcp\/u\/).+$/, '$1••••••••••');

function ConnectorStep({ onNext }: { onNext: () => void }) {
  const { data: status, reload } = useApi<McpTokenStatus>('/mcp-token');
  const [url, setUrl] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);
  const [note, setNote] = useState<Note | null>(null);

  const make = async () => {
    if (status?.active && !confirm('새 주소를 만들면 지금 쓰는 주소는 바로 막혀요. claude.ai에서 커넥터를 지우고 새로 추가해야 해요. 계속할까요?')) return;
    try {
      const result = await request<{ url: string }>('/mcp-token', { method: 'POST' });
      setUrl(result.url);
      setNote(null);
      reload();
    } catch (error) {
      setNote({ text: errorMessage(error), tone: 'bad' });
    }
  };
  const copy = async () => {
    if (!url) return;
    setNote((await copyText(url)) ? { text: '복사했어요. claude.ai에 붙여 넣으세요.', tone: 'good' } : { text: '복사하지 못했어요. 주소를 보이게 한 뒤 길게 눌러 복사해 주세요.', tone: 'bad' });
  };

  return (
    <>
      <div className="welcome-body">
        <span className="welcome-label">2/4 · claude.ai 연결</span>
        <div className="welcome-row">
          <Mascot mood="claude" size={84} />
          <div>
            <h2>claude.ai에 모아이를 연결해요</h2>
            <p className="muted small">연결하면 채팅에서 "모아이에 저장해줘"라고 할 수 있어요.</p>
          </div>
        </div>
        <ol className="guide-steps">
          <li>
            <div className="guide-head">
              <span className="guide-no">1</span>
              <strong>연결 주소 만들기</strong>
              {!url && status && !status.active ? (
                <button type="button" className="button accent" onClick={() => void make()}>
                  주소 만들기
                </button>
              ) : null}
            </div>
            {url ? (
              <div className="secret">
                <code className="secret-url">{visible ? url : mask(url)}</code>
                <div className="actions">
                  <button type="button" className="button primary" onClick={() => void copy()}>
                    주소 복사
                  </button>
                  <button type="button" className="button" onClick={() => setVisible(!visible)}>
                    {visible ? '가리기' : '보기'}
                  </button>
                </div>
                <p className="small">이 주소는 비밀번호와 같아요. 지금 한 번만 보이니 바로 claude.ai에 넣고, 다른 사람에게 보여 주지 마세요.</p>
              </div>
            ) : status?.active ? (
              <p className="muted small">
                {status.created_at ? `${formatDateTime(status.created_at)}에 만든 주소가 있어요. ` : '이미 만든 주소가 있어요. '}
                claude.ai에 추가했다면 그대로 쓰면 돼요.{' '}
                <button type="button" className="text-button inline" onClick={() => void make()}>
                  새로 만들기
                </button>
              </p>
            ) : null}
          </li>
          <li>
            <div className="guide-head">
              <span className="guide-no">2</span>
              <strong>claude.ai에서 커넥터 추가</strong>
            </div>
            <p className="guide-path">
              <span>Customize</span>›<span>Connectors</span>›<span className="hot">Add custom connector</span>
            </p>
            <p className="muted small">웹 claude.ai에서 해요. 이름은 "모아이", 주소는 붙여 넣고 "No sign in"을 골라요.</p>
          </li>
          <li>
            <div className="guide-head">
              <span className="guide-no">3</span>
              <strong>도구 허용</strong>
            </div>
            <p className="muted small">도구들을 "Always allow"로 바꿔요. 여러 개념을 한꺼번에 바꾸는 분류 바꾸기만 묻게 두세요. 휴대폰 Claude 앱은 따로 할 일이 없어요.</p>
          </li>
        </ol>
        {note ? <p className={`notice ${note.tone}`}>{note.text}</p> : null}
      </div>
      <Actions>
        <button type="button" className="button primary" onClick={onNext}>
          다음
        </button>
      </Actions>
    </>
  );
}

const PHRASE = '모아이에 저장해줘';

function SaveStep({ onNext }: { onNext: () => void }) {
  /** 처음 열었을 때 이미 있던 저장 수와 지금 수. 늘면 첫 저장을 받은 것이다 */
  const [first, setFirst] = useState<number | null>(null);
  const [count, setCount] = useState<number | null>(null);
  const [demo, setDemo] = useState(false);
  const [copied, setCopied] = useState<boolean | null>(null);
  const saved = (count ?? 0) > 0;

  useEffect(() => {
    if (saved) return;
    let alive = true;
    const check = () =>
      request<{ sessions: SessionSummary[] }>('/sessions').then(
        ({ sessions }) => {
          if (!alive) return;
          setFirst((value) => value ?? sessions.length);
          setCount(sessions.length);
        },
        () => undefined,
      );
    void check();
    // claude.ai에서 저장하면 바로 알아채도록 이 단계를 보는 동안만 5초마다 확인한다
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void check();
    }, 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [saved]);

  return (
    <>
      <div className="welcome-body">
        <span className="welcome-label">3/4 · 첫 저장</span>
        <div className="welcome-row">
          <Mascot mood={saved ? 'cheer' : 'study'} size={84} />
          <div>
            <h2>첫 공부를 저장해 봐요</h2>
            <p className="muted small">claude.ai에서 아무 주제나 공부하고, 끝에 이렇게 말해 보세요.</p>
          </div>
        </div>
        <div className="chat-mock">
          <p className="chat-me">
            {PHRASE}
            <button type="button" className="chat-copy" aria-label="문장 복사" onClick={() => void copyText(PHRASE).then(setCopied)}>
              <IconCopy size={16} />
            </button>
          </p>
          <p className="chat-claude">
            <span className="chip">모아이 사용함</span>
            개념과 카드를 저장했어요. 앱에서 복습해 보세요!
          </p>
        </div>
        {copied === null ? null : <p className={copied ? 'notice good' : 'notice bad'}>{copied ? '복사했어요.' : '복사하지 못했어요. 직접 입력해 주세요.'}</p>}
        {saved ? (
          <p className="notice good">{first === 0 ? '첫 저장을 받았어요! 오늘 화면에서 바로 복습할 수 있어요.' : `저장한 공부가 이미 ${count}개 있어요.`}</p>
        ) : (
          <p className="waiting">
            <span className="waiting-dot" />
            저장을 기다리는 중이에요. 저장하면 여기에 바로 표시돼요.
          </p>
        )}
        {saved ? null : demo ? (
          <DemoDeck />
        ) : (
          <div className="welcome-hint">
            <div>
              <strong>아직 공부한 게 없다면</strong>
              <span className="muted small">체험 카드로 먼저 감을 잡아요.</span>
            </div>
            <button type="button" className="button" onClick={() => setDemo(true)}>
              체험 3장
            </button>
          </div>
        )}
      </div>
      <Actions>
        <button type="button" className="button primary" onClick={onNext}>
          다음
        </button>
      </Actions>
    </>
  );
}

const TIMES = [
  { value: '08:00', label: '아침 8시' },
  { value: '12:00', label: '점심 12시' },
  { value: '21:00', label: '저녁 9시' },
];

/** 알림을 켤 수 없는 기기 상태. 시간은 먼저 저장해 둔다 */
const PUSH_NOTE: Partial<Record<PushState, string>> = {
  'needs-install': 'iPhone은 홈 화면에 추가한 앱에서만 알림을 받을 수 있어요. 시간은 먼저 정해 둘게요.',
  denied: '알림이 차단되어 있어요. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요. 시간은 먼저 정해 둘게요.',
  unsupported: '이 브라우저는 알림을 지원하지 않아요. 시간은 먼저 정해 둘게요.',
};

function PushStep({ onNext }: { onNext: () => void }) {
  const [state, setState] = useState<PushState | null>(null);
  const { data } = useApi<{ reminders: Reminder[] }>('/reminders');
  const [time, setTime] = useState('21:00');
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [note, setNote] = useState<Note | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const existing = data ? data.reminders.map((reminder) => reminder.local_time) : null;
  const ready = state === 'on' && existing !== null && existing.length > 0;

  const save = async () => {
    setBusy(true);
    setNote(null);
    try {
      let current = state;
      if (current === 'off') {
        current = await enablePush();
        setState(current);
      }
      // 이미 정해 둔 시간은 두고 고른 시간을 더한다
      const times = [...new Set([...(existing ?? []), time])].sort().slice(0, MAX_REMINDERS);
      await request('/reminders', { method: 'PUT', json: { times } });
      if (current === 'on') return onNext();
      setSaved(true);
      setNote({ text: current === 'off' ? '알림을 허용하지 않았어요. 시간은 저장했고, 설정에서 언제든 켤 수 있어요.' : (PUSH_NOTE[current!] ?? '시간을 저장했어요.'), tone: 'muted' });
    } catch (error) {
      setNote({ text: errorMessage(error), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  const label = ready ? existing![0]! : (TIMES.find((item) => item.value === time)?.label ?? time);
  return (
    <>
      <div className="welcome-body">
        <span className="welcome-label">4/4 · 알림</span>
        <div className="notif-mock" aria-hidden="true">
          <span className="notif-icon">
            <Mascot size={26} still />
          </span>
          <span className="notif-text">
            <strong>복습할 시간!</strong>
            <span>오늘 8장 · 약 3분</span>
          </span>
          <span className="notif-time">{label}</span>
        </div>
        <div className="welcome-row">
          <Mascot mood="alarm" size={84} />
          <div>
            <h2>언제 알려 드릴까요?</h2>
            <p className="muted small">정한 시간에 복습할 카드가 있을 때만 알려 드려요.</p>
          </div>
        </div>
        {ready ? (
          <p className="notice good">이미 {existing!.join(', ')}에 알려 드리고 있어요.</p>
        ) : (
          <div className="time-chips" role="radiogroup" aria-label="알림 시간">
            {TIMES.map((item) => (
              <button key={item.value} type="button" role="radio" aria-checked={time === item.value} className={time === item.value ? 'time-chip on' : 'time-chip'} onClick={() => setTime(item.value)}>
                {item.label}
              </button>
            ))}
          </div>
        )}
        {state && PUSH_NOTE[state] && !ready && !saved ? <p className="notice warn">{PUSH_NOTE[state]}</p> : null}
        {note ? <p className={`notice ${note.tone}`}>{note.text}</p> : null}
      </div>
      <Actions>
        {ready || saved ? (
          <button type="button" className="button primary" onClick={onNext}>
            다음
          </button>
        ) : (
          <button type="button" className="button primary" disabled={busy || state === null} onClick={() => void save()}>
            {busy ? '켜는 중…' : '알림 켜기'}
          </button>
        )}
        {ready || saved ? null : (
          <button type="button" className="text-button" onClick={onNext}>
            나중에 할게요
          </button>
        )}
      </Actions>
    </>
  );
}

function Ready({ installedNow, onFinish, onRestart }: { installedNow: boolean; onFinish: () => void; onRestart: () => void }) {
  const [rows, setRows] = useState<{ label: string; ok: boolean }[] | null>(null);
  useEffect(() => {
    void (async () => {
      const [token, sessions, push, reminders] = await Promise.all([
        request<McpTokenStatus>('/mcp-token').catch(() => null),
        request<{ sessions: SessionSummary[] }>('/sessions').catch(() => null),
        pushState().catch((): PushState => 'off'),
        request<{ reminders: Reminder[] }>('/reminders').catch(() => null),
      ]);
      setRows([
        { label: '홈 화면 앱', ok: installedNow || isStandalone() },
        { label: 'claude.ai 연결', ok: token?.active ?? false },
        { label: '첫 저장', ok: (sessions?.sessions.length ?? 0) > 0 },
        { label: '알림', ok: push === 'on' && (reminders?.reminders.length ?? 0) > 0 },
      ]);
    })();
  }, [installedNow]);
  const all = rows !== null && rows.every((row) => row.ok);
  return (
    <>
      <div className="welcome-body welcome-ready">
        <Confetti />
        <Mascot mood="cheer" size={150} />
        <h1>준비 끝!</h1>
        <p className="muted">{all ? '이제 오늘 화면에서 복습을 시작해요.' : '남은 것은 오늘 화면의 "시작하기"에서 언제든 이어서 할 수 있어요.'}</p>
        {rows ? (
          <ul className="ready-list">
            {rows.map((row) => (
              <li key={row.label} className={row.ok ? 'ok' : undefined}>
                <span className="step-mark">{row.ok ? <IconCheck size={14} /> : null}</span>
                {row.label}
                <small>{row.ok ? '했어요' : '나중에'}</small>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
      <Actions>
        <button type="button" className="button primary" onClick={onFinish}>
          오늘 화면으로
        </button>
        <button type="button" className="text-button" onClick={onRestart}>
          처음부터 다시 보기
        </button>
      </Actions>
    </>
  );
}
