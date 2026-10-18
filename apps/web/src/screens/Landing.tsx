import { DemoDeck } from '../cards/DemoDeck';
import { IconGithub, IconGrowth, IconHistory, IconMap, IconOffline } from '../icons';
import { Mascot, type Mood } from '../Mascot';
import { Link } from '../router';

// 처음 온 사람이 보는 소개 화면 (3단계 시안 "랜딩"). 로그인하지 않았을 때의 첫 화면이다.
// 휴대폰은 한 줄로 쌓고, 컴퓨터는 첫 화면을 두 칸(글 · 휴대폰 속 복습 장면)으로 나눈다 (styles.css의 .landing).

const GITHUB_START = '/api/auth/github/start';

const STEPS: { mood: Mood; title: string; text: string }[] = [
  { mood: 'claude', title: 'Claude와 공부해요', text: '평소처럼 묻고 답하다가 끝에 "모아이에 저장해줘"라고 해요. PDF도 카드로 만들 수 있어요.' },
  { mood: 'study', title: '모아이가 정리해요', text: '개념, 내가 틀린 부분, 복습 카드를 대화에서 뽑아 저장하고 지식 지도에 이어 붙여요.' },
  { mood: 'alarm', title: '2~3분씩 되새겨요', text: '잊을 때쯤 알림이 와요. 휴대폰에서 OX, 객관식, 빈칸, 설명하기로 가볍게 풀어요.' },
];

const FEATURES = [
  { icon: <IconMap />, tone: 'cream', title: '지식 지도', text: '공부한 개념이 서로 어떻게 이어지는지 한눈에 봐요.' },
  { icon: <IconHistory />, tone: 'peach', title: '내 오답부터', text: '예전에 틀렸던 지점을 먼저 다시 물어봐요.' },
  { icon: <IconGrowth />, tone: 'green', title: '내 성장', text: '연속 기록, 지난주 대비, 12주 잔디로 꾸준함을 확인해요.' },
  { icon: <IconOffline />, tone: 'blue', title: '오프라인도 괜찮아요', text: '지하 구간에서도 풀고, 연결되면 알아서 저장해요.' },
];

/** 같은 화면 안의 소개 칸으로 내려간다. 주소(#)를 바꾸면 화면 전환이 일어나서 버튼으로 옮긴다 */
function scrollToSection(id: string) {
  const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches;
  document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
}

export function Landing({ github }: { github: boolean }) {
  // GitHub 로그인이 서버에 없으면 로그인 코드로만 들어온다
  const start = (className: string) =>
    github ? (
      <a className={className} href={GITHUB_START}>
        <IconGithub />
        GitHub로 시작하기
      </a>
    ) : (
      <Link className={className} href="/login">
        로그인 코드로 시작하기
      </Link>
    );
  return (
    <div className="landing">
      <header className="landing-top">
        <span className="landing-brand">
          <Mascot size={30} still />
          <strong>모아이</strong>
        </span>
        <nav className="landing-nav" aria-label="소개">
          <button type="button" className="landing-link wide-only" onClick={() => scrollToSection('how')}>
            이렇게 써요
          </button>
          <button type="button" className="landing-link wide-only" onClick={() => scrollToSection('features')}>
            기능
          </button>
          <Link className="landing-link" href="/login">
            로그인
          </Link>
          {github ? (
            <a className="button primary landing-top-cta wide-only" href={GITHUB_START}>
              GitHub로 시작하기
            </a>
          ) : null}
        </nav>
      </header>

      <section className="landing-hero" aria-labelledby="landing-title">
        <div className="landing-art narrow-only" aria-hidden="true">
          <span className="landing-shadow" />
          <Mascot mood="wave" size={160} />
          <span className="landing-bubble">모아보자!</span>
        </div>
        <div className="landing-copy">
          <p className="landing-eyebrow">Claude와 공부하는 사람을 위한 복습 앱</p>
          <h1 id="landing-title">
            공부한 대화가
            <br />
            <mark>잊히기 전에</mark>
          </h1>
          <p className="landing-lede">claude.ai에서 공부하고 "모아이에 저장해줘"라고 말하세요. 개념과 내 오답을 카드로 만들어, 잊을 때쯤 2~3분씩 다시 보여 줘요.</p>
          <div className="landing-ctas">
            {start('button primary')}
            {github ? (
              <Link className="button" href="/login">
                로그인 코드가 있어요
              </Link>
            ) : null}
          </div>
          <p className="muted small">지금은 초대받은 분만 가입할 수 있어요.</p>
        </div>
        <PhoneScene />
      </section>

      <section className="landing-section" id="how" aria-labelledby="how-title">
        <h2 id="how-title">이렇게 써요</h2>
        <p className="landing-sub">공부는 Claude와, 기억은 모아이가 챙겨요.</p>
        <ol className="landing-steps">
          {STEPS.map((step, index) => (
            <li key={step.title} className="landing-step">
              <Mascot mood={step.mood} size={88} />
              <div>
                <span className="landing-step-no">STEP {String(index + 1).padStart(2, '0')}</span>
                <strong>{step.title}</strong>
                <p>{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="landing-section" aria-labelledby="demo-title">
        <h2 id="demo-title">한 장 풀어 볼까요?</h2>
        <p className="landing-sub">실제 복습 카드와 똑같이 생겼어요.</p>
        <DemoDeck />
      </section>

      <section className="landing-section" id="features" aria-labelledby="features-title">
        <h2 id="features-title">모아이가 챙겨 주는 것</h2>
        <ul className="landing-features">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="landing-feature">
              <span className={`landing-icon ${feature.tone}`}>{feature.icon}</span>
              <strong>{feature.title}</strong>
              <p>{feature.text}</p>
            </li>
          ))}
        </ul>
      </section>

      <section className="landing-band" aria-labelledby="band-title">
        <Mascot mood="cheer" size={112} />
        <div>
          <h2 id="band-title">
            오늘 공부한 걸
            <br />
            내일도 기억하게
          </h2>
          <p>하루 2~3분이면 충분해요.</p>
        </div>
        {start('button accent')}
      </section>

      <footer className="landing-footer">© 모아이</footer>
    </div>
  );
}

/** 컴퓨터 첫 화면 오른쪽: 휴대폰 속에서 복습 한 장이 저절로 풀린다 (그림이라 스크린 리더는 건너뛴다) */
function PhoneScene() {
  return (
    <div className="landing-scene wide-only" aria-hidden="true">
      <span className="landing-glow" />
      <div className="landing-phone">
        <div className="landing-screen">
          <div className="scene-top">
            <span className="scene-bar">
              <span />
            </span>
            <span className="scene-count">3/8</span>
          </div>
          <div className="scene-meta">
            <span className="chip">HTTP 캐시</span>
            <span className="muted">객관식</span>
          </div>
          <p className="scene-prompt">응답에 Cache-Control: no-cache가 있으면 브라우저는 어떻게 하나요?</p>
          <div className="scene-choices">
            <span>아예 저장하지 않는다</span>
            <span className="pick">저장하되 쓰기 전에 서버에 확인한다</span>
            <span>만료될 때까지 그대로 쓴다</span>
            <span>프록시에만 저장한다</span>
          </div>
          <div className="scene-sheet">
            <div className="answer-head">
              <Mascot mood="cheer" size={48} />
              <div>
                <p className="verdict right">맞았어요!</p>
                <p className="small muted">no-store와 헷갈리기 쉬워요</p>
              </div>
            </div>
            <span className="scene-next">다음</span>
          </div>
        </div>
      </div>
      <div className="landing-float">
        <span className="landing-bubble">오늘 8장, 3분이면 끝!</span>
        <Mascot mood="alarm" size={96} />
      </div>
      <span className="landing-xp">+30 XP</span>
    </div>
  );
}
