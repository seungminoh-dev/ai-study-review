import type { MapNode, StatsDay, StatsResponse } from '@moai/shared';
import * as m from 'motion/react-m';
import type { CSSProperties, ReactNode } from 'react';
import { IconCheck, IconSnow } from './icons';
import { Link } from './router';

// 오늘 화면과 내 성장 화면이 같이 쓰는 진행 표시: 목표 링, 이번 주 7칸, 최근 12주, 분류별 진행

/** 둥근 진행 링. tone="hero"는 남색 카드 위에서 쓴다. 채운 만큼 0에서부터 차오른다 */
export function Ring({ value, max, size = 96, label, children, tone = 'card' }: { value: number; max: number; size?: number; label: string; children: ReactNode; tone?: 'card' | 'hero' }) {
  const stroke = Math.round(size / 9);
  const radius = (size - stroke) / 2;
  const ratio = max > 0 ? Math.min(1, value / max) : 0;
  return (
    <div className="ring" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={label}>
        <circle cx={size / 2} cy={size / 2} r={radius} fill="none" stroke={tone === 'hero' ? 'var(--hero-line)' : 'var(--surface-2)'} strokeWidth={stroke} />
        {ratio > 0 ? (
          <m.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={stroke}
            strokeLinecap="round"
            transform={`rotate(-90 ${size / 2} ${size / 2})`}
            initial={{ pathLength: 0 }}
            animate={{ pathLength: ratio }}
            transition={{ duration: 0.9, ease: [0.2, 0.8, 0.2, 1], delay: 0.15 }}
          />
        ) : null}
      </svg>
      <div className="ring-label" aria-hidden="true">
        {children}
      </div>
    </div>
  );
}

/** 연속 학습 목표 단계. 지금 연속보다 큰 첫 단계가 다음 목표다 */
const STREAK_GOALS = [3, 7, 14, 30, 60, 100, 365];

/** 다음 연속 목표까지 남은 날. 14일까지는 하루씩 칸으로, 그 뒤로는 앞 단계부터 막대로 보여 준다. steps는 단계 칩 4개를 같이 그린다 */
export function StreakGoal({ streak, steps = false }: { streak: number; steps?: boolean }) {
  const index = STREAK_GOALS.findIndex((goal) => goal > streak);
  if (index < 0) return <p className="streak-goal-top small">연속 목표를 모두 넘었어요. 대단해요!</p>;
  const next = STREAK_GOALS[index]!;
  const from = index > 0 ? STREAK_GOALS[index - 1]! : 0;
  const cells = next <= 14;
  const shown = STREAK_GOALS.slice(Math.max(0, Math.min(index - 1, STREAK_GOALS.length - 4)), Math.max(0, Math.min(index - 1, STREAK_GOALS.length - 4)) + 4);
  return (
    <div className="streak-goal">
      <p className="streak-goal-top small">
        <strong>다음 목표 {next}일</strong>
        <span className="streak-goal-left">{next - streak}일 남았어요</span>
      </p>
      {cells ? (
        <div className="streak-cells" role="img" aria-label={`${next}일 중 ${streak}일 채움`}>
          {Array.from({ length: next }, (_, i) => (
            <span key={i} className={i < streak ? 'on' : undefined} />
          ))}
        </div>
      ) : (
        <div className="bar streak-bar" role="img" aria-label={`${next}일 중 ${streak}일 채움`}>
          <div style={{ width: `${((streak - from) / (next - from)) * 100}%` }} />
        </div>
      )}
      {steps ? (
        <ol className="streak-steps">
          {shown.map((goal) => (
            <li key={goal} className={goal <= streak ? 'done' : goal === next ? 'next' : undefined}>
              {goal <= streak ? <IconCheck size={12} /> : null}
              {goal}일
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}

const WEEKDAYS = ['월', '화', '수', '목', '금', '토', '일'];

/** 오늘은 아직 지나지 않은 날 중 마지막 날이다 */
function todayKey(days: StatsDay[]): string | undefined {
  return [...days].reverse().find((day) => !day.future)?.day;
}

/** 이번 주 7칸: 채운 날, 프리즈로 지킨 날, 오늘(진행 중), 아직 안 온 날 */
export function WeekDays({ stats }: { stats: StatsResponse }) {
  const today = todayKey(stats.week.days);
  return (
    <ol className="days" aria-label="이번 주">
      {stats.week.days.map((day, index) => {
        const isToday = day.day === today;
        const state = day.met ? 'met' : day.frozen ? 'frozen' : isToday ? 'today' : day.future ? 'future' : '';
        const text = day.met ? '목표 채움' : day.frozen ? '프리즈' : isToday ? `${day.reviewed}/${stats.goal}장` : day.future ? '' : '쉼';
        return (
          <li key={day.day} className={isToday ? 'is-today' : undefined} style={{ '--i': index } as CSSProperties}>
            <span className={`day ${state}`} title={text}>
              {day.met ? <IconCheck /> : day.frozen ? <IconSnow /> : isToday && !day.met ? `${day.reviewed}/${stats.goal}` : null}
            </span>
            <span>
              {WEEKDAYS[index]}
              <span className="sr-only"> {text}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** 최근 12주: 한 열이 한 주(월~일). 진하기는 그날 푼 장수를 하루 목표와 비교한다 */
export function Heatmap({ history, goal }: { history: StatsDay[]; goal: number }) {
  const level = (day: StatsDay) => {
    if (day.future) return 'future';
    if (day.reviewed === 0) return '';
    if (day.reviewed < goal / 2) return 'l1';
    if (day.reviewed < goal) return 'l2';
    return day.reviewed < goal * 2 ? 'l3' : 'l4';
  };
  const weeks = Array.from({ length: Math.ceil(history.length / 7) }, (_, week) => history.slice(week * 7, week * 7 + 7));
  const studied = history.filter((day) => day.reviewed > 0).length;
  return (
    <>
      <div className="heatmap" role="img" aria-label={`최근 12주 중 ${studied}일 공부했어요`}>
        {weeks.map((days) => (
          <div key={days[0]!.day} className="heatmap-week">
            {days.map((day) => (
              <span key={day.day} className={`heat ${level(day)}`} title={day.future ? undefined : `${day.day} · ${day.reviewed}장`} />
            ))}
          </div>
        ))}
      </div>
      <div className="heat-legend" aria-hidden="true">
        <span>적게</span>
        <span className="heat" />
        <span className="heat l1" />
        <span className="heat l2" />
        <span className="heat l3" />
        <span className="heat l4" />
        <span>많이</span>
      </div>
    </>
  );
}

/** 지식 지도에서 상태별 개념 수. 아직 안 푼 자료 개념은 내 지식이 아니라 뺀다 */
export function conceptCounts(nodes: MapNode[]): { familiar: number; shaky: number; unlearned: number } {
  const mine = nodes.filter((node) => node.state !== 'material');
  return {
    familiar: mine.filter((node) => node.state === 'familiar').length,
    shaky: mine.filter((node) => node.state === 'shaky').length,
    unlearned: mine.filter((node) => node.state === 'unlearned').length,
  };
}

/** 큰 분류별로 익숙해진 개념의 비율. 누르면 그 분류만 복습한다 */
export function CategoryProgress({ nodes, limit = 5 }: { nodes: MapNode[]; limit?: number }) {
  const groups = new Map<string, { total: number; familiar: number }>();
  for (const node of nodes) {
    if (node.state === 'material' || !node.category) continue;
    const top = node.category.split('/')[0]!;
    const group = groups.get(top) ?? { total: 0, familiar: 0 };
    group.total += 1;
    if (node.state === 'familiar') group.familiar += 1;
    groups.set(top, group);
  }
  const rows = [...groups.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, limit);
  if (rows.length === 0) return <p className="muted small">분류가 정해진 개념이 아직 없어요.</p>;
  return (
    <>
      {rows.map(([name, group]) => (
        <div key={name} className="cat-row">
          <div>
            <p style={{ fontWeight: 600 }}>{name}</p>
            <p className="muted small">
              {group.total}개 중 {group.familiar}개 익숙함
            </p>
          </div>
          <div className="bar" role="progressbar" aria-label={`${name} 익숙함`} aria-valuemin={0} aria-valuemax={group.total} aria-valuenow={group.familiar}>
            <div style={{ width: `${(group.familiar / group.total) * 100}%` }} />
          </div>
          <Link className="small-button" href={`/review?category=${encodeURIComponent(name)}`}>
            복습
          </Link>
        </div>
      ))}
    </>
  );
}

/** 오늘 날짜 (한국 시간) */
export function todayLabel(): string {
  return new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'long', timeZone: 'Asia/Seoul' }).format(new Date());
}
