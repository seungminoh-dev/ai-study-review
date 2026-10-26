import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';
import pkg from '../../package.json';

// 로컬에서는 wrangler dev(8787)가 API를 받는다. Worker가 Origin을 검사하므로 프록시가 Origin을 Worker 주소로 바꿔 보낸다.
const worker = 'http://localhost:8787';
const proxy = { target: worker, headers: { origin: worker } };

// 설정 화면 바닥에 보여 줄 버전: 레포 package.json의 버전(버전 PR마다 올린다), 커밋 앞 7자리, 빌드한 날(한국 시간).
// GitHub Actions가 GITHUB_SHA를 넣어 주고, 로컬 빌드는 dev다.
// 설정 파일은 Node에서 돌지만 Node 타입을 따로 들이지 않으려고 process를 globalThis에서 꺼낸다
const env = (globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env ?? {};
const buildDay = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
const appVersion = `v${pkg.version} · ${env.GITHUB_SHA?.slice(0, 7) ?? 'dev'} · ${buildDay}`;

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      strategies: 'injectManifest',
      srcDir: 'src',
      filename: 'sw.ts',
      // 서비스 워커 등록은 src/main.tsx에서 직접 한다
      injectRegister: false,
      injectManifest: {
        // 모든 브라우저에서 등록되도록 모듈이 아닌 일반 스크립트로 만든다
        rollupFormat: 'iife',
        globPatterns: ['**/*.{js,css,html,png,svg,webmanifest}'],
        // 링크 미리보기 그림과 설치 미리보기 화면은 앱에서 쓰지 않는다. 글꼴(woff2)은 화면에 나온 글자 조각만 그때그때 받는다
        globIgnores: ['og.png', 'screenshots/**'],
      },
      manifest: {
        name: '모아이',
        short_name: '모아이',
        description: 'AI와 공부한 내용을 2~3분씩 되새기는 복습 앱',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        // Android Chrome에 설치한 앱은 3버튼 내비게이션 바를 이 색으로 칠한다 (2026-10 실측. 페이지의 theme-color는 따르지 않았다).
        // 매니페스트에는 다크 모드용 색이 없어서 다크 모드의 아래 탭 색에 맞춘다. 라이트 모드에서는 어두운 바가 된다.
        // 이미 설치한 앱은 Chrome이 매니페스트를 다시 읽어야(재설치 또는 앱 업데이트) 바뀐다.
        background_color: '#182238',
        theme_color: '#192849',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512-maskable.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
        // 홈 화면 아이콘을 길게 누르면 나오는 바로가기
        shortcuts: [
          { name: '오늘 복습', short_name: '복습', url: '/review', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: '지식 지도', short_name: '지도', url: '/map', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
          { name: '내 성장', short_name: '성장', url: '/growth', icons: [{ src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' }] },
        ],
        // 설치 창에 보여 줄 화면 (scripts/gen-screenshots.mjs로 시험 데이터에서 찍는다)
        screenshots: [
          { src: '/screenshots/today.webp', sizes: '780x1688', type: 'image/webp', form_factor: 'narrow', label: '오늘 복습할 카드와 하루 목표' },
          { src: '/screenshots/review.webp', sizes: '780x1688', type: 'image/webp', form_factor: 'narrow', label: '한 장씩 푸는 복습' },
          { src: '/screenshots/map.webp', sizes: '780x1688', type: 'image/webp', form_factor: 'narrow', label: '내 지식 지도' },
          { src: '/screenshots/wide.webp', sizes: '1280x800', type: 'image/webp', form_factor: 'wide', label: '컴퓨터에서 보는 오늘 화면' },
        ],
      },
    }),
  ],
  define: { __APP_VERSION__: JSON.stringify(appVersion) },
  server: { proxy: { '/api': proxy, '/mcp': proxy } },
  build: { target: 'es2022' },
});
