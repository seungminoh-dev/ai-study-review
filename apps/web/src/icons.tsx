import type { ReactNode } from 'react';

// 화면에 쓰는 선 아이콘. 글자색(currentColor)을 따른다. 옆에 글자가 있는 장식이라 스크린 리더는 건너뛴다.

function Icon({ size = 22, strokeWidth = 2, children }: { size?: number; strokeWidth?: number; children: ReactNode }) {
  return (
    <svg
      className="icon"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  );
}

interface Props {
  size?: number;
}

export const IconHome = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M3 10.5 12 3l9 7.5" />
    <path d="M5 9.5V20h5v-6h4v6h5V9.5" />
  </Icon>
);

export const IconMap = ({ size }: Props) => (
  <Icon size={size}>
    <circle cx="6" cy="6" r="2.5" />
    <circle cx="18" cy="8" r="2.5" />
    <circle cx="11" cy="18" r="2.5" />
    <path d="M8.4 6.5 15.6 7.6" />
    <path d="M7.2 8.3l2.7 7.5" />
    <path d="M16.6 10.1l-4.2 5.9" />
  </Icon>
);

export const IconGrowth = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M4 20h16" />
    <path d="M7 16v-4" />
    <path d="M12 16V8" />
    <path d="M17 16V5" />
  </Icon>
);

export const IconRecords = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M6 4h10a2 2 0 0 1 2 2v14H8a2 2 0 0 1-2-2z" />
    <path d="M6 16a2 2 0 0 1 2-2h10" />
    <path d="M10 8h4" />
  </Icon>
);

export const IconBook = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M5 5a2 2 0 0 1 2-2h12v15H7a2 2 0 0 0-2 2z" />
    <path d="M5 20a2 2 0 0 1 2-2h12" />
  </Icon>
);

export const IconSettings = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M4 7h9" />
    <path d="M17 7h3" />
    <circle cx="15" cy="7" r="2" />
    <path d="M4 17h3" />
    <path d="M11 17h9" />
    <circle cx="9" cy="17" r="2" />
  </Icon>
);

export const IconArrow = ({ size = 18 }: Props) => (
  <Icon size={size} strokeWidth={2.4}>
    <path d="M5 12h14" />
    <path d="M13 6l6 6-6 6" />
  </Icon>
);

export const IconCheck = ({ size = 18 }: Props) => (
  <Icon size={size} strokeWidth={2.8}>
    <path d="M5 12.5 10 17l9-10" />
  </Icon>
);

/** 프리즈로 지킨 날 */
export const IconSnow = ({ size = 16 }: Props) => (
  <Icon size={size} strokeWidth={2.2}>
    <path d="M12 3v18" />
    <path d="M4.2 7.5l15.6 9" />
    <path d="M4.2 16.5l15.6-9" />
  </Icon>
);

/** 예전에 틀린 곳부터 (되감기 시계) */
export const IconHistory = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M4 12a8 8 0 1 0 2.3-5.7" />
    <path d="M4 4v4h4" />
    <path d="M12 8v4l3 2" />
  </Icon>
);

/** 오프라인 */
export const IconOffline = ({ size }: Props) => (
  <Icon size={size}>
    <path d="M2 8.5a15 15 0 0 1 20 0" />
    <path d="M5.5 12a10 10 0 0 1 13 0" />
    <path d="M9 15.5a5 5 0 0 1 6 0" />
    <path d="M3 3l18 18" />
  </Icon>
);

/** 펼치기 (아래 꺾쇠) */
export const IconChevron = ({ size = 18 }: Props) => (
  <Icon size={size} strokeWidth={2.4}>
    <path d="M6 9l6 6 6-6" />
  </Icon>
);

/** 말풍선: 개념 물어보기 */
export const IconChat = ({ size = 18 }: Props) => (
  <Icon size={size} strokeWidth={2.2}>
    <path d="M5 5h14v10H10l-5 4z" />
    <path d="M9 9.5h6" />
  </Icon>
);

/** 바깥 사이트로 나가는 링크 */
export const IconExternal = ({ size = 18 }: Props) => (
  <Icon size={size} strokeWidth={2.4}>
    <path d="M7 17 17 7" />
    <path d="M9 7h8v8" />
  </Icon>
);

export const IconCopy = ({ size = 18 }: Props) => (
  <Icon size={size}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a2 2 0 0 1 2-2h10" />
  </Icon>
);

/** GitHub 로고 (Octicons mark-github). 면으로 그린 로고라 글자색으로 채운다 */
export const IconGithub = ({ size = 20 }: Props) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
    <path
      fill="currentColor"
      d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"
    />
  </svg>
);

/** 연속 학습 불꽃. 색이 정해진 그림이라 글자색을 따르지 않는다 */
export const IconFlame = ({ size = 20 }: Props) => (
  <svg className="icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
    <path
      d="M12 2.5c.8 3.2 4.8 5.2 4.8 10a4.8 4.8 0 0 1-9.6 0c0-2.4 1.3-3.9 2.3-4.9.3 1.5 1.1 2.4 2.3 2.8.6-2.9-.8-5.4.2-7.9z"
      fill="#ff914d"
    />
  </svg>
);
