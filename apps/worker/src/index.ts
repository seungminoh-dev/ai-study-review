import { app } from './app';
import { runCron } from './cron';
import type { Env } from './env';

export default {
  fetch: app.fetch,
  async scheduled(_controller, env, _ctx) {
    await runCron(env, Date.now());
  },
} satisfies ExportedHandler<Env>;
