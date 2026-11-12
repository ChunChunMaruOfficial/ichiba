import { TOPICS } from './knowledge.js';
import type { Button, Keyboard } from './types.js';

/** Fixed words of the chat: the greeting, the menu, the refusals. Nothing here needs a model. */
export const press = (id: string, label: string): Button => ({ id, label, kind: 'press' });

export const WELCOME =
  'Здравствуйте! Я Ichiba — помощник площадки. Напишите, что сделать, обычными словами: «подними пару моих вещей», «снизь цену на куртки на 10%», «скрой всё дороже 200», «что ждёт моего ответа?», «выключи уведомления о торге». Сделаю сам и покажу, что изменилось, — под каждым действием есть кнопка «Отменить».\n\nА ещё отвечу на вопросы о сделках, доставке и правилах.';

export const CAN =
  'Что я умею:\n· цены — поднять или снизить на процент, на сумму, поставить точную, сразу у многих вещей;\n· поднять вещи в ленте, скрыть и вернуть в продажу;\n· торг — включить, выключить, задать порог и автопринятие;\n· заявки и предложения цены — показать, принять, отклонить, отметить передачу;\n· статистика продаж за неделю или месяц;\n· настройки — город, размеры и мерки, скидка за комплект, вид карточек, уведомления;\n· избранное, корзина, подписки — почистить;\n· ответить на вопросы о площадке и принять предложение по её улучшению.\n\nЧто нельзя вернуть (продано, удаление, ответ покупателю), сначала переспрошу. Удаление аккаунта, выход и покупки — только вы сами, я дам ссылку.';

export const OFF_TOPIC = 'Я помогаю только с Ichiba: вещи, сделки, настройки и правила площадки. Спросите об этом — или выберите в меню.';
export const NOT_NOW = 'Сейчас не могу разобрать просьбу — попробуйте чуть позже. А пока вот что есть под рукой:';
export const BUSY = 'Я ещё выполняю вашу предыдущую просьбу — дождитесь ответа и напишите снова.';
export const NOTHING_TO_UNDO = 'Отменять нечего: за последние сутки я ничего не менял (или это уже отменено).';
/** Words that mean «show me the menu»: answered at once, no model asked. */
export const asksMenu = (text: string) => /^\s*(\/?(start|menu|help)|меню|помощь|помоги|что (ты|вы) умее(шь|те)\??|привет|здравствуй(те)?)\s*[.!?]*\s*$/i.test(text);

/** Plain «отмени»: undone at once, whether or not a model can be asked. */
export const asksUndo = (text: string) => /^\s*(нет[,.!\s]+)?(отмени(ть)?|отмена|верни(те)?( вс[её])? (как было|назад|обратно))( это| последнее( действие| изменение)?)?\s*[.!]*\s*$/i.test(text);

export const UNCLEAR = 'Не понял, что нужно сделать. Напишите подробнее — например, «снизь цену на джинсы на 10%».';
/** «через 40 сек», «через 12 мин», «через 3 ч»: rounded up, so the moment named is never too early. */
export function waitWords(ms: number) {
  const s = Math.max(1, Math.ceil(ms / 1000));
  if (s < 60) return `через ${s} сек`;
  if (s < 3600) return `через ${Math.ceil(s / 60)} мин`;
  return `через ${Math.ceil(s / 3600)} ч`;
}

/** The ready answer when a limit is reached: which one, and when to come back. */
export const limitReached = (what: string, waitMs: number) => `Вы достигли лимита: ${what}. Попробуйте ${waitWords(waitMs)}.`;
export const LIMITS = {
  minute: (n: number) => `не больше ${n} сообщений в минуту`,
  day: (n: number) => `не больше ${n} просьб в сутки`,
  hour: (n: number) => `не больше ${n} изменений в аккаунте за час`,
  busy: 'сейчас ко мне слишком много обращений',
};

/** Ready requests behind menu buttons: sent as if the person had typed them. */
export const PRESETS: Record<string, string> = {
  bump: 'Подними мои вещи, которые сейчас можно поднять',
  pending: 'Что сейчас ждёт моего ответа?',
  stats: 'Покажи статистику продаж за неделю',
};

export function menu(seller: boolean): Keyboard {
  return [
    [press('kb:can', 'Что вы умеете')],
    ...(seller ? [[press('say:bump', 'Поднять вещи'), press('say:pending', 'Что ждёт ответа')], [press('say:stats', 'Статистика за неделю')]] : []),
    [press('kb:deal', 'Как проходит сделка'), press('kb:delivery', 'Доставка')],
    [press('kb:returns', 'Возврат и споры'), press('kb:selling', 'Как продавать')],
    [press('suggest', 'Предложить улучшение')],
  ];
}

/** The text behind a `kb:` button. */
export const answerOf = (id: string) => (id === 'can' ? { title: 'Что вы умеете', text: CAN, links: [] as string[] } : (TOPICS.find((t) => t.id === id) ?? null));
