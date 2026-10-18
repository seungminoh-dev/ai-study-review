import { Mascot } from './Mascot';

// 불러오는 중: 글자 대신 화면 모양의 뼈대와 책 읽는 마스코트를 보여 준다. 빨리 끝나면 깜빡이지 않게 조금 늦게 나타난다

export function Loading({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="loading" role="status">
      <div className="loading-head">
        <Mascot mood="study" size={48} />
        <div className="loading-lines">
          <span className="skeleton" style={{ width: '62%' }} />
          <span className="skeleton short" style={{ width: '38%' }} />
        </div>
      </div>
      <span className="skeleton block" />
      <span className="skeleton block small" />
      <span className="sr-only">{label}…</span>
    </div>
  );
}

/** 앱을 열 때 로그인 확인을 기다리는 화면 */
export function Splash() {
  return (
    <div className="splash" role="status">
      <Mascot mood="wave" size={96} />
      <strong>모아이</strong>
      <span className="sr-only">여는 중…</span>
    </div>
  );
}
