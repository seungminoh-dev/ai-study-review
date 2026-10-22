import type { Me } from '@moai/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';
import { IconGithub, IconGoogle } from '../icons';
import { Mascot } from '../Mascot';
import { isIos, isStandalone } from '../push';
import { BackLink, useLocation } from '../router';

// 로그인 (설계서 §8.4, §8.5, 3단계 시안): Google·GitHub로 계속하기, 또는 로그인된 기기에서 받은 코드.
// 처음 보는 계정이면 서버가 가입 화면(/join)으로 보낸다. 로그인이 실패하면 서버가 ?auth=로 돌려보낸다.

const AUTH_TEXT: Record<string, string> = {
  denied: '로그인을 취소했어요.',
  expired: '로그인 시간이 지났어요. 다시 해 주세요.',
  session: '로그인이 끝났어요. 다시 로그인해 주세요. 보내지 못한 답은 이 기기에 남아 있어요.',
  failed: '계정 확인을 받지 못했어요. 잠시 뒤에 다시 해 주세요.',
  unavailable: '서버에 이 로그인 방법이 아직 설정되지 않았어요. 다른 방법이나 로그인 코드를 써 주세요.',
  disabled: '운영자가 이 계정의 이용을 멈췄어요. 운영자에게 문의해 주세요.',
};

/** 커넥터 허용 화면에서 로그인하러 왔으면 그리로 돌아간다. 남의 사이트로 보내지 않게 /authorize?만 따른다 */
const nextOf = (value: string | null) => (value && value.startsWith('/authorize?') ? value : null);

export function Login({ github, google, onDone }: { github: boolean; google: boolean; onDone: (me: Me) => void }) {
  const { query } = useLocation();
  const reason = AUTH_TEXT[query.get('auth') ?? ''];
  const next = nextOf(query.get('next'));
  const start = (provider: 'github' | 'google') => `/api/auth/${provider}/start${next ? `?${new URLSearchParams({ next })}` : ''}`;
  const received = [google ? 'Google에서는 계정 식별 번호만' : null, github ? 'GitHub에서는 아이디와 이름만' : null].filter(Boolean).join(', ');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await request<Me>('/auth/login', { method: 'POST', json: { code } });
      if (next) location.assign(next);
      else onDone(me);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth">
      <BackLink href="/" className="back">
        ← 처음으로
      </BackLink>
      <div className="auth-head">
        <Mascot mood={reason || error ? 'oops' : 'wave'} size={88} />
        <div>
          <h1>
            다시 만나서
            <br />
            반가워요
          </h1>
          <p className="muted small">로그인 방법을 골라 주세요.</p>
        </div>
      </div>
      {reason ? <p className="notice bad">{reason}</p> : null}
      {next ? <p className="notice">로그인하면 Claude 연결 허용 화면으로 돌아가요.</p> : null}
      {github || google ? (
        <>
          <div className="auth-block">
            {google ? (
              <a className="button" href={start('google')}>
                <IconGoogle />
                Google로 계속하기
              </a>
            ) : null}
            {github ? (
              <a className="button primary" href={start('github')}>
                <IconGithub />
                GitHub로 계속하기
              </a>
            ) : null}
            <p className="muted small">{received} 받아요. 처음이면 확인 뒤 앱에서 불릴 이름만 정하면 돼요.</p>
          </div>
          <p className="auth-or">또는</p>
        </>
      ) : null}
      <form className="auth-card" onSubmit={(event) => void submit(event)}>
        <label htmlFor="login-code" className="auth-label">
          로그인 코드
        </label>
        <input
          id="login-code"
          className="code-input"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCD-EFGH"
          autoComplete="one-time-code"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
        <p className="muted small">이미 로그인된 기기의 설정 → "다른 기기에서 로그인"에서 만들어요. 10분 동안 한 번 쓸 수 있어요.</p>
        {error ? <p className="notice bad">{error}</p> : null}
        <button type="submit" className="button" disabled={busy}>
          {busy ? '확인 중…' : '코드로 로그인'}
        </button>
      </form>
      {(github || google) && isIos() && isStandalone() ? (
        <p className="auth-tip">iPhone 홈 화면 앱에서는 GitHub·Google 로그인이 Safari로 넘어가 로그인이 앱에 남지 않을 수 있어요. 그럴 땐 위 로그인 코드를 쓰세요.</p>
      ) : null}
    </div>
  );
}
