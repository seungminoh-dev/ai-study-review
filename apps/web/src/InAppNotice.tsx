import { useState } from 'react';
import { inAppBrowser, isIos, openInBrowser } from './push';

// 앱 안의 브라우저(카톡 등)로 들어왔을 때 맨 위에 뜨는 안내 (개선점 4). 여기서는 홈 화면 설치와 복습 알림이 안 되고,
// 바깥 브라우저는 로그인을 따로 기억해서 한 번 더 로그인해야 한다. "그냥 볼게요"를 누르면 이번에는 숨긴다.

export function InAppNotice() {
  const [hidden, setHidden] = useState(false);
  const app = inAppBrowser();
  if (!app || hidden) return null;
  const browser = isIos() ? 'Safari' : 'Chrome';
  const canOpen = app === 'kakao' || !isIos();
  return (
    <div className="notice warn inapp-notice" role="note">
      <p>
        {app === 'kakao' ? '카톡 안에서 열었어요.' : '앱 안의 브라우저로 열었어요.'} 홈 화면 설치와 복습 알림은 {browser}에서만 돼요. 거기서는 로그인을 한 번 더 해요.
      </p>
      <div className="inapp-actions">
        {canOpen ? (
          <button type="button" className="button primary" onClick={() => openInBrowser()}>
            {browser === 'Chrome' ? 'Chrome으로 열기' : 'Safari로 열기'}
          </button>
        ) : (
          <p className="small">메뉴(··· 또는 공유 버튼)에서 "Safari로 열기"를 눌러 주세요.</p>
        )}
        <button type="button" className="text-button" onClick={() => setHidden(true)}>
          그냥 볼게요
        </button>
      </div>
    </div>
  );
}
