import type { Achievement, Badge, BadgeId, StatsResponse } from '@moai/shared';
import { useEffect, useState, type CSSProperties } from 'react';
import { achievementArt } from './achievement-art';
import { forgetAiStatus } from './ai';
import { Confetti } from './Confetti';
import { Sprite } from './credits';
import { IconStar } from './icons';
import { play } from './sound';
import { Mascot, type Mood } from './Mascot';
import { Link } from './router';
import { readStoredJson, writeStored } from './prefs';

// 이정표 배지 (3단계 3-4). 무엇을 몇 번 하면 받는지는 packages/shared/src/badges.ts, 받은 기록은 서버가 갖는다.
// 새 배지 축하는 기기마다 한 번만 한다. 본 배지는 이 기기의 localStorage에 적어 둔다.
// 숨은 업적(4단계)도 같은 방식으로 축하한다. 업적은 조건을 미리 알려 주지 않아서, 서버가 이룬 것만 내려 준다.

/** tier: 1 처음 해 보기, 2 꾸준함, 3 오래 쌓기. 메달 색이 달라진다 */
export const BADGE_INFO: Record<BadgeId, { title: string; text: string; ribbon: string; mood: Mood; tier: 1 | 2 | 3 }> = {
  first_save: { title: '첫 저장', text: '공부한 대화를 처음 모아이에 저장했어요.', ribbon: '저장', mood: 'claude', tier: 1 },
  first_review: { title: '첫 복습', text: '첫 카드를 풀었어요.', ribbon: '복습', mood: 'study', tier: 1 },
  streak_3: { title: '3일 연속', text: '3일 연속으로 하루 목표를 채웠어요.', ribbon: '3일', mood: 'happy', tier: 1 },
  first_explain: { title: '첫 설명 통과', text: '처음으로 개념을 직접 설명해 냈어요.', ribbon: '설명', mood: 'wave', tier: 1 },
  streak_7: { title: '7일 연속', text: '일주일 내내 하루 목표를 채웠어요.', ribbon: '7일', mood: 'cheer', tier: 2 },
  concepts_10: { title: '개념 10개', text: '지식 지도에 개념이 10개 쌓였어요.', ribbon: '10개', mood: 'think', tier: 2 },
  reviews_100: { title: '카드 100장', text: '카드를 100장 풀었어요.', ribbon: '100장', mood: 'study', tier: 2 },
  streak_30: { title: '30일 연속', text: '한 달 동안 하루 목표를 채웠어요.', ribbon: '30일', mood: 'levelup', tier: 3 },
  concepts_50: { title: '개념 50개', text: '지식 지도에 개념이 50개 쌓였어요.', ribbon: '50개', mood: 'think', tier: 3 },
  reviews_500: { title: '카드 500장', text: '카드를 500장 풀었어요.', ribbon: '500장', mood: 'cheer', tier: 3 },
  reviews_1000: { title: '카드 1000장', text: '카드를 1000장 풀었어요.', ribbon: '1000장', mood: 'levelup', tier: 3 },
};

/** 받은 날: '10월 18일' (작년 이전이면 연도도) */
const dayFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
const yearFormat = new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', timeZone: 'Asia/Seoul' });
const earnedOn = (ms: number) => (new Date(ms).getFullYear() === new Date().getFullYear() ? dayFormat : yearFormat).format(ms);

const SEEN = 'moai:badges-seen';
/** 받은 지 이만큼 안 된 배지만 새 배지로 축하한다. 오래전에 이룬 것은 조용히 선반에만 둔다 */
const NEW_MS = 2 * 24 * 60 * 60 * 1000;

const readSeen = () => new Set((readStoredJson(SEEN) as string[] | null) ?? []);

/** 저장소를 못 쓰면 다음에 또 축하한다 */
function markSeen(ids: readonly string[]): void {
  if (ids.length > 0) writeStored(SEEN, JSON.stringify([...new Set([...readSeen(), ...ids])]));
}

/** 로그아웃하면 지운다. 같은 기기로 다른 사람이 로그인해도 그 사람의 새 배지를 축하한다 */
export const forgetSeenBadges = () => writeStored(SEEN, null);

type Earnable = { id: string; earned_at: number | null };

/** 이 기기에서 아직 축하하지 않은 새 배지·업적 (배지와 업적의 id는 겹치지 않는다) */
export function unseenBadges<T extends Earnable>(badges: readonly T[], now = Date.now()): T[] {
  const seen = readSeen();
  return badges.filter((badge) => badge.earned_at !== null && now - badge.earned_at < NEW_MS && !seen.has(badge.id));
}

/** 처음 그릴 때의 새 배지 목록을 고정하고, 본 것으로 적는다. 다시 그려도 목록이 사라지지 않는다 */
export function useUnseenBadges<T extends Earnable>(badges: readonly T[]): T[] {
  const [unseen] = useState(() => unseenBadges(badges));
  useEffect(() => markSeen(unseen.map((badge) => badge.id)), [unseen]);
  return unseen;
}

export function BadgeMedal({ badge, size = 'm', alive = false }: { badge: Badge; size?: 's' | 'm' | 'l'; alive?: boolean }) {
  const info = BADGE_INFO[badge.id];
  const locked = badge.earned_at === null;
  const mascot = { s: 32, m: 40, l: 56 }[size];
  return (
    <span className={`badge-medal size-${size}${locked ? ' locked' : ''}`} data-tier={info.tier} aria-hidden="true">
      <span className="badge-disc">
        <Mascot mood={locked ? 'sleep' : info.mood} size={mascot} still={!alive} />
      </span>
      <span className="badge-ribbon">{info.ribbon}</span>
    </span>
  );
}

/** 새로 받은 배지 축하 카드. 오늘 화면과 복습 끝 화면 위쪽에 뜬다 */
export function NewBadges({ badges, link = false, className }: { badges: readonly Badge[]; link?: boolean; className?: string }) {
  const unseen = useUnseenBadges(badges);
  if (unseen.length === 0) return null;
  const first = BADGE_INFO[unseen[0]!.id];
  return (
    <section className={className ? `badge-new ${className}` : 'badge-new'} aria-labelledby="badge-new-title">
      <Confetti />
      <p className="badge-new-kicker">새 이정표</p>
      <h2 id="badge-new-title">{unseen.length === 1 ? `${first.title} 배지를 받았어요` : `배지 ${unseen.length}개를 받았어요`}</h2>
      <ul className="badge-new-list">
        {unseen.map((badge, index) => (
          <li key={badge.id} style={{ '--i': index } as CSSProperties}>
            <BadgeMedal badge={badge} size="l" alive />
            <div>
              <strong>{BADGE_INFO[badge.id].title}</strong>
              <p className="small muted">{BADGE_INFO[badge.id].text}</p>
            </div>
          </li>
        ))}
      </ul>
      {link ? (
        <Link href="/growth" className="text-button">
          내 성장에서 모든 이정표 보기 →
        </Link>
      ) : null}
    </section>
  );
}

/** 내 성장 화면의 이정표 선반. 받은 배지는 날짜, 못 받은 배지는 진행 막대 */
export function BadgeShelf({ badges }: { badges: readonly Badge[] }) {
  const fresh = new Set(useUnseenBadges(badges).map((badge) => badge.id));
  const earned = badges.filter((badge) => badge.earned_at !== null).length;
  return (
    <section className="card" aria-labelledby="badge-title">
      <div className="card-head">
        <h2 id="badge-title">이정표</h2>
        <span className="aside">
          {earned}/{badges.length}
        </span>
      </div>
      <ul className="badge-shelf">
        {badges.map((badge) => {
          const info = BADGE_INFO[badge.id];
          const label = badge.earned_at !== null ? `${info.title}, ${earnedOn(badge.earned_at)}에 받음` : `${info.title}, 아직 못 받음 (${Math.min(badge.value, badge.target)}/${badge.target})`;
          return (
            <li key={badge.id} className={badge.earned_at === null ? 'locked' : fresh.has(badge.id) ? 'fresh' : undefined} aria-label={label} title={info.text}>
              {fresh.has(badge.id) ? <span className="badge-tag">NEW</span> : null}
              <BadgeMedal badge={badge} alive={fresh.has(badge.id)} />
              <strong>{info.title}</strong>
              {badge.earned_at !== null ? (
                <span className="muted small">{earnedOn(badge.earned_at)}</span>
              ) : (
                <span className="badge-progress">
                  <span className="bar">
                    <span style={{ width: `${Math.min(100, (badge.value / badge.target) * 100)}%` }} />
                  </span>
                  <span className="muted small">
                    {Math.min(badge.value, badge.target)}/{badge.target}
                  </span>
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** 업적 그림 칸. 업적마다 12×12 도트(achievement-art.ts)를 그린다. 숨은 것은 물음표, 그림이 아직 없는 업적은 별 */
function Gem({ id, px = 3 }: { id?: string; px?: number }) {
  if (id === undefined) {
    return (
      <span className="achievement-gem hidden" aria-hidden="true">
        ?
      </span>
    );
  }
  const art = achievementArt(id);
  return (
    <span className="achievement-gem" aria-hidden="true">
      {art ? <Sprite art={art} px={px} /> : <IconStar size={18} />}
    </span>
  );
}

/** 새로 찾은 숨은 업적 축하 카드. 오늘 화면과 복습 끝 화면에 뜬다. 받은 크레딧이 바로 보이게 AI 상태를 다시 묻는다 */
export function NewAchievements({ achievements, className }: { achievements: readonly Achievement[]; className?: string }) {
  const unseen = useUnseenBadges(achievements);
  useEffect(() => {
    if (unseen.length === 0) return;
    forgetAiStatus();
    // 끝 화면의 다른 소리 뒤에 울린다
    const timer = setTimeout(() => play('achievement'), 700);
    return () => clearTimeout(timer);
  }, [unseen]);
  if (unseen.length === 0) return null;
  const reward = unseen.reduce((sum, item) => sum + item.reward, 0);
  return (
    <section className={className ? `achievement-new ${className}` : 'achievement-new'} aria-labelledby="achievement-new-title">
      <Confetti />
      <p className="achievement-new-kicker">숨은 업적 발견</p>
      <h2 id="achievement-new-title">{unseen.length === 1 ? '숨겨진 조건을 채웠어요' : `숨겨진 조건 ${unseen.length}개를 채웠어요`}</h2>
      <ul className="badge-new-list">
        {unseen.map((item, index) => (
          <li key={item.id} style={{ '--i': index } as CSSProperties}>
            <Gem id={item.id} px={4} />
            <div>
              <strong>{item.title}</strong>
              <p className="small muted">{item.text}</p>
            </div>
          </li>
        ))}
      </ul>
      <p className="achievement-new-reward">보유 크레딧 +{reward}</p>
    </section>
  );
}

/** 내 성장 화면의 숨은 업적. 이룬 것만 이름·조건·보상을 보여 주고, 나머지는 개수만 */
export function AchievementShelf({ achievements }: { achievements: StatsResponse['achievements'] }) {
  const fresh = new Set(useUnseenBadges(achievements.earned).map((item) => item.id));
  const hidden = achievements.total - achievements.earned.length;
  return (
    <section className="card" aria-labelledby="achievement-title">
      <div className="card-head">
        <h2 id="achievement-title">숨은 업적</h2>
        <span className="aside">
          {achievements.earned.length}/{achievements.total}
        </span>
      </div>
      {achievements.earned.length > 0 ? (
        <ul className="achievement-list">
          {achievements.earned.map((item) => (
            <li key={item.id} className={fresh.has(item.id) ? 'fresh' : undefined}>
              <Gem id={item.id} />
              <div className="grow">
                <strong>{item.title}</strong>
                <p className="small muted">{item.text}</p>
              </div>
              <span className="achievement-reward">
                +{item.reward}
                <small>{earnedOn(item.earned_at)}</small>
              </span>
            </li>
          ))}
        </ul>
      ) : null}
      {hidden > 0 ? (
        <div className="achievement-hidden">
          <span className="achievement-hidden-gems" aria-hidden="true">
            {Array.from({ length: Math.min(hidden, 5) }, (_, index) => (
              <Gem key={index} />
            ))}
          </span>
          <p className="small muted">
            {hidden}개가 더 숨어 있어요. 무엇을 하면 받는지는 비밀이고, 찾으면 보유 크레딧을 드려요.
          </p>
        </div>
      ) : null}
    </section>
  );
}
