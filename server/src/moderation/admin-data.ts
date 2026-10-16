import { BadRequestException, Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { randomInt } from 'node:crypto';
import { z } from 'zod';
import { AuthUser, CurrentUser, forgetSessionStatus } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ListingsService } from '../listings/listings.service.js';
import { PrivacyService } from '../privacy/privacy.js';
import { AdminGuard } from './moderation.js';

/**
 * Owner tools in /admin: users (search, edit, block, delete) and a database browser that reads the live
 * Postgres catalog, so every table is editable without a hand-written screen. Every write lands in the
 * moderation log.
 */

const PAGE = 50;
/** Column names whose values never leave the server (password and code hashes, tokens). */
const SECRET = /hash|secret|token|password/i;
const quote = (ident: string) => `"${ident.replace(/"/g, '""')}"`;
const selectList = (columns: Column[]) => columns.map((c) => (c.readAs ? `${quote(c.name)}::${c.readAs} AS ${quote(c.name)}` : quote(c.name))).join(', ');

interface Column {
  name: string;
  type: string;
  nullable: boolean;
  default: string | null;
  enumValues: string[] | null;
  pk: boolean;
  secret: boolean;
  /** Enums (and enum arrays) are read as text: the driver adapter has no decoder for them. */
  readAs: string | null;
}

/** Dates as ISO, bigint/Decimal as strings, secrets masked: safe to JSON-encode. */
function plain(row: Record<string, unknown>, columns?: Column[]) {
  const secret = new Set((columns ?? []).filter((c) => c.secret).map((c) => c.name));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (secret.has(k) || (!columns && SECRET.test(k))) out[k] = v == null ? null : '••••••';
    else if (typeof v === 'bigint') out[k] = v.toString();
    else if (v instanceof Prisma.Decimal) out[k] = v.toString();
    else if (v instanceof Uint8Array) out[k] = `<${v.length} bytes>`;
    else out[k] = v;
  }
  return out;
}

const dbError = (e: unknown) => {
  const msg = (e as { meta?: { message?: string }; message?: string }).meta?.message ?? (e as Error).message ?? 'Ошибка базы';
  return new BadRequestException({ message: msg.split('\n').filter(Boolean).slice(-1)[0]?.slice(0, 400) ?? 'Ошибка базы' });
};

const UserPatch = z.object({
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9_]{3,24}$/, 'Ник: 3–24 латинских буквы, цифры или _').optional(),
  email: z.string().trim().toLowerCase().email('Проверьте почту').nullish(),
  phone: z.string().trim().max(30).nullish(),
  city: z.string().trim().max(60).nullish(),
  bio: z.string().trim().max(500).nullish(),
  role: z.enum(['USER', 'ADMIN']).optional(),
});
/** Letters and digits that can't be misread when a password is copied by hand (no 0/O, 1/l/I). */
const PASSWORD_ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newPassword = (length = 12) => Array.from({ length }, () => PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]).join('');

const Reason = z.object({ reason: z.string().trim().min(3, 'Укажите причину').max(300) });
const RowKey = z.object({ key: z.record(z.string(), z.unknown()) });
const RowPatch = RowKey.extend({ set: z.record(z.string(), z.unknown()) });

@Controller('admin')
@UseGuards(AdminGuard)
export class AdminDataController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly privacy: PrivacyService,
    private readonly listings: ListingsService,
  ) {}

  // ---------- users ----------

  @Get('users')
  async users(@Query('q') q = '', @Query('page') page = '1', @Query('filter') filter = 'all') {
    const term = q.trim();
    const where: Prisma.UserWhereInput = {
      ...(term
        ? { OR: [{ username: { contains: term.toLowerCase() } }, { email: { contains: term.toLowerCase() } }, { phone: { contains: term } }, ...(/^[0-9a-f-]{36}$/i.test(term) ? [{ id: term }] : [])] }
        : {}),
      ...(filter === 'blocked' ? { blockedAt: { not: null } } : filter === 'admins' ? { role: 'ADMIN' } : filter === 'deleted' ? { deletedAt: { not: null } } : {}),
    };
    const skip = (Math.max(1, Number(page) || 1) - 1) * PAGE;
    const [total, rows] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: PAGE,
        select: { id: true, username: true, email: true, phone: true, role: true, city: true, blockedAt: true, deletedAt: true, createdAt: true, googleSub: true, telegramId: true, _count: { select: { listings: true } } },
      }),
    ]);
    return {
      total,
      pageSize: PAGE,
      items: rows.map(({ _count, googleSub, telegramId, ...u }) => ({ ...u, listings: _count.listings, via: [googleSub && 'google', telegramId && 'telegram'].filter(Boolean) })),
    };
  }

  @Get('users/:id')
  async user(@Param('id', ParseUUIDPipe) id: string) {
    const u = await this.prisma.user.findUnique({ where: { id } });
    if (!u) throw new NotFoundException({ message: 'Пользователь не найден' });
    const [listings, asBuyer, asSeller, reportsAgainst, actions, recent] = await Promise.all([
      this.prisma.listing.groupBy({ by: ['status'], where: { sellerId: id }, _count: true }),
      this.prisma.buyRequest.count({ where: { buyerId: id } }),
      this.prisma.buyRequest.count({ where: { sellerId: id } }),
      this.prisma.report.count({ where: { targetType: 'USER', targetId: id } }),
      this.prisma.moderationAction.findMany({ where: { targetType: 'USER', targetId: id }, orderBy: { at: 'desc' }, take: 20 }),
      this.prisma.listing.findMany({ where: { sellerId: id }, orderBy: { updatedAt: 'desc' }, take: 12, select: { id: true, title: true, status: true, price: true, updatedAt: true } }),
    ]);
    const { passwordHash, ...rest } = u;
    return {
      user: { ...plain(rest), hasPassword: !!passwordHash },
      stats: { listings: Object.fromEntries(listings.map((l) => [l.status, l._count])), asBuyer, asSeller, reportsAgainst },
      recentListings: recent,
      actions,
    };
  }

  @Patch('users/:id')
  async editUser(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(UserPatch)) dto: z.infer<typeof UserPatch>) {
    if (id === admin.id && dto.role && dto.role !== 'ADMIN') throw new ForbiddenException({ message: 'Нельзя снять админа с себя' });
    try {
      await this.prisma.user.update({ where: { id }, data: { ...dto, ...(dto.email !== undefined ? { emailVerifiedAt: dto.email ? new Date() : null } : {}) } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new BadRequestException({ message: 'Такой ник, почта или телефон уже заняты' });
      throw e;
    }
    forgetSessionStatus(id);
    await this.log(admin.id, 'USER', id, 'edit', Object.keys(dto).join(', '));
    return { ok: true };
  }

  /**
   * «Задать новый пароль»: a fresh random password replaces the old one and is returned once, for the owner to hand
   * over (passwords are stored only as hashes, so there is nothing to look up later). Never for admin accounts.
   * The journal records that it happened, not the password.
   */
  @Post('users/:id/password')
  @HttpCode(200)
  async resetPassword(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { role: true, username: true, email: true, phone: true, deletedAt: true } });
    if (!user || user.deletedAt) throw new NotFoundException({ message: 'Пользователь не найден' });
    if (user.role === 'ADMIN') throw new ForbiddenException({ message: 'Пароль администратора так не меняется' });
    const password = newPassword();
    await this.prisma.user.update({ where: { id }, data: { passwordHash: await bcrypt.hash(password, 10) } });
    forgetSessionStatus(id);
    await this.log(admin.id, 'USER', id, 'password_reset', null);
    // Accounts without an address sign in with their nick (AuthService.login).
    return { login: user.email ?? user.phone ?? `@${user.username}`, password };
  }

  @Post('users/:id/block')
  @HttpCode(200)
  async blockUser(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(Reason)) dto: z.infer<typeof Reason>) {
    if (id === admin.id) throw new ForbiddenException({ message: 'Нельзя заблокировать себя' });
    await this.prisma.user.update({ where: { id }, data: { blockedAt: new Date() } });
    forgetSessionStatus(id);
    await this.listings.hideForBlock(id);
    await this.log(admin.id, 'USER', id, 'block', dto.reason);
    return { ok: true };
  }

  @Post('users/:id/unblock')
  @HttpCode(200)
  async unblockUser(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.user.update({ where: { id }, data: { blockedAt: null } });
    forgetSessionStatus(id);
    const restored = await this.listings.restoreAfterUnblock(id);
    await this.log(admin.id, 'USER', id, 'unblock', `${restored}`);
    return { ok: true, restored };
  }

  /**
   * Hide every listing of an account without deleting or blocking it: on-sale items go hidden (marked as hidden by an
   * admin, so the owner can't bring them back), items in a deal finish it, and new ones are saved hidden too.
   */
  @Post('users/:id/hide-listings')
  @HttpCode(200)
  async hideListings(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.user.update({ where: { id }, data: { listingsHiddenAt: new Date() } });
    const onSale = await this.prisma.listing.findMany({ where: { sellerId: id, status: 'PUBLISHED' }, select: { id: true } });
    const { count } = await this.prisma.listing.updateMany({ where: { id: { in: onSale.map((l) => l.id) } }, data: { status: 'HIDDEN', hiddenByAdmin: true } });
    await this.listings.withdrawFromSale(onSale.map((l) => l.id));
    await this.prisma.cartItem.deleteMany({ where: { listing: { sellerId: id, hiddenByAdmin: true } } });
    await this.log(admin.id, 'USER', id, 'hide_listings', `${count}`);
    return { ok: true, hidden: count };
  }

  /** Brings back exactly what an admin hid; listings the owner hid themselves stay hidden. */
  @Post('users/:id/show-listings')
  @HttpCode(200)
  async showListings(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const user = await this.prisma.user.update({ where: { id }, data: { listingsHiddenAt: null }, select: { blockedAt: true } });
    // A blocked account's items stay hidden until it is unblocked (then they come back with the block's own).
    const { count } = await this.prisma.listing.updateMany({
      where: { sellerId: id, hiddenByAdmin: true, status: 'HIDDEN' },
      data: user.blockedAt ? { hiddenByAdmin: false, hiddenByBlock: true } : { status: 'PUBLISHED', hiddenByAdmin: false },
    });
    await this.prisma.listing.updateMany({ where: { sellerId: id, hiddenByAdmin: true }, data: { hiddenByAdmin: false } });
    await this.log(admin.id, 'USER', id, 'show_listings', `${count}`);
    return { ok: true, shown: user.blockedAt ? 0 : count };
  }

  /** Same erasure as "delete my account": deals and chats stay for the other side, anonymised. */
  @Delete('users/:id')
  async deleteUser(@CurrentUser() admin: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    if (id === admin.id) throw new ForbiddenException({ message: 'Себя удалить отсюда нельзя' });
    await this.privacy.deleteAccount(id);
    forgetSessionStatus(id);
    await this.log(admin.id, 'USER', id, 'delete', null);
    return { ok: true };
  }

  // ---------- database ----------

  @Get('db')
  async tables() {
    const rows = await this.prisma.$queryRaw<Array<{ name: string }>>`
      SELECT c.relname::text AS name
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname <> '_prisma_migrations'
      ORDER BY c.relname`;
    return { tables: rows };
  }

  @Get('db/:table')
  async rows(@Param('table') table: string, @Query('q') q = '', @Query('page') page = '1', @Query('sort') sort?: string, @Query('dir') dir = 'desc', @Query('filter') filterRaw?: string) {
    const columns = await this.columns(table);
    const params: unknown[] = [];
    const conds: string[] = [];
    const term = q.trim();
    if (term) {
      params.push(`%${term}%`);
      const searchable = columns.filter((c) => !c.secret && (c.enumValues || /^(text|character varying|uuid|citext)/.test(c.type)));
      if (searchable.length) conds.push(`(${searchable.map((c) => `${quote(c.name)}::text ILIKE $${params.length}`).join(' OR ')})`);
    }
    if (filterRaw) {
      let filter: Record<string, unknown>;
      try {
        filter = JSON.parse(filterRaw) as Record<string, unknown>;
      } catch {
        throw new BadRequestException({ message: 'filter: нужен JSON' });
      }
      for (const [k, v] of Object.entries(filter)) {
        const col = columns.find((c) => c.name === k);
        if (!col) throw new BadRequestException({ message: `Нет колонки ${k}` });
        if (v === null) conds.push(`${quote(k)} IS NULL`);
        else {
          params.push(String(v));
          conds.push(`${quote(k)}::text = $${params.length}`);
        }
      }
    }
    const where = conds.length ? `WHERE ${conds.join(' AND ')}` : '';
    const sortCol = columns.find((c) => c.name === sort) ?? columns.find((c) => c.name === 'createdAt') ?? columns.find((c) => c.pk) ?? columns[0];
    const order = `${quote(sortCol.name)} ${dir === 'asc' ? 'ASC' : 'DESC'} NULLS LAST`;
    const offset = (Math.max(1, Number(page) || 1) - 1) * PAGE;
    try {
      const [count, rows] = await Promise.all([
        this.prisma.$queryRawUnsafe<Array<{ n: number }>>(`SELECT count(*)::int AS n FROM ${quote(table)} ${where}`, ...params),
        this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`SELECT ${selectList(columns)} FROM ${quote(table)} ${where} ORDER BY ${order} LIMIT ${PAGE} OFFSET ${offset}`, ...params),
      ]);
      return { table, columns, total: count[0].n, pageSize: PAGE, sort: sortCol.name, dir: dir === 'asc' ? 'asc' : 'desc', rows: rows.map((r) => plain(r, columns)) };
    } catch (e) {
      throw dbError(e);
    }
  }

  @Patch('db/:table')
  async updateRow(@CurrentUser() admin: AuthUser, @Param('table') table: string, @Body(new ZodPipe(RowPatch)) dto: z.infer<typeof RowPatch>) {
    const columns = await this.columns(table);
    const entries = Object.entries(dto.set);
    if (!entries.length) throw new BadRequestException({ message: 'Нечего сохранять' });
    const params: unknown[] = [];
    const sets = entries.map(([k, v]) => {
      const col = columns.find((c) => c.name === k);
      if (!col) throw new BadRequestException({ message: `Нет колонки ${k}` });
      if (col.secret) throw new BadRequestException({ message: `${k} не редактируется` });
      return `${quote(k)} = ${this.param(col, v, params)}`;
    });
    const where = this.keyWhere(columns, dto.key, params);
    try {
      const rows = await this.prisma.$queryRawUnsafe<Array<Record<string, unknown>>>(`UPDATE ${quote(table)} SET ${sets.join(', ')} WHERE ${where} RETURNING ${selectList(columns)}`, ...params);
      if (!rows.length) throw new NotFoundException({ message: 'Строка не найдена' });
      await this.log(admin.id, 'DB', `${table}:${JSON.stringify(dto.key)}`, 'update', entries.map(([k]) => k).join(', '));
      if (table === 'User') forgetSessionStatus(String(dto.key.id ?? ''));
      return { row: plain(rows[0], columns) };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw dbError(e);
    }
  }

  @Delete('db/:table')
  async deleteRow(@CurrentUser() admin: AuthUser, @Param('table') table: string, @Body(new ZodPipe(RowKey)) dto: z.infer<typeof RowKey>) {
    const columns = await this.columns(table);
    const params: unknown[] = [];
    const where = this.keyWhere(columns, dto.key, params);
    try {
      const n = await this.prisma.$executeRawUnsafe(`DELETE FROM ${quote(table)} WHERE ${where}`, ...params);
      if (!n) throw new NotFoundException({ message: 'Строка не найдена' });
      await this.log(admin.id, 'DB', `${table}:${JSON.stringify(dto.key)}`, 'delete', null);
      return { ok: true };
    } catch (e) {
      if (e instanceof NotFoundException) throw e;
      throw dbError(e);
    }
  }

  // ---------- helpers ----------

  private async columns(table: string): Promise<Column[]> {
    const rows = await this.prisma.$queryRaw<Array<Omit<Column, 'secret'>>>`
      SELECT a.attname::text AS name, format_type(a.atttypid, a.atttypmod) AS type, NOT a.attnotnull AS nullable,
             pg_get_expr(d.adbin, d.adrelid) AS default,
             CASE WHEN t.typtype = 'e' THEN (SELECT array_agg(e.enumlabel::text ORDER BY e.enumsortorder) FROM pg_enum e WHERE e.enumtypid = t.oid) END AS "enumValues",
             COALESCE(a.attnum = ANY(i.indkey), false) AS pk,
             CASE WHEN t.typtype = 'e' THEN 'text' WHEN et.typtype = 'e' THEN 'text[]' END AS "readAs"
      FROM pg_attribute a
      JOIN pg_class c ON c.oid = a.attrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
      JOIN pg_type t ON t.oid = a.atttypid
      LEFT JOIN pg_type et ON et.oid = t.typelem
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      LEFT JOIN pg_index i ON i.indrelid = c.oid AND i.indisprimary
      WHERE n.nspname = current_schema() AND c.relkind = 'r' AND c.relname = ${table} AND c.relname <> '_prisma_migrations'
        AND a.attnum > 0 AND NOT a.attisdropped
      ORDER BY a.attnum`;
    if (!rows.length) throw new NotFoundException({ message: `Таблицы ${table} нет` });
    return rows.map((c) => ({ ...c, secret: SECRET.test(c.name) }));
  }

  /** Placeholder with a cast to the column's own type (taken from the catalog, never from the request). */
  private param(col: Column, value: unknown, params: unknown[]) {
    if (value === null || value === undefined) {
      params.push(null);
      return `$${params.length}::${col.type}`;
    }
    if (/^jsonb?$/.test(col.type)) params.push(typeof value === 'string' ? value : JSON.stringify(value));
    else if (col.type.endsWith('[]')) {
      if (!Array.isArray(value)) throw new BadRequestException({ message: `${col.name}: нужен массив` });
      params.push(value.map((v) => (v === null ? null : String(v))));
      return `$${params.length}::text[]::${col.type}`;
    } else params.push(String(value));
    return `$${params.length}::${col.type}`;
  }

  private keyWhere(columns: Column[], key: Record<string, unknown>, params: unknown[]) {
    const pk = columns.filter((c) => c.pk);
    if (!pk.length) throw new BadRequestException({ message: 'У таблицы нет первичного ключа' });
    return pk
      .map((c) => {
        if (!(c.name in key)) throw new BadRequestException({ message: `Нужен ключ ${c.name}` });
        return `${quote(c.name)} = ${this.param(c, key[c.name], params)}`;
      })
      .join(' AND ');
  }

  private log(moderatorId: string, targetType: string, targetId: string, action: string, reason: string | null) {
    return this.prisma.moderationAction.create({ data: { moderatorId, targetType, targetId: targetId.slice(0, 500), action, reason } });
  }
}
