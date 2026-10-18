import type { CategoryNode, MaterialSummary, McpTokenStatus, StatsResponse, TodayResponse } from '@moai/shared';
import { request } from '../api';
import { isStandalone, pushState } from '../push';
import { useEffect, useState } from 'react';
import { cachedQueue } from '../offline/store';
import { Link } from '../router';
import { formatDate, useApi } from '../useApi';

// 오늘 화면 (설계서 §12.1): 남은 카드 수와 예상 시간, 시작 버튼, 스트릭과 하루 목표, 최근 저장 세션, 열린 질문

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];
const ONBOARDED = 'moai:onboarded';

interface Steps {
  installed: boolean;
  push: boolean;
  connector: boolean;
  saved: boolean;
}

/** 처음 쓰는 사람의 시작 체크리스트 (설계서 §2.3 2번). 다 하면 다시 보이지 않는다 */
function Onboarding({ saved }: { saved: boolean }) {
  const [steps, setSteps] = useState<Steps | null>(null);
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(ONBOARDED) === '1';
    } catch {
      return false;
    }
  });
  useEffect(() => {
    if (hidden) return;
    void (async () => {
      const [push, token] = await Promise.all([pushState().catch(() => 'off'), request<McpTokenStatus>('/mcp-token').catch(() => null)]);
      setSteps({ installed: isStandalone(), push: push === 'on', connector: token?.active ?? false, saved });
    })();
  }, [hidden, saved]);
  const done = steps ? Object.values(steps).every(Boolean) : false;
  const hide = () => {
    try {
      localStorage.setItem(ONBOARDED, '1');
    } catch {
      // 저장소를 못 쓰면 다음에 또 보일 뿐이다
    }
    setHidden(true);
  };
  useEffect(() => {
    if (done) hide();
  }, [done]);
  if (hidden || !steps || done) return null;
  const items: { key: keyof Steps; label: string; href: string }[] = [
    { key: 'installed', label: '홈 화면에 추가 (브라우저 메뉴 → 앱 설치)', href: '/settings' },
    { key: 'push', label: '이 기기에서 알림 켜기', href: '/settings' },
    { key: 'connector', label: '커넥터 URL 만들어 claude.ai에 추가 ("No sign in", 분류 바꾸기 말고 도구는 "Always allow")', href: '/settings' },
    { key: 'saved', label: 'claude.ai에서 공부하고 "모아이에 저장해줘"', href: '/sessions' },
  ];
  return (
    <section className="onboarding">
      <h2>시작하기</h2>
      <ol className="checklist">
        {items.map((item) => (
          <li key={item.key} className={steps[item.key] ? 'done' : ''}>
            <Link href={item.href}>
              {steps[item.key] ? '✓' : '○'} {item.label}
            </Link>
          </li>
        ))}
      </ol>
      <button type="button" className="text-button" onClick={hide}>
        그만 보기
      </button>
    </section>
  );
}

/** 분류별 복습과 안 푼 자료 바로 가기 */
function ByCategory() {
  const { data: categories } = useApi<{ categories: CategoryNode[]; unclassified: number }>('/categories');
  const { data: materials } = useApi<{ materials: MaterialSummary[] }>('/materials');
  const tops = [...new Set((categories?.categories ?? []).map((item) => item.path.split('/')[0]!))];
  const unsolved = (materials?.materials ?? []).reduce((sum, material) => sum + material.unsolved_open, 0);
  if (tops.length < 2 && unsolved === 0) return null;
  return (
    <section>
      {tops.length >= 2 ? (
        <>
          <h2>분류별로 복습</h2>
          <p className="chips">
            {tops.map((top) => (
              <Link key={top} className="chip" href={`/review?category=${encodeURIComponent(top)}`}>
                {top}
              </Link>
            ))}
          </p>
        </>
      ) : null}
      {unsolved > 0 ? (
        <Link href="/materials" className="notice link">
          아직 안 푼 자료 카드 {unsolved}장 · 풀면 내 지식이 돼요 →
        </Link>
      ) : null}
    </section>
  );
}

/** 스트릭, 오늘 목표, 이번 주 (설계서 §9.6) */
function StreakCard({ stats }: { stats: StatsResponse }) {
  const progress = Math.min(1, stats.today.reviewed / stats.goal);
  return (
    <section className="streak">
      <div className="streak-head">
        <p>
          <strong className="streak-count">{stats.streak}일</strong> 연속
        </p>
        <span className="muted small">이번 주 {stats.week.xp} XP</span>
      </div>
      <div className="goal" role="progressbar" aria-valuemin={0} aria-valuemax={stats.goal} aria-valuenow={stats.today.reviewed} aria-label="오늘 목표">
        <div style={{ width: `${progress * 100}%` }} />
      </div>
      <p className="muted small">
        오늘 {Math.min(stats.today.reviewed, stats.goal)}/{stats.goal}장
        {stats.today.reviewed >= stats.goal ? ' · 오늘 목표를 채웠어요' : ''}
        {stats.freeze_available ? ' · 프리즈 1회 남음' : ' · 이번 주 프리즈를 썼어요'}
      </p>
      <ol className="week">
        {stats.week.days.map((day, index) => (
          <li key={day.day} className={day.met ? 'met' : day.frozen ? 'frozen' : day.future ? 'future' : ''} title={day.day}>
            <span>{WEEKDAYS[index]}</span>
            <span aria-hidden="true">{day.met ? '●' : day.frozen ? '❄' : '○'}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Today({ name }: { name: string }) {
  const { data, error } = useApi<TodayResponse>('/today');
  const { data: stats } = useApi<StatsResponse>('/stats');
  const [cached, setCached] = useState(0);
  useEffect(() => {
    if (error) void cachedQueue().then((cards) => setCached(cards.length));
  }, [error]);
  if (error) {
    return (
      <div className="screen">
        <p className="notice bad">{error}</p>
        {cached > 0 ? (
          <>
            <p className="muted">저장해 둔 카드 {cached}장으로 복습할 수 있어요. 답은 연결되면 보내요.</p>
            <div className="bottom-actions">
              <Link className="button primary" href="/review">
                저장해 둔 카드로 시작
              </Link>
            </div>
          </>
        ) : null}
      </div>
    );
  }
  if (!data) return <div className="center muted">불러오는 중…</div>;

  const empty = data.remaining === 0;
  return (
    <div className="screen">
      <p className="muted">{name}님, 안녕하세요</p>
      <section className="hero">
        {empty ? (
          <>
            <p className="big">{data.reviewed_today > 0 ? '오늘 복습을 다 했어요' : '오늘 복습할 카드가 없어요'}</p>
            <p className="muted">
              {data.reviewed_today > 0
                ? `오늘 ${data.reviewed_today}장을 풀었어요. 다음 카드는 알림으로 알려 드릴게요.`
                : 'claude.ai에서 공부하고 "정리해줘"라고 하면 카드가 여기로 와요.'}
            </p>
          </>
        ) : (
          <>
            <p className="big">오늘 복습 {data.remaining}장</p>
            <p className="muted">약 {data.minutes}분</p>
          </>
        )}
      </section>

      <Onboarding saved={data.sessions.length > 0} />
      <ByCategory />
      {stats ? <StreakCard stats={stats} /> : null}

      {!data.reminders_set ? (
        <Link className="notice link" href="/settings">
          알림 시간을 정하면 복습할 때 알려 드려요 →
        </Link>
      ) : null}

      {data.followups.length > 0 ? (
        <section>
          <h2>다음에 볼 질문</h2>
          <ul className="list">
            {data.followups.map((followup) => (
              <li key={followup.id}>
                <span className="chip">{followup.concept_name}</span> {followup.question}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {data.sessions.length > 0 ? (
        <section>
          <h2>최근 저장</h2>
          <ul className="list">
            {data.sessions.map((session) => (
              <li key={session.id}>
                <Link href={`/sessions/${session.id}`} className="row-link">
                  <span>{session.topic}</span>
                  <span className="muted small">
                    {formatDate(session.created_at)} · 카드 {session.cards}장
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {!empty ? (
        <div className="bottom-actions">
          {data.remaining > 8 ? (
            <Link className="button" href="/review?size=5">
              가볍게 5장
            </Link>
          ) : null}
          <Link className="button primary" href="/review">
            시작
          </Link>
        </div>
      ) : null}
    </div>
  );
}
