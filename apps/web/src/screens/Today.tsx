import type { StatsResponse, TodayResponse } from '@moai/shared';
import { useEffect, useState } from 'react';
import { cachedQueue } from '../offline/store';
import { Link } from '../router';
import { formatDate, useApi } from '../useApi';

// 오늘 화면 (설계서 §12.1): 남은 카드 수와 예상 시간, 시작 버튼, 스트릭과 하루 목표, 최근 저장 세션, 열린 질문

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 스트릭, 오늘 목표, 이번 주 (설계서 §9.6) */
function StreakCard({ stats }: { stats: StatsResponse }) {
  const progress = Math.min(1, stats.today.reviewed / stats.goal);
  return (
    <section className="streak">
      <div className="streak-head">
        <p>
          <strong className="streak-count">{stats.streak}일</strong> 연속
        </p>
        <Link href="/league" className="small">
          이번 주 {stats.week.xp} XP · 리그 →
        </Link>
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
