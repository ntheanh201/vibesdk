import 'dotenv/config';
import { serve } from '@hono/node-server';
import { createApp } from './app';
import { createLogger } from './logger';

const logger = createLogger('Server');

// We will need to adapt `createApp` to not depend on Cloudflare's `Env`
// For now, we'll pass a placeholder.
const app = createApp({} as any);

const port = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

serve({
  fetch: app.fetch,
  port: port,
}, (info) => {
  logger.info(`Server is running at http://localhost:${info.port}`);
});