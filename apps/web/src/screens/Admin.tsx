import type { BetaMetrics, CreditAdminRow, InviteSummary, MemberSummary, UsageReport } from '@moai/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { forgetAiStatus } from '../ai';
import { copyText } from '../copy';
import { Badge, Disclosure, RowError, SetCard, SetRow, Toaster, toast } from '../settings-ui';
import { formatDate, useApi, useRun } from '../useApi';

// 관리 대시보드 (/admin, 오너만): 설정 맨 아래에 있던 초대·회원·베타 지표·AI 사용량·크레딧 주기를 따로 뺀 화면.
// 서버의 /api/admin/*는 app.ts에서 오너만 통과시킨다. 이 화면을 숨기는 것은 보기 좋게 하려는 것뿐이다.
// 컴퓨터는 위에 숫자 칸 네 개, 아래 두 칸(왼쪽 지표·AI, 오른쪽 사람). 휴대폰은 같은 순서로 한 줄이다.

const usd = (value: number) => `$${value.toFixed(2)}`;
const percent = (value: number) => `${Math.round(value * 100)}%`;

const KIND: Record<string, string> = {
  ask: '개념 물어보기',
  interview: '모의면접',
  grade: 'AI 채점',
  cards: '대화로 카드 만들기',
  import: '대화 붙여넣기',
};

export function Admin() {
  const metrics = useApi<BetaMetrics>('/admin/metrics');
  const usage = useApi<UsageReport>('/admin/usage');
  const members = useApi<{ members: MemberSummary[] }>('/admin/members');
  return (
    <div className="screen admin-screen">
      <h1>관리</h1>
      <p className="muted small">오너만 보는 화면이에요. 숫자는 들어올 때마다 새로 세요.</p>
      <Tiles metrics={metrics.data} usage={usage.data} />
      <div className="admin-grid">
        <div className="admin-col">
          <MetricsCard data={metrics.data} error={metrics.error} />
          <UsageCard data={usage.data} error={usage.error} />
        </div>
        <div className="admin-col">
          <InviteCard members={members.data?.members ?? []} />
          <MemberCard members={members.data?.members ?? null} error={members.error} reload={members.reload} />
          <CreditCard />
        </div>
      </div>
      <Toaster />
    </div>
  );
}

/** 맨 위 숫자 칸. 베타가 끝났다고 볼 기준(설계서 §2.3)을 넘었는지 색으로도, 글자로도 알린다 */
function Tiles({ metrics, usage }: { metrics: BetaMetrics | null; usage: UsageReport | null }) {
  const tiles = [
    { label: '회원', value: metrics ? `${metrics.users}명` : '…', note: metrics ? `14일 유지 ${metrics.retention_14d.eligible ? percent(metrics.retention_14d.retained / metrics.retention_14d.eligible) : '–'}` : '' },
    { label: '주간 복습자', value: metrics ? percent(metrics.weekly_reviewers) : '…', note: '목표 60% 이상', ok: metrics ? metrics.weekly_reviewers >= 0.6 : null },
    { label: '카드 신고율 (30일)', value: metrics ? percent(metrics.report_rate) : '…', note: metrics ? `${metrics.reports_30d}/${metrics.reviewed_cards_30d}장 · 목표 5% 미만` : '', ok: metrics ? metrics.report_rate < 0.05 : null },
    { label: 'AI 비용 (이번 달)', value: usage ? usd(usage.total_usd) : '…', note: usage ? `한도 ${usd(usage.monthly_cap_usd)}의 ${percent(usage.total_usd / Math.max(usage.monthly_cap_usd, 0.01))}` : '', ok: usage ? usage.total_usd < 100 : null },
  ];
  return (
    <div className="admin-tiles">
      {tiles.map((tile) => (
        <div key={tile.label} className={tile.ok === false ? 'admin-tile off' : 'admin-tile'}>
          <span>{tile.label}</span>
          <strong>{tile.value}</strong>
          <small>
            {tile.ok === false ? '기준 밖 · ' : ''}
            {tile.note}
          </small>
        </div>
      ))}
    </div>
  );
}

/** 베타 지표 (설계서 §2.3, 기획서 §13). 사람별 목록과 설문 메모는 접어 둔다 */
function MetricsCard({ data, error }: { data: BetaMetrics | null; error: string | null }) {
  return (
    <SetCard title="베타 지표">
      <RowError text={error} />
      {data ? (
        <>
          <SetRow label="저장 → 첫 복습" sub="하루 넘게 지난 대화 저장 중 카드를 한 장이라도 푼 것">
            <span className="admin-num">{data.first_review.saved === 0 ? '–' : `${percent(data.first_review.reviewed / data.first_review.saved)} (${data.first_review.reviewed}/${data.first_review.saved})`}</span>
          </SetRow>
          <SetRow label="정답률 2회차 → 5회차" sub={`${data.accuracy.second_n}장 · ${data.accuracy.fifth_n}장`}>
            <span className="admin-num">
              {data.accuracy.second === null ? '–' : percent(data.accuracy.second)} → {data.accuracy.fifth === null ? '–' : percent(data.accuracy.fifth)}
            </span>
          </SetRow>
          <Disclosure label="주간 설문: 써먹은 개념이 있었나요?" sub={data.survey[0] ? `이번 주 답 ${data.survey[0].answered}명 · 써먹음 ${data.survey[0].used}명` : '아직 답이 없어요'}>
            <ul className="admin-list">
              {data.survey.map((week) => (
                <li key={week.week}>
                  <strong>
                    {week.week} 주 · 답 {week.answered}명 · 써먹음 {week.used}명
                  </strong>
                  {week.notes.length > 0 ? <span>{week.notes.join(' / ')}</span> : null}
                </li>
              ))}
            </ul>
          </Disclosure>
          <Disclosure label="사람별 복습" sub="최근 7일 푼 카드와 마지막 복습">
            <ul className="admin-list">
              {data.people.map((person) => (
                <li key={`${person.name}-${person.joined_at}`}>
                  <strong>{person.name}</strong>
                  <span>
                    7일 {person.reviews_7d}장 · 마지막 {person.last_review_at ? formatDate(person.last_review_at) : '없음'}
                  </span>
                </li>
              ))}
            </ul>
          </Disclosure>
        </>
      ) : error ? null : (
        <p className="set-note">불러오는 중이에요…</p>
      )}
    </SetCard>
  );
}

/** 이번 달 서버 AI 비용 (설계서 §11.5). 단가는 넉넉히 센 값이고 실제 청구는 Anthropic Console에서 본다 */
function UsageCard({ data, error }: { data: UsageReport | null; error: string | null }) {
  const failed = data?.jobs.filter((job) => job.status === 'failed') ?? [];
  return (
    <SetCard title="AI 사용량 (이번 달)">
      <RowError text={error} />
      {data ? (
        <>
          <div className="admin-bar" role="img" aria-label={`한도의 ${percent(data.total_usd / Math.max(data.monthly_cap_usd, 0.01))} 사용`}>
            <i style={{ width: `${Math.min(100, (data.total_usd / Math.max(data.monthly_cap_usd, 0.01)) * 100)}%` }} />
          </div>
          <p className="set-note">
            {usd(data.total_usd)} / 서비스 전체 한도 {usd(data.monthly_cap_usd)} · 한 사람이 쓰는 양은 AI 크레딧이 정해요. 실제 청구는 Anthropic Console에서 확인하세요.
          </p>
          {data.by_kind.length > 0 ? (
            <p className="set-note">{data.by_kind.map((row) => `${KIND[row.kind] ?? row.kind} ${usd(row.usd)} (${row.calls}번)`).join(' · ')}</p>
          ) : null}
          {data.by_user.length > 0 ? (
            data.by_user.map((row) => (
              <SetRow key={row.name} label={row.name} sub={`${row.calls}번`}>
                <span className="admin-num">{usd(row.usd)}</span>
              </SetRow>
            ))
          ) : (
            <SetRow label="아직 쓴 사람이 없어요" />
          )}
          {data.by_model.length > 0 ? (
            <Disclosure label="모델별" sub="호출 수, 토큰, 한 번에 평균 비용">
              <ul className="admin-list">
                {data.by_model.map((row) => (
                  <li key={row.model}>
                    <strong>{row.model}</strong>
                    <span>
                      {row.calls}번 · 입력 {row.input_tokens.toLocaleString()} · 출력 {row.output_tokens.toLocaleString()} 토큰 · 평균 {usd(row.usd / Math.max(1, row.calls))}
                    </span>
                  </li>
                ))}
              </ul>
            </Disclosure>
          ) : null}
          {failed.length > 0 ? <p className="set-error">실패: {failed.map((job) => `${KIND[job.kind] ?? job.kind} ${job.error ?? ''} ${job.n}건`).join(', ')}</p> : null}
        </>
      ) : error ? null : (
        <p className="set-note">불러오는 중이에요…</p>
      )}
    </SetCard>
  );
}

function inviteState(invite: InviteSummary): string {
  const kind = invite.bind_name ? `${invite.bind_name}님 기기 복구 · ` : '';
  if (invite.used_at) return `${kind}${invite.used_by_name ?? '누군가'}님이 ${invite.bind_name ? '들어왔어요' : '가입했어요'}`;
  if (invite.expires_at <= Date.now()) return `${kind}만료됐어요`;
  return `${kind}${formatDate(invite.expires_at)}까지`;
}

/** 초대 코드 (설계서 §8.4). 코드는 만들 때 한 번만 보이고 링크에 넣지 않는다. 받은 사람이 앱 안에서 직접 입력한다 */
function InviteCard({ members }: { members: MemberSummary[] }) {
  const { data, reload } = useApi<{ invites: InviteSummary[] }>('/admin/invites');
  const [label, setLabel] = useState('');
  const [bind, setBind] = useState('');
  const [created, setCreated] = useState<{ label: string; code: string; recovery: boolean } | null>(null);
  const { error, setError, run } = useRun();

  const create = async (event: FormEvent) => {
    event.preventDefault();
    await run(async () => {
      const result = await request<{ invite: InviteSummary; code: string }>('/admin/invites', { method: 'POST', json: bind ? { label, bind_user_id: bind } : { label } });
      setCreated({ label: result.invite.label, code: result.code, recovery: result.invite.bind_name !== null });
      setLabel('');
      setBind('');
      reload();
    });
  };

  const remove = async (invite: InviteSummary) => {
    if (!confirm(`"${invite.label}" 초대를 지울까요? 그 코드로는 가입할 수 없게 돼요.`)) return;
    try {
      await request(`/admin/invites/${encodeURIComponent(invite.id)}`, { method: 'DELETE' });
      reload();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };

  const shareText = created
    ? `모아이 초대 코드: ${created.code}\n${location.origin} 을 Chrome이나 Safari로 열어서(카톡 안에서는 설치와 알림이 안 돼요) GitHub나 Google로 로그인한 뒤 이 코드를 넣어 주세요. ${created.recovery ? '24시간' : '7일'} 동안 한 번 쓸 수 있어요.`
    : '';

  return (
    <SetCard title="초대">
      <p className="set-note">새 친구 초대는 7일, 기기 복구 초대는 24시간 동안 한 번 써요. 코드는 만들 때 한 번만 보여요.</p>
      {created ? (
        <div className="set-more">
          <p className="small">{created.label}님에게 보낼 코드예요.</p>
          <code className="secret-url login-code">{created.code}</code>
          <button type="button" className="small-button strong" onClick={() => void copyText(shareText).then((ok) => (ok ? toast('안내 문구와 함께 복사했어요.') : setError('복사하지 못했어요. 코드를 길게 눌러 복사해 주세요.')))}>
            안내와 함께 복사
          </button>
        </div>
      ) : null}
      <form className="set-form" onSubmit={(event) => void create(event)}>
        <label className="field">
          <span>누구에게 보낼까요?</span>
          <input value={label} onChange={(event) => setLabel(event.target.value)} maxLength={30} placeholder="예: 민수" required />
        </label>
        {members.length > 0 ? (
          <label className="field">
            <span>종류</span>
            <select value={bind} onChange={(event) => setBind(event.target.value)}>
              <option value="">새 친구 가입</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  기기 복구: {member.display_name}
                  {member.github_login ? ` (@${member.github_login})` : ''}
                </option>
              ))}
            </select>
            {bind ? (
              <span className="muted small">
                이 코드로 들어오면 그 사람 계정으로 로그인하고, 들어올 때 쓴 GitHub나 Google 계정을 새로 이어요. 다른 기기의 로그인, 연결한 Claude 앱, 비밀 주소, 알림 구독은
                모두 끊겨서 다시 연결해야 해요.
              </span>
            ) : null}
          </label>
        ) : null}
        <button type="submit" className="small-button">
          초대 코드 만들기
        </button>
      </form>
      <RowError text={error} />
      {data && data.invites.length > 0
        ? data.invites.map((invite) => (
            <SetRow key={invite.id} label={invite.label} sub={inviteState(invite)}>
              {invite.used_at ? null : (
                <button type="button" className="small-button" onClick={() => void remove(invite)}>
                  지우기
                </button>
              )}
            </SetRow>
          ))
        : null}
    </SetCard>
  );
}

/** 회원 이용 멈추기·다시 열기 (이용약관의 이용 정지). 멈추면 그 회원의 로그인·커넥터·알림이 모두 끊긴다 */
function MemberCard({ members, error, reload }: { members: MemberSummary[] | null; error: string | null; reload: () => void }) {
  const { error: failure, run } = useRun();
  const toggle = async (member: MemberSummary) => {
    const disable = member.disabled_at === null;
    if (disable && !confirm(`${member.display_name}님의 이용을 멈출까요? 그 사람의 로그인, 커넥터, 알림이 모두 끊기고 다시 열 때까지 로그인할 수 없어요. 데이터는 지우지 않아요.`)) return;
    await run(async () => {
      await request(`/admin/members/${encodeURIComponent(member.id)}/${disable ? 'disable' : 'enable'}`, { method: 'POST' });
      toast(disable ? `${member.display_name}님의 이용을 멈췄어요.` : `${member.display_name}님이 다시 로그인할 수 있어요.`);
      reload();
    });
  };
  return (
    <SetCard title="회원" aside={members ? <Badge>{members.length}명</Badge> : undefined}>
      <RowError text={error ?? failure} />
      {members === null ? null : members.length === 0 ? (
        <SetRow label="아직 회원이 없어요" />
      ) : (
        members.map((member) => (
          <SetRow
            key={member.id}
            label={member.display_name}
            sub={`${member.github_login ? `@${member.github_login} · ` : ''}${member.disabled_at ? `${formatDate(member.disabled_at)}부터 멈춤` : `${formatDate(member.created_at)} 가입`}`}
            tags={member.disabled_at ? <Badge tone="warn">멈춤</Badge> : undefined}
          >
            <button type="button" className={member.disabled_at ? 'small-button' : 'small-button danger-text'} onClick={() => void toggle(member)}>
              {member.disabled_at ? '다시 열기' : '이용 멈추기'}
            </button>
          </SetRow>
        ))
      )}
    </SetCard>
  );
}

/** 보유 크레딧 주기. 돈이 오가지 않는 앱 안 재화다. 되돌리는 기능이 없어서 주기 전에 한 번 묻는다 */
function CreditCard() {
  const { data, error, reload } = useApi<{ people: CreditAdminRow[] }>('/admin/credits');
  const [target, setTarget] = useState('');
  const [amount, setAmount] = useState(100);
  const [note, setNote] = useState('');
  const { error: failure, run } = useRun();

  const grant = async (event: FormEvent) => {
    event.preventDefault();
    const person = data?.people.find((row) => row.id === target);
    if (!person || !confirm(`${person.name}님에게 보유 크레딧 ${amount}을 줄까요? 준 뒤에는 되돌릴 수 없어요.`)) return;
    await run(async () => {
      await request('/admin/credits', { method: 'POST', json: { user_id: target, amount, ...(note.trim() ? { note: note.trim() } : {}) } });
      toast(`${person.name}님에게 보유 크레딧 ${amount}을 줬어요.`);
      setNote('');
      forgetAiStatus();
      reload();
    });
  };

  return (
    <SetCard title="AI 크레딧 주기">
      <RowError text={error ?? failure} />
      {data ? (
        <>
          {data.people.map((person) => (
            <SetRow key={person.id} label={person.name} sub={`월간 ${person.credits.monthly} · 이번 달 ${person.used_month} 씀`}>
              <span className="admin-num">보유 {person.credits.held}</span>
            </SetRow>
          ))}
          <form className="set-form" onSubmit={(event) => void grant(event)}>
            <label className="field">
              <span>누구에게</span>
              <select value={target} onChange={(event) => setTarget(event.target.value)} required>
                <option value="">고르기</option>
                {data.people.map((person) => (
                  <option key={person.id} value={person.id}>
                    {person.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              <span>얼마나</span>
              <input type="number" min={1} max={100000} value={amount} onChange={(event) => setAmount(Number(event.target.value))} required />
            </label>
            <label className="field">
              <span>메모 (받는 사람 기록에 보여요)</span>
              <input value={note} onChange={(event) => setNote(event.target.value)} maxLength={80} placeholder="예: 베타 감사" />
            </label>
            <button type="submit" className="small-button">
              보유 크레딧 주기
            </button>
          </form>
        </>
      ) : null}
    </SetCard>
  );
}
