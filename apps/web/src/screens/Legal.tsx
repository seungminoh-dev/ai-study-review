import type { ReactNode } from 'react';
import { Mascot } from '../Mascot';
import { Link, leave } from '../router';

// 개인정보 처리방침과 이용약관 (3단계 3-4). 로그인 전에도 볼 수 있다. 내용은 운영자가 확인하고 고친다.
// 저장하는 정보가 바뀌면(마이그레이션, 외부 서비스 추가) 이 문서도 같이 고친다.

/** 시행일. 내용을 바꾸면 날짜도 바꾼다 */
const EFFECTIVE = '2026년 10월 19일';
/** 개인정보 보호책임자와 문의처 */
const OPERATOR = 'seungminoh-dev';
const CONTACT = 'contact@smoh.dev';

export type LegalDoc = 'privacy' | 'terms';

const TITLE: Record<LegalDoc, string> = { privacy: '개인정보 처리방침', terms: '이용약관' };

export function Legal({ doc }: { doc: LegalDoc }) {
  return (
    <article className="legal">
      <button type="button" className="text-button legal-back" onClick={leave}>
        ← 돌아가기
      </button>
      <header className="legal-head">
        <Mascot mood="study" size={56} still />
        <div>
          <p className="legal-kicker">모아이</p>
          <h1>{TITLE[doc]}</h1>
          <p className="muted small">시행일 {EFFECTIVE}</p>
        </div>
      </header>
      <nav className="legal-switch" aria-label="문서">
        {(['privacy', 'terms'] as const).map((item) => (
          <Link key={item} href={`/${item}`} className={item === doc ? 'filter-chip on' : 'filter-chip'} aria-current={item === doc ? 'page' : undefined}>
            {TITLE[item]}
          </Link>
        ))}
      </nav>
      {doc === 'privacy' ? <Privacy /> : <Terms />}
    </article>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="legal-section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

/** 항목마다 작은 카드. 표는 휴대폰에서 좁아서 쓰지 않는다 */
function Items({ items }: { items: { title: string; rows: [label: string, text: ReactNode][] }[] }) {
  return (
    <ul className="legal-items">
      {items.map((item) => (
        <li key={item.title}>
          <strong>{item.title}</strong>
          <dl>
            {item.rows.map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{text}</dd>
              </div>
            ))}
          </dl>
        </li>
      ))}
    </ul>
  );
}

function Privacy() {
  return (
    <>
      <p className="legal-lede">
        모아이는 AI와 공부한 내용을 복습 카드로 바꿔 주는 서비스예요. 개인 운영자(이하 운영자)가 운영하고, 복습에 꼭 필요한 정보만 받아요. 이메일, 전화번호, 위치, 광고 식별자는 받지 않아요.
      </p>

      <Section title="1. 받는 정보와 쓰는 곳">
        <Items
          items={[
            {
              title: 'GitHub 계정 정보',
              rows: [
                ['내용', 'GitHub 숫자 id, 아이디, 프로필 이름'],
                ['언제', 'GitHub로 가입하거나 로그인할 때'],
                ['쓰는 곳', '본인 확인과 다른 기기 로그인. 공개 프로필만 읽고, 이메일과 GitHub 접근 토큰은 저장하지 않아요.'],
              ],
            },
            {
              title: '이름과 설정',
              rows: [
                ['내용', '앱에서 불릴 이름, 하루 목표, 하루 카드 수 같은 설정'],
                ['언제', '가입할 때, 설정을 바꿀 때'],
                ['쓰는 곳', '화면 표시와 복습 일정'],
              ],
            },
            {
              title: '학습 기록',
              rows: [
                ['내용', '공부한 대화의 주제와 요약, 개념, 판정과 그때 내가 한 말, 다음에 볼 질문, 복습 카드, 자료(PDF) 제목과 섹션 이름(바꾼 이름 포함), 분류'],
                ['언제', 'Claude 커넥터나 플러그인으로 저장할 때, 대화를 붙여 넣어 가져올 때, 카드를 고칠 때'],
                ['쓰는 곳', '복습 카드와 지식 지도 만들기'],
              ],
            },
            {
              title: '주간 설문',
              rows: [
                ['내용', '한 주에 한 번 묻는 "써먹은 개념이 있었는지"에 대한 답과, 적었다면 그 개념'],
                ['언제', '오늘 화면에서 답할 때 (답하지 않아도 돼요)'],
                ['쓰는 곳', '베타 기간에 서비스가 실제로 도움이 되는지 보기. 운영자가 관리 화면에서 봐요'],
              ],
            },
            {
              title: '복습 기록',
              rows: [
                ['내용', '고른 답, 쓴 설명, 확신도, 푼 시간과 시각, 카드 신고 내용'],
                ['언제', '복습할 때, 카드를 신고할 때'],
                ['쓰는 곳', '다음 복습 날짜 계산, 연속 학습·XP 같은 통계, 카드 품질 관리'],
              ],
            },
            {
              title: '알림 정보',
              rows: [
                ['내용', '브라우저 푸시 구독 주소와 암호 키, 알림 받을 시간'],
                ['언제', '알림을 켤 때'],
                ['쓰는 곳', '복습 알림 보내기'],
              ],
            },
            {
              title: '로그인과 연결 정보',
              rows: [
                ['내용', '로그인 쿠키, 커넥터 주소, 로그인 코드, 초대 코드. 모두 되돌릴 수 없는 해시로만 저장해요.'],
                ['언제', '로그인하거나 Claude와 연결할 때'],
                ['쓰는 곳', '로그인 유지와 커넥터 인증'],
              ],
            },
            {
              title: '서버 AI 기능에 넣은 글',
              rows: [
                ['내용', 'AI 채점을 받을 설명, 가져올 대화 원문, 개념 물어보기에 쓴 질문, 모의면접에서 한 답'],
                ['언제', '운영자가 서버 AI를 켰고, 그 기능을 쓸 때만'],
                ['쓰는 곳', 'AI 채점, 대화 가져오기, 개념 물어보기, 모의면접. 원문은 처리가 끝나면 바로 지우고, 물어본 질문과 면접 대화는 저장하지 않아요. 직접 기록으로 남기면 판정과 카드만 남아요.'],
              ],
            },
            {
              title: '운영 기록',
              rows: [
                ['내용', '이벤트 이름, 사용자 id, 숫자. 글 내용, 주소, 토큰은 남기지 않아요.'],
                ['언제', '서비스를 쓸 때'],
                ['쓰는 곳', '오류 확인과 보안'],
              ],
            },
          ]}
        />
        <p>접속 IP 주소는 모아이가 따로 저장하지 않아요. 다만 서버를 운영하는 Cloudflare가 보안과 전송을 위해 처리할 수 있어요.</p>
      </Section>

      <Section title="2. 보관 기간">
        <ul>
          <li>계정을 지울 때까지 보관하고, 계정을 지우면 바로 모두 지워요. 설정 → 계정 지우기에서 직접 할 수 있어요.</li>
          <li>AI 사용 비용 기록(토큰 수, 금액)은 월 합계를 맞추려고 누구 것인지 알 수 없게 바꿔 남겨요.</li>
          <li>로그인은 180일 동안 유지돼요. 로그인 코드는 10분, GitHub 확인 뒤 가입을 마치지 않은 정보는 30분이 지나면 지워요.</li>
          <li>운영 기록은 Cloudflare에 최대 7일 보관돼요.</li>
          <li>복구용 백업에는 지운 정보가 최대 30일 남을 수 있어요. 그 뒤에는 백업에서도 사라져요.</li>
        </ul>
      </Section>

      <Section title="3. 맡기거나 보내는 곳 (처리 위탁과 국외 이전)">
        <p>아래 회사들은 서비스를 돌리는 데 필요한 일만 하고, 정보는 서비스를 쓰는 동안 인터넷으로 전송돼요.</p>
        <Items
          items={[
            {
              title: 'Cloudflare, Inc. (미국)',
              rows: [
                ['하는 일', '서버, 데이터베이스(아시아·태평양 지역), 운영 기록 보관'],
                ['보내는 정보', '위 1번의 정보 전부'],
                ['보관', '위 2번의 보관 기간과 같아요'],
              ],
            },
            {
              title: 'Anthropic, PBC (미국)',
              rows: [
                ['하는 일', '서버 AI 기능(설명 AI 채점, 대화 가져오기, 개념 물어보기, 모의면접). 운영자가 켰을 때만'],
                ['보내는 정보', '채점받을 설명과 그 카드 내용, 가져올 대화 원문, 물어본 질문과 그 카드·내가 정리한 답, 면접 대화와 그 개념의 지난 기록'],
                ['보관', 'Anthropic API 정책에 따라요'],
              ],
            },
            {
              title: '브라우저의 푸시 서비스 (Google, Apple, Mozilla 등)',
              rows: [
                ['하는 일', '휴대폰과 컴퓨터로 알림 전달. 쓰는 브라우저가 정해요'],
                ['보내는 정보', '알림 문구 (암호화해서 보내요)'],
                ['보관', '각 회사 정책에 따라요'],
              ],
            },
          ]}
        />
        <p>GitHub 로그인은 GitHub, Inc.(미국)가 본인 확인 결과를 모아이에 보내 주는 방식이에요. 모아이가 GitHub에 학습 기록을 보내지는 않아요.</p>
      </Section>

      <Section title="4. Claude와 연결할 때">
        <ul>
          <li>커넥터나 플러그인을 연결하면, 내가 Claude에게 부탁할 때 Claude가 학습 기록을 모아이에 저장하고, 복습할 카드나 내 학습 맥락을 읽어 가요.</li>
          <li>Claude로 넘어간 내용은 내 Claude 계정과 Anthropic의 정책을 따라요.</li>
          <li>커넥터 주소는 비밀번호와 같아요. 다른 사람에게 알려 주지 마세요. 설정에서 새로 만들면 예전 주소는 바로 끊겨요.</li>
        </ul>
      </Section>

      <Section title="5. 다른 사람에게 보이는 정보">
        <ul>
          <li>내 학습 기록, 이름, XP는 다른 회원에게 보이지 않아요.</li>
          <li>운영자는 관리 화면에서 회원별 이름, GitHub 아이디, 가입일, 최근 7일 복습 수, 마지막 복습 시각, AI 사용 비용, 주간 설문 답(누가 답했는지는 빼고 모아서)을 봐요. 그 밖의 데이터는 장애를 고치거나 문의에 답할 때만 봐요.</li>
        </ul>
      </Section>

      <Section title="6. 내 권리">
        <ul>
          <li>설정에서 내 데이터 내보내기(JSON 파일), 카드 고치기와 끄기, 계정 지우기를 직접 할 수 있어요.</li>
          <li>그 밖에 정보를 보여 달라거나, 고치거나, 지우거나, 쓰지 말아 달라는 요청은 아래 문의처로 보내 주세요. 10일 안에 답할게요.</li>
        </ul>
      </Section>

      <Section title="7. 쿠키와 기기 저장소">
        <ul>
          <li>로그인을 유지하는 쿠키 하나만 써요. 광고나 분석 쿠키는 쓰지 않아요. 브라우저에서 쿠키를 막으면 로그인할 수 없어요.</li>
          <li>지하철처럼 연결이 끊겨도 복습할 수 있게, 받은 카드와 아직 못 보낸 답을 이 기기의 브라우저 저장소에 둬요. 로그아웃하면 지워요.</li>
        </ul>
      </Section>

      <Section title="8. 안전하게 지키는 방법">
        <ul>
          <li>모든 통신은 HTTPS로 암호화해요.</li>
          <li>로그인 쿠키, 커넥터 주소, 코드는 해시로만 저장해요.</li>
          <li>모든 조회는 내 계정 범위 안에서만 해요.</li>
          <li>운영 기록에는 글 내용, 주소, 토큰을 남기지 않아요.</li>
        </ul>
      </Section>

      <Section title="9. 만 14세 미만">
        <p>만 14세 미만은 가입할 수 없어요.</p>
      </Section>

      <Section title="10. 개인정보 보호책임자와 문의">
        <ul>
          <li>책임자: {OPERATOR}</li>
          <li>문의: {CONTACT}</li>
        </ul>
        <p>침해 신고나 상담은 아래 기관에도 할 수 있어요.</p>
        <ul>
          <li>개인정보침해신고센터 privacy.kisa.or.kr, 국번 없이 118</li>
          <li>개인정보분쟁조정위원회 www.kopico.go.kr, 1833-6972</li>
          <li>대검찰청 www.spo.go.kr, 국번 없이 1301</li>
          <li>경찰청 ecrm.police.go.kr, 국번 없이 182</li>
        </ul>
      </Section>

      <Section title="11. 바뀔 때">
        <p>이 방침을 바꾸면 시행 7일 전에 앱에서 알려요. 내게 불리하게 바뀌면 30일 전에 알려요.</p>
      </Section>
    </>
  );
}

function Terms() {
  return (
    <>
      <p className="legal-lede">모아이를 쓰기 전에 읽어 주세요. 가입하면 이 약관과 개인정보 처리방침에 동의한 것으로 봐요.</p>

      <Section title="1. 서비스">
        <ul>
          <li>모아이는 AI와 공부한 내용을 복습 카드로 바꾸고, 잊을 때쯤 다시 풀도록 일정과 알림을 주는 서비스예요.</li>
          <li>지금은 초대받은 사람만 쓰는 무료 베타예요.</li>
        </ul>
      </Section>

      <Section title="2. 가입과 계정">
        <ul>
          <li>초대 코드와 GitHub 계정으로 가입해요. 만 14세 이상만 가입할 수 있어요.</li>
          <li>계정은 본인만 써요. 커넥터 주소와 로그인 코드는 비밀번호처럼 지켜 주세요. 새어 나갔다면 설정에서 바로 새로 만들어 주세요.</li>
        </ul>
      </Section>

      <Section title="3. 내 학습 기록">
        <ul>
          <li>내가 저장한 학습 기록의 권리는 나에게 있어요.</li>
          <li>운영자는 저장, 복습 카드 보여 주기, 백업처럼 서비스를 주는 데 필요한 만큼만 다뤄요.</li>
          <li>설정에서 언제든 내보내거나 지울 수 있어요.</li>
        </ul>
      </Section>

      <Section title="4. 하지 말아 주세요">
        <ul>
          <li>다른 사람의 계정, 커넥터 주소, 초대 코드를 허락 없이 쓰는 일</li>
          <li>서비스를 공격하거나, 자동으로 지나치게 많이 요청해 다른 사람이 쓰기 어렵게 하는 일</li>
          <li>남의 권리를 침해하거나 법에 어긋나는 내용을 저장하는 일</li>
        </ul>
        <p>이런 일이 있으면 미리 알린 뒤 이용을 멈추게 할 수 있어요. 급한 보안 문제는 먼저 멈추고 바로 알려요.</p>
      </Section>

      <Section title="5. AI가 만든 내용">
        <ul>
          <li>카드, 해설, AI 채점, 개념 물어보기 답, 모의면접 질문과 정리는 AI가 만들어서 틀릴 수 있어요. 시험이나 업무에 쓰기 전에 한 번 더 확인해 주세요.</li>
          <li>이상한 카드는 복습 화면에서 신고하거나 기록 탭에서 고칠 수 있어요.</li>
        </ul>
      </Section>

      <Section title="6. 서비스 변경과 중단">
        <ul>
          <li>베타라서 기능이 바뀌거나 빠질 수 있어요.</li>
          <li>서비스를 끝내야 하면 30일 전에 알리고, 그동안 내 데이터를 내보낼 수 있게 해요.</li>
          <li>백업을 하지만 모든 데이터를 보장하지는 못해요. 중요한 기록은 가끔 내보내 두세요.</li>
        </ul>
      </Section>

      <Section title="7. 그만두기">
        <p>언제든 설정 → 계정 지우기로 그만둘 수 있어요. 지운 데이터는 되돌릴 수 없어요.</p>
      </Section>

      <Section title="8. 책임">
        <p>
          모아이는 무료 베타예요. 운영자의 고의나 중대한 과실이 없으면, 서비스를 쓰다 생긴 손해는 법이 허용하는 범위에서 책임지지 않아요. 법이 소비자에게 보장하는 권리는 그대로예요.
        </p>
      </Section>

      <Section title="9. 약관이 바뀔 때">
        <p>약관을 바꾸면 시행 7일 전에 앱에서 알려요. 내게 불리하게 바뀌면 30일 전에 알려요. 바뀐 약관이 싫으면 계정을 지워 그만둘 수 있어요.</p>
      </Section>

      <Section title="10. 문의와 준거법">
        <ul>
          <li>문의: {CONTACT}</li>
          <li>이 약관은 대한민국 법을 따라요.</li>
        </ul>
      </Section>
    </>
  );
}
