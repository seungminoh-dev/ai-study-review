import { describe, expect, it } from 'vitest';
import example from '../fixtures/immutable-object.json';
import max from '../fixtures/save-learning-max.json';
import { SaveLearningInput, checkSaveLearning, countSaveLearning, rungOf } from '../src/index';

const parse = (value: unknown) => SaveLearningInput.parse(value);
const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

describe('SaveLearningInput', () => {
  it('accepts the immutable-object session from the plan', () => {
    const input = parse(example);
    expect(checkSaveLearning(input)).toEqual([]);
    expect(countSaveLearning(input)).toEqual({ concepts: 5, cards: 5, judgments: 2, followups: 2, edges: 4 });
  });

  it('accepts the max-size fixture', () => {
    const input = parse(max);
    expect(checkSaveLearning(input)).toEqual([]);
    expect(input.cards).toHaveLength(30);
    expect(input.concepts).toHaveLength(20);
  });

  it('fills defaults for optional arrays', () => {
    const input = parse({
      topic: 't',
      concepts: [{ key: 'a', name: 'A' }],
      cards: [{ type: 'ox', concept: 'a', prompt: 'p', answer: 'O', explain: 'e' }],
    });
    expect(input.source).toBe('claude.ai');
    expect(input.edges).toEqual([]);
    expect(input.concepts[0]?.aliases).toEqual([]);
  });

  it('rejects keys that are not kebab-case', () => {
    const bad = clone(example) as { concepts: { key: string }[] };
    bad.concepts[0]!.key = 'Immutable Object';
    expect(SaveLearningInput.safeParse(bad).success).toBe(false);
  });

  it('derives the rung from the card type and code', () => {
    const input = parse(example);
    expect(input.cards.map((card) => [card.type, rungOf(card)])).toEqual([
      ['ox', 2],
      ['cloze', 2],
      ['mcq', 1],
      ['ox', 1],
      ['explain', 3],
    ]);
  });

  it('drops a rung sent by the client', () => {
    const input = parse({
      topic: 't',
      concepts: [{ key: 'a', name: 'A' }],
      cards: [{ type: 'ox', concept: 'a', rung: 3, prompt: 'p', answer: 'O', explain: 'e' }],
    });
    expect(input.cards[0]).not.toHaveProperty('rung');
    expect(rungOf(input.cards[0]!)).toBe(1);
  });
});

describe('checkSaveLearning', () => {
  it('reports a multiple-choice card with two correct options', () => {
    const input = parse(example);
    const mcq = input.cards[2];
    if (mcq?.type !== 'mcq') throw new Error('fixture changed');
    mcq.options[2]!.correct = true;
    expect(checkSaveLearning(input).join('\n')).toContain('정답이 정확히 1개');
  });

  it('reports a wrong answer marked as correct', () => {
    const input = parse(example);
    const mcq = input.cards[2];
    if (mcq?.type !== 'mcq') throw new Error('fixture changed');
    mcq.options[0]!.correct = false;
    mcq.options[1]!.correct = true;
    expect(checkSaveLearning(input).join('\n')).toContain('from_my_answer 보기는 오답');
  });

  it('reports a cloze card without exactly one blank or without its answer in the choices', () => {
    const input = parse(example);
    const cloze = input.cards[1];
    if (cloze?.type !== 'cloze') throw new Error('fixture changed');
    cloze.prompt = '빈칸이 없는 문장';
    cloze.choices = ['상속', '오버라이딩', '직렬화'];
    const problems = checkSaveLearning(input).join('\n');
    expect(problems).toContain('정확히 한 번');
    expect(problems).toContain('choices에 정답');
  });

  it('reports references to unknown concepts and self edges', () => {
    const input = parse(example);
    input.edges.push({ from: 'deep-copy', to: 'deep-copy', type: 'contrast' });
    input.judgments.push({ concept: 'unknown-concept', label: '틀림', note: 'n' });
    const problems = checkSaveLearning(input).join('\n');
    expect(problems).toContain('자기 자신');
    expect(problems).toContain('unknown-concept');
  });

  it('accepts references to concepts the user already has', () => {
    const input = parse(example);
    input.judgments.push({ concept: 'older-concept', label: '애매', note: 'n' });
    expect(checkSaveLearning(input, { keys: new Set(['older-concept']), withFinalAnswer: new Set(), withLowRungCards: new Set() })).toEqual([]);
  });

  it('requires a final answer for explain cards', () => {
    const input = parse(example);
    delete input.final_answer;
    expect(checkSaveLearning(input).join('\n')).toContain('최종 버전');
    expect(checkSaveLearning(input, { keys: new Set(), withFinalAnswer: new Set(['immutable-object']), withLowRungCards: new Set() })).toEqual([]);
  });

  it('requires a low-rung card next to an explain card', () => {
    const input = parse(example);
    input.cards = input.cards.filter((card) => !(card.concept === 'immutable-object' && card.type === 'ox'));
    expect(checkSaveLearning(input).join('\n')).toContain('1·2단계 카드');
    expect(checkSaveLearning(input, { keys: new Set(), withFinalAnswer: new Set(), withLowRungCards: new Set(['immutable-object']) })).toEqual([]);
  });

  it('reports duplicate concept keys', () => {
    const input = parse(example);
    input.concepts.push({ key: 'deep-copy', name: '깊은 복사', aliases: [] });
    expect(checkSaveLearning(input).join('\n')).toContain('두 번');
  });
});
