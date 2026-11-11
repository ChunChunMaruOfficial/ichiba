import { articleRoutes } from './articles.js';
import { brandRoutes } from './brands.js';
import { complaintRoutes } from './complaints.js';
import type { Routes } from './ctx.js';
import { dbRowRoutes } from './db-row.js';
import { dbRoutes } from './db.js';
import { disputeRoutes } from './disputes.js';
import { homeRoutes } from './home.js';
import { importRoutes } from './imports.js';
import { listingRoutes } from './listings.js';
import { logRoutes } from './log.js';
import { reportRoutes } from './reports.js';
import { userActionRoutes } from './user-actions.js';
import { userRoutes } from './users.js';

/** Every screen of the panel, by section — the same sections as /admin on the site. */
export const ROUTES: Routes = {
  ...homeRoutes,
  ...reportRoutes,
  ...disputeRoutes,
  ...complaintRoutes,
  ...listingRoutes,
  ...userRoutes,
  ...userActionRoutes,
  ...brandRoutes,
  ...articleRoutes,
  ...logRoutes,
  ...importRoutes,
  ...dbRoutes,
  ...dbRowRoutes,
};
