import 'dotenv/config';
import { defineConfig } from 'prisma/config';

/**
 * Migrations need a direct (non-pooled) connection: DIRECT_URL when the app itself goes through a
 * pooler (Neon `-pooler` host, Supabase port 6543), otherwise DATABASE_URL. `prisma generate` needs neither.
 */
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    // Demo data is opt-in, see prisma/seed.ts.
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: process.env.DIRECT_URL || process.env.DATABASE_URL || '',
  },
});
