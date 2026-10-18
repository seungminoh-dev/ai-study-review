import type { MapResponse, MaterialSummary, QueueResponse } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadTodayQueue } from '../src/domain/queue';
import { api, callTool, mcpUrl, newUser, type TestUser } from './helpers';

// 자료(PDF)는 풀기 전까지 내 지식이 아니다. 분류는 저장할 때 모양을 맞춰 기존 분류에 붙인다.

let user: TestUser;
let url: string;
beforeEach(async () => {
  user = await newUser();
  url = await mcpUrl(user);
});

const pdf = (part: string, key = 'pod') => ({
  topic: `쿠버네티스 입문 ${part}`,
  material: { title: '쿠버네티스 입문.pdf', part },
  concepts: [{ key, name: key === 'pod' ? '파드' : key, domain: 'infra / k8s' }],
  cards: [
    { type: 'ox', concept: key, prompt: `${key}는 컨테이너 묶음이다.`, answer: 'O', explain: '파드는 컨테이너를 묶는 최소 단위다. (p.12)' },
    { type: 'mcq', concept: key, prompt: `${key}의 IP는?`, options: [{ text: '파드마다 하나', correct: true }, { text: '컨테이너마다 하나', correct: false }, { text: '노드마다 하나', correct: false }], explain: '파드 안 컨테이너는 IP를 나눠 쓴다. (p.13)' },
  ],
});

const concept = (key: string) => env.DB.prepare('SELECT domain, adopted_at FROM concepts WHERE user_id = ?1 AND key = ?2').bind(user.id, key).first<{ domain: string | null; adopted_at: number | null }>();

describe('materials', () => {
  it('keeps PDF cards out of my knowledge until I answer one', async () => {
    const saved = await callTool(url, 'save_learning', pdf('1장'));
    expect(saved.content[0].text).toContain('자료 화면에서 풀면');
    expect(await concept('pod')).toMatchObject({ domain: '인프라/Kubernetes', adopted_at: null });
    // 오늘 복습, 지식 지도, 모의면접에는 없다
    expect(await loadTodayQueue(env, user.id, Date.now())).toHaveLength(0);
    const map = (await (await api(user, '/map')).json()) as MapResponse;
    expect(map.nodes.find((node) => node.key === 'pod')?.state).toBe('material');
    expect((await callTool(url, 'get_interview_chain', {})).structuredContent.concepts).toEqual([]);

    const { materials } = (await (await api(user, '/materials')).json()) as { materials: MaterialSummary[] };
    expect(materials[0]).toMatchObject({ title: '쿠버네티스 입문.pdf', parts: ['1장'], solved: 0, adopted: 0, concepts: 1 });

    // "이 자료 풀기"로 처음 푼다
    const queue = (await (await api(user, `/queue?material=${encodeURIComponent('쿠버네티스 입문.pdf')}&size=10`)).json()) as QueueResponse;
    expect(queue.cards.length).toBeGreaterThan(0);
    await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: queue.cards[0]!.id, grade: 3, reviewed_at: Date.now() }] } });
    expect((await concept('pod'))!.adopted_at).not.toBeNull();
    const after = (await (await api(user, '/materials')).json()) as { materials: MaterialSummary[] };
    expect(after.materials[0]).toMatchObject({ solved: 1, adopted: 1 });
  });

  it('can be studied in chat, and a study chat about the concept adopts it too', async () => {
    await callTool(url, 'save_learning', pdf('2장', 'service'));
    const quiz = await callTool(url, 'get_review_queue', { material: '쿠버네티스 입문.pdf' });
    const ox = quiz.structuredContent.questions.find((question: { type: string }) => question.type === 'ox');
    expect((await callTool(url, 'submit_review', { card_id: ox.card_id, answer: 'O' })).structuredContent).toMatchObject({ recorded: true, correct: true });
    expect((await concept('service'))!.adopted_at).not.toBeNull();

    await callTool(url, 'save_learning', pdf('3장', 'ingress'));
    expect((await concept('ingress'))!.adopted_at).toBeNull();
    await callTool(url, 'save_learning', {
      topic: '인그레스 공부',
      concepts: [{ key: 'ingress', name: '인그레스' }],
      cards: [{ type: 'ox', concept: 'ingress', prompt: '인그레스는 L7 라우팅이다.', answer: 'O', explain: 'HTTP 경로로 나눈다.' }],
    });
    expect((await concept('ingress'))!.adopted_at).not.toBeNull();
  });

  it('refuses judgments in a material save and can turn off unsolved cards', async () => {
    const withJudgment = await callTool(url, 'save_learning', { ...pdf('4장', 'node'), judgments: [{ concept: 'node', label: '맞음', note: '자료' }] });
    expect(withJudgment.isError).toBe(true);
    await callTool(url, 'save_learning', pdf('4장', 'node'));
    expect(await (await api(user, '/materials/suspend-unsolved', { method: 'POST', json: { title: '쿠버네티스 입문.pdf' } })).json()).toEqual({ suspended: 2 });
  });
});

describe('categories', () => {
  it('normalizes names, reuses the spelling I already have and keeps an existing category', async () => {
    const save = (key: string, domain: string) =>
      callTool(url, 'save_learning', {
        topic: key,
        concepts: [{ key, name: key, domain }],
        cards: [{ type: 'ox', concept: key, prompt: `${key} 문제`, answer: 'O', explain: '해설' }],
      });
    await save('helm', '인프라 > DevOps > helm');
    expect((await concept('helm'))!.domain).toBe('인프라/DevOps/helm');
    await save('argo', '인프라/devops/argo');
    expect((await concept('argo'))!.domain).toBe('인프라/DevOps/argo');
    await save('helm', '배포/Helm');
    expect((await concept('helm'))!.domain).toBe('인프라/DevOps/helm');

    const found = await callTool(url, 'find_concepts', { query: '없는개념' });
    expect(found.content[0].text).toContain('인프라/DevOps/helm(1)');
    expect(await (await api(user, '/categories')).json()).toMatchObject({ categories: expect.arrayContaining([{ path: '인프라/DevOps/argo', concepts: 1 }]) });
    // 분류로 복습을 거른다
    expect((await loadTodayQueue(env, user.id, Date.now(), { category: '인프라/DevOps' })).length).toBe(2);
    expect(await loadTodayQueue(env, user.id, Date.now(), { category: '백엔드' })).toHaveLength(0);
    // 앱에서 고친다
    expect(await (await api(user, '/concepts/helm/category', { method: 'PATCH', json: { category: 'infra/devops' } })).json()).toEqual({ category: '인프라/DevOps' });
  });
});

describe('category tools', () => {
  it('fills missing categories, merges one into another and follows the old name next time', async () => {
    const save = (key: string, domain?: string) =>
      callTool(url, 'save_learning', {
        topic: key,
        concepts: [{ key, name: key, ...(domain ? { domain } : {}) }],
        cards: [{ type: 'ox', concept: key, prompt: `${key} 문제`, answer: 'O', explain: '해설' }],
      });
    await save('pod', 'K8s/기본');
    await save('jvm');
    const overview = await callTool(url, 'get_categories', {});
    expect(overview.structuredContent.unclassified.map((item: { key: string }) => item.key)).toContain('jvm');

    const updated = await callTool(url, 'update_categories', {
      assign: [{ concept_key: 'jvm', category: '백엔드 / java' }],
      rename: [{ from: 'Kubernetes', to: '인프라/Kubernetes' }],
    });
    expect(updated.structuredContent).toEqual({ assigned: 1, renamed: 1 });
    expect((await concept('jvm'))!.domain).toBe('백엔드/Java');
    expect((await concept('pod'))!.domain).toBe('인프라/Kubernetes/기본');
    // 옛 이름으로 저장해도 새 분류로 간다
    await save('service', 'k8s/네트워크');
    expect((await concept('service'))!.domain).toBe('인프라/Kubernetes/네트워크');
  });
});
