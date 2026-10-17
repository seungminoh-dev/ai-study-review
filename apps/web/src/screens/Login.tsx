import type { Me } from '@moai/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { isIos, isStandalone } from '../push';
import { useLocation } from '../router';

// 로그인 (설계서 §8.4, §8.5): GitHub로 계속하기, 또는 로그인된 기기에서 받은 코드.
// 처음 보는 GitHub 계정이면 서버가 초대 코드 화면(/join)으로 보낸다.

const AUTH_TEXT: Record<string, string> = {
  denied: 'GitHub 로그인을 취소했어요.',
  expired: '로그인 시간이 지났어요. 다시 해 주세요.',
  failed: 'GitHub에서 계정 정보를 받지 못했어요. 잠시 뒤에 다시 해 주세요.',
  unavailable: '서버에 GitHub 로그인이 아직 설정되지 않았어요. 로그인 코드를 써 주세요.',
};

export function Login({ github, onDone }: { github: boolean; onDone: (me: Me) => void }) {
  const { query } = useLocation();
  const reason = AUTH_TEXT[query.get('auth') ?? ''];
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await request<Me>('/auth/login', { method: 'POST', json: { code } }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <h1>모아이</h1>
      <p className="muted">AI와 공부한 내용을 2~3분씩 되새기는 복습 앱이에요. 초대받은 사람만 가입할 수 있어요.</p>
      {reason ? <p className="notice bad">{reason}</p> : null}
      {github ? (
        <>
          <div className="actions">
            <a className="button primary" href="/api/auth/github/start">
              GitHub로 계속하기
            </a>
          </div>
          <p className="muted small">처음이면 GitHub 확인 뒤 초대 코드를 넣어요. GitHub에서는 아이디와 이름만 받아요.</p>
          {isIos() && isStandalone() ? (
            <p className="muted small">iPhone 홈 화면 앱에서는 GitHub 로그인이 Safari로 넘어가 로그인이 앱에 남지 않을 수 있어요. 그럴 땐 아래 로그인 코드를 쓰세요.</p>
          ) : null}
        </>
      ) : null}
      <form onSubmit={(event) => void submit(event)}>
        <h2>로그인 코드로</h2>
        <p className="muted small">이미 로그인된 기기의 설정 → "다른 기기에서 로그인"에서 코드를 만들어요. 10분 동안 한 번 쓸 수 있어요.</p>
        <label className="field">
          <span>로그인 코드</span>
          <input
            value={code}
            onChange={(event) => setCode(event.target.value)}
            placeholder="ABCD-EFGH"
            autoComplete="one-time-code"
            autoCapitalize="characters"
            spellCheck={false}
            required
          />
        </label>
        {error ? <p className="notice bad">{error}</p> : null}
        <div className="actions">
          <button type="submit" className="button" disabled={busy}>
            {busy ? '확인 중…' : '코드로 로그인'}
          </button>
        </div>
      </form>
    </div>
  );
}
