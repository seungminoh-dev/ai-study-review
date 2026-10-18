import type { Me, PendingJoin } from '@moai/shared';
import { useEffect, useState, type FormEvent } from 'react';
import { RequestError, errorMessage, request } from '../api';
import { Splash } from '../Loading';

// 초대 코드로 가입 (설계서 §8.4). GitHub 확인을 마치고 서버가 이 화면으로 보낸다.

type Load = { state: 'loading' } | { state: 'ready'; pending: PendingJoin } | { state: 'expired'; message: string };

export function Join({ onDone }: { onDone: (me: Me) => void }) {
  const [load, setLoad] = useState<Load>({ state: 'loading' });
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

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
      onDone(await request<Me>('/auth/join', { method: 'POST', json: { code, display_name: name } }));
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
      <div className="screen">
        <h1>모아이 가입</h1>
        <p className="notice bad">{load.message}</p>
        <div className="actions">
          <a className="button primary" href="/api/auth/github/start">
            GitHub로 다시 하기
          </a>
        </div>
      </div>
    );
  }
  return (
    <form className="screen" onSubmit={(event) => void submit(event)}>
      <h1>모아이 가입</h1>
      <p className="muted">GitHub 계정(@{load.pending.github_login})으로 가입해요. 받은 초대 코드와 앱에서 쓸 이름을 넣어 주세요.</p>
      <label className="field">
        <span>초대 코드</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="ABCDE-FGHJK"
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          required
        />
      </label>
      <label className="field">
        <span>이름</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} required />
      </label>
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="bottom-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? '가입하는 중…' : '가입하기'}
        </button>
      </div>
    </form>
  );
}
