import { app } from './app';
import { runCron } from './cron';
import type { Env } from './env';

export default {
  fetch: app.fetch,
  async scheduled(controller, env, _ctx) {
    // 예정 시각을 기준으로 한다. 실행이 몇 초 늦어도 같은 분으로 본다
    await runCron(env, controller.scheduledTime);
  },
} satisfies ExportedHandler<Env>;
