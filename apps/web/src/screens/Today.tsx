import type { LevelUp, MaterialSummary, McpTokenStatus, StatsResponse, SurveyStatus, TodayResponse } from '@moai/shared';
import { QUEST_XP, TERMS_VERSION, isPdf } from '@moai/shared/client';
import { useEffect, useState } from 'react';
import { useCanInterview } from '../ai';
import { errorMessage, request } from '../api';
import { NewAchievements, NewBadges } from '../badges';
import { CreditChip } from '../credits';
import { IconArrow, IconBook, IconCheck, IconFlame, IconHistory, IconSettings } from '../icons';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { currentMaterial, materialReview, partView } from '../materials';
import { REVIEWS_SENT, cachedQueue, peekLevelUps, takeLevelUps } from '../offline/store';
import { GoalRing, StreakGoal, WeekDays, todayLabel } from '../progress';
import { isStandalone, pushState } from '../push';
import { Link, TabLink } from '../router';
import { useApi, useRun } from '../useApi';
import { readStored, writeStored } from '../prefs';

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
  const [hidden, setHidden] = useState(() => readStored(ONBOARDED) === '1');
  useEffect(() => {
    if (hidden) return;
    void (async () => {
      const [push, token] = await Promise.all([pushState().catch(() => 'off'), request<McpTokenStatus>('/mcp-token').catch(() => null)]);
      setSteps({ installed: isStandalone(), push: push === 'on', connector: token?.connected ?? false, saved });
    })();
  }, [hidden, saved]);
  const done = steps ? Object.values(steps).every(Boolean) : false;
  const hide = () => {
    // 저장소를 못 쓰면 다음에 또 보일 뿐이다
    writeStored(ONBOARDED, '1');
    setHidden(true);
  };
  useEffect(() => {
    if (done) hide();
  }, [done]);
  if (hidden || !steps || done) return null;
  // 누르면 시작 가이드의 그 단계로 간다
  const items: { key: keyof Steps; label: string; href: string }[] = [
    { key: 'installed', label: '홈 화면에 추가하기', href: '/welcome?step=1' },
    { key: 'connector', label: '클로드에 모아이 연결하기', href: '/welcome?step=2' },
    { key: 'saved', label: '클로드에서 공부하고 "모아이에 저장해줘"', href: '/welcome?step=3' },
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

/** 이번 실행에서 약관 확인을 마쳤다. 다른 탭에 갔다 와도 내 정보(me)를 다시 읽기 전까지 카드가 다시 뜨지 않게 */
let termsAcknowledged = false;

/** 약관·처리방침이 바뀌면 오늘 화면에서 한 번 알린다 (이용약관 10조). 확인하면 서버에 시행일을 적는다 */
function TermsNotice() {
  const [done, setDone] = useState(termsAcknowledged);
  const [error, setError] = useState<string | null>(null);
  if (done) return null;
  const [year, month, day] = TERMS_VERSION.split('-');
  return (
    <section className="notice warn terms-notice o-badges" aria-labelledby="terms-notice-title">
      <strong id="terms-notice-title">이용약관과 개인정보 처리방침이 바뀌었어요</strong>
      <p className="small">
        시행일 {year}년 {Number(month)}월 {Number(day)}일. 바뀐 내용을 한 번 확인해 주세요.
      </p>
      {error ? <p className="small">{error}</p> : null}
      <div className="terms-actions">
        <Link href="/privacy">처리방침 보기</Link>
        <Link href="/terms">약관 보기</Link>
        <button
          type="button"
          className="button"
          onClick={() =>
            void request('/me/terms', { method: 'PUT' })
              .then(() => {
                termsAcknowledged = true;
                setDone(true);
              })
              .catch((reason: unknown) => setError(errorMessage(reason)))
          }
        >
          확인했어요
        </button>
      </div>
    </section>
  );
}

/** 다음에 볼 질문. 다 본 질문은 ✓로 닫는다 (같은 개념을 다시 공부해 판정이 들어오면 서버가 알아서 닫기도 한다) */
function FollowupsCard({ followups }: { followups: TodayResponse['followups'] }) {
  const [closed, setClosed] = useState<ReadonlySet<string>>(new Set());
  const open = followups.filter((followup) => !closed.has(followup.id)).slice(0, 5);
  const close = async (id: string) => {
    setClosed((current) => new Set([...current, id]));
    try {
      await request(`/followups/${id}`, { method: 'PATCH' });
    } catch {
      // 못 닫았으면 다시 보여 준다
      setClosed((current) => new Set([...current].filter((item) => item !== id)));
    }
  };
  if (open.length === 0) return null;
  return (
    <section className="card o-followups" aria-labelledby="followups-title">
      <div className="card-head">
        <Mascot mood="claude" size={32} />
        <h2 id="followups-title">다음에 볼 질문</h2>
      </div>
      <ul className="question-list">
        {open.map((followup) => (
          <li key={followup.id} className="followup-item">
            <span className="grow">
              <span className="chip">{followup.concept_name}</span> {followup.question}
            </span>
            <button type="button" className="icon-button" aria-label="이 질문 닫기" title="다 봤어요" onClick={() => void close(followup.id)}>
              ✓
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** 오늘 화면 머리의 픽셀 하늘과 언덕 (5단계 배경 C). 96×38 그림을 4배로 키워 가로로 이어 붙인다. 색은 styles.css의 --sky, --hill-* */
/** 지금 때 (기기 시계): 아침 5~11시, 낮 11~17시, 저녁 17~21시, 밤 그 밖. 오늘 화면 머리 그림의 하늘과 해·달이 바뀐다 */
export type DayPart = 'morning' | 'day' | 'evening' | 'night';
export function dayPart(hour = new Date().getHours()): DayPart {
  if (hour >= 5 && hour < 11) return 'morning';
  if (hour >= 11 && hour < 17) return 'day';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night';
}

const SUN = ['..XXXX..', '.XXXXXX.', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', 'XXXXXXXX', '.XXXXXX.', '..XXXX..'];
const MOON = ['..XXXX..', '.XXX....', 'XXX.....', 'XXX.....', 'XXX.....', 'XXX.....', '.XXX....', '..XXXX..'];
/** 해·달 자리: x는 그림 폭의 %, y는 px. 아침은 오른쪽 언덕 위로 뜨는 중, 낮은 위, 저녁은 왼쪽으로 지는 중, 밤은 달. 휴대폰 오른쪽 위 엽전 칩과 아래 글자를 피한다 */
const SKY_BODY: Record<DayPart, { x: string; y: number; art: string[] }> = {
  morning: { x: '62%', y: 58, art: SUN },
  day: { x: '44%', y: 18, art: SUN },
  evening: { x: '30%', y: 52, art: SUN },
  night: { x: '44%', y: 16, art: MOON },
};

function Hills({ part }: { part: DayPart }) {
  const body = SKY_BODY[part];
  return (
    <svg className="hills-art" aria-hidden="true" shapeRendering="crispEdges">
      <defs>
        <pattern id="hills-sky" width="96" height="38" patternUnits="userSpaceOnUse" patternTransform="scale(4)">
          <rect className="sky" width="96" height="38" />
          <rect className="star" x="12" y="6" width="2" height="2" />
          <rect className="star" x="44" y="4" width="2" height="2" />
          <rect className="star" x="78" y="8" width="2" height="2" />
          <rect className="spark" x="64" y="3" width="1" height="1" />
        </pattern>
        <pattern id="hills-land" width="96" height="38" patternUnits="userSpaceOnUse" patternTransform="scale(4)">
          <rect className="far" x="0" y="24" width="96" height="14" />
          <rect className="far" x="0" y="20" width="22" height="4" />
          <rect className="far" x="4" y="17" width="14" height="3" />
          <rect className="far" x="30" y="22" width="30" height="2" />
          <rect className="far" x="36" y="19" width="18" height="3" />
          <rect className="far" x="66" y="21" width="30" height="3" />
          <rect className="far" x="72" y="16" width="18" height="5" />
          <rect className="near" x="0" y="30" width="96" height="8" />
          <rect className="near" x="10" y="28" width="26" height="2" />
          <rect className="near" x="58" y="27" width="30" height="3" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#hills-sky)" />
      {/* 해·달은 하늘과 언덕 사이에 그려서, 낮게 뜬 해가 언덕 뒤로 걸린다 */}
      <svg className="sky-body" x={body.x} y={body.y} overflow="visible">
        {body.art.flatMap((row, y) => [...row].map((cell, x) => (cell === 'X' ? <rect key={`${x}-${y}`} x={x * 4} y={y * 4} width="4" height="4" /> : null)))}
      </svg>
      <rect width="100%" height="100%" fill="url(#hills-land)" />
    </svg>
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
            {data.reviewed_today > 0 ? `오늘 ${data.reviewed_today}장을 풀었어요. 다음 카드는 알림으로 알려 드릴게요.` : '클로드에서 공부하고 "모아이에 저장해줘"라고 하면 카드가 여기로 와요.'}
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
  const material = currentMaterial(materials, true);
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
  const view = partView(next.part, index, material.part_labels[next.part]);
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
            {material.name} · 섹션 {index + 1}/{sections}
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
        <span className={stats.today.reviewed >= stats.goal ? 'flame lit' : 'flame'}>
          <IconFlame />
        </span>
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

const QUEST_LABEL: Record<StatsResponse['quests'][number]['id'], string> = {
  cards: '카드 10장 풀기',
  perfect: '한 번도 안 틀리고 복습하기 (5장 이상)',
  learn: '새 카드 5장 학습 또는 설명하기 1장',
};

/** 오늘의 퀘스트 세 가지. 하나에 QUEST_XP씩 */
function QuestCard({ stats }: { stats: StatsResponse }) {
  const done = stats.quests.filter((quest) => quest.done).length;
  return (
    <section className="card quest-card o-quest" aria-labelledby="quest-title">
      <div className="card-head">
        <h2 id="quest-title">오늘의 퀘스트</h2>
        <span className="aside">
          {done}/{stats.quests.length}
        </span>
      </div>
      <ul className="quest-list">
        {stats.quests.map((quest) => (
          <li key={quest.id} className={quest.done ? 'done' : undefined}>
            <span className="quest-mark" aria-hidden="true">
              {quest.done ? <IconCheck size={14} /> : null}
            </span>
            <span className="grow">
              <span className="quest-name">
                {QUEST_LABEL[quest.id]}
                <span className="sr-only">{quest.done ? ' 완료' : ` ${Math.min(quest.value, quest.target)}/${quest.target}`}</span>
              </span>
              <span className="bar" aria-hidden="true">
                <span style={{ width: `${quest.done ? 100 : (Math.min(quest.value, quest.target) / quest.target) * 100}%` }} />
              </span>
            </span>
            <span className="quest-xp">+{QUEST_XP}</span>
          </li>
        ))}
      </ul>
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

const SURVEY_SKIP = 'moai:survey-skip';

/** 주간 한 문항 설문 (기획서 §13). 서버가 물을 때만, "다음에"를 누른 주에는 다시 띄우지 않는다 */
function SurveyCard() {
  const { data } = useApi<SurveyStatus>('/survey');
  const [state, setState] = useState<'ask' | 'note' | 'sent' | 'hidden'>('ask');
  const [note, setNote] = useState('');
  const { error, run } = useRun();
  if (!data?.ask || state === 'hidden') return null;
  // 저장소를 못 쓰면 그냥 묻는다
  if (readStored(SURVEY_SKIP) === data.week) return null;
  const send = (used: boolean) =>
    run(async () => {
      await request('/survey', { method: 'PUT', json: { used, ...(note.trim() ? { note: note.trim() } : {}) } });
      setState('sent');
    });
  const skip = () => {
    // 저장소를 못 쓰면 이번 화면에서만 숨긴다
    writeStored(SURVEY_SKIP, data.week);
    setState('hidden');
  };
  return (
    <section className="card survey-card o-badges" aria-labelledby="survey-title">
      <div className="card-head">
        <Mascot mood="think" size={36} />
        <h2 id="survey-title">이번 주 한 가지만 물어볼게요</h2>
      </div>
      {state === 'sent' ? (
        <p className="notice good">고마워요! 다음 주에 또 물어볼게요.</p>
      ) : (
        <>
          <p>이번 주 면접이나 공부에서 써먹은 개념이 있나요?</p>
          <p className="muted small">답은 베타를 고치는 데 쓰여요. 운영자는 누가 답했는지 빼고 모아서 봐요.</p>
          {state === 'note' ? (
            <form
              className="survey-note"
              onSubmit={(event) => {
                event.preventDefault();
                void send(true);
              }}
            >
              <label htmlFor="survey-note" className="small">
                어떤 개념이었나요? (적지 않아도 돼요)
              </label>
              <input id="survey-note" value={note} maxLength={200} autoFocus onChange={(event) => setNote(event.target.value)} placeholder="예: 트랜잭션 전파" />
              <button type="submit" className="button primary">
                보내기
              </button>
            </form>
          ) : (
            <div className="actions">
              <button type="button" className="button primary" onClick={() => setState('note')}>
                있어요
              </button>
              <button type="button" className="button" onClick={() => void send(false)}>
                아직 없어요
              </button>
            </div>
          )}
          {error ? <p className="notice bad">{error}</p> : null}
          <button type="button" className="text-button" onClick={skip}>
            다음에
          </button>
        </>
      )}
    </section>
  );
}

/** 복습 밖에서 받은 LEVEL UP (앱을 열 때 밀린 답을 보내서 열린 단계). 확인하면 비운다 */
function LevelUpNotice() {
  const [ups, setUps] = useState<LevelUp[]>([]);
  useEffect(() => {
    // 앱을 열 때 밀린 답을 보내는 중일 수 있다. 다 보내면 그 결과로 열린 단계를 다시 읽는다
    const read = () => void peekLevelUps().then(setUps);
    read();
    window.addEventListener(REVIEWS_SENT, read);
    return () => window.removeEventListener(REVIEWS_SENT, read);
  }, []);
  if (ups.length === 0) return null;
  return (
    <section className="card levelup-notice o-badges" aria-labelledby="levelup-notice-title">
      <div className="card-head">
        <Mascot mood="levelup" size={40} />
        <div className="grow">
          <p className="levelup-kicker">LEVEL UP</p>
          <h2 id="levelup-notice-title">{ups.length}개 개념이 한 단계 올라갔어요</h2>
        </div>
      </div>
      <p className="muted small">{ups.map((up) => `${up.concept_name} ${up.rung}단계`).join(' · ')}</p>
      <button
        type="button"
        className="text-button"
        onClick={() => {
          setUps([]);
          void takeLevelUps();
        }}
      >
        확인
      </button>
    </section>
  );
}

/** 서버 AI를 쓸 수 있다. 크레딧이 모자라도 모의면접 입구는 보이고, 시작 화면이 모자란다고 알린다 */
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

export function Today({ name, termsVersion }: { name: string; termsVersion: string | null }) {
  const { data, error, reload: reloadToday } = useApi<TodayResponse>('/today');
  const { data: stats, reload: reloadStats } = useApi<StatsResponse>('/stats');
  const { data: materials, reload: reloadMaterials } = useApi<{ materials: MaterialSummary[] }>('/materials');
  // 앱으로 돌아오거나 다시 연결되거나 밀린 답을 보낸 뒤 다시 읽는다. 열어 둔 채 날이 바뀌었거나, 오프라인 오류가 남았거나, 보내기 전 숫자일 수 있다
  useEffect(() => {
    const refresh = () => {
      reloadToday();
      reloadStats();
      reloadMaterials();
    };
    const visible = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', visible);
    window.addEventListener('online', refresh);
    window.addEventListener(REVIEWS_SENT, refresh);
    return () => {
      document.removeEventListener('visibilitychange', visible);
      window.removeEventListener('online', refresh);
      window.removeEventListener(REVIEWS_SENT, refresh);
    };
  }, [reloadToday, reloadStats, reloadMaterials]);
  const [cached, setCached] = useState(0);
  const canInterview = useCanInterview();
  useEffect(() => {
    if (error) void cachedQueue().then((cards) => setCached(cards.length));
  }, [error]);
  // 다시 읽기가 실패해도 이미 받은 화면은 그대로 둔다 (오프라인으로 돌아왔을 때 오류 화면으로 바뀌지 않게)
  if (error && !data) {
    return (
      <div className="screen">
        <p className="notice bad">{error}</p>
        <div className="actions">
          <button
            type="button"
            className="button"
            onClick={() => {
              reloadToday();
              reloadStats();
              reloadMaterials();
            }}
          >
            다시 시도
          </button>
        </div>
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
  const part = dayPart();

  return (
    <div className="today">
      <header className={`today-head hills sky-${part}`}>
        <Hills part={part} />
        {/* 할 카드가 있으면 휴대폰을 흔들고, 오늘 다 했으면 쉰다 (사용자 시트의 복습 알림·휴식) */}
        <Mascot mood={data.remaining > 0 ? 'alarm' : data.reviewed_today > 0 ? 'sleep' : 'happy'} size={56} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <p>
            {todayLabel()} · {name}님
          </p>
          <h1>오늘도 조금씩 모아요</h1>
        </div>
        <div className="today-tools">
          <CreditChip />
          <Link className="icon-link" href="/settings" aria-label="설정">
            <IconSettings />
          </Link>
        </div>
      </header>

      <div className="today-cols">
        <div className="today-col">
          <div className="today-pair">
            <ReviewHero data={data} className="o-hero" />
            {materials ? <LearnCard materials={materials.materials} /> : null}
          </div>
          {termsVersion !== TERMS_VERSION ? <TermsNotice /> : null}
          {/* 첫 저장처럼 복습 밖에서 이룬 이정표는 여기서 축하한다 */}
          {stats ? <NewBadges badges={stats.badges} link className="o-badges" /> : null}
          {stats ? <NewAchievements achievements={stats.achievements.earned} className="o-badges" /> : null}
          <LevelUpNotice />
          <SurveyCard />
          <Onboarding saved={data.sessions.length > 0} />
          {data.followups.length > 0 ? <FollowupsCard followups={data.followups} /> : null}
          {!data.reminders_set ? (
            <Link className="notice link o-reminder" href="/settings#alerts">
              알림 시간을 정하면 복습할 때 알려 드려요 →
            </Link>
          ) : data.push_lost ? (
            <Link className="notice warn link o-badges" href="/settings#alerts">
              복습 알림이 꺼졌어요. 이 기기에서 다시 켜 주세요 →
            </Link>
          ) : null}
        </div>
        <div className="today-col">
          {stats ? <QuestCard stats={stats} /> : null}
          {stats ? <WeekCard stats={stats} /> : null}
          {stats ? <GoalCard stats={stats} /> : null}
          {canInterview && data.sessions.length > 0 ? <InterviewLink className="o-interview" /> : null}
        </div>
      </div>
    </div>
  );
}
