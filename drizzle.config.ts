import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './worker/database/schema.ts',
  out: './migrations',
  dialect: 'sqlite',
  driver: 'better-sqlite',
  dbCredentials: {
    url: './data/sqlite.db',
  },
  verbose: true,
  strict: true,
});