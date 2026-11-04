import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { resetAndMigrate, useTestDatabaseForApp } from './helpers/testdb.js';

/**
 * «Жалобы и обращения» against the test database: the complaint is stored with a number, the author gets a receipt
 * and the admins a Telegram message; the answer is sent once and goes to the author's email.
 */

useTestDatabaseForApp();
const { PrismaService } = await import('../../src/prisma/prisma.service.js');
const { ComplaintsService, ComplaintDto, AdminComplaintsController } = await import('../../src/complaints/complaints.js');
const { AdminGuard } = await import('../../src/moderation/moderation.js');
const { ZodPipe } = await import('../../src/common/zod.js');

type Any = any; // eslint-disable-line @typescript-eslint/no-explicit-any
const prisma = new PrismaService();
const mails: Array<{ to: string; subject: string; text: string; kind: string; userId: string | null }> = [];
const telegrams: Array<{ chatId: string; html: string }> = [];
const outbox: Any = { enqueue: async (m: (typeof mails)[number]) => void mails.push(m) };
const telegram: Any = { send: async (chatId: string, html: string) => void telegrams.push({ chatId, html }) };
const complaints = new ComplaintsService(prisma, outbox, telegram);
const pipe = new ZodPipe(ComplaintDto);
const rejects = (p: Promise<unknown>, status: number) => assert.rejects(p, (e: Any) => e?.getStatus?.() === status);
const settle = () => new Promise((r) => setTimeout(r, 50));

const form = { topic: 'DEAL', about: 'Сделка № 10482', text: 'Продавец не пришёл на встречу и не отвечает в чате третий день.', name: 'Аня', email: 'anya@example.com' };

before(async () => {
  await resetAndMigrate();
  await prisma.$connect();
});
after(async () => {
  await prisma.$disconnect();
});
beforeEach(() => {
  mails.length = 0;
  telegrams.length = 0;
});

describe('complaints', () => {
  test('the form is checked: a topic, a real text, a name and an email; a bot that fills the hidden field is refused', () => {
    assert.deepEqual(pipe.transform({ ...form, about: '' }), { ...form, about: null });
    assert.throws(() => pipe.transform({ ...form, text: 'плохо' }), (e: Any) => 'text' in e.getResponse().fields);
    assert.throws(() => pipe.transform({ ...form, email: 'anya' }), (e: Any) => 'email' in e.getResponse().fields);
    assert.throws(() => pipe.transform({ ...form, topic: 'SPAM' }), (e: Any) => 'topic' in e.getResponse().fields);
    assert.throws(() => pipe.transform({ ...form, website: 'http://spam' }), (e: Any) => 'website' in e.getResponse().fields);
  });

  test('a complaint gets a number, the author a receipt with their words, every admin with Telegram a message', async () => {
    await prisma.user.create({ data: { username: 'boss', role: 'ADMIN', tgChatId: '111' } });
    await prisma.user.create({ data: { username: 'boss2', role: 'ADMIN', tgChatId: '222' } });
    await prisma.user.create({ data: { username: 'gone', role: 'ADMIN', tgChatId: '333', blockedAt: new Date() } });
    await prisma.user.create({ data: { username: 'plain', tgChatId: '444' } });
    const a = await complaints.create(null, pipe.transform(form) as Any);
    const b = await complaints.create(null, pipe.transform({ ...form, about: null }) as Any);
    assert.equal(b.number, a.number + 1);
    await settle();
    const row = await prisma.complaint.findUniqueOrThrow({ where: { number: a.number } });
    assert.equal(row.status, 'NEW');
    assert.equal(row.userId, null);
    const receipt = mails.find((m) => m.subject.includes(`№ ${a.number}`))!;
    assert.equal(receipt.to, 'anya@example.com');
    assert.equal(receipt.userId, null);
    assert.match(receipt.text, /третий день/);
    assert.deepEqual(telegrams.filter((t) => t.html.includes(`№ ${a.number}<`)).map((t) => t.chatId).sort(), ['111', '222']);
  });

  test('the answer goes to the author once; a second answer is refused', async () => {
    const admin = await prisma.user.create({ data: { username: 'answerer', role: 'ADMIN' } });
    const { number } = await complaints.create(null, pipe.transform(form) as Any);
    const c = await prisma.complaint.findUniqueOrThrow({ where: { number } });
    mails.length = 0;
    await complaints.answer({ id: admin.id, username: admin.username, role: 'ADMIN' }, c.id, 'Связались с продавцом: встреча перенесена на завтра, 12:00.');
    const done = await prisma.complaint.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(done.status, 'ANSWERED');
    assert.equal(done.answeredBy, 'answerer');
    assert.equal(mails.length, 1);
    assert.equal(mails[0].to, 'anya@example.com');
    assert.match(mails[0].subject, new RegExp(`Ответ на обращение № ${number}`));
    assert.match(mails[0].text, /встреча перенесена/);
    await rejects(complaints.answer({ id: admin.id, username: admin.username, role: 'ADMIN' }, c.id, 'Ещё один ответ на то же обращение.'), 409);
    assert.equal((await complaints.list('NEW')).some((x) => x.id === c.id), false);
    assert.equal((await complaints.list('ANSWERED')).some((x) => x.id === c.id), true);
  });

  test('a signed-in author is kept with the complaint and shown to the admin by nick', async () => {
    const u = await prisma.user.create({ data: { username: 'buyer1' } });
    const { number } = await complaints.create(u.id, pipe.transform(form) as Any);
    const row = (await complaints.list('all')).find((x) => x.number === number)!;
    assert.equal(row.username, 'buyer1');
  });

  test('the admin list and answers are admin-only', () => {
    assert.ok((Reflect.getMetadata(GUARDS_METADATA, AdminComplaintsController) as unknown[]).includes(AdminGuard));
  });
});
