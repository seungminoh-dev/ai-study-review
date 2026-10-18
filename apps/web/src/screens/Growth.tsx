import type { MapResponse, StatsResponse } from '@moai/shared';
import { BadgeShelf } from '../badges';
import { IconFlame } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { CategoryProgress, Heatmap, conceptCounts } from '../progress';
import { useApi } from '../useApi';

// 내 성장 (2단계): 친구와 겨루는 리그 대신 "지난주의 나"와 비교한다. 연속, XP, 익숙해진 개념, 이정표, 최근 12주, 분류별 진행

export function Growth() {
  const { data: stats, error } = useApi<StatsResponse>('/stats');
  const { data: map } = useApi<MapResponse>('/map');
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!stats) return <Loading />;

  const counts = map ? conceptCounts(map.nodes) : null;
  const diff = stats.week.xp - stats.last_week_xp;
  const studied = stats.history.filter((day) => day.reviewed > 0).length;
  return (
    <div className="today">
      <header className="today-head">
        <Mascot size={40} mood={stats.streak > 0 ? 'happy' : 'think'} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p>지난주의 나와 비교해요</p>
          <h1>내 성장</h1>
        </div>
      </header>
      <div className="stat-grid">
        <section className="stat" aria-label="연속 학습">
          <p className="stat-label">연속 학습</p>
          <p className="stat-value" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <IconFlame size={22} />
            {stats.streak}일
          </p>
          <p className="stat-note">최고 {stats.best_streak}일</p>
        </section>
        <section className="stat" aria-label="이번 주 XP">
          <p className="stat-label">이번 주 XP</p>
          <p className="stat-value">{stats.week.xp}</p>
          <p className={diff > 0 ? 'stat-note up' : 'stat-note'}>지난주 {stats.last_week_xp}{diff !== 0 ? ` (${diff > 0 ? '+' : ''}${diff})` : ''}</p>
        </section>
        <section className="stat" aria-label="익숙해진 개념">
          <p className="stat-label">익숙해진 개념</p>
          <p className="stat-value">{counts ? counts.familiar : '–'}</p>
          <p className="stat-note">
            흔들림 {counts ? counts.shaky : 0} · 아직 {counts ? counts.unlearned : 0}
          </p>
        </section>
        <section className="stat" aria-label="오늘">
          <p className="stat-label">오늘 푼 카드</p>
          <p className="stat-value">{stats.today.reviewed}</p>
          <p className="stat-note">
            목표 {stats.goal}장 · {stats.today.xp} XP
          </p>
        </section>
      </div>
      <BadgeShelf badges={stats.badges} />
      <section className="card" aria-labelledby="heat-title">
        <div className="card-head">
          <h2 id="heat-title">최근 12주</h2>
          <span className="aside">{studied}일 공부</span>
        </div>
        <Heatmap history={stats.history} goal={stats.goal} />
      </section>
      {map ? (
        <section className="card" aria-labelledby="category-title">
          <h2 id="category-title">분류별 진행</h2>
          <CategoryProgress nodes={map.nodes} limit={10} />
        </section>
      ) : null}
    </div>
  );
}
