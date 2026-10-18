import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// 로컬에서는 wrangler dev(8787)가 API를 받는다. Worker가 Origin을 검사하므로 프록시가 Origin을 Worker 주소로 바꿔 보낸다.
const worker = 'http://localhost:8787';
const proxy = { target: worker, headers: { origin: worker } };

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
        // 링크 미리보기 그림은 앱에서 쓰지 않는다. 글꼴(woff2)은 화면에 나온 글자 조각만 그때그때 받는다
        globIgnores: ['og.png'],
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
      },
    }),
  ],
  server: { proxy: { '/api': proxy, '/mcp': proxy } },
  build: { target: 'es2022' },
});
