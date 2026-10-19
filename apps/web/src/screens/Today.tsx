import type { MaterialSummary, McpTokenStatus, StatsResponse, TodayResponse } from '@moai/shared';
import { isPdf, materialLabel } from '@moai/shared/client';
import { useEffect, useState } from 'react';
import { aiStatus } from '../ai';
import { request } from '../api';
import { NewBadges } from '../badges';
import { IconArrow, IconBook, IconCheck, IconFlame, IconHistory, IconSettings } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { materialReview, partView } from '../materials';
import { cachedQueue } from '../offline/store';
import { GoalRing, StreakGoal, WeekDays, todayLabel } from '../progress';
import { isStandalone, pushState } from '../push';
import { Link, TabLink } from '../router';
import { useApi } from '../useApi';

// 오늘 화면 (설계서 §12.1, 4단계 시안): 복습(남은 카드)과 학습(이어서 풀 자료 섹션)을 나란히, 그 아래 연속·오늘 목표·모의면접.
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

/** 복습 카드: 남은 장수와 나누기(틀린 것·다시 볼 때·대화에서 온 새 카드), 시작 버튼. 복습 탭도 같이 쓴다 */
export function ReviewHero({ data, className = '' }: { data: TodayResponse; className?: string }) {
  const empty = data.remaining === 0;
  const again = Math.max(0, data.remaining - data.parts.wrong - data.parts.fresh);
  const parts = [
    { label: '틀린 것', n: data.parts.wrong, hot: true },
    { label: '다시 볼 때', n: again, hot: false },
    { label: '대화에서 온 새 카드', n: data.parts.fresh, hot: false },
  ].filter((part) => part.n > 0);
  return (
    <section className={`hero ${className}`} aria-label="오늘 복습">
      <div className="hero-top">
        <span className="hero-chip">
          <IconHistory size={14} />
          복습
        </span>
        {empty ? null : <span className="hero-sub">약 {data.minutes}분</span>}
      </div>
      {empty ? (
        <div>
          <p className="hero-count text">{data.reviewed_today > 0 ? '다 했어요' : '카드가 없어요'}</p>
          <p className="hero-sub">
            {data.reviewed_today > 0 ? `오늘 ${data.reviewed_today}장을 풀었어요. 다음 카드는 알림으로 알려 드릴게요.` : 'claude.ai에서 공부하고 "모아이에 저장해줘"라고 하면 카드가 여기로 와요.'}
          </p>
        </div>
      ) : (
        <p className="hero-count">
          {data.remaining}
          <small>장 남았어요</small>
        </p>
      )}
      {parts.length > 0 ? (
        <ul className="hero-parts">
          {parts.map((part) => (
            <li key={part.label} className={part.hot ? 'hot' : undefined}>
              {part.label} {part.n}
            </li>
          ))}
        </ul>
      ) : null}
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

/** 학습 카드: 이어서 풀 자료의 다음 섹션. 자료가 없거나 다 풀었으면 학습 탭으로 안내한다 */
function LearnCard({ materials }: { materials: MaterialSummary[] }) {
  const material = materials.find((item) => item.next !== null);
  return (
    <section className="card learn-card o-learn" aria-label="학습">
      <div className="card-head">
        <span className="learn-chip">
          <IconBook size={14} />
          학습
        </span>
        <TabLink href={material ? `/learn?${new URLSearchParams({ title: material.title })}` : '/learn'} className="aside">
          자료 길 보기
        </TabLink>
      </div>
      {material?.next ? <NextPart material={material} next={material.next} /> : (
        <p className="muted small">{materials.length === 0 ? 'PDF 자료를 카드로 만들면 여기서 섹션 순서대로 학습해요.' : '자료의 새 카드를 다 풀었어요. 푼 카드는 복습에서 다시 나와요.'}</p>
      )}
    </section>
  );
}

function NextPart({ material, next }: { material: MaterialSummary; next: NonNullable<MaterialSummary['next']> }) {
  const index = Math.max(material.parts.indexOf(next.part), 0);
  const view = partView(next.part, index);
  const sections = Math.max(material.parts.length, 1);
  return (
    <>
      <div className="learn-next">
        <span className="book-tile" aria-hidden="true">
          <span>{isPdf(material.title) ? 'PDF' : '자료'}</span>
          <strong>{view.no}</strong>
        </span>
        <div className="grow">
          <span className="muted small">
            {materialLabel(material.title)} · 섹션 {index + 1}/{sections}
          </span>
          <strong>{next.part ? view.name : '안 푼 카드'}</strong>
          <span className="muted small">
            새 카드 {next.unsolved_open}장 · 약 {Math.max(1, Math.round(next.unsolved_open / 3))}분
          </span>
        </div>
      </div>
      <div className="bar">
        <div style={{ width: `${material.cards === 0 ? 0 : (material.solved / material.cards) * 100}%` }} />
      </div>
      <Link className="button primary" href={materialReview(material.title, next.part)}>
        이어서 학습
      </Link>
    </>
  );
}

/** 연속 학습: 다음 목표, 이번 주 7칸, "지난주의 나"와 XP 비교 */
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

/** 오늘 목표: 복습과 학습을 나눠 칠한다 */
function GoalCard({ stats }: { stats: StatsResponse }) {
  const learned = stats.today.learned;
  const reviewed = stats.today.reviewed - learned;
  return (
    <section className="card goal-card o-goal" aria-labelledby="goal-title">
      <GoalRing review={reviewed} learn={learned} goal={stats.goal} label={`오늘 목표 ${stats.goal}장 중 ${stats.today.reviewed}장, 복습 ${reviewed}장, 학습 ${learned}장`}>
        <strong>
          {Math.min(stats.today.reviewed, stats.goal)}/{stats.goal}
        </strong>
      </GoalRing>
      <div className="grow">
        <h2 id="goal-title">오늘 목표 {stats.goal}장</h2>
        <span className="goal-legend">복습 {reviewed}장</span>
        <span className="goal-legend goal-legend-learn">학습 {learned}장</span>
      </div>
    </section>
  );
}

/** 서버 AI가 있고 이번 달 면접 질문이 남았다 */
export function useCanInterview(): boolean {
  const [can, setCan] = useState(false);
  useEffect(() => {
    void aiStatus().then((status) => setCan(status.available && !status.over_budget && status.interview_left > 0));
  }, []);
  return can;
}

export function InterviewLink({ className = '' }: { className?: string }) {
  return (
    <Link className={`claude-link ${className}`} href="/interview">
      <Mascot mood="study" size={40} />
      <span className="grow">
        <strong>꼬리질문 모의면접</strong>
        <span className="muted small">흔들리는 개념부터 면접관처럼 이어서 물어봐요</span>
      </span>
      <IconArrow />
    </Link>
  );
}

export function Today({ name }: { name: string }) {
  const { data, error } = useApi<TodayResponse>('/today');
  const { data: stats } = useApi<StatsResponse>('/stats');
  const { data: materials } = useApi<{ materials: MaterialSummary[] }>('/materials');
  const [cached, setCached] = useState(0);
  const canInterview = useCanInterview();
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
  if (!data) return <Loading />;

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
          <div className="today-pair">
            <ReviewHero data={data} className="o-hero" />
            {materials ? <LearnCard materials={materials.materials} /> : null}
          </div>
          {/* 첫 저장처럼 복습 밖에서 이룬 이정표는 여기서 축하한다 */}
          {stats ? <NewBadges badges={stats.badges} link className="o-badges" /> : null}
          <Onboarding saved={data.sessions.length > 0} />
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
          {!data.reminders_set ? (
            <Link className="notice link o-reminder" href="/settings">
              알림 시간을 정하면 복습할 때 알려 드려요 →
            </Link>
          ) : null}
        </div>
        <div className="today-col">
          {stats ? <WeekCard stats={stats} /> : null}
          {stats ? <GoalCard stats={stats} /> : null}
          {canInterview && data.sessions.length > 0 ? <InterviewLink className="o-interview" /> : null}
        </div>
      </div>
    </div>
  );
}
