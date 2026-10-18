import type { SharedQuestion } from '@moai/shared';
import { useState } from 'react';
import { errorMessage, request } from '../api';
import { copyText } from '../copy';
import { Link } from '../router';
import { formatDate, useApi } from '../useApi';

// 질문 은행 (설계서 §2.4): 친구들이 공유한 질문. 답과 판정은 없다. 복사해서 claude.ai에서 내 말로 답해 본다.

export function QuestionBank() {
  const { data, error, reload } = useApi<{ questions: SharedQuestion[] }>('/shared-questions');
  const [message, setMessage] = useState<{ text: string; tone: 'good' | 'bad' } | null>(null);
  if (error) return <div className="screen"><p className="notice bad">{error}</p></div>;
  if (!data) return <div className="center muted">불러오는 중…</div>;

  const copy = (question: SharedQuestion) =>
    void copyText(question.prompt).then((ok) =>
      setMessage(ok ? { text: '복사했어요. claude.ai 채팅에 붙여 넣으세요.', tone: 'good' } : { text: '복사하지 못했어요.', tone: 'bad' }),
    );
  const remove = async (question: SharedQuestion) => {
    try {
      await request(`/shared-questions/${question.id}`, { method: 'DELETE' });
      reload();
    } catch (reason) {
      setMessage({ text: errorMessage(reason), tone: 'bad' });
    }
  };

  return (
    <div className="screen">
      <Link href="/map" className="back">
        ← 지식 지도
      </Link>
      <h1>질문 은행</h1>
      <p className="muted small">친구들이 공유한 질문이에요. 답과 판정은 공유되지 않아요. 개념 화면의 "다음에 볼 질문"에서 내 질문도 공유할 수 있어요.</p>
      {message ? <p className={`notice ${message.tone}`}>{message.text}</p> : null}
      {data.questions.length === 0 ? <p className="muted">아직 공유된 질문이 없어요.</p> : null}
      <ul className="list">
        {data.questions.map((question) => (
          <li key={question.id}>
            <p className="small">
              <span className="chip">{question.concept_name}</span> <span className="muted">{question.mine ? '내가 공유' : question.by} · {formatDate(question.created_at)}</span>
            </p>
            <p>{question.question}</p>
            <div className="row-actions">
              <button type="button" className="text-button" onClick={() => copy(question)}>
                복사해서 공부하기
              </button>
              {question.mine ? (
                <button type="button" className="text-button" onClick={() => void remove(question)}>
                  공유 취소
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
