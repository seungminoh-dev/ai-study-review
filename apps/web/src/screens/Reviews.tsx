import type { MapResponse, QueueResponse, SessionSummary, TodayResponse } from '@moai/shared';
import { Loading } from '../Loading';
import { Mascot } from '../Mascot';
import { CategoryProgress } from '../progress';
import { examHref } from '../materials';
import { Link } from '../router';
import { useApi } from '../useApi';
import { useCanInterview } from '../ai';
import { InterviewLink, ReviewHero } from './Today';
import { SessionItem } from './Sessions';

// 복습 탭 (4단계 시안): 대화에서 온 카드와 한 번이라도 푼 카드. 오늘 복습, 틀린 것, 분류별, 모의면접, 공부한 대화.

/** "틀린 것만 풀기"는 한 번에 이만큼까지 */
const MISTAKES_SIZE = 20;

export function Reviews() {
  const { data, error } = useApi<TodayResponse>('/today');
  const { data: mistakes } = useApi<QueueResponse>(`/queue?mode=mistakes&size=5`);
  const { data: map } = useApi<MapResponse>('/map');
  const { data: saved } = useApi<{ sessions: SessionSummary[] }>('/sessions');
  /** 공부한 대화만. 자료 섹션은 학습 탭에 있다 */
  const chats = saved?.sessions.filter((session) => session.material === null).slice(0, 3) ?? [];
  const canInterview = useCanInterview();
  if (error) {
    return (
      <div className="screen">
        <h1>복습</h1>
        <p className="notice bad">{error}</p>
      </div>
    );
  }
  if (!data) return <Loading />;
  const hasCategories = map?.nodes.some((node) => node.state !== 'material' && node.category) ?? false;

  return (
    <div className="screen reviews-screen">
      <header>
        <h1>복습</h1>
        <p className="muted small">대화에서 온 카드와 한 번이라도 푼 카드가 잊을 때쯤 돌아와요.</p>
      </header>

      <ReviewHero data={data} />

      <section className="card mistakes" aria-labelledby="mistakes-title">
        <div className="card-head">
          <Mascot mood="oops" size={44} />
          <div className="grow">
            <h2 id="mistakes-title">틀린 것 {data.mistakes}개</h2>
            <p className="muted small">최근 30일 안에 마지막에 틀린 카드예요</p>
          </div>
        </div>
        {data.mistakes === 0 ? (
          <p className="muted small">지금은 다시 풀 틀린 카드가 없어요. 오늘 틀린 카드는 곧 복습에 다시 나와요.</p>
        ) : (
          <>
            {mistakes ? (
              <ul className="mistake-list">
                {/* 개념 이름은 정답일 수 있어서 문제만 보여 준다 */}
                {mistakes.cards.map((card) => (
                  <li key={card.id}>{card.prompt}</li>
                ))}
              </ul>
            ) : null}
            <Link className="button primary" href={`/review?mode=mistakes&size=${MISTAKES_SIZE}`}>
              틀린 것만 풀기 · {Math.min(data.mistakes, MISTAKES_SIZE)}장
            </Link>
            <p className="muted small">다시 푼 답도 기록에 남고 XP를 받아요. 오늘 이미 푼 카드는 빼요.</p>
          </>
        )}
      </section>

      {map && hasCategories ? (
        <section className="card" aria-labelledby="category-title">
          <div className="card-head">
            <h2 id="category-title">분류별로</h2>
            <Link href="/categories" className="aside">
              분류 관리
            </Link>
          </div>
          <CategoryProgress nodes={map.nodes} limit={6} />
        </section>
      ) : null}

      <section className="exam-card" aria-label="랜덤 시험">
        <span className="grow">
          <strong>랜덤 시험</strong>
          <span className="muted small">한 번이라도 푼 카드에서 10문제를 섞어 내요. 기록하지 않아서 복습 일정은 그대로예요.</span>
        </span>
        <div className="exam-actions">
          <Link className="button" href={examHref()}>
            시험 보기
          </Link>
        </div>
      </section>

      {canInterview && data.sessions.length > 0 ? <InterviewLink /> : null}

      <section aria-labelledby="sessions-title">
        <div className="card-head">
          <h2 id="sessions-title">공부한 대화</h2>
          <Link href="/sessions" className="aside">
            모두 보기
          </Link>
        </div>
        {saved && chats.length === 0 ? (
          <p className="muted small">아직 저장한 대화가 없어요. 클로드에서 공부하고 "모아이에 저장해줘"라고 해 보세요.</p>
        ) : (
          <ul className="list">
            {chats.map((session) => (
              <SessionItem key={session.id} session={session} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
