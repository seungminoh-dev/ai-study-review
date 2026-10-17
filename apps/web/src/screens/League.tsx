import type { LeagueEntry, StatsResponse } from '@moai/shared';
import { Link } from '../router';
import { formatDate, useApi } from '../useApi';

// 이번 주 리그 (설계서 §9.6): 월요일 04:00 KST에 시작해서 친구 전체를 XP 순으로 보여 준다.

export function League() {
  const { data, error } = useApi<{ week_start: number; entries: LeagueEntry[] }>('/league');
  const { data: stats } = useApi<StatsResponse>('/stats');
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;
  return (
    <div className="screen">
      <Link href="/" className="back">
        ← 오늘
      </Link>
      <h1>이번 주 리그</h1>
      <p className="muted small">{formatDate(data.week_start)}부터 · 정답 10 · 오답 2 · 설명하기 20 · 학습 저장 30 XP</p>
      <ol className="list league">
        {data.entries.map((entry, index) => (
          <li key={`${entry.name}-${index}`} className={entry.me ? 'me' : ''}>
            <span className="rank">{index + 1}</span>
            <span className="name">{entry.name}</span>
            <span className="xp">{entry.xp} XP</span>
          </li>
        ))}
      </ol>
      {stats ? (
        <p className="muted small">
          {stats.streak}일 연속 · 하루 목표 {stats.goal}장 (설정에서 바꿀 수 있어요)
        </p>
      ) : null}
    </div>
  );
}
