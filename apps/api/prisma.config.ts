import 'dotenv/config';
import { defineConfig } from 'prisma/config';

// Migrations need a direct connection: on Supabase DATABASE_URL is the pooler, DIRECT_URL the database itself.

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    // Empty is fine for `prisma generate` (e.g. on install); migrate commands need a real URL.
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
