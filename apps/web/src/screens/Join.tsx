import type { Me, PendingJoin } from '@moai/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { RequestError, errorMessage, request } from '../api';
import { IconCheck, IconGithub } from '../icons';
import { Splash } from '../Loading';
import { Mascot } from '../Mascot';

// 초대 코드로 가입 (설계서 §8.4, 3단계 시안). GitHub 확인을 마치고 서버가 이 화면으로 보낸다. 가입하면 시작 가이드로 간다.

type Load = { state: 'loading' } | { state: 'ready'; pending: PendingJoin } | { state: 'expired'; message: string };

/** GitHub 확인 → 초대 코드 → 시작 */
function Steps() {
  return (
    <ol className="join-steps" aria-label="가입 단계">
      <li className="done">
        <span className="join-mark">
          <IconCheck size={14} />
        </span>
        GitHub 확인
      </li>
      <li className="current" aria-current="step">
        <span className="join-mark">2</span>
        초대 코드
      </li>
      <li>
        <span className="join-mark">3</span>
        시작
      </li>
    </ol>
  );
}

/** Claude 커넥터 허용 화면에서 가입하러 왔으면 가입한 뒤 그리로 돌아간다. 남의 사이트로 보내지 않게 /authorize?만 따른다 */
const nextOf = (value: string | null) => (value && value.startsWith('/authorize?') ? value : null);

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
      // 만료됐거나 너무 많이 틀렸으면 GitHub 확인부터 다시 한다
      if (reason instanceof RequestError && (reason.status === 410 || reason.status === 429)) setLoad({ state: 'expired', message: reason.message });
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
          <a className="button primary" href="/api/auth/github/start">
            <IconGithub />
            GitHub로 다시 하기
          </a>
        </div>
      </div>
    );
  }
  return (
    <form className="auth" onSubmit={(event) => void submit(event)}>
      <Steps />
      <div className="auth-hero">
        <Mascot mood="happy" size={104} />
        <p className="auth-chip">@{load.pending.github_login}님, 반가워요!</p>
        <h1>초대 코드를 넣어 주세요</h1>
        <p className="muted small">받은 초대 코드와 앱에서 불릴 이름이면 끝나요.</p>
      </div>
      <label className="field">
        <span>초대 코드</span>
        <input
          className="mono"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          placeholder="ABCDE-FGHJK"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </label>
      <label className="field">
        <span>이름</span>
        <input value={name} onChange={(event) => setName(event.target.value)} placeholder="앱에서 불릴 이름" maxLength={30} required />
      </label>
      {error ? <p className="notice bad">{error}</p> : null}
      <p className="muted small">초대 코드는 모아이를 쓰는 친구나 운영자에게 받아요.</p>
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
