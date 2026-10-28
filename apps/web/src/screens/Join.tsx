import type { LoginProvider, Me, PendingJoin } from '@moai/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { RequestError, errorMessage, request } from '../api';
import { IconCheck } from '../icons';
import { Splash } from '../Loading';
import { Mascot } from '../Mascot';
import { nextOf } from './Login';

// 가입 (설계서 §8.4, 3단계 시안). GitHub나 Google 확인을 마치고 서버가 이 화면으로 보낸다. 가입하면 시작 가이드로 간다.
// 초대 코드는 있으면 넣는다 (2026-10-22부터 없어도 가입한다).

type Load = { state: 'loading' } | { state: 'ready'; pending: PendingJoin } | { state: 'expired'; message: string };

/** GitHub(Google) 확인 → 이름 → 시작 */
function Steps({ provider }: { provider: LoginProvider }) {
  return (
    <ol className="join-steps" aria-label="가입 단계">
      <li className="done">
        <span className="join-mark">
          <IconCheck size={14} />
        </span>
        {provider === 'google' ? 'Google' : 'GitHub'} 확인
      </li>
      <li className="current" aria-current="step">
        <span className="join-mark">2</span>
        이름
      </li>
      <li>
        <span className="join-mark">3</span>
        시작
      </li>
    </ol>
  );
}

export function Join({ onDone }: { onDone: (me: Me) => void }) {
  const next = nextOf(new URLSearchParams(location.search).get('next'));
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [agree, setAgree] = useState(false);

  useEffect(() => {
    request<PendingJoin>('/auth/join')
      .then((pending) => {
        setLoad({ state: 'ready', pending });
        setName(pending.suggested_name);
      })
      .catch((reason: unknown) => setLoad({ state: 'expired', message: errorMessage(reason) }));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = await request<Me>('/auth/join', { method: 'POST', json: { code, display_name: name, agree } });
      if (next) location.assign(next);
      else onDone(me);
    } catch (reason) {
      // 만료됐거나 너무 많이 틀렸으면 로그인부터 다시 한다
      // 초대 없는 가입 자리가 찬 것(join_full)은 다시 시작할 일이 아니다. 폼을 두고 초대 코드를 넣게 한다 (#20)
      if (reason instanceof RequestError && (reason.status === 410 || (reason.status === 429 && reason.code !== 'join_full'))) setLoad({ state: 'expired', message: reason.message });
      else setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (load.state === 'loading') return <Splash />;
  if (load.state === 'expired') {
    return (
      <div className="auth">
        <div className="auth-hero">
          <Mascot mood="oops" size={96} />
          <h1>가입을 다시 시작해요</h1>
          <p className="notice bad">{load.message}</p>
        </div>
        <div className="bottom-actions">
          <a className="button primary" href="/login">
            로그인부터 다시 하기
          </a>
        </div>
      </div>
    );
  }
  return (
    <form className="auth" onSubmit={(event) => void submit(event)}>
      <Steps provider={load.pending.provider} />
      <div className="auth-hero">
        <Mascot mood="happy" size={104} />
        <p className="auth-chip">{load.pending.github_login ? `@${load.pending.github_login}님, 반가워요!` : '반가워요!'}</p>
        <h1>앱에서 불릴 이름을 정해 주세요</h1>
        <p className="muted small">이름만 정하면 끝나요. 받은 초대 코드가 있으면 함께 넣어 주세요.</p>
      </div>
      <label className="field">
        <span>이름</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="앱에서 불릴 이름" maxLength={30} required />
      </label>
      <label className="field">
        <span>초대 코드 (있으면)</span>
        <input
          className="mono"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCDE-FGHJK"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
        />
      </label>
      {error ? <p className="notice bad">{error}</p> : null}
      <p className="muted small">초대 코드는 모아이를 쓰는 친구나 운영자에게 받아요. 없으면 비워 두세요.</p>
      <label className="toggle join-agree">
        <input type="checkbox" checked={agree} onChange={(event) => setAgree(event.target.checked)} required />
        {/* 새 탭으로 연다. 이 화면을 떠나면 넣던 초대 코드가 사라진다 */}
        <span>
          만 14세 이상이고,{' '}
          <a href="/terms" target="_blank" rel="noreferrer">
            이용약관
          </a>
          과{' '}
          <a href="/privacy" target="_blank" rel="noreferrer">
            개인정보 처리방침
          </a>
          에 동의해요.
        </span>
      </label>
      <div className="bottom-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? '가입하는 중…' : '가입하고 시작하기'}
        </button>
      </div>
    </form>
  );
}
