import type { McpTokenStatus, Reminder } from '@moai/shared';
import { MAX_REMINDERS } from '@moai/shared/client';
import { useEffect, useState } from 'react';
import { errorMessage, request } from '../api';
import { COACH_INSTRUCTIONS } from '../coach';
import { copyText } from '../copy';
import { disablePush, enablePush, isStandalone, pushState, type PushState } from '../push';
import { formatDateTime, useApi } from '../useApi';

// 설정 (설계서 §12.1): 알림 시간, 알림 켜기·테스트, 커넥터 URL, 코치 지침 복사(선택)

export function Settings() {
  return (
    <div className="screen">
      <h1>설정</h1>
      <PushSection />
      <ReminderSection />
      <ConnectorSection />
      <CoachSection />
    </div>
  );
}

function Status({ text, tone }: { text: string; tone: 'good' | 'bad' | 'muted' }) {
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
      {state ? <Status text={PUSH_TEXT[state]} tone={state === 'on' ? 'good' : state === 'off' ? 'muted' : 'bad'} /> : null}
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

function ConnectorSection() {
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
    <section>
      <h2>claude.ai 커넥터</h2>
      {data ? (
        <p className="muted small">{data.active && data.created_at ? `${formatDateTime(data.created_at)}에 만든 URL을 쓰고 있어요.` : '아직 커넥터 URL이 없어요.'}</p>
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
          <ol className="steps small">
            <li>웹 claude.ai → Customize → Connectors → Add custom connector</li>
            <li>이름은 "모아이", 주소에 위 URL을 넣고 "No sign in"을 고른다.</li>
            <li>도구 3개(find_concepts, save_learning, get_learner_context)를 "Always allow"로 바꾼다.</li>
            <li>폰 앱에서는 따로 할 일 없이 바로 쓸 수 있다.</li>
          </ol>
        </div>
      ) : (
        <div className="actions">
          <button type="button" className="button" onClick={() => void issue()}>
            {data?.active ? '커넥터 URL 다시 만들기' : '커넥터 URL 만들기'}
          </button>
        </div>
      )}
      {message ? <Status text={message.text} tone={message.tone} /> : null}
    </section>
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
