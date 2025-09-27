import { createApp } from './app';

// Create the Hono app instance.
// The `createApp` function will be modified to not depend on Cloudflare's `Env`.
const app = createApp({} as any);

export default app;