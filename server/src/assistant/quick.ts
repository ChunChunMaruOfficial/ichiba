/**
 * The commonest requests, understood without a model: «подними пару вещей», «снизь цену всем на 5%». They are done
 * in a fraction of a second and work when no provider answers. Only whole, unambiguous phrases: anything with a word
 * this file doesn't know («на куртки», «кроме пальто») goes to the model as before.
 */
export interface QuickCall {
  tool: 'bump' | 'set_price';
  args: Record<string, unknown>;
}

const clean = (text: string) =>
  text
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[.!,]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const THINGS = '(?:вещи|вещей|вещам|вещь|позиции|позиций|позициям|товары|товаров|товарам|объявления|объявлений|объявлениям)';
const MY = '(?:мои|моих|моим|мое)';
const HOW_MANY: Record<string, number | undefined> = { пару: 2, несколько: 3, все: undefined, всех: undefined };

const BUMP = new RegExp(`^(?:подними|поднять|подыми|поднимите)(?: (пару|несколько|все|всех|\\d{1,3}))?(?: ${MY})?(?: ${THINGS})?$`);
const LOWER = '(?:снизь|снизить|снизьте|уменьши|уменьшить|скинь|сбрось|опусти)';
const RAISE = '(?:подними|поднять|повысь|повысить|увеличь|увеличить)';
// «всем», «на все вещи», «у всех моих позиций», «всем позициям»: said or left out, it means every item on sale.
const ALL = `(?: (?:на |у |для )?(?:все|всех|всем|всему)(?: ${MY})?(?: ${THINGS})?| (?:на |у )?${MY} ${THINGS}| ${THINGS})?`;
const AMOUNT = '(?: на)? (\\d{1,5})(?: ?(%|процент\\S*|руб\\S*|р|byn|бел\\S* руб\\S*))';
const PRICE = new RegExp(`^(${LOWER}|${RAISE}) (?:цену|цены)${ALL}${AMOUNT}${ALL}$`);

export function quick(text: string): QuickCall | null {
  const t = clean(text);
  const bump = BUMP.exec(t);
  // «Подними» alone is not a request; with «цену» it is the price, handled below.
  if (bump && t !== bump[0].split(' ')[0]) {
    const n = bump[1];
    const limit = n === undefined ? undefined : /^\d+$/.test(n) ? Number(n) : HOW_MANY[n];
    return { tool: 'bump', args: { filter: limit && limit >= 1 && limit <= 200 ? { limit } : {} } };
  }
  const price = PRICE.exec(t);
  if (price) {
    const down = new RegExp(`^${LOWER}$`).test(price[1]);
    const n = Number(price[2]);
    const percent = price[3].startsWith('%') || price[3].startsWith('процент');
    if (n < 1 || (percent && n > (down ? 90 : 300))) return null;
    return { tool: 'set_price', args: { filter: {}, mode: percent ? 'percent' : 'amount', value: down ? -n : n } };
  }
  return null;
}
