import type { Me } from '@moai/shared';
import { useState, type FormEvent } from 'react';
import { errorMessage, request } from '../api';

// 오너 계정 만들기 (설계서 §8.3). 홈 화면에 추가한 앱 안에서 하면 쿠키가 그 앱에 남는다.

export function Setup({ onDone }: { onDone: (me: Me) => void }) {
  const [code, setCode] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onDone(await request<Me>('/setup', { method: 'POST', json: { code, display_name: name } }));
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="screen" onSubmit={(event) => void submit(event)}>
      <h1>모아이 시작하기</h1>
      <p className="muted">처음 한 번만 해요. 서버에 넣어 둔 설정 코드(BOOTSTRAP_CODE)와 이름을 넣어 주세요.</p>
      <label className="field">
        <span>설정 코드</span>
        <input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="off" autoCapitalize="off" spellCheck={false} required />
      </label>
      <label className="field">
        <span>이름</span>
        <input value={name} onChange={(event) => setName(event.target.value)} maxLength={30} required />
      </label>
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="bottom-actions">
        <button type="submit" className="button primary" disabled={busy}>
          {busy ? '만드는 중…' : '시작하기'}
        </button>
      </div>
    </form>
  );
}
