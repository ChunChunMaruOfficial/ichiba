import type { Routes } from './ctx.js';
import { ask, btn, go, h, screen, str, toast } from './ui.js';

const FIELDS: Record<string, string> = { username: 'Ник', email: 'Почта', phone: 'Телефон', city: 'Город', bio: 'О себе' };
const user = (p: Record<string, unknown>) => go('user', { id: p.id, tab: p.tab, q: p.q, page: p.page });
const confirm = (text: string, yes: string, route: string, p: Record<string, unknown>) => screen(text, [[btn(yes, route, p), btn('Отмена', 'user', p)]]);

/** Every action on an account; destructive ones ask first, and the API checks the rest (not yourself, not an admin's password…). */
export const userActionRoutes: Routes = {
  async 'user.edit'({ p }) {
    return screen('✏️ <b>Что изменить?</b>', [
      [btn('Ник', 'user.field', { ...p, f: 'username' }), btn('Почта', 'user.field', { ...p, f: 'email' }), btn('Телефон', 'user.field', { ...p, f: 'phone' })],
      [btn('Город', 'user.field', { ...p, f: 'city' }), btn('О себе', 'user.field', { ...p, f: 'bio' })],
      [btn('👑 Сделать админом', 'user.role', { ...p, role: 'ADMIN' }), btn('Снять админа', 'user.role', { ...p, role: 'USER' })],
      [btn('← Назад', 'user', p)],
    ]);
  },
  async 'user.field'({ p }) {
    const f = str(p.f);
    const hint = f === 'username' ? '3–24 латинских буквы, цифры или _' : f === 'email' ? 'почта считается подтверждённой' : 'или «-», чтобы очистить';
    return ask(`✏️ Новое значение поля «${h(FIELDS[f] ?? f)}» (${hint}):`, go('user.set', p), user(p));
  },
  async 'user.set'({ api, p }) {
    const f = str(p.f);
    if (!(f in FIELDS)) return toast('Неизвестное поле', user(p));
    const raw = str(p.input).trim();
    const value = raw === '-' && f !== 'username' ? null : raw;
    await api('PATCH', `/admin/users/${str(p.id)}`, { [f]: value });
    return toast('✅ Сохранено', user(p));
  },
  async 'user.role'({ p }) {
    const admin = p.role === 'ADMIN';
    return confirm(admin ? '👑 Сделать этот аккаунт администратором? Он получит полный доступ к админке.' : 'Снять с аккаунта права администратора?', admin ? '👑 Да, сделать' : 'Да, снять', 'user.roledo', p);
  },
  async 'user.roledo'({ api, p }) {
    await api('PATCH', `/admin/users/${str(p.id)}`, { role: p.role === 'ADMIN' ? 'ADMIN' : 'USER' });
    return toast('✅ Роль изменена', user(p));
  },

  async 'user.block'({ p }) {
    return ask('🚫 Причина блокировки (от 3 символов). Все сессии аккаунта закончатся, вещи скроются:', go('user.blockdo', p), user(p));
  },
  async 'user.blockdo'({ api, p }) {
    await api('POST', `/admin/users/${str(p.id)}/block`, { reason: str(p.input) });
    return toast('🚫 Заблокирован', user(p));
  },
  async 'user.unblock'({ p }) {
    return confirm('Разблокировать аккаунт? Вещи, скрытые блокировкой, вернутся в продажу.', '✅ Разблокировать', 'user.unblockdo', p);
  },
  async 'user.unblockdo'({ api, p }) {
    const r = await api<{ restored: number }>('POST', `/admin/users/${str(p.id)}/unblock`);
    return toast(`✅ Разблокирован, вернулось вещей: ${r.restored}`, user(p));
  },
  async 'user.hide'({ p }) {
    return confirm('🙈 Скрыть аккаунт с сайта? Профиль и вещи пропадут, владелец сможет входить, но не вернёт их сам.', '🙈 Скрыть', 'user.hidedo', p);
  },
  async 'user.hidedo'({ api, p }) {
    const r = await api<{ hidden: number }>('POST', `/admin/users/${str(p.id)}/hide-listings`);
    return toast(`🙈 Скрыт, вещей снято: ${r.hidden}`, user(p));
  },
  async 'user.show'({ p }) {
    return confirm('👁 Показать аккаунт снова? Вернутся вещи, которые скрыл админ.', '👁 Показать', 'user.showdo', p);
  },
  async 'user.showdo'({ api, p }) {
    const r = await api<{ shown: number }>('POST', `/admin/users/${str(p.id)}/show-listings`);
    return toast(`👁 Показан, вещей вернулось: ${r.shown}`, user(p));
  },

  async 'user.pass'({ p }) {
    return confirm('🔑 Задать новый случайный пароль? Старый перестанет работать, все сессии аккаунта закончатся. Пароль покажу один раз.', '🔑 Задать', 'user.passdo', p);
  },
  async 'user.passdo'({ api, p }) {
    const r = await api<{ login: string; password: string }>('POST', `/admin/users/${str(p.id)}/password`);
    // Shown once, under a spoiler; any next tap replaces this message, so the password doesn't stay in the chat.
    return {
      ...screen(
        `🔑 <b>Новый пароль</b>\n\nЛогин: <code>${h(r.login)}</code>\nПароль: <tg-spoiler><code>${h(r.password)}</code></tg-spoiler>\n\n<i>Передайте владельцу и нажмите «Готово» — сообщение заменится и пароль из чата исчезнет (само — через 2 минуты).</i>`,
        [[btn('✅ Готово', 'user', p)]],
      ),
      expireMs: 120_000,
    };
  },

  async 'user.del'({ p }) {
    return confirm('🗑 <b>Удалить аккаунт?</b>\n\nДанные сотрутся как при «Удалить мой аккаунт»: сделки и чаты останутся у другой стороны обезличенными. Отменить нельзя.', 'Дальше →', 'user.del2', p);
  },
  async 'user.del2'({ p }) {
    return confirm('⚠️ Точно удалить? Это последнее подтверждение.', '🗑 Да, удалить навсегда', 'user.deldo', p);
  },
  async 'user.deldo'({ api, p }) {
    await api('DELETE', `/admin/users/${str(p.id)}`);
    return toast('🗑 Аккаунт удалён', go('users', { tab: p.tab, q: p.q, page: p.page }), true);
  },

  async 'user.revoke'({ p }) {
    return ask(`Забрать статус ${p.kind === 'CATALOG' ? '«основной каталог»' : '«Бренд»'}? Напишите причину для журнала:`, go('user.revokedo', p), user(p), { skip: 'Без причины' });
  },
  async 'user.revokedo'({ api, p }) {
    await api('POST', `/admin/brand-applications/users/${str(p.id)}/revoke`, { note: str(p.input) || null, kind: p.kind === 'CATALOG' ? 'CATALOG' : 'BRAND' });
    return toast('✅ Статус снят', user(p));
  },
};
