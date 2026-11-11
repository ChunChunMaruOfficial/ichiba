import type { PrismaService } from '../../prisma/prisma.service.js';
import { LOG_GROUPS, type LogGroup } from './activity-labels.js';
import { logPrefsOf, stateOf, type LogPrefs } from './access.js';
import type { Routes } from './ctx.js';
import { btn, menu, screen, str, toast, go, type Btn } from './ui.js';

const MODES: Array<[LogPrefs['mode'], string, string]> = [
  ['instant', '⚡️ Сразу', 'каждое изменение — не чаще одного сообщения в минуту'],
  ['hourly', '🕐 Раз в час', 'одна сводка за час'],
  ['off', '🔕 Выключить', 'журнал не присылается'],
];

/** 🔔 Journal notifications: how often, and which kinds of seller actions. Kept in User.tgAdmin.log. */
export function notifyRoutes(prisma: PrismaService): Routes {
  const read = async (id: string) => stateOf((await prisma.user.findUniqueOrThrow({ where: { id }, select: { tgAdmin: true } })).tgAdmin);
  const write = async (id: string, change: (p: LogPrefs) => LogPrefs) => {
    const s = await read(id);
    await prisma.user.update({ where: { id }, data: { tgAdmin: { ...s, log: change(logPrefsOf(s)) } as object } });
  };

  return {
    async notify({ admin }) {
      const prefs = logPrefsOf(await read(admin.id));
      const mode = MODES.find(([m]) => m === prefs.mode)!;
      const rows: Btn[][] = [MODES.map(([m, label]) => btn(m === prefs.mode ? `• ${label} •` : label, 'notify.mode', { mode: m }))];
      if (prefs.mode !== 'off') {
        for (const [g, def] of Object.entries(LOG_GROUPS)) rows.push([btn(`${prefs.off.includes(g as LogGroup) ? '⬜️' : '✅'} ${def.label}`, 'notify.group', { group: g })]);
      }
      rows.push([btn('📜 Открыть журнал', 'log'), menu()]);
      const text = [
        '🔔 <b>Уведомления журнала</b>',
        '',
        'Сюда приходят изменения в «Журнале» админки: что выставили, продали, изменили продавцы.',
        '',
        `Сейчас: <b>${mode[1]}</b> — ${mode[2]}.`,
        prefs.mode !== 'off' ? '\nКакие действия присылать:' : '',
      ].join('\n');
      return screen(text, rows);
    },
    async 'notify.mode'({ admin, p }) {
      const mode = MODES.find(([m]) => m === p.mode)?.[0] ?? 'instant';
      // The hourly digest counts from now, not from whenever it was last switched on.
      await write(admin.id, (prefs) => ({ ...prefs, mode, digestAt: mode === 'hourly' ? new Date().toISOString() : null }));
      return toast(mode === 'off' ? '🔕 Выключено' : '✅ Сохранено', go('notify'));
    },
    async 'notify.group'({ admin, p }) {
      const g = str(p.group) as LogGroup;
      if (!(g in LOG_GROUPS)) return toast('Нет такой группы', go('notify'));
      await write(admin.id, (prefs) => ({ ...prefs, off: prefs.off.includes(g) ? prefs.off.filter((x) => x !== g) : [...prefs.off, g] }));
      return toast('', go('notify'));
    },
  };
}
