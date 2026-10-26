import { useId, useState, type FormEvent } from 'react';
import { errorMessage } from './api';

// 화면 제목과 "이름 바꾸기". 누르면 그 자리에서 고친다 (자료 이름, 저장한 대화 이름)

export function EditableTitle({
  value,
  maxLength,
  onSave,
  hint,
  allowEmpty = false,
  bare = false,
}: {
  value: string;
  maxLength: number;
  /** 저장한 뒤의 이름을 돌려준다 (비우면 원래 이름으로 돌아가는 경우) */
  onSave: (next: string) => Promise<string>;
  hint?: string;
  /** 비워서 저장할 수 있다 (원래 이름으로 돌리기) */
  allowEmpty?: boolean;
  /** 이름은 다른 곳에 보이고 여기에는 "이름 바꾸기"만 둔다 (학습 탭의 펼친 섹션) */
  bare?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const id = useId();

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy || (!allowEmpty && !text.trim())) return;
    setBusy(true);
    setError(null);
    try {
      setShown(await onSave(text.trim()));
      setEditing(false);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <div className={bare ? 'title-row small-title' : 'title-row'}>
        {bare ? null : <h1>{shown}</h1>}
        <button
          type="button"
          className="text-button"
          onClick={() => {
            setText(shown);
            setEditing(true);
          }}
        >
          이름 바꾸기
        </button>
      </div>
    );
  }
  return (
    <form className="title-edit" onSubmit={(event) => void submit(event)}>
      <label className="sr-only" htmlFor={id}>
        새 이름
      </label>
      <input id={id} value={text} maxLength={maxLength} autoFocus onFocus={(event) => event.currentTarget.select()} onChange={(event) => setText(event.target.value)} />
      {hint ? <p className="muted small">{hint}</p> : null}
      {error ? <p className="notice bad">{error}</p> : null}
      <div className="actions">
        <button type="button" className="button" onClick={() => setEditing(false)}>
          취소
        </button>
        <button type="submit" className="button primary" disabled={busy || (!allowEmpty && !text.trim())}>
          저장
        </button>
      </div>
    </form>
  );
}
