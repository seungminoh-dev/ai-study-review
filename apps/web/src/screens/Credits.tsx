import type { CreditsResponse } from '@moai/shared';
import { CREDIT_COST, creditsLeft } from '@moai/shared/client';
import { NO_CREDITS_HINT } from '../ai';
import { Coin, Gem } from '../credits';
import { Loading } from '../Loading';
import { BackLink, Link } from '../router';
import { formatDate, formatDateTime, useApi } from '../useApi';

// AI 크레딧 화면 (6단계 시안 "AI 크레딧 도트"): 오늘 화면·사이드바의 엽전 칩에서 연다.
// 큰 엽전과 쓸 수 있는 크레딧, 월간(엽전 10개), 보유(보석), 쓰는 값, 최근 기록 (설계서 §11.8)

const COINS = 10;

const KIND: Record<string, string> = {
  grant: '받은 크레딧',
  achievement: '숨은 업적',
  ask: '개념 물어보기',
  interview: '모의면접 질문',
  grade: 'AI 채점',
  cards: '대화로 카드 만들기',
  import: '대화 붙여넣기',
};

export function Credits() {
  const { data, error } = useApi<CreditsResponse>('/credits');
  if (error) {
    return (
      <div className="screen">
        <p className="notice bad">{error}</p>
      </div>
    );
  }
  if (!data) return <Loading />;
  const { credits, history } = data;
  const perCoin = credits.monthly_total / COINS;
  // 조금이라도 남은 엽전은 채워서 그린다
  const filled = Math.ceil(credits.monthly / perCoin);
  const gems = Math.min(3, Math.ceil(credits.held / 100));
  return (
    <div className="screen credits-screen">
      <BackLink href="/" className="back">
        ← 오늘
      </BackLink>
      <h1>AI 크레딧</h1>
      <div className="credits-cols">
        <div className="credits-col">
          <section className="hero credits-hero" aria-label="지금 쓸 수 있는 크레딧">
            <Coin px={6} />
            <div>
              <strong className="credits-total">{creditsLeft(credits).toLocaleString()}</strong>
              <p className="hero-sub">지금 쓸 수 있는 크레딧</p>
            </div>
          </section>
          {/* 월간 크레딧이 없는 회원(초대 없이 가입)은 월간 칸을 그리지 않는다 */}
          {credits.monthly_total > 0 ? (
          <section className="card" aria-labelledby="credits-monthly-title">
            <div className="card-head">
              <h2 id="credits-monthly-title">월간 크레딧</h2>
              <span className="aside credits-num">
                {credits.monthly} / {credits.monthly_total}
              </span>
            </div>
            <div className="coin-row" aria-hidden="true">
              {Array.from({ length: COINS }, (_, index) => (
                <Coin key={index} px={3} empty={index >= filled} />
              ))}
            </div>
            <p className="muted small">
              엽전 하나에 {perCoin}. {formatDate(credits.refill_at)}에 다시 가득 차요. 남은 건 다음 달로 넘어가지 않아요.
            </p>
          </section>
          ) : null}
          <section className="card credits-held" aria-labelledby="credits-held-title">
            <span className="gem-pile" aria-hidden="true">
              {gems === 0 ? <Gem px={4} empty /> : Array.from({ length: gems }, (_, index) => <Gem key={index} px={4} />)}
            </span>
            <div className="grow">
              <div className="card-head">
                <h2 id="credits-held-title">보유 크레딧</h2>
                <span className="aside credits-num">{credits.held}</span>
              </div>
              <p className="muted small">
                숨은 업적과 선물로 받아요. {credits.monthly_total > 0 ? '사라지지 않고, 월간을 다 쓰면 여기서 써요.' : '쓰기 전까지 사라지지 않아요.'} {NO_CREDITS_HINT}
              </p>
            </div>
          </section>
        </div>
        <div className="credits-col">
          <section className="card" aria-labelledby="credits-costs-title">
            <h2 id="credits-costs-title">쓰는 값</h2>
            <dl className="cost-list">
              <dt>개념 물어보기 · 모의면접 질문 · AI 채점</dt>
              <dd>{CREDIT_COST.ask}</dd>
              <dt>대화로 카드 만들기 · 면접 기록하기</dt>
              <dd>{CREDIT_COST.cards}</dd>
              <dt>대화 붙여넣기</dt>
              <dd>{CREDIT_COST.import}</dd>
            </dl>
            <p className="muted small">AI 서버에 닿지 못해 실패하면 돌려줘요. 돈으로 사거나 바꿀 수 없는 앱 안 재화예요.</p>
          </section>
          <section className="card" aria-labelledby="credits-log-title">
            <h2 id="credits-log-title">최근 기록</h2>
            {history.length === 0 ? (
              <p className="muted small">아직 쓰거나 받은 크레딧이 없어요.</p>
            ) : (
              <ul className="credit-log">
                {history.map((row, index) => (
                  <li key={index}>
                    <span className="grow">
                      {KIND[row.kind] ?? row.kind}
                      {row.note ? ` (${row.note})` : ''}
                      <span className="muted small">{formatDateTime(row.created_at)}</span>
                    </span>
                    <strong className={row.amount > 0 ? 'credit-plus' : 'credit-minus'}>{row.amount > 0 ? `+${row.amount}` : row.amount}</strong>
                  </li>
                ))}
              </ul>
            )}
          </section>
          <Link className="claude-tip credits-tip" href="/growth">
            <Gem px={3} />
            <span>숨은 업적을 찾으면 보유 크레딧을 받아요. 내 성장에서 찾은 업적을 볼 수 있어요.</span>
          </Link>
        </div>
      </div>
    </div>
  );
}
