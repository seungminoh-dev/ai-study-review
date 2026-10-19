import type { MapResponse, MaterialSummary, McpTokenStatus, StatsResponse, TodayResponse } from '@moai/shared';
import { materialLabel } from '@moai/shared/client';
import { useEffect, useState } from 'react';
import { aiStatus } from '../ai';
import { request } from '../api';
import { NewBadges } from '../badges';
import { IconArrow, IconBook, IconCheck, IconFlame, IconSettings } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { materialReview, partView } from '../materials';
import { cachedQueue } from '../offline/store';
import { CategoryProgress, Heatmap, Ring, StreakGoal, WeekDays, conceptCounts, todayLabel } from '../progress';
import { isStandalone, pushState } from '../push';
import { Link, TabLink } from '../router';
import { useApi } from '../useApi';

// 오늘 화면 (설계서 §12.1, 2단계 시안): 남은 카드와 목표 링, 시작 버튼, 이번 주, 내 성장, 분류별 진행, 이어서 풀 자료.
// 휴대폰은 한 줄로 쌓고, 컴퓨터는 왼쪽(할 일)·오른쪽(기록) 두 칸이다 (styles.css의 .today-cols).

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
      setSteps({ installed: isStandalone(), push: push === 'on', connector: token?.connected ?? false, saved });
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
  // 누르면 시작 가이드의 그 단계로 간다
  const items: { key: keyof Steps; label: string; href: string }[] = [
    { key: 'installed', label: '홈 화면에 추가하기', href: '/welcome?step=1' },
    { key: 'connector', label: 'claude.ai에 모아이 연결하기', href: '/welcome?step=2' },
    { key: 'saved', label: 'claude.ai에서 공부하고 "모아이에 저장해줘"', href: '/welcome?step=3' },
    { key: 'push', label: '이 기기에서 알림 켜기', href: '/welcome?step=4' },
  ];
  const count = Object.values(steps).filter(Boolean).length;
  return (
    <section className="onboarding o-onboard" aria-labelledby="onboarding-title">
      <div className="onboarding-head">
        <h2 id="onboarding-title">시작하기</h2>
        <span>
          {count}/{items.length}
        </span>
      </div>
      <ol className="steps-list">
        {items.map((item) => (
          <li key={item.key} className={steps[item.key] ? 'done' : ''}>
            <Link href={item.href}>
              <span className="step-mark">{steps[item.key] ? <IconCheck size={14} /> : null}</span>
              {item.label}
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

/** 첫 카드: 남은 장수와 시간, 오늘 목표 링, 시작 버튼 */
function Hero({ data, stats }: { data: TodayResponse; stats: StatsResponse | null }) {
  const empty = data.remaining === 0;
  const goal = stats?.goal ?? 0;
  const reviewed = Math.min(stats?.today.reviewed ?? 0, goal);
  return (
    <section className="hero o-hero" aria-label="오늘 복습">
      <div className="hero-top">
        <div>
          <p className="hero-label">오늘 복습</p>
          {empty ? (
            <>
              <p className="hero-count text">{data.reviewed_today > 0 ? '다 했어요' : '카드가 없어요'}</p>
              <p className="hero-sub">
                {data.reviewed_today > 0 ? `오늘 ${data.reviewed_today}장을 풀었어요. 다음 카드는 알림으로 알려 드릴게요.` : 'claude.ai에서 공부하고 "모아이에 저장해줘"라고 하면 카드가 여기로 와요.'}
              </p>
            </>
          ) : (
            <>
              <p className="hero-count">{data.remaining}장</p>
              <p className="hero-sub">약 {data.minutes}분</p>
            </>
          )}
        </div>
        {stats ? (
          <Ring value={reviewed} max={goal} label={`오늘 목표 ${goal}장 중 ${reviewed}장`} tone="hero">
            <strong>
              {reviewed}/{goal}
            </strong>
            <span>오늘 목표</span>
          </Ring>
        ) : null}
      </div>
      {empty ? null : (
        <div className="hero-actions">
          <Link className="button accent" href="/review">
            복습 시작
            <IconArrow />
          </Link>
          {data.remaining > 8 ? (
            <Link className="button ghost" href="/review?size=5">
              가볍게 5장
            </Link>
          ) : null}
        </div>
      )}
    </section>
  );
}

/** 연속 학습과 이번 주 7칸. "지난주의 나"와 XP를 비교한다 */
function WeekCard({ stats }: { stats: StatsResponse }) {
  const diff = stats.week.xp - stats.last_week_xp;
  return (
    <section className="card o-week" aria-labelledby="week-title">
      <div className="card-head">
        <IconFlame />
        <h2 id="week-title">{stats.streak}일 연속</h2>
        <span className="aside">최고 {stats.best_streak}일</span>
      </div>
      <StreakGoal streak={stats.streak} steps />
      <WeekDays stats={stats} />
      <p className="muted small">
        이번 주 {stats.week.xp} XP
        {diff !== 0 ? (
          <>
            {' · '}
            <span className={diff > 0 ? 'up' : undefined}>지난주보다 {diff > 0 ? `+${diff}` : diff}</span>
          </>
        ) : null}
        {stats.freeze_available ? ' · 프리즈 1회 남음' : ''}
      </p>
    </section>
  );
}

/** 휴대폰: 작은 숫자 카드 두 장 */
function GrowthCards({ stats, map }: { stats: StatsResponse; map: MapResponse | null }) {
  const counts = map ? conceptCounts(map.nodes) : null;
  return (
    <div className="stat-grid o-growth o-narrow">
      <section className="stat" aria-label="익숙해진 개념">
        <p className="stat-label">익숙해진 개념</p>
        <p className="stat-value">{counts ? counts.familiar : '–'}</p>
        <p className="stat-note">흔들림 {counts ? counts.shaky : 0}</p>
      </section>
      <section className="stat" aria-label="최고 연속">
        <p className="stat-label">최고 연속</p>
        <p className="stat-value">{stats.best_streak}일</p>
        <p className="stat-note">지금 {stats.streak}일</p>
      </section>
    </div>
  );
}

/** 컴퓨터: 오른쪽 칸의 내 성장 요약 */
function GrowthRows({ stats, map }: { stats: StatsResponse; map: MapResponse | null }) {
  const counts = map ? conceptCounts(map.nodes) : null;
  return (
    <section className="card o-wide" aria-labelledby="growth-title">
      <h2 id="growth-title">내 성장</h2>
      <div className="stat-rows">
        <div className="stat-row">
          <span>익숙해진 개념</span>
          <strong>{counts ? counts.familiar : '–'}</strong>
        </div>
        <div className="stat-row">
          <span>이번 주 XP</span>
          <strong>
            {stats.week.xp} <span className="muted small">지난주 {stats.last_week_xp}</span>
          </strong>
        </div>
        <div className="stat-row">
          <span>최고 연속</span>
          <strong>{stats.best_streak}일</strong>
        </div>
        <div className="stat-row">
          <span>오늘 XP</span>
          <strong>{stats.today.xp}</strong>
        </div>
      </div>
      <TabLink href="/growth" className="small">
        내 성장 자세히 보기
      </TabLink>
    </section>
  );
}

/** 이어서 풀 자료: 안 푼 카드가 남은 첫 자료 */
function ContinueMaterial({ materials }: { materials: MaterialSummary[] }) {
  const material = materials.find((item) => item.next !== null);
  if (!material?.next) return null;
  const progress = material.cards === 0 ? 0 : material.solved / material.cards;
  // 다음 섹션부터 이어서 푼다
  return (
    <Link className="card material-card o-material" href={materialReview(material.title, material.next.part)}>
      <span className="icon-tile">
        <IconBook />
      </span>
      <div className="grow">
        <strong>{materialLabel(material.title)}</strong>
        <span className="muted small">
          다음 섹션 · {material.next.part ? partView(material.next.part, 0).name : '안 푼 카드'} · {material.next.unsolved_open}장
        </span>
        <div className="bar">
          <div style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      <IconArrow />
    </Link>
  );
}

export function Today({ name }: { name: string }) {
  const { data, error } = useApi<TodayResponse>('/today');
  const { data: stats } = useApi<StatsResponse>('/stats');
  const { data: map } = useApi<MapResponse>('/map');
  const { data: materials } = useApi<{ materials: MaterialSummary[] }>('/materials');
  const [cached, setCached] = useState(0);
  /** 서버 AI가 있고 이번 달 면접 질문이 남았다 */
  const [canInterview, setCanInterview] = useState(false);
  useEffect(() => {
    if (error) void cachedQueue().then((cards) => setCached(cards.length));
  }, [error]);
  useEffect(() => {
    void aiStatus().then((status) => setCanInterview(status.available && !status.over_budget && status.interview_left > 0));
  }, []);
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
  if (!data) return <Loading />;

  const studied = stats ? stats.history.filter((day) => day.reviewed > 0).length : 0;
  return (
    <div className="today">
      <header className="today-head">
        {/* 할 카드가 있으면 휴대폰을 흔들고, 오늘 다 했으면 쉰다 (사용자 시트의 복습 알림·휴식) */}
        <Mascot mood={data.remaining > 0 ? 'alarm' : data.reviewed_today > 0 ? 'sleep' : 'happy'} size={40} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p>
            {todayLabel()} · {name}님
          </p>
          <h1>오늘도 조금씩 모아요</h1>
        </div>
        <Link className="icon-link" href="/settings" aria-label="설정">
          <IconSettings />
        </Link>
      </header>

      <div className="today-cols">
        <div className="today-col">
          <Hero data={data} stats={stats ?? null} />
          {/* 첫 저장처럼 복습 밖에서 이룬 이정표는 여기서 축하한다 */}
          {stats ? <NewBadges badges={stats.badges} link className="o-badges" /> : null}
          <Onboarding saved={data.sessions.length > 0} />
          {map && map.nodes.some((node) => node.state !== 'material' && node.category) ? (
            <section className="card o-category" aria-labelledby="category-title">
              <div className="card-head">
                <h2 id="category-title">분류별 진행</h2>
                <TabLink href="/map" className="aside">
                  지식 지도
                </TabLink>
              </div>
              <CategoryProgress nodes={map.nodes} limit={4} />
            </section>
          ) : null}
          {materials ? <ContinueMaterial materials={materials.materials} /> : null}
          {data.followups.length > 0 ? (
            <section className="card o-followups" aria-labelledby="followups-title">
              <div className="card-head">
                <Mascot mood="claude" size={32} />
                <h2 id="followups-title">다음에 볼 질문</h2>
              </div>
              <ul className="question-list">
                {data.followups.slice(0, 5).map((followup) => (
                  <li key={followup.id}>
                    <span className="chip">{followup.concept_name}</span> {followup.question}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
          {canInterview && (map?.nodes.length ?? 0) > 0 ? (
            <Link className="claude-link o-interview" href="/interview">
              <Mascot mood="study" size={40} />
              <span className="grow">
                <strong>꼬리질문 모의면접</strong>
                <span className="muted small">흔들리는 개념부터 면접관처럼 이어서 물어봐요</span>
              </span>
              <IconArrow />
            </Link>
          ) : null}
          {!data.reminders_set ? (
            <Link className="notice link o-reminder" href="/settings">
              알림 시간을 정하면 복습할 때 알려 드려요 →
            </Link>
          ) : null}
        </div>
        <div className="today-col">
          {stats ? <WeekCard stats={stats} /> : null}
          {stats ? <GrowthCards stats={stats} map={map ?? null} /> : null}
          {stats ? <GrowthRows stats={stats} map={map ?? null} /> : null}
          {stats ? (
            <section className="card o-wide" aria-labelledby="heat-title">
              <div className="card-head">
                <h2 id="heat-title">최근 12주</h2>
                <span className="aside">{studied}일 공부</span>
              </div>
              <Heatmap history={stats.history} goal={stats.goal} />
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
