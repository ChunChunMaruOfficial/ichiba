import type { ZodType } from 'zod';
import type { AuctionsService } from '../auctions/auctions.js';
import type { ListingsService } from '../listings/listings.service.js';
import type { OffersService } from '../offers/offers.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import type { RequestsService } from '../requests/requests.service.js';
import type { StatsService } from '../stats/stats.js';
import type { UsersService } from '../users/users.service.js';

/**
 * A button under a bot message (an inline keyboard, as in Telegram). `press` goes back to the server
 * (POST /assistant/press) — undo, confirm, a menu item; `link` opens a page of the site.
 */
export interface Button {
  id: string;
  label: string;
  kind: 'press' | 'link';
  path?: string;
}
export type Keyboard = Button[][];

/** What a tool works with: always the signed-in account, never an id the model named. */
export interface ToolCtx {
  userId: string;
  prisma: PrismaService;
  listings: ListingsService;
  requests: RequestsService;
  offers: OffersService;
  auctions: AuctionsService;
  stats: StatsService;
  users: UsersService;
}

export interface Outcome {
  /** What is shown in the chat, in plain words, with what exactly changed. */
  report: string;
  /** What was there before; given back to undo(). No snapshot = nothing to put back. */
  snapshot?: unknown;
  /** Read tools: what the model gets back for its next step. */
  data?: unknown;
  /** Link buttons under the report. */
  links?: string[];
}

/**
 * - read: looks things up, changes nothing; its result goes back to the model.
 * - write: done at once, reported with «Отменить» (needs undo).
 * - confirm: cannot be put back, so the chat asks «Сделать?» first.
 */
export type ToolKind = 'read' | 'write' | 'confirm';

export interface Tool<A = unknown> {
  name: string;
  /** For the model: when to call it and what the arguments mean. */
  about: string;
  args: ZodType<A>;
  kind: ToolKind;
  /** A write tool may still ask first (a price cut by more than half). Returns the question, or null to go ahead. */
  ask?(ctx: ToolCtx, args: A): Promise<string | null>;
  /** confirm tools: what exactly will happen, shown above «Сделать / Отмена». */
  preview?(ctx: ToolCtx, args: A): Promise<string>;
  run(ctx: ToolCtx, args: A): Promise<Outcome>;
  undo?(ctx: ToolCtx, snapshot: unknown): Promise<string>;
}

/** A refusal the person should read as it is (nothing matched, a limit, a rule of the site). */
export class Refusal extends Error {
  /** Keys of LINKS to show under the refusal (where the person can do it themselves). */
  constructor(
    message: string,
    readonly links: string[] = [],
  ) {
    super(message);
  }
}
