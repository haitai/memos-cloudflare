import type { Config } from 'drizzle-kit';

export default {
  schema: './src/schema/index.ts',
  out: './drizzle',
  driver: 'better-sqlite',
  dbCredentials: {
    url: './local.db',
  },
} satisfies Config;
