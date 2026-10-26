import type { AuthOptions, LoginProvider, LoginCode, LoginSummary, McpTokenStatus, Me, Reminder } from '@moai/shared';
import { MAX_REMINDERS } from '@moai/shared/client';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { RequestError, errorMessage, request } from '../api';
import { COACH_INSTRUCTIONS } from '../coach';
import { IconGoogle } from '../icons';
import { forgetAiStatus } from '../ai';
import { copyText } from '../copy';
import { Mascot } from '../Mascot';
import { clearDeviceData, flushReviews, pendingCount } from '../offline/store';
import { currentEndpoint, disablePush, dropLocalPush, enablePush, isStandalone, pushState, type PushState } from '../push';
import { Link, useLocation } from '../router';
import { Badge, Disclosure, Pills, RowError, SetCard, SetRow, SwitchRow, Tag, Toaster, toast } from '../settings-ui';
import { formatDate, formatDateTime, useApi, useRun } from '../useApi';
import { setSound, setTheme, setVibrate, soundOn, theme, vibrateOn, type Theme } from '../prefs';
import { play } from '../sound';
import { askConfidence, setAskConfidence } from './Review';

// 설정 (설계서 §12.1, 설정 정리 시안): 한 페이지에 흰 카드 6장(알림, 복습, 화면과 소리, 클로드 연결, 계정과 기기, 내 데이터).
// 자주 쓰는 것을 위에 두고, 한 번만 보는 것(연결 방법, 코치 지침, 예전 비밀 주소)은 접는다. 바꾸면 바로 저장하고 잠깐 알린다.
// 오너의 초대·회원·지표는 관리 대시보드(/admin, Admin.tsx)로 옮겼다.

/** 위에 붙는 바로가기 칩. id는 오늘 화면 링크(/settings#alerts)도 쓴다 */
const JUMPS = [
  { id: 'alerts', label: '알림' },
  { id: 'review', label: '복습' },
  { id: 'screen', label: '화면' },
  { id: 'claude', label: '클로드' },
  { id: 'account', label: '계정' },
] as const;

export function Settings({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="screen settings">
      <h1>설정</h1>
      <Profile me={me} />
      <JumpBar />
      <NotifyCard />
      <ReviewCard initialGoal={me.daily_goal} />
      <ScreenCard />
      <ClaudeCard />
      <AccountCard me={me} onLogout={onLogout} />
      <DataCard me={me} onDeleted={onLogout} />
      <footer className="set-footer">
        <p>
          <Link href="/welcome">시작 가이드 다시 보기</Link>
          <Link href="/privacy">개인정보 처리방침</Link>
          <Link href="/terms">이용약관</Link>
        </p>
        <p className="set-version">버전 {__APP_VERSION__}</p>
      </footer>
      <Toaster />
    </div>
  );
}

/** 맨 위 내 이름과 연결한 계정. 오너에게는 관리 대시보드로 가는 줄이 붙는다 */
function Profile({ me }: { me: Me }) {
  return (
    <section className="set-card set-profile" aria-label="내 계정">
      <div className="set-who">
        <Mascot size={40} still />
        <div>
          <strong>{me.display_name}</strong>
          <span className="set-chips">
            {me.github_login ? <span>GitHub @{me.github_login}</span> : null}
            {me.google_linked ? <span>Google</span> : null}
            {!me.github_login && !me.google_linked ? <span>로그인 코드로 들어옴</span> : null}
          </span>
        </div>
      </div>
      {me.role === 'owner' ? (
        <Link className="set-row set-link" href="/admin">
          <span className="set-label">
            <strong className="accent">관리 대시보드</strong>
            <span>베타 지표 · AI 사용량 · 초대 · 회원</span>
          </span>
          <span className="set-chevron" aria-hidden="true">
            ›
          </span>
        </Link>
      ) : null}
    </section>
  );
}

/** 지금 보고 있는 카드의 칩을 밝힌다. 칩을 누르면 그 카드로 내려간다 (주소는 바꾸지 않는다) */
function JumpBar() {
  const [current, setCurrent] = useState<string>(JUMPS[0].id);
  const bar = useRef<HTMLElement>(null);
  /** 칩을 누른 뒤 부드럽게 내려가는 동안에는 지나가는 카드의 칩으로 바꾸지 않는다 */
  const hold = useRef(0);
  useEffect(() => {
    // 오늘 화면의 "알림 시간을 정하면…" 링크(/settings#alerts)로 왔으면 그 카드로 내려간다.
    // 화면을 바꿀 때 맨 위로 올린 뒤에 그려지므로 바로 내려가도 된다 (가려진 창에서는 requestAnimationFrame이 돌지 않는다)
    if (location.hash) document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'start' });
    let frame = 0;
    const spy = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (performance.now() < hold.current) return;
        const edge = (bar.current?.getBoundingClientRect().bottom ?? 0) + 24;
        let seen: string = JUMPS[0].id;
        for (const jump of JUMPS) {
          const top = document.getElementById(jump.id)?.getBoundingClientRect().top;
          if (top !== undefined && top <= edge) seen = jump.id;
        }
        // 키가 큰 화면에서는 마지막 카드가 칩 막대까지 올라오지 못한다. 끝까지 내렸으면 마지막 칩이다
        if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2) seen = JUMPS[JUMPS.length - 1]!.id;
        setCurrent(seen);
      });
    };
    window.addEventListener('scroll', spy, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', spy);
    };
  }, []);
  return (
    <nav ref={bar} className="set-jump" aria-label="설정 바로가기">
      {JUMPS.map((jump) => (
        <button
          key={jump.id}
          type="button"
          className={current === jump.id ? 'current' : undefined}
          aria-current={current === jump.id ? 'true' : undefined}
          onClick={() => {
            setCurrent(jump.id);
            hold.current = performance.now() + 1000;
            const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
            document.getElementById(jump.id)?.scrollIntoView({ block: 'start', behavior: reduce ? 'auto' : 'smooth' });
          }}
        >
          {jump.label}
        </button>
      ))}
    </nav>
  );
}

/** 이 기기 알림 상태. 켜짐이 아니면 왜 안 되는지 한 줄로 알린다 (차단·미지원은 오류가 아니라 기기 상태다) */
const PUSH: Record<PushState, { badge: string; tone: 'good' | 'warn' | 'muted'; text: string }> = {
  unsupported: { badge: '지원 안 됨', tone: 'warn', text: '이 브라우저는 웹 푸시를 지원하지 않아요.' },
  'needs-install': { badge: '설치 필요', tone: 'warn', text: 'iPhone은 Safari 공유 버튼 → "홈 화면에 추가"로 설치한 앱에서만 알림을 받아요.' },
  'in-app': { badge: '앱 안 브라우저', tone: 'warn', text: '카톡 같은 앱 안의 브라우저에서는 알림을 켤 수 없어요. Chrome·Safari에서 열어 주세요.' },
  denied: { badge: '차단됨', tone: 'warn', text: '휴대폰 설정에서 이 앱의 알림을 허용해 주세요.' },
  off: { badge: '꺼짐', tone: 'muted', text: '이 기기에서는 알림이 꺼져 있어요.' },
  on: { badge: '켜짐', tone: 'good', text: '복습할 카드가 있을 때만 알려요.' },
};

function NotifyCard() {
  const [state, setState] = useState<PushState | null>(null);
  const { error, run } = useRun();
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const info = state ? PUSH[state] : null;
  const installHint = !isStandalone() && state !== 'needs-install' ? ' 홈 화면에 추가하면 알림이 잘 와요.' : '';

  const test = () =>
    run(async () => {
      try {
        const result = await request<{ sent: number; failed: number }>('/push/test', { method: 'POST' });
        toast(`테스트 알림을 보냈어요 (기기 ${result.sent}대).`);
      } catch (reason) {
        // 서버에 이 기기의 구독이 없다(끊겼다): 다시 켠다
        if (reason instanceof RequestError && reason.status === 409) {
          setState(await enablePush());
          toast('알림이 끊겨 있어서 다시 켰어요. 한 번 더 보내 보세요.');
        } else throw reason;
      }
    });

  return (
    <SetCard id="alerts" title="알림">
      <SetRow label="이 기기 알림" sub={info ? `${info.text}${installHint}` : undefined}>
        {state === 'off' ? (
          <button type="button" className="small-button strong" onClick={() => void run(async () => setState(await enablePush()))}>
            켜기
          </button>
        ) : info ? (
          <Badge tone={info.tone}>{info.badge}</Badge>
        ) : null}
      </SetRow>
      <RowError text={error} />
      <ReminderRows />
      {state === 'on' ? (
        <>
          <SetRow label="테스트 알림">
            <button type="button" className="small-button" onClick={() => void test()}>
              보내기
            </button>
          </SetRow>
          <button type="button" className="set-row set-action quiet" onClick={() => void run(async () => setState(await disablePush()))}>
            이 기기에서 알림 끄기
          </button>
        </>
      ) : null}
    </SetCard>
  );
}

/** 저장할 시간 목록: 빈칸을 빼고, 같은 시간은 하나로, 이른 순서로 */
const tidy = (times: readonly string[]) => [...new Set(times.filter(Boolean))].sort();
const sameTimes = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((time, index) => time === b[index]);
/** 더할 때 넣는 시간. 이미 있는 시간과 겹치지 않는 첫 값을 쓴다 (겹치면 저장할 것이 없어 버튼이 먹통이 된다) */
const NEW_TIMES = ['08:10', '21:30', '12:30', '07:00', '19:00'];

interface TimeRow {
  /** 줄마다 고정된 번호. 고치기·지우기를 자리 대신 이것으로 해서, 누르는 사이 줄이 바뀌어도 다른 알림을 건드리지 않는다 */
  id: number;
  time: string;
}

/**
 * 알림 시간. 더하고 지우면 바로, 시간을 바꾸면 고르기를 마칠 때(1.2초 멈추거나 칸을 떠날 때) 저장한다.
 * 저장은 한 번에 하나씩 보내고, 보내는 동안 또 바뀌면 끝난 뒤 마지막 목록을 한 번 더 보낸다. 못 저장하면 저장된 값으로 되돌린다.
 * 서버는 시간 순서로 정리해 저장하지만, 화면의 줄 순서는 다음에 열 때까지 그대로 둔다 (고치는 도중 줄이 움직이지 않게)
 */
function ReminderRows() {
  const { data } = useApi<{ reminders: Reminder[] }>('/reminders');
  const [rows, setRows] = useState<TimeRow[] | null>(null);
  /** 화면의 최신 줄, 서버에 저장된 목록, 마지막으로 보낸 목록, 보내는 중인지, 그동안 또 바뀌었는지 */
  const local = useRef<TimeRow[]>([]);
  const saved = useRef<string[]>([]);
  const sent = useRef<string[]>([]);
  const busy = useRef(false);
  const again = useRef(false);
  const nextId = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const show = (next: TimeRow[]) => {
    local.current = next;
    setRows(next);
  };
  const toRows = (times: readonly string[]) => times.map((time) => ({ id: nextId.current++, time }));

  const persist = async (): Promise<void> => {
    clearTimeout(timer.current);
    timer.current = undefined;
    const filled = tidy(local.current.map((row) => row.time));
    if (sameTimes(filled, sent.current)) return;
    if (busy.current) {
      again.current = true;
      return;
    }
    busy.current = true;
    sent.current = filled;
    try {
      const result = await request<{ reminders: Reminder[] }>('/reminders', { method: 'PUT', json: { times: filled } });
      saved.current = result.reminders.map((reminder) => reminder.local_time);
      sent.current = saved.current;
      const nextFire = Math.min(...result.reminders.map((reminder) => reminder.next_fire_at));
      toast(result.reminders.length > 0 ? `저장했어요 · 다음 알림 ${formatDateTime(nextFire)}` : '알림 시간을 모두 지웠어요.');
    } catch (reason) {
      // 서버에는 저장된 값이 그대로다. 그사이 바꾼 것도 버리고 저장된 값으로 되돌린다
      sent.current = saved.current;
      again.current = false;
      show(toRows(saved.current));
      setError(`${errorMessage(reason)} 저장된 시간으로 되돌렸어요.`);
    } finally {
      busy.current = false;
      if (again.current) {
        again.current = false;
        void persist();
      }
    }
  };

  useEffect(() => {
    if (data && rows === null) {
      saved.current = data.reminders.map((reminder) => reminder.local_time);
      sent.current = saved.current;
      show(toRows(saved.current));
    }
  }, [data, rows]);
  // 고르고 1.2초가 지나기 전에 화면을 떠나도 바꾼 시간을 보낸다
  useEffect(
    () => () => {
      if (timer.current !== undefined) void persist();
    },
    [],
  );

  const change = (next: TimeRow[]) => {
    setError(null);
    show(next);
  };

  if (rows === null) return <div className="set-skeleton" aria-hidden="true" />;
  return (
    <>
      {rows.map((row, index) => (
        <SetRow key={row.id} label={`알림 ${index + 1}`}>
          <input
            type="time"
            className="set-time"
            value={row.time}
            aria-label={`알림 시간 ${index + 1}`}
            onChange={(event) => {
              const time = event.target.value;
              change(local.current.map((item) => (item.id === row.id ? { ...item, time } : item)));
              clearTimeout(timer.current);
              // 휴대폰 시간 고르기는 돌리는 동안에도 값이 바뀐다. 잠깐 멈추면 저장한다
              timer.current = time ? setTimeout(() => void persist(), 1200) : undefined;
            }}
            onBlur={() => void persist()}
          />
          <button
            type="button"
            className="icon-button"
            aria-label={`알림 시간 ${index + 1} 지우기`}
            onClick={() => {
              change(local.current.filter((item) => item.id !== row.id));
              void persist();
            }}
          >
            ✕
          </button>
        </SetRow>
      ))}
      {rows.length < MAX_REMINDERS ? (
        <button
          type="button"
          className="set-row set-action add"
          onClick={() => {
            const taken = local.current.map((item) => item.time);
            change([...local.current, { id: nextId.current++, time: NEW_TIMES.find((time) => !taken.includes(time)) ?? '' }]);
            void persist();
          }}
        >
          + 시간 추가
        </button>
      ) : null}
      <RowError text={error} />
      <p className="set-note">하루 최대 {MAX_REMINDERS}번 · 한국 시간 · 그 시각에 복습할 카드가 있을 때만 알려요</p>
    </>
  );
}

const GOALS = [3, 5, 10, 15, 20].map((value) => ({ value, label: `${value}장` }));

/** 하루 목표(설계서 §9.6, 서버에 저장)와 확신도 묻기(설계서 §9.3, 이 기기에만) */
function ReviewCard({ initialGoal }: { initialGoal: number }) {
  const [goal, setGoal] = useState(initialGoal);
  const [error, setError] = useState<string | null>(null);
  const [confidence, setConfidence] = useState(askConfidence);
  const pick = async (value: number) => {
    const before = goal;
    setGoal(value);
    setError(null);
    try {
      await request('/goal', { method: 'PUT', json: { daily_goal: value } });
      toast(`하루 ${value}장으로 바꿨어요.`);
    } catch (reason) {
      setGoal(before);
      setError(errorMessage(reason));
    }
  };
  return (
    <SetCard id="review" title="복습">
      <SetRow label="하루 목표" sub="이만큼 한 날이 이어지면 스트릭이 돼요. 하루를 빠지면 그 주에 한 번은 프리즈가 막아 줘요." stack>
        <Pills label="하루 목표" options={GOALS} value={goal} onPick={(value) => void pick(value)} />
      </SetRow>
      <RowError text={error} />
      <SwitchRow
        label="답을 고른 뒤 확신도 묻기"
        tags={
          <>
            <Tag accent>권장</Tag>
            <Tag>이 기기</Tag>
          </>
        }
        sub="찍어서 맞힌 카드는 일찍 다시 나오고, 확신했는데 틀린 카드는 따로 짚어 줘요."
        checked={confidence}
        onChange={(checked) => {
          setConfidence(checked);
          setAskConfidence(checked);
        }}
      />
    </SetCard>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: '자동' },
  { value: 'light', label: '밝게' },
  { value: 'dark', label: '어둡게' },
];

/** 이 기기에서만: 밝게·어둡게, 진동, 효과음. 바뀐 모습이 곧 알림이라 따로 알리지 않는다 */
function ScreenCard() {
  const [current, setCurrent] = useState(theme);
  const [buzzing, setBuzzing] = useState(vibrateOn);
  const [sound, setSoundState] = useState(soundOn);
  return (
    <SetCard id="screen" title="화면과 소리" aside={<Tag>이 기기</Tag>}>
      <SetRow label="테마" sub={current === 'auto' ? '기기 설정을 따라요' : undefined}>
        <Pills
          label="화면 밝기"
          options={THEMES}
          value={current}
          onPick={(value) => {
            setCurrent(value);
            setTheme(value);
          }}
        />
      </SetRow>
      {/* 진동은 휴대폰에서만 뜻이 있다. 컴퓨터 Chrome도 vibrate가 있지만 아무 일도 하지 않는다 */}
      {'vibrate' in navigator && matchMedia('(pointer: coarse)').matches ? (
        <SwitchRow
          label="진동"
          sub="맞음·틀림, 목표 달성"
          checked={buzzing}
          onChange={(checked) => {
            setBuzzing(checked);
            setVibrate(checked);
            if (checked) navigator.vibrate(15);
          }}
        />
      ) : null}
      <SwitchRow
        label="효과음"
        sub="맞음·틀림, 목표 달성, 숨은 업적 · iPhone은 무음 모드면 안 나요"
        checked={sound}
        onChange={(checked) => {
          setSoundState(checked);
          setSound(checked);
          if (checked) play('right');
        }}
      />
    </SetCard>
  );
}

interface ConnectedApp {
  id: string;
  name: string;
  created_at: number;
}

/** claude.ai·Claude Code 연결. 권장은 OAuth 주소(/mcp)를 넣고 로그인·허용하는 것이고, 예전 비밀 주소도 계속 된다. 지금 연결 상태를 맨 위에 둔다 */
function ClaudeCard() {
  const address = `${location.origin}/mcp`;
  const { data: apps, reload: reloadApps } = useApi<{ apps: ConnectedApp[] }>('/oauth/apps');
  const { error, setError, run } = useRun();
  const none = apps !== null && apps.apps.length === 0;

  const disconnect = async (app: ConnectedApp) => {
    if (!confirm(`${app.name} 연결을 끊을까요? 그 앱에서 모아이를 쓰려면 다시 연결해야 해요.`)) return;
    await run(async () => {
      await request(`/oauth/apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' });
      toast(`${app.name} 연결을 끊었어요.`);
      reloadApps();
    });
  };
  const copy = (text: string) => void copyText(text).then((ok) => (ok ? toast('복사했어요.') : setError('복사하지 못했어요. 길게 눌러 복사해 주세요.')));

  return (
    <SetCard id="claude" title="클로드 연결">
      {apps === null ? (
        <div className="set-skeleton short" aria-hidden="true" />
      ) : none ? (
        <SetRow label="아직 연결한 앱이 없어요" sub="아래 주소를 claude.ai나 Claude Code의 커넥터에 넣어 주세요." />
      ) : (
        apps.apps.map((app) => (
          <SetRow key={app.id} label={app.name} sub={`${formatDateTime(app.created_at)}에 연결`}>
            <button type="button" className="small-button" onClick={() => void disconnect(app)}>
              끊기
            </button>
          </SetRow>
        ))
      )}
      <SetRow label="커넥터 주소" sub={<code className="set-code">{address}</code>}>
        <button type="button" className={none ? 'small-button strong' : 'small-button'} onClick={() => copy(address)}>
          복사
        </button>
      </SetRow>
      <RowError text={error} />
      {/* 연결한 앱이 없으면 처음부터 펼친다. 앱 목록을 받기 전에는 접어 두고, 받은 뒤 다시 그린다 */}
      <Disclosure key={none ? 'open' : 'closed'} label="연결 방법 보기" sub="claude.ai · Claude Code" defaultOpen={none}>
        <ol className="steps small">
          <li>웹 claude.ai → Customize → Connectors → Add custom connector</li>
          <li>이름은 "모아이", 주소에 위 주소를 넣고 연결한다. 뜨는 창에서 모아이에 로그인하고 "허용"을 누른다.</li>
          <li>도구 7개(저장·찾기·과거 기록·복습 문제·채점·모의면접·분류 보기)를 "Always allow"로 바꾼다. 분류 바꾸기는 여러 개념을 한꺼번에 바꾸니 묻게 둔다.</li>
          <li>
            Claude Code는 <code>claude mcp add --transport http --scope user moai {address}</code> 뒤 <code>/mcp</code>에서 로그인한다.
          </li>
        </ol>
        <Link className="set-inline-link" href="/welcome">
          처음부터 차례로 안내 받기 →
        </Link>
      </Disclosure>
      <Disclosure label="코치 지침 (선택)" sub="면접 코치 프로젝트 지침에 붙여 넣는 글">
        <p className="muted small">
          지침이 없어도 커넥터를 켜 둔 채팅이면 어디서든 "모아이에 저장해줘"라고 하면 저장돼요. 과거에 틀린 지점부터 묻게 하고 싶을 때만 프로젝트 지침에 붙여 넣으세요. 기존 "#
          세션 정리" 부분은 지워요.
        </p>
        <textarea className="instructions" readOnly value={COACH_INSTRUCTIONS} rows={8} aria-label="코치 지침" />
        <button type="button" className="small-button" onClick={() => copy(COACH_INSTRUCTIONS)}>
          지침 복사
        </button>
      </Disclosure>
      <LegacyConnector />
    </SetCard>
  );
}

/** 예전 방식: 비밀 주소. 로그인 창을 못 쓰는 곳을 위해 남겨 둔다. 주소 자체가 비밀번호다. 켜져 있어도 저절로 펼치지 않고 표시만 한다 */
function LegacyConnector() {
  const { data, reload } = useApi<McpTokenStatus>('/mcp-token');
  const [url, setUrl] = useState<string | null>(null);
  const { error, setError, run } = useRun();

  const issue = async () => {
    if (data?.active && !confirm('새 URL을 만들면 지금 쓰는 URL은 바로 막혀요. claude.ai에서 커넥터를 지우고 새로 추가해야 해요. 계속할까요?')) return;
    await run(async () => {
      const result = await request<{ url: string }>('/mcp-token', { method: 'POST' });
      setUrl(result.url);
      reload();
    });
  };
  const drop = async () => {
    if (!confirm('비밀 주소를 지울까요? 그 주소로 연결한 커넥터는 바로 끊겨요.')) return;
    await run(async () => {
      await request('/mcp-token', { method: 'DELETE' });
      toast('비밀 주소를 지웠어요.');
      reload();
    });
  };

  return (
    <Disclosure label="예전 방식: 비밀 주소" badge={data?.active ? <Badge tone="warn">켜져 있음</Badge> : <Badge>꺼짐</Badge>}>
      {data ? (
        <p className="muted small">
          {data.active && data.created_at
            ? `${formatDateTime(data.created_at)}에 만든 비밀 주소를 쓰고 있어요 (마지막 사용 ${data.last_used_at ? formatDate(data.last_used_at) : '아직 없음'}). 90일 동안 안 쓰면 저절로 끊겨요. 로그인으로 연결했다면 이 주소는 지워도 돼요.`
            : '비밀 주소가 없어요. 위의 로그인 연결을 권해요.'}
        </p>
      ) : null}
      {url ? (
        <div className="secret">
          <p className="small">이 주소는 지금 한 번만 보여요. 비밀번호처럼 다른 사람에게 보이지 마세요.</p>
          <code className="secret-url">{url}</code>
          <button type="button" className="small-button strong" onClick={() => void copyText(url).then((ok) => (ok ? toast('복사했어요.') : setError('복사하지 못했어요. 길게 눌러 복사해 주세요.')))}>
            URL 복사
          </button>
          <p className="small">커넥터를 추가할 때 이 주소를 넣고 "No sign in"을 고른다.</p>
        </div>
      ) : (
        <div className="set-buttons">
          <button type="button" className="small-button" onClick={() => void issue()}>
            {data?.active ? '비밀 주소 다시 만들기' : '비밀 주소 만들기'}
          </button>
          {data?.active ? (
            <button type="button" className="small-button danger-text" onClick={() => void drop()}>
              비밀 주소 지우기
            </button>
          ) : null}
        </div>
      )}
      <RowError text={error} />
    </Disclosure>
  );
}

const LINK_TEXT: Record<LoginProvider, Record<string, { text: string; tone: 'good' | 'bad' }>> = {
  github: {
    linked: { text: 'GitHub를 연결했어요. 이제 다른 기기에서 GitHub로 로그인할 수 있어요.', tone: 'good' },
    taken: { text: '이 GitHub 계정은 이미 다른 모아이 계정에 연결되어 있어요.', tone: 'bad' },
    denied: { text: 'GitHub 연결을 취소했어요.', tone: 'bad' },
    expired: { text: '연결 시간이 지났어요. 다시 해 주세요.', tone: 'bad' },
    failed: { text: 'GitHub에서 계정 정보를 받지 못했어요. 잠시 뒤에 다시 해 주세요.', tone: 'bad' },
  },
  google: {
    linked: { text: 'Google 계정을 연결했어요. 이제 다른 기기에서 Google로 로그인할 수 있어요.', tone: 'good' },
    taken: { text: '이 Google 계정은 이미 다른 모아이 계정에 연결되어 있어요.', tone: 'bad' },
    denied: { text: 'Google 연결을 취소했어요.', tone: 'bad' },
    expired: { text: '연결 시간이 지났어요. 다시 해 주세요.', tone: 'bad' },
    failed: { text: 'Google에서 계정 확인을 받지 못했어요. 잠시 뒤에 다시 해 주세요.', tone: 'bad' },
  },
};

/** 로그인 방법(GitHub·Google), 다른 기기 로그인 코드, 로그인한 곳, 로그아웃. 다른 기기에 미치는 동작은 맨 아래 빨간 줄이다 */
function AccountCard({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { data: options } = useApi<AuthOptions>('/auth/options');
  const { query } = useLocation();
  const [result] = useState(() => LINK_TEXT.github[query.get('github') ?? ''] ?? LINK_TEXT.google[query.get('google') ?? '']);
  const [code, setCode] = useState<LoginCode | null>(null);
  const { error, setError, run } = useRun(result?.tone === 'bad' ? result.text : null);
  const signIn = [me.github_login ? 'GitHub' : null, me.google_linked ? 'Google' : null].filter(Boolean).join('나 ');

  // 연결 결과는 처음 열 때 한 번만 알린다 (result는 처음 값 그대로라 다시 돌지 않는다)
  useEffect(() => {
    if (result?.tone === 'good') toast(result.text);
  }, [result]);
  useEffect(() => {
    // 새로 고침해도 같은 안내가 다시 나오지 않게 주소에서 뺀다
    // 기록 깊이(history.state)는 그대로 둔다. 지우면 뒤로가기 규칙이 깨진다
    if (query.has('github') || query.has('google')) history.replaceState(history.state, '', '/settings');
  }, [query]);

  const issue = () =>
    run(async () => {
      setCode(await request<LoginCode>('/login-codes', { method: 'POST' }));
    });

  const logout = async () => {
    await flushReviews();
    const left = await pendingCount();
    const warning = left > 0 ? `아직 보내지 못한 답 ${left}개가 사라져요. ` : '';
    if (!confirm(`${warning}이 기기에서 로그아웃할까요? 이 기기의 알림도 꺼져요. 다른 기기의 로그인은 그대로예요.`)) return;
    try {
      // 다른 사람이 이 기기로 로그인해도 내 알림이 오지 않게, 구독을 끊고 서버에서도 지운다
      const endpoint = await dropLocalPush();
      await request('/auth/logout', { method: 'POST', json: endpoint ? { endpoint } : {} });
      await clearDeviceData();
      forgetAiStatus();
      onLogout();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const provider = (name: 'github' | 'google') => {
    const linked = name === 'github' ? me.github_login !== null : me.google_linked;
    if (linked) return <Badge tone="good">연결됨</Badge>;
    if (!options?.[name]) return <Badge>못 씀</Badge>;
    return (
      <a className="small-button" href={`/api/auth/${name}/start?intent=link`}>
        {name === 'google' ? <IconGoogle /> : null}
        연결
      </a>
    );
  };

  return (
    <SetCard id="account" title="계정과 기기">
      <RowError text={error} />
      <h3>로그인 방법</h3>
      <SetRow label="GitHub" sub={me.github_login ? `@${me.github_login}` : undefined}>
        {provider('github')}
      </SetRow>
      <SetRow label="Google">{provider('google')}</SetRow>
      <SetRow label="다른 기기에서 로그인" sub={signIn ? `${location.host}에서 "${signIn}로 계속하기"를 누르거나 코드를 쓰세요` : '로그인 코드를 만들어 다른 기기에 넣으세요'}>
        {code ? null : (
          <button type="button" className="small-button" onClick={() => void issue()}>
            코드 만들기
          </button>
        )}
      </SetRow>
      {code ? (
        <div className="set-more">
          <p className="small">다른 기기의 로그인 화면에서 "로그인 코드로"에 넣으세요. {formatDateTime(code.expires_at)}까지 한 번만 쓸 수 있어요.</p>
          <code className="secret-url login-code">{code.code}</code>
        </div>
      ) : null}
      <Logins onLogout={() => void logout()} />
    </SetCard>
  );
}

/** 로그인한 기기와 다른 기기 모두 로그아웃 (잃어버린 기기를 끊을 때). 기기 이름은 저장하지 않아서 마지막 사용일만 보여 준다 */
function Logins({ onLogout }: { onLogout: () => void }) {
  const { data, reload } = useApi<{ logins: LoginSummary[] }>('/logins');
  const { error, run } = useRun();
  const others = data?.logins.filter((login) => !login.current) ?? [];

  const endOthers = async () => {
    if (!confirm('이 기기만 남기고 다른 기기에서 모두 로그아웃할까요? 다른 기기의 알림도 꺼져요. Claude 커넥터는 그대로예요.')) return;
    await run(async () => {
      const endpoint = await currentEndpoint();
      const result = await request<{ ended: number }>('/logins', { method: 'DELETE', json: endpoint ? { endpoint } : {} });
      toast(`${result.ended}곳에서 로그아웃했어요.`);
      reload();
    });
  };

  return (
    <>
      <h3>로그인한 곳</h3>
      {data === null ? (
        <div className="set-skeleton short" aria-hidden="true" />
      ) : (
        <>
          <SetRow label="이 기기">
            <Badge>지금</Badge>
          </SetRow>
          {others.map((login, index) => (
            <SetRow key={`${login.created_at}-${index}`} label="다른 기기" sub={`마지막 사용 ${formatDate(login.last_seen_at)}`} />
          ))}
        </>
      )}
      <RowError text={error} />
      {others.length > 0 ? (
        <button type="button" className="set-row set-action danger" onClick={() => void endOthers()}>
          다른 기기 모두 로그아웃
        </button>
      ) : null}
      <button type="button" className="set-row set-action" onClick={onLogout}>
        이 기기에서 로그아웃
      </button>
    </>
  );
}

/** 내 데이터 내보내기와 계정 지우기 (설계서 §14). 오너는 계정을 지울 수 없다 */
function DataCard({ me, onDeleted }: { me: Me; onDeleted: () => void }) {
  const { error, setError, run } = useRun();
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');

  const download = () =>
    run(async () => {
      const response = await fetch('/api/export', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('내보내지 못했어요. 잠시 뒤에 다시 해 주세요.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `moai-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      toast('내려받았어요.');
    });

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirm('정말 지울까요? 저장한 개념, 카드, 복습 기록이 모두 사라지고 되돌릴 수 없어요.')) return;
    try {
      await dropLocalPush();
      await request('/me', { method: 'DELETE', json: { confirm: name } });
      await clearDeviceData();
      forgetAiStatus();
      onDeleted();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  return (
    <SetCard id="data" title="내 데이터">
      <SetRow label="내 데이터 내보내기" sub="개념·카드·복습 기록을 JSON 파일로">
        <button type="button" className="small-button" onClick={() => void download()}>
          내려받기
        </button>
      </SetRow>
      <RowError text={error} />
      {me.role === 'owner' ? null : confirming ? (
        <form className="danger set-danger" onSubmit={(event) => void remove(event)}>
          <p className="small">계정을 지우면 저장한 개념, 카드, 복습 기록, 알림 설정이 모두 사라져요. 먼저 내보내기를 해 두세요.</p>
          <label className="field">
            <span>확인을 위해 내 이름을 그대로 써 주세요: {me.display_name}</span>
            <input value={name} onChange={(event) => setName(event.target.value)} autoComplete="off" required />
          </label>
          <div className="actions">
            <button type="button" className="button" onClick={() => setConfirming(false)}>
              취소
            </button>
            <button type="submit" className="button danger-button" disabled={name.trim() !== me.display_name}>
              계정 지우기
            </button>
          </div>
        </form>
      ) : (
        <button type="button" className="set-row set-action danger" onClick={() => setConfirming(true)}>
          계정 지우기
        </button>
      )}
    </SetCard>
  );
}
