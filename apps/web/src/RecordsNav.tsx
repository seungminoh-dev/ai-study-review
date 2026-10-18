import { TabLink } from './router';

// 휴대폰 기록 탭 위의 나누기: 공부한 대화 | 자료. 컴퓨터는 사이드바에 둘 다 있어서 숨긴다

export function RecordsNav({ current, materials = 0 }: { current: 'sessions' | 'materials'; materials?: number }) {
  return (
    <nav className="records-nav narrow-only" aria-label="기록 종류">
      <TabLink href="/sessions" className={current === 'sessions' ? 'on' : undefined} aria-current={current === 'sessions' ? 'page' : undefined}>
        공부한 대화
      </TabLink>
      <TabLink href="/materials" className={current === 'materials' ? 'on' : undefined} aria-current={current === 'materials' ? 'page' : undefined}>
        자료{materials > 0 ? ` ${materials}` : ''}
      </TabLink>
    </nav>
  );
}
