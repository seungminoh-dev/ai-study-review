import { useCallback, useEffect, useState } from 'react';
import { errorMessage, request } from './api';

/** GET 요청 하나를 화면 상태로 바꾼다 */
export function useApi<T>(path: string): { data: T | null; error: string | null; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    let cancelled = false;
    request<T>(path)
      .then((value) => {
        if (!cancelled) {
          setData(value);
          setError(null);
        }
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(errorMessage(reason));
      });
    return () => {
      cancelled = true;
    };
  }, [path, nonce]);
  return { data, error, reload: useCallback(() => setNonce((value) => value + 1), []) };
}

/** 버튼 하나의 일을 한다. 시작할 때 지난 오류를 지우고, 실패하면 그 이유를 error에 둔다 */
export function useRun(initial: string | null = null): { error: string | null; setError: (error: string | null) => void; run: (action: () => Promise<void>) => Promise<void> } {
  const [error, setError] = useState(initial);
  const run = async (action: () => Promise<void>) => {
    setError(null);
    try {
      await action();
    } catch (reason) {
      setError(errorMessage(reason));
    }
  };
  return { error, setError, run };
}

const dateFormat = new Intl.DateTimeFormat('ko-KR', { month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Seoul' });
const timeFormat = new Intl.DateTimeFormat('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Asia/Seoul' });

export const formatDate = (ms: number) => dateFormat.format(ms);
export const formatDateTime = (ms: number) => `${dateFormat.format(ms)} ${timeFormat.format(ms)}`;

/** 다음 복습까지 남은 시간: '1분', '10분', '3시간', '4일', '2개월' */
export function formatInterval(ms: number): string {
  const minutes = Math.max(1, Math.round(ms / 60_000));
  if (minutes < 60) return `${minutes}분`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}시간`;
  const days = Math.round(hours / 24);
  if (days < 31) return `${days}일`;
  return `${Math.round(days / 30)}개월`;
}
