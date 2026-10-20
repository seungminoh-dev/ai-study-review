import type { MapResponse, MaterialSummary, QueueResponse } from '@moai/shared';
import { env } from 'cloudflare:workers';
import { beforeEach, describe, expect, it } from 'vitest';
import example from '../../../packages/shared/fixtures/immutable-object.json';
import { repairLibrary } from '../src/domain/categories';
import { loadMaterialQueue, loadTodayQueue } from '../src/domain/queue';
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
    expect(saved.content[0].text).toContain('학습 탭에서 풀면');
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

    // 한 번 푼 카드는 학습에 다시 나오지 않고 복습으로 간다. 틀려서 곧 다시 볼 때가 돼도
    const second = queue.cards[1]!.id;
    await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: second, grade: 1, reviewed_at: Date.now() }] } });
    const later = Date.now() + 30 * 60_000;
    expect(await loadMaterialQueue(env, user.id, '쿠버네티스 입문.pdf', later, 10)).toEqual({ cards: [], remaining: 0 });
    expect((await loadTodayQueue(env, user.id, later)).map((card) => card.id)).toContain(second);
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
    expect(updated.structuredContent).toEqual({ assigned: 1, renamed: 1, moves: [{ from: 'Kubernetes/기본', to: '인프라/Kubernetes/기본' }], merged: [] });
    expect((await concept('jvm'))!.domain).toBe('백엔드/Java');
    expect((await concept('pod'))!.domain).toBe('인프라/Kubernetes/기본');
    // 옛 이름으로 저장해도 새 분류로 간다
    await save('service', 'k8s/네트워크');
    expect((await concept('service'))!.domain).toBe('인프라/Kubernetes/네트워크');
  });

  it('does not keep stale old names after renames', async () => {
    const save = (key: string, domain: string) =>
      callTool(url, 'save_learning', {
        topic: key,
        concepts: [{ key, name: key, domain }],
        cards: [{ type: 'ox', concept: key, prompt: `${key} 문제`, answer: 'O', explain: '해설' }],
      });
    await save('pod', 'Kubernetes');
    // 한 단계 아래로 옮겨도 새 이름으로 저장한 것이 두 번 옮겨지지 않는다
    await callTool(url, 'update_categories', { assign: [], rename: [{ from: 'Kubernetes', to: 'Kubernetes/기본' }] });
    await save('service', 'Kubernetes/기본');
    expect((await concept('service'))!.domain).toBe('Kubernetes/기본');
    // 되돌리면 그 이름을 다른 곳으로 보내던 옛 이름은 지운다
    await callTool(url, 'update_categories', { assign: [], rename: [{ from: 'Kubernetes/기본', to: 'Kubernetes' }] });
    expect((await concept('pod'))!.domain).toBe('Kubernetes');
    await save('ingress', 'Kubernetes');
    expect((await concept('ingress'))!.domain).toBe('Kubernetes');
    const aliases = await env.DB.prepare('SELECT alias, path FROM category_aliases WHERE user_id = ?1').bind(user.id).all();
    expect(aliases.results).toEqual([{ alias: 'kubernetes/기본', path: 'Kubernetes' }]);
  });

  it('counts material concepts, follows renamed names in a chain and warns before levels merge', async () => {
    await save2('jpa', 'Java/Spring/JPA');
    await callTool(url, 'save_learning', pdf('1장', 'node'));
    const { categories } = (await callTool(url, 'get_categories', {})).structuredContent;
    expect(categories).toEqual(expect.arrayContaining([{ path: 'Java/Spring/JPA', concepts: 1, material: 0 }, { path: '인프라/Kubernetes', concepts: 0, material: 1 }]));

    // 미리보기는 바꾸지 않고, 3단계를 넘어 합쳐지는 이동을 따로 알린다
    const rename = { assign: [], rename: [{ from: 'Java', to: '백엔드/Java' }] };
    const merged = [{ from: 'Java/Spring/JPA', to: '백엔드/Java/Spring' }];
    expect((await callTool(url, 'update_categories', { ...rename, dry_run: true })).structuredContent).toMatchObject({ dry_run: true, merged });
    expect((await concept('jpa'))!.domain).toBe('Java/Spring/JPA');
    expect((await callTool(url, 'update_categories', rename)).structuredContent).toMatchObject({ renamed: 1, merged });
    expect((await concept('jpa'))!.domain).toBe('백엔드/Java/Spring');

    // 두 번 바꾼 이름도 끝까지 따라간다: Java/Spring → 백엔드/Java/Spring → 백엔드/Spring
    await callTool(url, 'update_categories', { assign: [], rename: [{ from: '백엔드/Java/Spring', to: '백엔드/Spring' }] });
    await save2('bean', 'Java/Spring');
    expect((await concept('bean'))!.domain).toBe('백엔드/Spring');
  });

  it('repairs categories saved before normalization and concepts saved during the deploy gap', async () => {
    const now = Date.now();
    await env.DB.batch([
      env.DB.prepare("INSERT INTO concepts (id, user_id, key, name, aliases, search_text, domain, created_at, updated_at, adopted_at) VALUES (?1, ?2, 'old', 'old', '[]', 'old', 'infra > k8s', ?3, ?3, ?3)").bind(crypto.randomUUID(), user.id, now),
    ]);
    await save2('gap', 'Kubernetes');
    await env.DB.prepare("UPDATE concepts SET adopted_at = NULL WHERE user_id = ?1 AND key = 'gap'").bind(user.id).run();
    await callTool(url, 'save_learning', pdf('1장', 'pdfonly'));
    await repairLibrary(env);
    expect(await concept('old')).toMatchObject({ domain: '인프라/Kubernetes' });
    expect((await concept('gap'))!.adopted_at).not.toBeNull();
    expect((await concept('pdfonly'))!.adopted_at).toBeNull();
    expect(await repairLibrary(env)).toEqual({ normalized: 0, adopted: 0 });
  });
});

function save2(key: string, domain: string) {
  return callTool(url, 'save_learning', {
    topic: key,
    concepts: [{ key, name: key, domain }],
    cards: [{ type: 'ox', concept: key, prompt: `${key} 문제`, answer: 'O', explain: '해설' }],
  });
}

// 이름 바꾸기는 데이터를 바꾸므로 확인해 둔다: 내 것만, 자료는 원래 이름으로 계속 묶인다
describe('renaming', () => {
  it('renames a material for display only, so later saves of the same PDF join it', async () => {
    await callTool(url, 'save_learning', pdf('1장'));
    const rename = (who: TestUser, label: string) => api(who, '/materials/label', { method: 'PUT', json: { title: '쿠버네티스 입문.pdf', label } });
    expect((await rename(await newUser(), '남의 이름')).status).toBe(404);
    expect(await (await rename(user, 'K8s 기초')).json()).toEqual({ name: 'K8s 기초' });
    // 같은 PDF의 다음 장은 원래 이름으로 저장돼도 같은 자료다
    await callTool(url, 'save_learning', pdf('2장', 'service'));
    const { materials } = (await (await api(user, '/materials')).json()) as { materials: MaterialSummary[] };
    expect(materials.map((material) => [material.title, material.name, material.parts.length])).toEqual([['쿠버네티스 입문.pdf', 'K8s 기초', 2]]);
    // 비우면 원래 이름
    expect(await (await rename(user, '')).json()).toEqual({ name: '쿠버네티스 입문' });
  });

  it('renames a material section for display only', async () => {
    await callTool(url, 'save_learning', pdf('1장'));
    const rename = (who: TestUser, part: string, label: string) =>
      api(who, '/materials/part-label', { method: 'PUT', json: { title: '쿠버네티스 입문.pdf', part, label } });
    expect((await rename(await newUser(), '1장', '남의 것')).status).toBe(404);
    expect((await rename(user, '없는 장', '파드')).status).toBe(404);
    expect(await (await rename(user, '1장', '파드 기초')).json()).toEqual({ label: '파드 기초' });
    const { materials } = (await (await api(user, '/materials')).json()) as { materials: MaterialSummary[] };
    expect(materials[0]).toMatchObject({ parts: ['1장'], part_labels: { '1장': '파드 기초' } });
    // 복습 주소는 원래 섹션 이름 그대로다
    expect(materials[0]!.next).toMatchObject({ part: '1장' });
    expect(await (await rename(user, '1장', '')).json()).toEqual({ label: null });
  });

  it('renames only my own saved conversation', async () => {
    const saved = await callTool(url, 'save_learning', pdf('1장'));
    const id = saved.structuredContent.session_id as string;
    expect((await api(await newUser(), `/sessions/${id}`, { method: 'PATCH', json: { topic: '남의 것' } })).status).toBe(404);
    expect((await api(user, `/sessions/${id}`, { method: 'PATCH', json: { topic: '  ' } })).status).toBe(400);
    expect(await (await api(user, `/sessions/${id}`, { method: 'PATCH', json: { topic: '파드 정리' } })).json()).toEqual({ topic: '파드 정리' });
    expect(await env.DB.prepare('SELECT topic FROM learning_sessions WHERE id = ?1').bind(id).first('topic')).toBe('파드 정리');
  });
});

// 앱의 분류 관리: 미리 보기는 바꾸지 않고, 바꾸면 자료 개념까지 옮긴다
describe('category manage', () => {
  it('previews a move without changing anything, then moves learned and material concepts', async () => {
    await callTool(url, 'save_learning', pdf('1장'));
    const manage = async () => (await (await api(user, '/categories/manage')).json()) as { categories: { path: string; concepts: number; material: number }[] };
    expect((await manage()).categories).toEqual([{ path: '인프라/Kubernetes', concepts: 0, material: 1 }]);
    const move = (dry_run: boolean) => api(user, '/categories/rename', { method: 'POST', json: { from: '인프라/Kubernetes', to: '인프라/컨테이너', dry_run } });
    expect(await (await move(true)).json()).toMatchObject({ dry_run: true, moves: [{ from: '인프라/Kubernetes', to: '인프라/컨테이너' }], merged: [] });
    expect((await manage()).categories[0]!.path).toBe('인프라/Kubernetes');
    expect(await (await move(false)).json()).toMatchObject({ renamed: 1 });
    expect((await manage()).categories).toEqual([{ path: '인프라/컨테이너', concepts: 0, material: 1 }]);
    // 다른 사람의 분류는 그대로다
    expect((await (await api(await newUser(), '/categories/rename', { method: 'POST', json: { from: '인프라/컨테이너', to: 'x' } })).json()) as { renamed: number }).toMatchObject({ renamed: 0 });
  });
});

// 지우기는 되돌릴 수 없다. 다른 대화가 쓰는 개념은 남고, 외래 키가 깨지지 않는지 본다
describe('deleting', () => {
  const count = (table: string) => env.DB.prepare(`SELECT count(*) AS n FROM ${table} WHERE user_id = ?1`).bind(user.id).first<number>('n');
  const keys = async () => (await env.DB.prepare('SELECT key FROM concepts WHERE user_id = ?1 ORDER BY key').bind(user.id).all<{ key: string }>()).results.map((row) => row.key);
  const foreignKeys = async () => (await env.DB.prepare('PRAGMA foreign_key_check').all()).results;

  it('removes one conversation, keeps concepts another conversation still uses and reopens their ladder', async () => {
    await callTool(url, 'save_learning', example);
    // 다른 대화의 같은 개념 설명하기 카드. 아래 단계가 이미 있어서 잠긴 채 저장된다
    await callTool(url, 'save_learning', {
      topic: '깊은 복사 설명',
      concepts: [{ key: 'deep-copy', name: '깊은 복사', final_answer: '깊은 복사는 중첩 객체까지 새로 만들어 원본과 상태를 나누지 않는다.' }],
      cards: [{ type: 'explain', concept: 'deep-copy', prompt: '깊은 복사를 30초로 설명해 보세요.', checklist: ['중첩 객체까지 새로 만든다', '원본과 상태를 나누지 않는다'] }],
    });
    const explain = () =>
      env.DB.prepare("SELECT c.status FROM cards c JOIN concepts k ON k.id = c.concept_id WHERE c.user_id = ?1 AND k.key = 'deep-copy' AND c.type = 'explain'").bind(user.id).first<string>('status');
    expect(await explain()).toBe('locked');
    const target = (await env.DB.prepare('SELECT id FROM learning_sessions WHERE user_id = ?1 AND topic = ?2').bind(user.id, example.topic).first<string>('id'))!;
    const card = await env.DB.prepare('SELECT id FROM cards WHERE session_id = ?1 LIMIT 1').bind(target).first<string>('id');
    await api(user, '/reviews', { method: 'POST', json: { reviews: [{ id: crypto.randomUUID(), card_id: card, grade: 3, reviewed_at: Date.now() }] } });
    await api(user, `/cards/${card}/report`, { method: 'POST', json: { reason: 'unclear' } });

    expect((await api(await newUser(), `/sessions/${target}`, { method: 'DELETE' })).status).toBe(404);
    expect((await api(user, `/sessions/${target}`, { method: 'DELETE' })).status).toBe(204);

    expect(await keys()).toEqual(['deep-copy']);
    expect(await explain()).toBe('active');
    for (const table of ['judgments', 'followups', 'review_logs', 'card_reports', 'edges']) expect([table, await count(table)]).toEqual([table, 0]);
    expect(await count('cards')).toBe(1);
    expect(await foreignKeys()).toEqual([]);
    expect((await api(user, `/sessions/${target}`)).status).toBe(404);
  });

  it('removes a whole material with its section names', async () => {
    const title = '쿠버네티스 입문.pdf';
    await callTool(url, 'save_learning', pdf('1장'));
    await callTool(url, 'save_learning', pdf('2장', 'service'));
    await api(user, '/materials/label', { method: 'PUT', json: { title, label: '쿠버 책' } });
    await api(user, '/materials/part-label', { method: 'PUT', json: { title, part: '1장', label: '첫 장' } });
    expect(await count('material_part_labels')).toBe(1);

    expect((await api(await newUser(), '/materials/delete', { method: 'POST', json: { title } })).status).toBe(404);
    expect(await (await api(user, '/materials/delete', { method: 'POST', json: { title } })).json()).toEqual({ deleted: 2 });

    expect(await keys()).toEqual([]);
    for (const table of ['learning_sessions', 'cards', 'material_labels', 'material_part_labels']) expect([table, await count(table)]).toEqual([table, 0]);
    expect(await foreignKeys()).toEqual([]);
  });
});
