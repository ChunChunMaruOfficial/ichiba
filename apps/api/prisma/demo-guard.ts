/**
 * Demo (mock) data is switched off: the seed scripts are kept for local development but only run
 * with SEED_DEMO=true, and never against a production deploy.
 *
 *   SEED_DEMO=true npm run seed -w apps/api
 */
export function assertDemoSeedAllowed() {
  if (process.env.SEED_DEMO !== 'true') {
    console.log('Demo data is disabled. Set SEED_DEMO=true to fill a local database with test accounts and items.');
    process.exit(0);
  }
  if (process.env.NODE_ENV === 'production' || process.env.VERCEL) {
    console.error('Refusing to seed demo data in production.');
    process.exit(1);
  }
}
