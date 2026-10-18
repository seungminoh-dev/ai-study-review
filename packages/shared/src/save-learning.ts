import { z } from 'zod';

// save_learning 입력 스키마. MCP 도구 입력, 붙여넣기 가져오기 결과 검증, PWA 타입이 함께 쓴다 (설계서 §6.4).

export const ConceptKey = z
  .string()
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, '영어 소문자 kebab-case여야 해요 (예: deep-copy)')
  .max(60);

export const JudgmentLabel = z.enum(['맞음', '애매', '틀림', '빠짐']);
export type JudgmentLabel = z.infer<typeof JudgmentLabel>;
export const EdgeType = z.enum(['prerequisite', 'follow_up', 'contrast', 'part_of']);
export type EdgeType = z.infer<typeof EdgeType>;

const OxCard = z.object({
  type: z.literal('ox'),
  concept: ConceptKey,
  prompt: z.string().min(1).max(500),
  code: z.string().max(1500).optional(),
  answer: z.enum(['O', 'X']),
  explain: z.string().min(1).max(400),
});

const McqCard = z.object({
  type: z.literal('mcq'),
  concept: ConceptKey,
  prompt: z.string().min(1).max(500),
  code: z.string().max(1500).optional(),
  options: z
    .array(
      z.object({
        text: z.string().min(1).max(300),
        correct: z.boolean(),
        from_my_answer: z.boolean().optional(),
      }),
    )
    .min(3)
    .max(4),
  explain: z.string().min(1).max(400),
});

const ClozeCard = z.object({
  type: z.literal('cloze'),
  concept: ConceptKey,
  prompt: z.string().min(1).max(500),
  answer: z.string().min(1).max(40),
  choices: z.array(z.string().min(1).max(40)).min(3).max(5),
  explain: z.string().min(1).max(400),
});

const ExplainCard = z.object({
  type: z.literal('explain'),
  concept: ConceptKey,
  prompt: z.string().min(1).max(300),
  checklist: z.array(z.string().min(1).max(60)).min(2).max(5),
});

export const LearningCard = z.discriminatedUnion('type', [OxCard, McqCard, ClozeCard, ExplainCard]);

export const SaveLearningInput = z.object({
  topic: z.string().min(1).max(200),
  source: z.enum(['claude.ai', 'claude-code']).default('claude.ai'),
  /** PDF 같은 자료에서 만든 카드면 자료 제목과 범위. 이 카드들은 사용자가 풀기 전까지 "자료"로 따로 둔다 */
  material: z
    .object({
      title: z.string().trim().min(1).max(120),
      part: z.string().trim().max(80).optional(),
    })
    .optional(),
  final_answer: z.string().max(2000).optional(),
  key_terms: z.array(z.string().min(1).max(40)).max(10).default([]),
  concepts: z
    .array(
      z.object({
        key: ConceptKey,
        name: z.string().min(1).max(60),
        aliases: z.array(z.string().min(1).max(60)).max(5).default([]),
        /** 분류 경로. 큰 분류부터 '/'로 잇는다 (예: "인프라/DevOps/Kubernetes"). 최대 3단계 */
        domain: z.string().max(80).optional(),
        final_answer: z.string().max(2000).optional(),
      }),
    )
    .min(1)
    .max(20),
  edges: z
    .array(z.object({ from: ConceptKey, to: ConceptKey, type: EdgeType }))
    .max(40)
    .default([]),
  judgments: z
    .array(
      z.object({
        concept: ConceptKey,
        label: JudgmentLabel,
        said: z.string().max(1000).optional(),
        note: z.string().min(1).max(500),
      }),
    )
    .max(40)
    .default([]),
  followups: z
    .array(z.object({ concept: ConceptKey, question: z.string().min(1).max(300) }))
    .max(10)
    .default([]),
  cards: z.array(LearningCard).min(1).max(30),
});

export type SaveLearningInput = z.infer<typeof SaveLearningInput>;
export type LearningCard = z.infer<typeof LearningCard>;

export const CLOZE_BLANK = '____';

export type Rung = 1 | 2 | 3;

/**
 * 카드 단계는 Claude가 정하지 않고 카드 종류로 정한다 (설계서 §9.4).
 * 1단계 알아보기: 코드 없는 ox·mcq / 2단계 떠올리기: cloze, 코드가 있는 ox·mcq / 3단계 설명하기: explain
 */
export function rungOf(card: LearningCard): Rung {
  switch (card.type) {
    case 'ox':
    case 'mcq':
      return card.code ? 2 : 1;
    case 'cloze':
      return 2;
    case 'explain':
      return 3;
  }
}

export interface ExistingConcepts {
  /** 이 사용자가 이미 가진 개념 key */
  keys: ReadonlySet<string>;
  /** 이미 최종 버전이 있는 개념 key */
  withFinalAnswer: ReadonlySet<string>;
  /** 이미 1·2단계 카드가 있는 개념 key */
  withLowRungCards: ReadonlySet<string>;
}

const NONE: ExistingConcepts = { keys: new Set(), withFinalAnswer: new Set(), withLowRungCards: new Set() };

/**
 * 스키마만으로 못 거르는 규칙을 검사한다 (설계서 §6.4).
 * 고칠 점을 한국어 문장 목록으로 돌려준다. 비어 있으면 통과다.
 */
export function checkSaveLearning(input: SaveLearningInput, existing: ExistingConcepts = NONE): string[] {
  const problems: string[] = [];
  const declared = new Set<string>();
  for (const concept of input.concepts) {
    if (declared.has(concept.key)) problems.push(`concepts에 key "${concept.key}"가 두 번 있어요.`);
    declared.add(concept.key);
  }
  const known = (key: string) => declared.has(key) || existing.keys.has(key);
  const requireKnown = (key: string, where: string) => {
    if (!known(key)) problems.push(`${where}의 개념 "${key}"가 concepts에도, 기존 개념에도 없어요.`);
  };

  input.edges.forEach((edge, i) => {
    requireKnown(edge.from, `edges ${i + 1}번`);
    requireKnown(edge.to, `edges ${i + 1}번`);
    if (edge.from === edge.to) problems.push(`edges ${i + 1}번은 자기 자신을 가리켜요.`);
  });
  input.judgments.forEach((judgment, i) => requireKnown(judgment.concept, `judgments ${i + 1}번`));
  // 자료에는 사용자가 답한 것이 없다. 판정은 사용자가 풀거나 설명한 뒤에 생긴다
  if (input.material && input.judgments.length > 0) problems.push('자료(material)에서 만든 저장에는 judgments를 넣지 않아요. 비워 주세요.');
  input.followups.forEach((followup, i) => requireKnown(followup.concept, `followups ${i + 1}번`));

  const finalAnswerKeys = new Set<string>(existing.withFinalAnswer);
  for (const concept of input.concepts) if (concept.final_answer) finalAnswerKeys.add(concept.key);

  input.cards.forEach((card, i) => {
    const where = `cards ${i + 1}번`;
    requireKnown(card.concept, where);
    switch (card.type) {
      case 'mcq': {
        const correct = card.options.filter((option) => option.correct).length;
        if (correct !== 1) problems.push(`${where}(객관식)은 정답이 정확히 1개여야 하는데 ${correct}개예요.`);
        if (card.options.some((option) => option.correct && option.from_my_answer)) {
          problems.push(`${where}: from_my_answer 보기는 오답이어야 해요.`);
        }
        break;
      }
      case 'cloze': {
        const blanks = card.prompt.split(CLOZE_BLANK).length - 1;
        if (blanks !== 1) problems.push(`${where}(빈칸)의 prompt에 "${CLOZE_BLANK}"가 정확히 한 번 있어야 하는데 ${blanks}번이에요.`);
        if (!card.choices.includes(card.answer)) problems.push(`${where}(빈칸)의 choices에 정답 "${card.answer}"가 없어요.`);
        if (new Set(card.choices).size !== card.choices.length) problems.push(`${where}(빈칸)의 choices에 같은 보기가 있어요.`);
        break;
      }
      case 'explain': {
        const hasLowRung = existing.withLowRungCards.has(card.concept) || input.cards.some((other) => other.concept === card.concept && rungOf(other) < 3);
        if (!hasLowRung) {
          problems.push(`${where}(설명하기): 개념 "${card.concept}"에 1·2단계 카드(ox, mcq, cloze)도 함께 만들어 주세요.`);
        }
        if (!finalAnswerKeys.has(card.concept) && !input.final_answer) {
          problems.push(`${where}(설명하기)는 개념 "${card.concept}"의 최종 버전이 있어야 해요. concepts의 final_answer나 세션의 final_answer를 넣어 주세요.`);
        }
        break;
      }
      case 'ox':
        break;
    }
  });

  return problems;
}

export interface SaveLearningCounts {
  concepts: number;
  cards: number;
  judgments: number;
  followups: number;
  edges: number;
}

export function countSaveLearning(input: SaveLearningInput): SaveLearningCounts {
  return {
    concepts: input.concepts.length,
    cards: input.cards.length,
    judgments: input.judgments.length,
    followups: input.followups.length,
    edges: input.edges.length,
  };
}
