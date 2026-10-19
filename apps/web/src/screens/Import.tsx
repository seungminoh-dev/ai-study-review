import type { ImportResult, JobView } from '@moai/shared';
import { MAX_IMPORT_CHARS } from '@moai/shared/client';
import { useEffect, useState, type FormEvent } from 'react';
import { JOB_ERROR, aiStatus } from '../ai';
import { errorMessage, request } from '../api';
import { BackLink, Link } from '../router';
import { formatDateTime, useApi } from '../useApi';

// 붙여넣기 가져오기 (설계서 §11.4): 커넥터 없이 한 대화를 통째로 붙여 넣으면 서버가 카드로 만든다.
// 몇 분 걸릴 수 있어서 서버가 매분 차례로 처리하고, 끝나면 알림을 보낸다. 원문은 끝나면 지운다.

const STATUS: Record<JobView['status'], string> = { queued: '기다리는 중', running: '만드는 중', done: '완료', failed: '실패' };

export function Import() {
  const { data, reload } = useApi<{ jobs: JobView[] }>('/imports');
  const [available, setAvailable] = useState<boolean | null>(null);
  const [text, setText] = useState('');
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void aiStatus().then((status) => setAvailable(status.available && !status.over_budget));
  }, []);
  // 기다리는 작업이 있으면 10초마다 다시 본다
  const waiting = data?.jobs.some((job) => job.status === 'queued' || job.status === 'running');
  useEffect(() => {
    if (!waiting) return;
    const timer = setInterval(reload, 10_000);
    return () => clearInterval(timer);
  }, [waiting, reload]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const result = await request<{ job_id: string; duplicate: boolean }>('/import', { method: 'POST', json: { text } });
      setMessage({ text: result.duplicate ? '이미 가져온 대화예요.' : '받았어요. 1~3분 뒤에 카드가 생기면 알림으로 알려 드려요.', tone: 'good' });
      setText('');
      reload();
    } catch (error) {
      setMessage({ text: errorMessage(error), tone: 'bad' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="screen">
      <BackLink href="/sessions" className="back">
        ← 저장 기록
      </BackLink>
      <h1>대화 붙여넣기</h1>
      <p className="muted small">
        커넥터를 못 쓰는 곳에서 공부한 대화를 통째로 붙여 넣으면 카드로 만들어요. 대화에 있는 내용만 쓰고, 원문은 카드를 만든 뒤 지워요.
      </p>
      {available === false ? <p className="notice warn">지금은 서버 AI를 쓸 수 없어요 (설정이 없거나 이번 달 한도에 닿았어요).</p> : null}
      <form onSubmit={(event) => void submit(event)}>
        <textarea
          className="answer-input"
          value={text}
          onChange={(event) => setText(event.target.value)}
          rows={10}
          maxLength={MAX_IMPORT_CHARS}
          placeholder="클로드 대화를 복사해서 붙여 넣으세요"
          aria-label="대화"
          required
        />
        <p className="muted small">
          {text.length.toLocaleString()} / {MAX_IMPORT_CHARS.toLocaleString()}자
        </p>
        {message ? <p className={`notice ${message.tone}`}>{message.text}</p> : null}
        <div className="actions">
          <button type="submit" className="button primary" disabled={busy || available === false || text.trim().length < 200}>
            {busy ? '보내는 중…' : '카드로 만들기'}
          </button>
        </div>
      </form>
      {data && data.jobs.length > 0 ? (
        <section>
          <h2>가져온 대화</h2>
          <ul className="list">
            {data.jobs.map((job) => {
              const result = job.result as ImportResult | null;
              return (
                <li key={job.id}>
                  <p className="small">
                    <strong>{STATUS[job.status]}</strong> · <span className="muted">{formatDateTime(job.created_at)}</span>
                  </p>
                  {job.status === 'done' && result ? (
                    <Link href={`/sessions/${result.session_id}`} className="small">
                      {result.summary.split('\n')[0]} →
                    </Link>
                  ) : null}
                  {job.status === 'failed' ? <p className="muted small">{JOB_ERROR[job.error ?? ''] ?? '실패했어요.'}</p> : null}
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
