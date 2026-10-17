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
      },
      manifest: {
        name: '모아이',
        short_name: '모아이',
        description: 'AI와 공부한 내용을 2~3분씩 되새기는 복습 앱',
        lang: 'ko',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        background_color: '#F5F6F8',
        theme_color: '#2445B8',
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
