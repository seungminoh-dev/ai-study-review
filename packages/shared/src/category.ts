// 분류 경로 (설계서 §5): "인프라/DevOps/Kubernetes"처럼 큰 분류부터 '/'로 잇는다. 최대 3단계, 단계마다 20자.
// 같은 분류가 여러 이름으로 갈라지지 않게 저장할 때 이 함수로 모양을 맞춘다. 기존 분류와의 대소문자 맞추기는 서버가 한다.

export const MAX_CATEGORY_DEPTH = 3;
export const MAX_CATEGORY_SEGMENT = 20;

/** 흔한 줄임말과 대소문자. 단계 하나가 이 낱말이면 오른쪽 이름으로 바꾼다 (소문자로 비교) */
const KNOWN: Record<string, string> = {
  k8s: 'Kubernetes',
  kubernetes: 'Kubernetes',
  쿠버네티스: 'Kubernetes',
  devops: 'DevOps',
  데브옵스: 'DevOps',
  js: 'JavaScript',
  javascript: 'JavaScript',
  ts: 'TypeScript',
  typescript: 'TypeScript',
  aws: 'AWS',
  gcp: 'GCP',
  docker: 'Docker',
  도커: 'Docker',
  linux: 'Linux',
  리눅스: 'Linux',
  java: 'Java',
  자바: 'Java',
  python: 'Python',
  파이썬: 'Python',
  spring: 'Spring',
  스프링: 'Spring',
  react: 'React',
  리액트: 'React',
  sql: 'SQL',
  db: 'DB',
  database: 'DB',
  데이터베이스: 'DB',
  os: 'OS',
  운영체제: 'OS',
  network: '네트워크',
  networking: '네트워크',
  infra: '인프라',
  infrastructure: '인프라',
};

/** 모양을 맞춘 분류 경로. 비었으면 null */
export function normalizeCategory(input: string | null | undefined): string | null {
  if (!input) return null;
  const segments = input
    .normalize('NFKC')
    .split(/\s*[/>›»|]\s*/)
    .map((segment) => segment.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    .slice(0, MAX_CATEGORY_DEPTH)
    .map((segment) => (KNOWN[segment.toLowerCase()] ?? segment).slice(0, MAX_CATEGORY_SEGMENT));
  return segments.length > 0 ? segments.join('/') : null;
}
