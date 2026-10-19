import type { AuthOptions, BetaMetrics, InviteSummary, LoginCode, McpTokenStatus, Me, MemberSummary, Reminder, UsageReport } from '@moai/shared';
import { MAX_REMINDERS } from '@moai/shared/client';
import { useEffect, useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { COACH_INSTRUCTIONS } from '../coach';
import { forgetAiStatus } from '../ai';
import { copyText } from '../copy';
import { clearDeviceData, flushReviews, pendingCount } from '../offline/store';
import { disablePush, dropLocalPush, enablePush, isStandalone, pushState, type PushState } from '../push';
import { Link, useLocation } from '../router';
import { formatDate, formatDateTime, useApi } from '../useApi';
import { setTheme, setVibrate, theme, vibrateOn, type Theme } from '../prefs';
import { askConfidence, setAskConfidence } from './Review';

// 설정 (설계서 §12.1): 알림 시간, 알림 켜기·테스트, 커넥터 URL, 계정과 다른 기기 로그인, 초대(오너), 코치 지침 복사(선택)

export function Settings({ me, onLogout }: { me: Me; onLogout: () => void }) {
  return (
    <div className="screen">
      <h1>설정</h1>
      <Link className="notice link" href="/welcome">
        설치, 클로드 연결, 알림을 차례로 안내하는 시작 가이드 다시 보기 →
      </Link>
      <PushSection />
      <ReminderSection />
      <GoalSection initial={me.daily_goal} />
      <ConfidenceSection />
      <ScreenSection />
      <ConnectorSection />
      <AccountSection me={me} onLogout={onLogout} />
      <CoachSection />
      <DataSection me={me} onDeleted={onLogout} />
      <p className="legal-links small">
        <Link href="/privacy">개인정보 처리방침</Link>
        <Link href="/terms">이용약관</Link>
      </p>
      {/* 오너만 쓰는 것은 내 설정과 섞이지 않게 맨 아래에 모은다 */}
      {me.role === 'owner' ? (
        <div className="admin">
          <h2 className="admin-title">관리</h2>
          <InviteSection />
          <MetricsSection />
          <UsageSection />
        </div>
      ) : null}
    </div>
  );
}

function Status({ text, tone }: { text: string; tone: 'good' | 'bad' | 'warn' | 'muted' }) {
  return <p className={`notice ${tone}`}>{text}</p>;
}

const PUSH_TEXT: Record<PushState, string> = {
  unsupported: '이 브라우저는 웹 푸시를 지원하지 않아요.',
  'needs-install': 'iPhone은 Safari 공유 버튼 → "홈 화면에 추가"로 설치한 앱에서만 알림을 받을 수 있어요.',
  denied: '알림이 차단되어 있어요. 휴대폰 설정에서 이 앱의 알림을 허용해 주세요.',
  off: '이 기기에서는 알림이 꺼져 있어요.',
  on: '이 기기에서 알림을 받아요.',
};

function PushSection() {
  const [state, setState] = useState<PushState | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  useEffect(() => {
    void pushState().then(setState);
  }, []);
  const run = async (action: () => Promise<void>) => {
    setMessage(null);
    try {
      await action();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };
  return (
    <section>
      <h2>알림</h2>
      {/* 차단·미지원은 오류가 아니라 기기 상태라 주의 색으로 보여 준다 */}
      {state ? <Status text={PUSH_TEXT[state]} tone={state === 'on' ? 'good' : state === 'off' ? 'muted' : 'warn'} /> : null}
      {!isStandalone() && state !== 'needs-install' ? <p className="muted small">홈 화면에 추가해 두면 앱처럼 열리고 알림도 잘 와요.</p> : null}
      <div className="actions">
        {state === 'off' ? (
          <button type="button" className="button primary" onClick={() => void run(async () => setState(await enablePush()))}>
            이 기기에서 알림 켜기
          </button>
        ) : null}
        {state === 'on' ? (
          <>
            <button
              type="button"
              className="button"
              onClick={() =>
                void run(async () => {
                  const result = await request<{ sent: number; failed: number }>('/push/test', { method: 'POST' });
                  setMessage({ text: `테스트 알림을 보냈어요 (기기 ${result.sent}대).`, tone: 'good' });
                })
              }
            >
              테스트 알림
            </button>
            <button type="button" className="button" onClick={() => void run(async () => setState(await disablePush()))}>
              알림 끄기
            </button>
          </>
        ) : null}
      </div>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
    </section>
  );
}

function ReminderSection() {
  const { data } = useApi<{ reminders: Reminder[] }>('/reminders');
  const [times, setTimes] = useState<string[] | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  useEffect(() => {
    if (data && times === null) setTimes(data.reminders.map((reminder) => reminder.local_time));
  }, [data, times]);
  if (times === null) return null;

  const save = async () => {
    setMessage(null);
    try {
      const filled = [...new Set(times.filter(Boolean))].sort();
      const result = await request<{ reminders: Reminder[] }>('/reminders', { method: 'PUT', json: { times: filled } });
      setTimes(result.reminders.map((reminder) => reminder.local_time));
      const next = Math.min(...result.reminders.map((reminder) => reminder.next_fire_at));
      setMessage({ text: result.reminders.length > 0 ? `저장했어요. 다음 알림은 ${formatDateTime(next)}이에요.` : '알림 시간을 모두 지웠어요.', tone: 'good' });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  return (
    <section>
      <h2>알림 시간</h2>
      <p className="muted small">하루 최대 {MAX_REMINDERS}번, 한국 시간이에요. 그 시각에 복습할 카드가 있을 때만 알려요.</p>
      <ul className="times">
        {times.map((time, index) => (
          <li key={index}>
            <input
              type="time"
              value={time}
              aria-label={`알림 시간 ${index + 1}`}
              onChange={(event) => setTimes(times.map((value, i) => (i === index ? event.target.value : value)))}
            />
            <button type="button" className="text-button" onClick={() => setTimes(times.filter((_, i) => i !== index))}>
              지우기
            </button>
          </li>
        ))}
      </ul>
      <div className="actions">
        {times.length < MAX_REMINDERS ? (
          <button type="button" className="button" onClick={() => setTimes([...times, times.length === 0 ? '08:10' : '21:30'])}>
            시간 추가
          </button>
        ) : null}
        <button type="button" className="button primary" onClick={() => void save()}>
          저장
        </button>
      </div>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
    </section>
  );
}

interface ConnectedApp {
  id: string;
  name: string;
  created_at: number;
}

/** claude.ai·Claude Code 연결. 권장은 OAuth 주소(/mcp)를 넣고 로그인·허용하는 것이고, 예전 비밀 주소도 계속 된다 */
function ConnectorSection() {
  const address = `${location.origin}/mcp`;
  const { data: apps, reload: reloadApps } = useApi<{ apps: ConnectedApp[] }>('/oauth/apps');
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  const disconnect = async (app: ConnectedApp) => {
    if (!confirm(`${app.name} 연결을 끊을까요? 그 앱에서 모아이를 쓰려면 다시 연결해야 해요.`)) return;
    try {
      await request(`/oauth/apps/${encodeURIComponent(app.id)}`, { method: 'DELETE' });
      reloadApps();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  return (
    <section>
      <h2>클로드 커넥터</h2>
      <p className="small">커넥터 주소에 아래 주소를 넣고 연결하면 모아이 로그인 창이 떠요. 로그인하고 "허용"을 누르면 끝이에요.</p>
      <code className="secret-url">{address}</code>
      <div className="actions">
        <button
          type="button"
          className="button primary"
          onClick={() => void copyText(address).then((ok) => setMessage(ok ? { text: '복사했어요.', tone: 'good' } : { text: '복사하지 못했어요. 길게 눌러 복사해 주세요.', tone: 'bad' }))}
        >
          주소 복사
        </button>
      </div>
      <ol className="steps small">
        <li>웹 claude.ai → Customize → Connectors → Add custom connector</li>
        <li>이름은 "모아이", 주소에 위 주소를 넣고 연결한다. 뜨는 창에서 모아이에 로그인하고 "허용"을 누른다.</li>
        <li>도구 7개(저장·찾기·과거 기록·복습 문제·채점·모의면접·분류 보기)를 "Always allow"로 바꾼다. 분류 바꾸기는 여러 개념을 한꺼번에 바꾸니 묻게 둔다.</li>
        <li>Claude Code는 <code>claude mcp add --transport http --scope user moai {address}</code> 뒤 <code>/mcp</code>에서 로그인한다.</li>
      </ol>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
      <h3>연결한 앱</h3>
      {apps && apps.apps.length > 0 ? (
        <ul className="invites">
          {apps.apps.map((app) => (
            <li key={app.id}>
              <p>
                <strong>{app.name}</strong>
                <br />
                <span className="muted small">{formatDateTime(app.created_at)}에 연결</span>
              </p>
              <button type="button" className="text-button" onClick={() => void disconnect(app)}>
                끊기
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">아직 로그인으로 연결한 앱이 없어요.</p>
      )}
      <LegacyConnector />
    </section>
  );
}

/** 예전 방식: 비밀 주소. 로그인 창을 못 쓰는 곳을 위해 남겨 둔다. 주소 자체가 비밀번호다 */
function LegacyConnector() {
  const { data, reload } = useApi<McpTokenStatus>('/mcp-token');
  const [url, setUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  const issue = async () => {
    if (data?.active && !confirm('새 URL을 만들면 지금 쓰는 URL은 바로 막혀요. claude.ai에서 커넥터를 지우고 새로 추가해야 해요. 계속할까요?')) return;
    try {
      const result = await request<{ url: string }>('/mcp-token', { method: 'POST' });
      setUrl(result.url);
      setMessage(null);
      reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  return (
    <details className="legacy-connector" open={Boolean(data?.active) || undefined}>
      <summary>예전 방식: 비밀 주소로 연결</summary>
      {data ? (
        <p className="muted small">{data.active && data.created_at ? `${formatDateTime(data.created_at)}에 만든 비밀 주소를 쓰고 있어요. 로그인으로 연결했다면 이 주소는 지워도 돼요.` : '비밀 주소가 없어요. 위의 로그인 연결을 권해요.'}</p>
      ) : null}
      {url ? (
        <div className="secret">
          <p className="small">이 주소는 지금 한 번만 보여요. 비밀번호처럼 다른 사람에게 보이지 마세요.</p>
          <code className="secret-url">{url}</code>
          <button
            type="button"
            className="button primary"
            onClick={() => void copyText(url).then((ok) => setMessage(ok ? { text: '복사했어요.', tone: 'good' } : { text: '복사하지 못했어요. 길게 눌러 복사해 주세요.', tone: 'bad' }))}
          >
            URL 복사
          </button>
          <p className="small">커넥터를 추가할 때 이 주소를 넣고 "No sign in"을 고른다.</p>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="button" onClick={() => void issue()}>
            {data?.active ? '비밀 주소 다시 만들기' : '비밀 주소 만들기'}
          </button>
          {data?.active ? (
            <button
              type="button"
              className="button"
              onClick={() =>
                void request('/mcp-token', { method: 'DELETE' })
                  .then(() => reload())
                  .catch((error) => setMessage({ text: errorMessage(error), tone: 'bad' }))
              }
            >
              비밀 주소 지우기
            </button>
          ) : null}
        </div>
      )}
      {message ? <Status text={message.text} tone={message.tone} /> : null}
    </details>
  );
}

function CoachSection() {
  const [copied, setCopied] = useState<boolean | null>(null);
  return (
    <section>
      <h2>코치 지침 (선택)</h2>
      <p className="muted small">
        지침이 없어도 커넥터를 켜 둔 채팅이면 어디서든 "모아이에 저장해줘"라고 하면 저장돼요. 면접 코치 프로젝트에서 과거에 틀린 지점부터 묻게 하고
        싶을 때만 프로젝트 지침에 붙여 넣으세요. 기존 "# 세션 정리" 부분은 지워요.
      </p>
      <textarea className="instructions" readOnly value={COACH_INSTRUCTIONS} rows={12} aria-label="코치 지침" />
      <div className="actions">
        <button type="button" className="button" onClick={() => void copyText(COACH_INSTRUCTIONS).then(setCopied)}>
          지침 복사
        </button>
      </div>
      {copied === null ? null : <Status text={copied ? '복사했어요.' : '복사하지 못했어요. 위 글을 길게 눌러 복사해 주세요.'} tone={copied ? 'good' : 'bad'} />}
    </section>
  );
}

const GITHUB_TEXT: Record<string, { text: string; tone: 'good' | 'bad' }> = {
  linked: { text: 'GitHub를 연결했어요. 이제 다른 기기에서 GitHub로 로그인할 수 있어요.', tone: 'good' },
  taken: { text: '이 GitHub 계정은 이미 다른 모아이 계정에 연결되어 있어요.', tone: 'bad' },
  denied: { text: 'GitHub 연결을 취소했어요.', tone: 'bad' },
  expired: { text: '연결 시간이 지났어요. 다시 해 주세요.', tone: 'bad' },
  failed: { text: 'GitHub에서 계정 정보를 받지 못했어요. 잠시 뒤에 다시 해 주세요.', tone: 'bad' },
};

function AccountSection({ me, onLogout }: { me: Me; onLogout: () => void }) {
  const { data: options } = useApi<AuthOptions>('/auth/options');
  const { query } = useLocation();
  const [result] = useState(() => GITHUB_TEXT[query.get('github') ?? '']);
  const [code, setCode] = useState<LoginCode | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  useEffect(() => {
    // 새로 고침해도 같은 안내가 다시 나오지 않게 주소에서 뺀다
    // 기록 깊이(history.state)는 그대로 둔다. 지우면 뒤로가기 규칙이 깨진다
    if (query.has('github')) history.replaceState(history.state, '', '/settings');
  }, [query]);

  const issue = async () => {
    setMessage(null);
    try {
      setCode(await request<LoginCode>('/login-codes', { method: 'POST' }));
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

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
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  return (
    <section>
      <h2>계정 · 다른 기기</h2>
      {result ? <Status text={result.text} tone={result.tone} /> : null}
      <p className="small">
        {me.display_name} · {me.github_login ? `GitHub @${me.github_login}` : 'GitHub 연결 안 됨'}
      </p>
      {me.github_login ? (
        <p className="muted small">컴퓨터나 새 휴대폰에서 {location.host}를 열고 "GitHub로 계속하기"를 누르면 이 계정으로 로그인돼요.</p>
      ) : options?.github ? (
        <>
          <p className="muted small">GitHub를 연결해 두면 컴퓨터나 새 휴대폰에서 GitHub로 바로 로그인해요.</p>
          <div className="actions">
            <a className="button primary" href="/api/auth/github/start?intent=link">
              GitHub 연결
            </a>
          </div>
        </>
      ) : null}
      {code ? (
        <div className="secret">
          <p className="small">다른 기기의 로그인 화면에서 "로그인 코드로"에 넣으세요. {formatDateTime(code.expires_at)}까지 한 번만 쓸 수 있어요.</p>
          <code className="secret-url login-code">{code.code}</code>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="button" onClick={() => void issue()}>
            다른 기기 로그인 코드 만들기
          </button>
        </div>
      )}
      {message ? <Status text={message.text} tone={message.tone} /> : null}
      <button type="button" className="text-button" onClick={() => void logout()}>
        이 기기에서 로그아웃
      </button>
    </section>
  );
}

function inviteState(invite: InviteSummary): string {
  const kind = invite.bind_name ? `${invite.bind_name}님 기기 복구 · ` : '';
  if (invite.used_at) return `${kind}${invite.used_by_name ?? '누군가'}님이 ${invite.bind_name ? '들어왔어요' : '가입했어요'}`;
  if (invite.expires_at <= Date.now()) return `${kind}만료됐어요`;
  return `${kind}${formatDate(invite.expires_at)}까지`;
}


function InviteSection() {
  const { data, reload } = useApi<{ invites: InviteSummary[] }>('/invites');
  const [label, setLabel] = useState('');
  const [created, setCreated] = useState<{ label: string; code: string } | null>(null);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);

  const { data: members } = useApi<{ members: MemberSummary[] }>('/members');
  const [bind, setBind] = useState('');

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setMessage(null);
    try {
      const result = await request<{ invite: InviteSummary; code: string }>('/invites', {
        method: 'POST',
        json: bind ? { label, bind_user_id: bind } : { label },
      });
      setCreated({ label: result.invite.label, code: result.code });
      setLabel('');
      reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  const remove = async (invite: InviteSummary) => {
    if (!confirm(`"${invite.label}" 초대를 지울까요? 그 코드로는 가입할 수 없게 돼요.`)) return;
    try {
      await request(`/invites/${invite.id}`, { method: 'DELETE' });
      reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  // 코드는 링크에 넣지 않는다. 받은 사람이 앱 안에서 직접 입력한다 (설계서 §8.4)
  const shareText = created
    ? `모아이 초대 코드: ${created.code}\n${location.origin} 에서 "GitHub로 계속하기"를 누른 뒤 이 코드를 넣어 주세요. 7일 동안 한 번 쓸 수 있어요.`
    : '';

  return (
    <section>
      <h2>초대</h2>
      <p className="muted small">초대 코드는 한 사람이 한 번 써요. 7일 동안 유효하고, 만들 때 한 번만 보여요.</p>
      {created ? (
        <div className="secret">
          <p className="small">{created.label}님에게 보낼 코드예요.</p>
          <code className="secret-url login-code">{created.code}</code>
          <button
            type="button"
            className="button primary"
            onClick={() => void copyText(shareText).then((ok) => setMessage(ok ? { text: '안내 문구와 함께 복사했어요.', tone: 'good' } : { text: '복사하지 못했어요. 코드를 길게 눌러 복사해 주세요.', tone: 'bad' }))}
          >
            안내와 함께 복사
          </button>
        </div>
      ) : null}
      <form onSubmit={(event) => void create(event)}>
        <label className="field">
          <span>누구에게 보낼까요?</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} placeholder="예: 민수" required />
        </label>
        {members && members.members.length > 0 ? (
          <label className="field">
            <span>종류</span>
            <select value={bind} onChange={(event) => setBind(event.target.value)}>
              <option value="">새 친구 가입</option>
              {members.members.map((member) => (
                <option key={member.id} value={member.id}>
                  기기 복구: {member.display_name}
                  {member.github_login ? ` (@${member.github_login})` : ''}
                </option>
              ))}
            </select>
            {bind ? <span className="muted small">이 코드로 들어오면 그 사람 계정으로 로그인하고 GitHub를 새로 이어요. 다른 기기의 로그인, 커넥터 URL, 알림 구독은 모두 끊겨서 커넥터 URL을 다시 만들어야 해요.</span> : null}
          </label>
        ) : null}
        <div className="actions">
          <button type="submit" className="button">
            초대 코드 만들기
          </button>
        </div>
      </form>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
      {data && data.invites.length > 0 ? (
        <ul className="list invites">
          {data.invites.map((invite) => (
            <li key={invite.id}>
              <div>
                <strong>{invite.label}</strong>
                <p className="muted small">{inviteState(invite)}</p>
              </div>
              {invite.used_at ? null : (
                <button type="button" className="text-button" onClick={() => void remove(invite)}>
                  지우기
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

const GOALS = [3, 5, 10, 15, 20];

/** 하루 목표: 이만큼 복습한 날이 이어지면 스트릭이 된다 (설계서 §9.6) */
function GoalSection({ initial }: { initial: number }) {
  const [goal, setGoal] = useState(initial);
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const save = async (value: number) => {
    setGoal(value);
    try {
      await request('/goal', { method: 'PUT', json: { daily_goal: value } });
      setMessage({ text: `하루 ${value}장으로 바꿨어요.`, tone: 'good' });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };
  return (
    <section>
      <h2>하루 목표</h2>
      <p className="muted small">이만큼 복습한 날이 이어지면 스트릭이 돼요. 하루를 빠지면 그 주에 한 번은 프리즈가 자동으로 막아 줘요.</p>
      <div className="segmented" role="group" aria-label="하루 목표">
        {GOALS.map((value) => (
          <button key={value} type="button" className={value === goal ? 'current' : ''} aria-pressed={value === goal} onClick={() => void save(value)}>
            {value}장
          </button>
        ))}
      </div>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
    </section>
  );
}

const usd = (value: number) => `$${value.toFixed(2)}`;

/** 관리자 사용량 (설계서 §11.5): 이번 달 서버 AI 비용. 단가는 보수적으로 센 값이고, 실제 청구는 Anthropic Console에서 본다 */
function UsageSection() {
  const { data, error } = useApi<UsageReport>('/admin/usage');
  if (error) return null;
  if (!data) return null;
  return (
    <section>
      <h2>AI 사용량 (이번 달)</h2>
      <p className="small">
        {usd(data.total_usd)} / 한도 {usd(data.monthly_cap_usd)} · 한 사람 한도 {usd(data.user_cap_usd)}
      </p>
      <p className="muted small">코드에 둔 단가로 넉넉히 센 값이에요. 실제 청구는 Anthropic Console에서 확인하세요.</p>
      {data.by_user.length > 0 ? (
        <ul className="list">
          {data.by_user.map((row) => (
            <li key={row.name}>
              {row.name} · {usd(row.usd)} · {row.calls}번
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted small">아직 쓴 사람이 없어요.</p>
      )}
      {data.by_model.map((row) => (
        <p key={row.model} className="muted small">
          {row.model}: {row.calls}번, 입력 {row.input_tokens.toLocaleString()} · 출력 {row.output_tokens.toLocaleString()} 토큰, 1번에 평균 {usd(row.usd / Math.max(1, row.calls))}
        </p>
      ))}
      {data.jobs.some((job) => job.status === 'failed') ? (
        <p className="muted small">
          실패:{' '}
          {data.jobs
            .filter((job) => job.status === 'failed')
            .map((job) => `${job.kind} ${job.error ?? ''} ${job.n}건`)
            .join(', ')}
        </p>
      ) : null}
    </section>
  );
}

/** 내 데이터 내보내기와 계정 지우기 (설계서 §14) */
function DataSection({ me, onDeleted }: { me: Me; onDeleted: () => void }) {
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState('');

  const download = async () => {
    setMessage(null);
    try {
      const response = await fetch('/api/export', { credentials: 'same-origin' });
      if (!response.ok) throw new Error('내보내지 못했어요. 잠시 뒤에 다시 해 주세요.');
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = `moai-export-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      setMessage({ text: '내려받았어요.', tone: 'good' });
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  const remove = async (event: FormEvent) => {
    event.preventDefault();
    if (!confirm('정말 지울까요? 저장한 개념, 카드, 복습 기록이 모두 사라지고 되돌릴 수 없어요.')) return;
    try {
      await dropLocalPush();
      await request('/me', { method: 'DELETE', json: { confirm: name } });
      await clearDeviceData();
      forgetAiStatus();
      onDeleted();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    }
  };

  return (
    <section>
      <h2>내 데이터</h2>
      <div className="actions">
        <button type="button" className="button" onClick={() => void download()}>
          내 데이터 내보내기 (JSON)
        </button>
      </div>
      {message ? <Status text={message.text} tone={message.tone} /> : null}
      {me.role === 'owner' ? null : confirming ? (
        <form className="danger" onSubmit={(event) => void remove(event)}>
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
        <button type="button" className="text-button" onClick={() => setConfirming(true)}>
          계정 지우기
        </button>
      )}
    </section>
  );
}

/** 확신도 묻기 (설계서 §9.3): 이 기기에만 저장한다 */
function ConfidenceSection() {
  const [on, setOn] = useState(askConfidence);
  return (
    <section>
      <h2>복습 방식</h2>
      <label className="toggle">
        <input
          type="checkbox"
          checked={on}
          onChange={(event) => {
            setOn(event.target.checked);
            setAskConfidence(event.target.checked);
          }}
        />{' '}
        답을 고른 뒤 확신도 묻기 (권장)
      </label>
      <p className="muted small">찍어서 맞힌 카드는 조금 일찍 다시 나오고, 확신했는데 틀린 카드는 따로 짚어 줘요. 한 번 더 누르는 대신 기억이 정확해져요.</p>
    </section>
  );
}

const THEMES: { value: Theme; label: string }[] = [
  { value: 'auto', label: '기기 설정 따르기' },
  { value: 'light', label: '밝게' },
  { value: 'dark', label: '어둡게' },
];

/** 이 기기에서만: 밝게·어둡게, 진동 */
function ScreenSection() {
  const [current, setCurrent] = useState(theme);
  const [buzzing, setBuzzing] = useState(vibrateOn);
  return (
    <section>
      <h2>화면</h2>
      <div className="theme-picker" role="radiogroup" aria-label="화면 밝기">
        {THEMES.map((item) => (
          <label key={item.value} className={current === item.value ? 'theme-option current' : 'theme-option'}>
            <input
              type="radio"
              name="theme"
              value={item.value}
              checked={current === item.value}
              onChange={() => {
                setCurrent(item.value);
                setTheme(item.value);
              }}
            />
            {item.label}
          </label>
        ))}
      </div>
      {/* 진동은 휴대폰에서만 뜻이 있다. 컴퓨터 Chrome도 vibrate가 있지만 아무 일도 하지 않는다 */}
      {'vibrate' in navigator && matchMedia('(pointer: coarse)').matches ? (
        <label className="toggle">
          <input
            type="checkbox"
            checked={buzzing}
            onChange={(event) => {
              setBuzzing(event.target.checked);
              setVibrate(event.target.checked);
              if (event.target.checked) navigator.vibrate(15);
            }}
          />{' '}
          진동 (맞음·틀림, 목표 달성)
        </label>
      ) : null}
      <p className="muted small">이 기기에만 적용돼요.</p>
    </section>
  );
}

const percent = (value: number) => `${Math.round(value * 100)}%`;

/** 베타 지표 (설계서 §2.3 끝났다는 기준): 주간 복습자 60% 이상, 카드 신고율 5% 미만, AI 지출 월 $100 미만 */
function MetricsSection() {
  const { data } = useApi<BetaMetrics>('/admin/metrics');
  if (!data) return null;
  const checks = [
    { label: '주간 복습자', value: percent(data.weekly_reviewers), ok: data.weekly_reviewers >= 0.6, goal: '60% 이상' },
    { label: '카드 신고율 (30일)', value: `${percent(data.report_rate)} (${data.reports_30d}/${data.reviewed_cards_30d})`, ok: data.report_rate < 0.05, goal: '5% 미만' },
    { label: '이번 달 AI 비용', value: `$${data.ai_usd_month.toFixed(2)}`, ok: data.ai_usd_month < 100, goal: '$100 미만' },
  ];
  return (
    <section>
      <h2>베타 지표 ({data.users}명)</h2>
      <ul className="list">
        {checks.map((check) => (
          <li key={check.label} className="metric">
            <span>{check.ok ? '✓' : '✗'} {check.label}</span>
            <span className={check.ok ? 'good-text' : 'bad-text'}>
              {check.value} <span className="muted small">목표 {check.goal}</span>
            </span>
          </li>
        ))}
      </ul>
      <h3>참고 지표</h3>
      <ul className="list">
        <li className="metric">
          <span>14일 유지율</span>
          <span>
            {data.retention_14d.eligible === 0 ? '아직 14일 지난 사람이 없어요' : `${percent(data.retention_14d.retained / data.retention_14d.eligible)} (${data.retention_14d.retained}/${data.retention_14d.eligible})`}
          </span>
        </li>
        <li className="metric">
          <span>저장 → 첫 복습</span>
          <span>{data.first_review.saved === 0 ? '아직 하루 지난 저장이 없어요' : `${percent(data.first_review.reviewed / data.first_review.saved)} (${data.first_review.reviewed}/${data.first_review.saved})`}</span>
        </li>
        <li className="metric">
          <span>정답률 2회차 → 5회차</span>
          <span>
            {data.accuracy.second === null ? '–' : percent(data.accuracy.second)} → {data.accuracy.fifth === null ? '–' : percent(data.accuracy.fifth)}{' '}
            <span className="muted small">
              ({data.accuracy.second_n}장 · {data.accuracy.fifth_n}장)
            </span>
          </span>
        </li>
      </ul>
      <h3>주간 설문: 써먹은 개념이 있었나요?</h3>
      <ul className="list">
        {data.survey.map((week) => (
          <li key={week.week} className="small">
            {week.week} 주 · 답 {week.answered}명 · 써먹음 {week.used}명
            {week.notes.length > 0 ? <span className="muted"> · {week.notes.join(' / ')}</span> : null}
          </li>
        ))}
      </ul>
      <ul className="list">
        {data.people.map((person) => (
          <li key={`${person.name}-${person.joined_at}`} className="small">
            {person.name} · 7일 {person.reviews_7d}장 · 마지막 {person.last_review_at ? formatDate(person.last_review_at) : '없음'}
          </li>
        ))}
      </ul>
    </section>
  );
}
