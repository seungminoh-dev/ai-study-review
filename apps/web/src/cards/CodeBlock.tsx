/** 코드는 고정폭 글꼴로, 줄바꿈 없이 가로 스크롤로 보여 준다 (설계서 §12.2) */
export function CodeBlock({ code }: { code: string }) {
  return (
    <pre className="code" tabIndex={0} aria-label="코드">
      <code>{code}</code>
    </pre>
  );
}
