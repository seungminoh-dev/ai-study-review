import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Mascot } from './Mascot';

// 화면을 그리다 오류가 나면 빈 화면 대신 새로고침을 권한다.
// 가장 흔한 경우는 배포 직후 예전 화면 조각(/assets/*.js)을 못 받는 것이라 새로고침하면 풀린다.

export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('screen_error', error, info.componentStack);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="screen done crash" role="alert">
        <Mascot mood="oops" size={96} />
        <p className="big">화면을 불러오지 못했어요</p>
        <p className="muted">앱이 새 버전으로 바뀌었거나 연결이 잠깐 끊겼을 수 있어요. 새로고침하면 대부분 풀려요.</p>
        <button type="button" className="button primary" onClick={() => location.reload()}>
          새로고침
        </button>
      </div>
    );
  }
}
