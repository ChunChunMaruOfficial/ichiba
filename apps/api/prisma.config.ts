import 'dotenv/config';
import { defineConfig, env } from 'prisma/config';

// Migrations need a direct connection: on Supabase DATABASE_URL is the pooler, DIRECT_URL the database itself.

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL || env('DATABASE_URL'),
  },
});
