// 가장 큰 save_learning 요청을 만든다 (개념 20, 카드 30, 판정 40, 연결 40, 질문 10).
// MVP 0의 CPU 측정(설계서 §2.1 #3)과 계약 테스트에 쓴다.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sentence = (n, seed) =>
  Array.from({ length: n }, (_, i) => `${seed}에 대한 설명 문장 ${i + 1}은 실제 코칭에서 나올 법한 길이로 씁니다.`).join(' ');

const concepts = Array.from({ length: 20 }, (_, i) => ({
  key: `concept-${i + 1}`,
  name: `개념 ${i + 1}`,
  aliases: [`개념${i + 1}`, `concept ${i + 1}`],
  domain: 'java',
  final_answer: sentence(4, `개념 ${i + 1}`),
}));

const edgeTypes = ['prerequisite', 'follow_up', 'contrast', 'part_of'];
const edges = Array.from({ length: 40 }, (_, i) => ({
  from: `concept-${(i % 20) + 1}`,
  to: `concept-${((i + 1 + Math.floor(i / 20)) % 20) + 1}`,
  type: edgeTypes[i % 4],
}));

const labels = ['맞음', '애매', '틀림', '빠짐'];
const judgments = Array.from({ length: 40 }, (_, i) => ({
  concept: `concept-${(i % 20) + 1}`,
  label: labels[i % 4],
  ...(labels[i % 4] === '빠짐' ? {} : { said: sentence(3, `사용자 원문 ${i + 1}`) }),
  note: sentence(1, `판정 메모 ${i + 1}`),
}));

const followups = Array.from({ length: 10 }, (_, i) => ({
  concept: `concept-${i + 1}`,
  question: `개념 ${i + 1}과 개념 ${i + 2}는 어떻게 다른가요? 실제 면접에서 나올 법한 꼬리질문입니다.`,
}));

const code = 'public final class Member {\n    private final List<String> roles;\n    public Member(List<String> roles) { this.roles = List.copyOf(roles); }\n    public List<String> getRoles() { return roles; }\n}';

const cards = Array.from({ length: 30 }, (_, i) => {
  const concept = `concept-${(i % 20) + 1}`;
  switch (i % 4) {
    case 0:
      return { type: 'ox', concept, prompt: sentence(2, `OX 문제 ${i + 1}`), answer: 'X', explain: sentence(2, `OX 해설 ${i + 1}`) };
    case 1:
      return {
        type: 'mcq', concept, prompt: sentence(2, `객관식 문제 ${i + 1}`), code,
        options: [
          { text: sentence(2, `정답 보기 ${i + 1}`), correct: true },
          { text: sentence(2, `내 오답 ${i + 1}`), correct: false, from_my_answer: true },
          { text: sentence(2, `오답 보기 A ${i + 1}`), correct: false },
          { text: sentence(2, `오답 보기 B ${i + 1}`), correct: false },
        ],
        explain: sentence(2, `객관식 해설 ${i + 1}`),
      };
    case 2:
      return {
        type: 'cloze', concept,
        prompt: `${sentence(2, `빈칸 문제 ${i + 1}`)} 핵심 단어는 ____이다.`,
        answer: '재할당', choices: ['재할당', '상속', '오버라이딩', '직렬화', '캡슐화'],
        explain: sentence(2, `빈칸 해설 ${i + 1}`),
      };
    default:
      return { type: 'explain', concept: `concept-${((i - 1) % 20) + 1}`, prompt: `개념 ${((i - 1) % 20) + 1}을 30초 안에 설명해 보세요.`, checklist: ['첫 문장에 정의', '핵심 이유', '예시 하나', '비교 대상'] };
  }
});

const payload = {
  topic: '최대 크기 측정용 세션',
  source: 'claude.ai',
  final_answer: sentence(5, '세션 최종 버전'),
  key_terms: Array.from({ length: 10 }, (_, i) => `핵심 용어 ${i + 1}`),
  concepts, edges, judgments, followups, cards,
};

const out = fileURLToPath(new URL('../packages/shared/fixtures/save-learning-max.json', import.meta.url));
const json = JSON.stringify(payload, null, 2);
writeFileSync(out, json + '\n');
console.log(`wrote ${out} (${Buffer.byteLength(JSON.stringify(payload))} bytes minified)`);
