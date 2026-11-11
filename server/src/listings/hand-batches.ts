import type { ListingInputT } from './listings.dto.js';

/**
 * Items the owner hands over to list for a seller (photos in seed-data/<folder>, rotated and sized by hand): listed
 * once after a deploy, never twice — an item whose title the seller has ever had (even deleted) is skipped.
 * A batch with `account` makes the seller's account first if there is none. It has no address: the seller signs in
 * with nick and password, the password's bcrypt hash coming from HAND_PASSWORD_HASHES='{"nick":"$2b$10$…"}' (kept out
 * of the public repository, like TG_PASSWORD_HASHES) and set only while the account has none.
 * `account.brandName` makes it a verified brand (its new items go to the catalogue) and `account.logo`, a square image
 * in the batch's folder, becomes its profile photo while it has none. `account.catalog` (with a brand name) puts every
 * item the seller has in the catalogue, worn ones too, the way an admin places an item by hand: the owner wants these
 * resellers on the home page next to the brands rather than among the wardrobes of «Вторичка».
 */
export interface HandItem {
  photos: string[];
  /**
   * The photos were handed over again (a composite cut into front and back): they replace the listing's own while it
   * still holds exactly this many (the old set), so it happens once and a seller who added photos is left alone.
   */
  replacePhotos?: number;
  /**
   * The photo (one of `photos`) that is the cover: the thing laid flat, never the one on a person. A new listing gets it
   * first; a live one is given it as cover, found among its photos by the difference hash, once.
   */
  cover?: string;
  /**
   * The description was corrected after the item was listed (a channel's star lines, a batch text that spoke of seven
   * shirts): a live listing whose description differs is given this one. The same afterwards, so it happens once per
   * correction; a sold item keeps its text.
   */
  retext?: true;
  input: Omit<ListingInputT, 'photos'>;
}

/**
 * Accounts this import made and the owner later wanted as one: everything `from` listed moves to `into` and the
 * `from` account is deleted (hand-listings.ts does it once, before the batches; a merge whose `from` is gone is a no-op).
 */
export const MERGES: Array<{ from: string; into: string }> = [
  { from: 'balconysection', into: 'psysectiony' },
  { from: 'worldvtg', into: 'sss1lv3r' },
];

export const BATCHES: Array<{ username: string; folder: string; account?: { bio: string; brandName?: string; logo?: string; catalog?: boolean }; items: HandItem[] }> = [
  {
    // 2026-10-15, «Вторичка», sizes and prices exactly as the owner gave them.
    username: 'bodrowa2007',
    folder: 'bodrowa',
    items: [
      {
        photos: ['1-1.jpg', '1-2.jpg'],
        input: {
          title: 'Красная майка Esprit с принтом',
          category: 'tshirts', subcategory: 'tank', sizeSystem: 'OTHER', sizeValue: 'US L', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: 'Esprit', color: 'red', gender: 'FEMALE',
          description: 'Красная майка Esprit с V-вырезом, на груди серебристый принт с крыльями и стразами. Размер US L.',
        },
      },
      {
        photos: ['2-1.jpg', '2-2.jpg'],
        input: {
          title: 'Белая рубашка с красными лампасами',
          category: 'shirts', subcategory: 'shirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 40,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: null,
          description: 'Белая хлопковая рубашка свободного кроя, по рукавам красно-чёрные лампасы. Размер L.',
        },
      },
      {
        photos: ['3-1.jpg', '3-2.jpg'],
        input: {
          title: 'Брюки-карго Bershka',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'OTHER', sizeValue: 'EUR 34', price: 35,
          condition: 'VISIBLE_WEAR', defectsPresent: true, defectsDescription: 'Светлые пятна на штанинах — видно на фото.',
          brand: 'Bershka', color: 'green', gender: null,
          description: 'Брюки-карго Bershka цвета хаки, прямые, с накладными карманами на штанинах. Размер EUR 34.',
        },
      },
      {
        photos: ['4-1.jpg', '4-2.jpg'],
        input: {
          title: 'Укороченный свитшот-поло Bershka «California»',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'OTHER', sizeValue: 'USA S', price: 35,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'brown', gender: 'FEMALE',
          description: 'Укороченный свитшот с воротником-поло: коричневый с бежевой полосой, вышивка «California», низ на резинке. Размер USA S.',
        },
      },
      {
        photos: ['5-1.jpg', '5-2.jpg'],
        input: {
          title: 'Футболка Bershka × Evangelion «Рей Аянами»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'EUR S', price: 70,
          condition: 'VISIBLE_WEAR', defectsPresent: true, defectsDescription: 'Есть дырочки, залатаны булавками.',
          brand: 'Bershka', color: 'black', gender: null,
          description: 'Старая лимитированная коллекция Bershka × Evangelion: Рей Аянами спереди, надпись на японском на спине. Размер EUR S.',
        },
      },
      {
        photos: ['6-1.jpg', '6-2.jpg'],
        input: {
          title: 'Юбка в клетку с аппликацией «Do you want play with me?»',
          category: 'skirts', subcategory: 'pleated', sizeSystem: 'OTHER', sizeValue: '38', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'green', gender: 'FEMALE',
          description: 'Клетчатая юбка со складками по бокам, по центру зелёная вставка с аппликацией, вышивкой и люверсами. Размер 38.',
        },
      },
      {
        photos: ['7-1.jpg', '7-2.jpg'],
        input: {
          title: 'Жёлтая футболка The Velvet Underground',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'S', price: 20,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'yellow', gender: null,
          description: 'Жёлтая футболка с принтом The Velvet Underground. Размер S.',
        },
      },
    ],
  },
  {
    // 2026-10-22, «Вторичка»: a new account; sizes and prices as the owner gave them.
    username: 'винтшмот',
    folder: 'vintshmot',
    account: { bio: 'Винтажные вещи из Минска: футболки и майки известных марок.' },
    items: [
      {
        photos: ['1-1.jpg', '1-2.jpg'],
        input: {
          title: 'Синяя футболка Hilfiger Denim',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: 'Tommy Hilfiger', color: 'blue', gender: null, material: 'Хлопок',
          description: 'Синяя хлопковая футболка Hilfiger Denim с V-вырезом и вышитым флажком на груди. Размер M.',
        },
      },
      {
        photos: ['2-1.jpg', '2-2.jpg'],
        input: {
          title: 'Голубая футболка Fishbone с флагом',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: 'Fishbone', color: 'lightblue', gender: 'FEMALE',
          description: 'Приталенная бирюзово-голубая футболка Fishbone с принтом американского флага и звездой из пайеток. Размер XS.',
        },
      },
      {
        photos: ['3-1.jpg', '3-2.jpg'],
        input: {
          title: 'Красная майка «Festival of Light»',
          category: 'tshirts', subcategory: 'tank', sizeSystem: 'ALPHA', sizeValue: 'S', price: 5,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'red', gender: 'FEMALE',
          description: 'Красная майка без рукавов с серебристым принтом «Festival of Light» и стразами у выреза. Размер S.',
        },
      },
    ],
  },
  {
    // 2026-10-22, «Вторичка»: a new account; sizes and prices as the owner gave them.
    username: 'second_minsk',
    folder: 'second_minsk',
    account: { bio: 'Секонд в Минске: базовые вещи Zara, H&M, Bershka по доступным ценам.' },
    items: [
      {
        photos: ['1-1.jpg'],
        input: {
          title: 'Лонгслив цвета хаки',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'S', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'green', gender: 'FEMALE',
          description: 'Облегающий лонгслив цвета хаки с круглым вырезом. Размер S.',
        },
      },
      {
        photos: ['2-1.jpg'],
        input: {
          title: 'Укороченная футболка оливковая',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'S', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'green', gender: 'FEMALE',
          description: 'Укороченная футболка-топ оливкового цвета в рубчик. Размер S.',
        },
      },
      {
        photos: ['3-1.jpg'],
        input: {
          title: 'Сатиновый бомбер пудрового цвета',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 35,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'pink', gender: null,
          description: 'Сатиновый бомбер пудрово-розового цвета на молнии, чёрный трикотажный воротник, манжеты и низ на резинке. Размер XS.',
        },
      },
      {
        photos: ['4-1.jpg'],
        input: {
          title: 'Вязаный жилет H&M с полосками',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'S', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: 'H&M', color: 'white', gender: 'FEMALE', material: 'Трикотаж',
          description: 'Молочный вязаный жилет H&M с V-вырезом и чёрными полосками по краю — в стиле preppy. Размер S.',
        },
      },
      {
        photos: ['5-1.jpg'],
        input: {
          title: 'Клетчатая рубашка H&M',
          category: 'shirts', subcategory: 'shirt', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: 'H&M', color: 'black', gender: null,
          description: 'Чёрно-белая рубашка H&M в крупную клетку, свободный крой, нагрудный карман. Размер XS.',
        },
      },
      {
        photos: ['6-1.jpg'],
        input: {
          title: 'Дутая куртка Zara из экокожи',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'M', price: 90,
          condition: 'GOOD', defectsPresent: false, brand: 'Zara', color: 'black', gender: null, material: 'Экокожа',
          description: 'Чёрная стёганая куртка Zara из экокожи с капюшоном, на молнии. Тёплая, объёмная. Размер M.',
        },
      },
      {
        photos: ['7-1.jpg'],
        input: {
          title: 'Светлые брюки-карго Bershka',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 35,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'lightblue', gender: 'FEMALE', material: 'Деним',
          description: 'Светло-голубые прямые брюки-карго Bershka из денима с накладными карманами. Размер 32 (XS).',
        },
      },
      {
        photos: ['8-1.jpg'],
        input: {
          title: 'Коричневая футболка',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'S', price: 20,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'brown', gender: null, material: 'Хлопок',
          description: 'Базовая хлопковая футболка шоколадного цвета прямого кроя. Размер S.',
        },
      },
      {
        photos: ['9-1.jpg'],
        input: {
          title: 'Чёрная футболка Zara',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: 'Zara', color: 'black', gender: null, material: 'Хлопок',
          description: 'Базовая чёрная футболка Zara из плотного хлопка. Размер M.',
        },
      },
      {
        photos: ['10-1.jpg'],
        input: {
          title: 'Широкие джинсы Bershka графитовые',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 50,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'gray', gender: 'FEMALE', material: 'Деним',
          description: 'Графитовые широкие джинсы Bershka с эффектом потёртости, высокая посадка. Размер 32 (XS).',
        },
      },
      {
        photos: ['11-1.jpg'],
        input: {
          title: 'Серый лонгслив на пуговицах',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'S', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'gray', gender: 'FEMALE',
          description: 'Укороченный тёмно-серый лонгслив в рубчик на пуговицах, облегающий. Размер S.',
        },
      },
      {
        photos: ['12-1.jpg'],
        input: {
          title: 'Топ на широких бретелях терракотовый',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'S', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'brown', gender: 'FEMALE',
          description: 'Терракотовый топ в рубчик на широких бретелях с прямым вырезом. Размер S.',
        },
      },
      {
        photos: ['13-1.jpg', '13-2.jpg'],
        input: {
          title: 'Лонгслив тай-дай со смайликами',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'multi', gender: null, styleTags: ['Streetwear'],
          description: 'Свободный лонгслив с принтом тай-дай, неоновые смайлики на рукавах и надпись на спине. Размер XS.',
        },
      },
      {
        photos: ['14-1.jpg'],
        input: {
          title: 'Чёрные спортивные штаны Bershka',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'black', gender: 'FEMALE', styleTags: ['Sport'],
          description: 'Чёрные спортивные штаны Bershka на резинке с завязками, манжеты внизу. Размер XS.',
        },
      },
    ],
  },
  {
    // 2026-10-22, «Вторичка»: a new account; sizes and prices as the owner gave them.
    username: 'find_store',
    folder: 'find_store',
    account: { bio: 'Находки из Минска: оригинальные вещи и винтаж в отличном состоянии.' },
    items: [
      {
        photos: ['1-1.jpg', '1-2.jpg'],
        input: {
          title: 'Футболка Abercrombie & Fitch с вышивкой',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'S', price: 35,
          condition: 'LIKE_NEW', defectsPresent: false, brand: 'Abercrombie & Fitch', color: 'pink', gender: 'FEMALE', material: 'Хлопок',
          description: 'Оригинал. Розовая футболка Abercrombie & Fitch из 100% хлопка, вышивка A&F и лось с датой 1892. В отличном состоянии. Размер S–XS.',
        },
      },
      {
        photos: ['2-1.jpg'],
        input: {
          title: 'Чёрные брюки-клёш New Yorker',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: 'New Yorker', color: 'black', gender: 'FEMALE',
          description: 'Чёрные брюки-клёш с широким эластичным поясом. Удлинённые, хорошо сидят на бёдрах. Размер XS–XXS, может подойти на S — хорошо тянутся.',
        },
      },
      {
        photos: ['3-1.jpg', '3-2.jpg'],
        input: {
          title: 'Светло-голубые джинсы, новые',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'ALPHA', sizeValue: 'S', price: 25,
          condition: 'NEW_WITH_TAGS', hasTags: false, defectsPresent: false, brand: null, color: 'lightblue', gender: 'FEMALE', material: 'Деним',
          description: 'Новые светло-голубые джинсы, не носились. Размер S.',
        },
      },
      {
        photos: ['4-1.jpg', '4-2.jpg', '4-3.jpg'],
        input: {
          title: 'Розовая олимпийка с золотой молнией',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 20,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'pink', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Розовая спортивная кофта на молнии с высоким воротом и золотистой фурнитурой. Гербовая нашивка со стразами. Размер уточняйте.',
        },
      },
      {
        photos: ['5-1.jpg', '5-2.jpg'],
        input: {
          title: 'Бордовый лонгслив Amisu',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'S', price: 20,
          condition: 'GOOD', defectsPresent: false, brand: 'Amisu', color: 'red', gender: 'FEMALE', material: 'Трикотаж',
          description: 'Бордовый лонгслив Amisu (линейка New Yorker): тонкий трикотаж, облегающий крой. Размер S–XS.',
        },
      },
      {
        photos: ['6-1.jpg'],
        input: {
          title: 'Винтажная велюровая кофта-безрукавка Froggy',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'S', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: 'Froggy', color: 'lightblue', gender: 'FEMALE', styleTags: ['Vintage', 'Y2K'],
          description: 'Винтажная велюровая кофта Froggy на молнии с капюшоном и короткими рукавами. Размер S.',
        },
      },
      {
        photos: ['7-1.jpg', '7-2.jpg'],
        input: {
          title: 'Голубая велюровая кофта с сердцем из страз',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'S', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'lightblue', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Голубая кофта на молнии из мягкого велюра с капюшоном, отделка атласными лентами, сердце из страз. Размер S.',
        },
      },
      {
        photos: ['8-1.jpg', '8-2.jpg'],
        input: {
          title: 'Брюки Freeman T. Porter хаки',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'ALPHA', sizeValue: 'S', price: 15,
          condition: 'GOOD', defectsPresent: false, brand: 'Freeman T. Porter', color: 'green', gender: 'FEMALE',
          description: 'Оригинал. Брюки Freeman T. Porter цвета хаки — известный европейский производитель джинсовой одежды. Размер S–XS.',
        },
      },
      {
        photos: ['9-1.jpg', '9-2.jpg'],
        input: {
          title: 'Тёмно-синее велюровое худи на молнии',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'S', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'blue', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Тёмно-синее худи из мягкого велюра с капюшоном, на молнии. Размер S.',
        },
      },
    ],
  },
  {
    // 2026-10-22, «Вторичка»: a new account; sizes and prices as the owner gave them.
    username: 'clothesminsko',
    folder: 'clothesminsko',
    account: { bio: 'Одежда из Минска: джинсы-клёш, топы и кофты Bershka, New Yorker и не только.' },
    items: [
      {
        photos: ['1-1.jpg', '1-2.jpg'],
        input: {
          title: 'Джинсы-клёш с вышитыми карманами',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XXS', price: 75,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K'],
          description: 'Тёмные джинсы-клёш с эффектом потёртости и белой вышивкой на задних карманах. Размер XXS.',
        },
      },
      {
        photos: ['2-1.jpg', '2-2.jpg'],
        input: {
          title: 'Чёрные джинсы-клёш Bershka',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 70,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'black', gender: 'FEMALE', material: 'Деним',
          description: 'Чёрные джинсы-клёш Bershka, карманы с клапанами сзади. Размер 32 (XS).',
        },
      },
      {
        photos: ['3-1.jpg'],
        input: {
          title: 'Голубые джинсы-клёш Bershka с низкой посадкой',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 69,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'lightblue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K'],
          description: 'Голубые джинсы-клёш Bershka с низкой посадкой и эффектом потёртости. Размер 32 (XS).',
        },
      },
      {
        photos: ['4-1.jpg'],
        input: {
          title: 'Светлые широкие джинсы из «Акулы»',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'lightblue', gender: 'FEMALE', material: 'Деним',
          description: 'Светлые широкие джинсы с потёртостями, из магазина «Акула». Размер уточняйте.',
        },
      },
      {
        photos: ['5-1.jpg'],
        input: {
          title: 'Чёрные багги джинсы',
          category: 'jeans', subcategory: 'baggy', sizeSystem: 'ALPHA', sizeValue: 'XXS', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', material: 'Деним', styleTags: ['Streetwear'],
          description: 'Чёрные багги джинсы с эффектом потёртости и необработанным низом. Размер XXS.',
        },
      },
      {
        photos: ['6-1.jpg'],
        input: {
          title: 'Голубые широкие джинсы с необработанным краем',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'ALPHA', sizeValue: 'M', price: 75,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'lightblue', gender: 'FEMALE', material: 'Деним',
          description: 'Светло-голубые широкие джинсы с потёртостями и необработанным краем. Размер M–L.',
        },
      },
      {
        photos: ['7-1.jpg'],
        input: {
          title: 'Чёрная кофточка с белой окантовкой',
          category: 'knitwear', subcategory: 'cardigan', sizeSystem: 'ALPHA', sizeValue: 'M', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', material: 'Трикотаж',
          description: 'Чёрная трикотажная кофточка в рубчик на пуговицах с контрастной белой окантовкой. Размер M.',
        },
      },
      {
        photos: ['8-1.jpg'],
        input: {
          title: 'Белая кофта',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE',
          description: 'Белая кофта-лонгслив из мягкого трикотажа. Размер уточняйте.',
        },
      },
      {
        photos: ['9-1.jpg'],
        input: {
          title: 'Серый топ с кружевом',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'XXS', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'gray', gender: 'FEMALE',
          description: 'Серый топ на бретелях с кружевной отделкой и пуговками. Размер XXS–XS–S.',
        },
      },
      {
        photos: ['10-1.jpg'],
        input: {
          title: 'Серый вязаный свитер Bershka',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 65,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'gray', gender: 'FEMALE', material: 'Трикотаж',
          description: 'Серый свитер Bershka с V-вырезом и узором «косы», вышивка на груди. Размер уточняйте.',
        },
      },
      {
        photos: ['11-1.jpg'],
        input: {
          title: 'Белая кофта с тремя полосками',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'S', price: 35,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE', styleTags: ['Sport'],
          description: 'Белая кофта с тремя чёрными полосками на рукавах, с Wildberries. Подойдёт на XS–S–M.',
        },
      },
      {
        photos: ['12-1.jpg'],
        input: {
          title: 'Молочный свитер',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 45,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE', material: 'Трикотаж',
          description: 'Мягкий вязаный свитер молочного цвета. Размер XS.',
        },
      },
      {
        photos: ['13-1.jpg'],
        input: {
          title: 'Футбольная майка «Ballet Football 07»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 20,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', material: 'Полиэстер', styleTags: ['Streetwear'],
          description: 'Чёрная футбольная майка с розовым номером 07 и надписью «Ballet Football», синтетика, с Wildberries. Размер уточняйте.',
        },
      },
      {
        photos: ['14-1.jpg'],
        input: {
          title: 'Серый свитшот New Yorker «Athletic»',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 35,
          condition: 'GOOD', defectsPresent: false, brand: 'New Yorker', color: 'gray', gender: 'FEMALE',
          description: 'Серый свитшот New Yorker с надписью «Athletic» и медвежонком. Размер XS.',
        },
      },
      {
        photos: ['15-1.jpg'],
        input: {
          title: 'Белая приталенная рубашка',
          category: 'shirts', subcategory: 'shirt', sizeSystem: 'ALPHA', sizeValue: 'S', price: 65,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE',
          description: 'Белая приталенная рубашка с отложным воротником. Размер S–M.',
        },
      },
      {
        photos: ['16-1.jpg'],
        input: {
          title: 'Бежевая кофта Bershka',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 30,
          condition: 'GOOD', defectsPresent: false, brand: 'Bershka', color: 'beige', gender: null,
          description: 'Бежевая кофта-свитшот Bershka свободного кроя. Размер L–XL.',
        },
      },
      {
        photos: ['17-1.jpg'],
        input: {
          title: 'Белая майка с короткими рукавами',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE',
          description: 'Белая укороченная майка с короткими рукавами. Размер L.',
        },
      },
      {
        photos: ['18-1.jpg'],
        input: {
          title: 'Топ-бандо в полоску',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'S', price: 10,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: 'FEMALE',
          description: 'Белый топ-бандо в чёрную полоску, в рубчик. Размер S–M.',
        },
      },
      {
        photos: ['19-1.jpg'],
        input: {
          title: 'Два спортивных топа, чёрный и серый',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'XS', price: 5,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', styleTags: ['Sport'],
          description: 'Два спортивных топа — чёрный и серый, размер XS. Цена за оба.',
        },
      },
      {
        photos: ['20-1.jpg'],
        input: {
          title: 'Розовый топ в рубчик на бретелях',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'S', price: 15,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'pink', gender: 'FEMALE',
          description: 'Розовый топ в рубчик на тонких бретелях. Размер S–M.',
        },
      },
      {
        photos: ['21-1.jpg'],
        input: {
          title: 'Нежно-розовый топ с кружевом',
          category: 'tshirts', subcategory: 'top', sizeSystem: 'ALPHA', sizeValue: 'S', price: 25,
          condition: 'GOOD', defectsPresent: false, brand: null, color: 'pink', gender: 'FEMALE',
          description: 'Нежно-розовый топ на бретелях с кружевной отделкой по вырезу. Размер S–M.',
        },
      },
    ],
  },
  {
    // 2026-10-24, a brand (vandal.era, streetwear from Grodno, t.me/vandal_era): new items in two sizes each, logo from
    // the channel. The nick follows the channel: a dot isn't allowed in nicks.
    username: 'vandal_era',
    folder: 'vandal_era',
    account: { bio: 'vandal.era — streetwear-бренд из Гродно.', brandName: 'vandal.era', logo: 'logo.jpg' },
    items: [
      {
        // 2026-11-06: the composite photo cut into front and back, replacing the one the live listing had.
        photos: ['1-1.jpg', '1-2.jpg'],
        replacePhotos: 1,
        input: {
          title: 'Шорты vandal.era «Camo blade»',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'M', sizes: ['M', 'L'], price: 87,
          condition: 'NEW_WITH_TAGS', hasTags: true, defectsPresent: false, brand: 'vandal.era', color: 'gray', gender: null,
          material: 'Хлопок', styleTags: ['Streetwear'], labels: ['new'],
          description: 'Серые трикотажные шорты vandal.era «Camo blade»: камуфляжные вставки-лезвия спереди и сзади, пояс на резинке со шнурком, необработанный низ. Размеры M и L.',
        },
      },
      {
        photos: ['2-1.jpg', '2-2.jpg'],
        replacePhotos: 1,
        input: {
          title: 'Джинсы vandal.era «School pants»',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'ALPHA', sizeValue: 'M', sizes: ['M', 'L'], price: 86,
          condition: 'NEW_WITH_TAGS', hasTags: true, defectsPresent: false, brand: 'vandal.era', color: 'black', gender: null,
          material: 'Деним', styleTags: ['Streetwear'], labels: ['new'],
          description: 'Чёрные широкие джинсы vandal.era «School pants» с вышивкой у кармана. Размеры M и L.',
        },
      },
    ],
  },
  {
    // 2026-11-02, a brand (HEGEMONY, Minsk, t.me/hegemonytg): an empty account for now, the name, the logo from the
    // channel and the brand status; items come later.
    username: 'hegemony',
    folder: 'hegemony',
    account: { bio: 'HEGEMONY — бренд одежды из Минска. Доставка по всему миру, заказ в Telegram: @hegemonymng.', brandName: 'HEGEMONY', logo: 'logo.jpg' },
    items: [],
  },
  {
    // 2026-11-05, «Вторичка»: a reseller of a personal wardrobe and vintage (t.me/sss1lv3r, the owner's second channel is
    // t.me/worldvtg; what is in stock sits in t.me/sss1lv3r_items). Every item of the stock channel on 2026-11-05 except
    // one already marked sold in the main channel; ₽ prices at 29 ₽/BYN rounded to 5 (the owner's own byn/₽ pairs use
    // 28–29); photos and wording from the posts, condition as the owner states it. Since 2026-11-07 the items of the
    // owner's second channel world.vtg (t.me/worldvtg: post ids 789–1415, the ones not in the stock channel) are in this
    // batch too: the owner wanted one account, so @worldvtg was merged into @sss1lv3r (MERGES) and its photos moved here.
    username: 'sss1lv3r',
    folder: 'sss1lv3r',
    // 2026-11-05 evening: the owner wants these three on the home page with the brands, so each is a brand with all of
    // its items in the catalogue (`catalog`), worn as they are.
    account: { bio: 'sss1lv3r — продажа личного гардероба: винтаж, кожа, деним, архивные вещи. Возврата нет.', brandName: 'sss1lv3r', logo: 'logo.jpg', catalog: true },
    items: [
      {
        cover: '2062-1.jpg',
        photos: ['2062-0.jpg', '2062-1.jpg', '2062-2.jpg', '2062-3.jpg'],
        input: {
          title: 'Чёрные лаковые туфли Mary Jane на каблуке',
          category: 'shoes', subcategory: 'shoes', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 140,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'На одном каблуке нужно поставить набойку.',
          brand: null, color: 'black', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 38 (стелька 24–24,5 см).\nПара лаковых черных туфель на устойчивом широком каблуке в стиле Mary Jane. Верх глянцевая кожа глубокого черного цвета, носок квадратный с декоративной металлической накладкой. Ремешок через подъём с регулируемой пряжкой, внутренняя подкладка бежевого оттенка. Каблук средней высоты, прочный и удобный для повседневной носки. Требуется на одном каблуке вставить протектор.',
        },
      },
      {
        cover: '2098-3.jpg',
        photos: ['2098-0.jpg', '2098-1.jpg', '2098-2.jpg', '2098-3.jpg', '2098-4.jpg', '2098-5.jpg', '2098-6.jpg'],
        input: {
          title: 'Кожаные ботинки Michael Kors',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Michael Kors', color: 'black', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 38 (стелька 23,5 см).\nУнисекс ботинки из гладкой натуральной кожи чёрного цвета. Лаконичный силуэт с округлым носком и плотной, прошитой подошвой. Низкий каблук даёт хорошую устойчивость и комфорт при длительной носке. По щиколотке оформлены декоративным ремешком и металлической фурнитурой. Отличный вариант для повседневной носки.',
        },
      },
      {
        photos: ['2935-0.jpg', '2935-1.jpg', '2935-2.jpg', '2935-3.jpg', '2935-4.jpg'],
        retext: true,
        input: {
          title: 'Кожаные ботильоны A.S.98 на каблуке',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 310,
          condition: 'GOOD', defectsPresent: false,
          brand: 'A.S.98', color: 'brown', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 38.\nШикарный силуэт. Натуральная кожа высшего качества, цвет какао/шоколад. Огромные, выразительные зипы сзади / брендированные, Италия. Деревянный каблук, в меру высокий. Внутри отделка вся под кожу, максимально все круто и удобно.',
        },
      },
      {
        photos: ['3111-0.jpg', '3111-1.jpg', '3111-2.jpg', '3111-3.jpg', '3111-4.jpg', '3111-5.jpg', '3111-6.jpg'],
        retext: true,
        input: {
          title: 'Кожаные ботинки Bugatti с пряжкой',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Bugatti', color: 'gray', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 42 (стелька 27 см).\nМашина среди обуви.\nКомбинированная натуральная кожа, тактильно приятная. Толстая качественная молния YKK для удобного надевания. Искусственные складки на части носка. Множество элементов с которых не отвести взгляд.',
        },
      },
      {
        photos: ['3310-0.jpg', '3310-1.jpg', '3310-2.jpg', '3310-3.jpg', '3310-4.jpg'],
        input: {
          title: 'Укороченное двубортное пальто (Япония)',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: XL (сидит универсально).\nЧерное укороченное пальто. Двойной грудной крой на крупных пуговицах, высокий стоячий воротник. Длинные рукава с декоративными манжетами и застёжками на пуговицы, слегка свободный силуэт с опущенной линией плеч. Матовая плотная ткань хорошо держащая форму. Усиленная набивка в плечах.\nЗамеры: длина 66 см, ширина 51 см, рукав 64 см.',
        },
      },
      {
        cover: '3436-1.jpg',
        photos: ['3436-0.jpg', '3436-1.jpg', '3436-2.jpg', '3436-3.jpg', '3436-4.jpg', '3436-5.jpg', '3436-6.jpg'],
        retext: true,
        input: {
          title: 'Винтажная кожаная куртка с эффектом патины',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 415,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительные нюансы для такой вещи — уточняйте у продавца.',
          brand: null, color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nНастоящий винтаж в мире кожаных курток. Имеет уникальные царапины и потертости, что делает ее аутентичной и не похожей на другие. Потрясающий цвет который выделит вас из толпы. Незначительные нюансы для такой вещи, уточняйте.\nЗамеры: длина 71 см, плечи 57 см, ширина 64 см, рукав 81 см.',
        },
      },
      {
        photos: ['3518-0.jpg', '3518-1.jpg', '3518-2.jpg', '3518-3.jpg', '3518-4.jpg'],
        input: {
          title: 'Кожаные ботинки Steve Madden с ремнями',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 195,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Steve Madden', color: 'black', gender: 'FEMALE', material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 39 (стелька 24 см).\nКожаные ботинки средней высоты с немного грубой фактурой кожи и прочной рельефной подошвой. Модель оформлена декоративными и функциональными ремнями с металлическими пряжками один фиксирует голеностоп, второй охватывает голень. Носок округлый, подошва массивная, с небольшим каблуком, что придаёт устойчивость. Есть множество вариантов носки.',
        },
      },
      {
        photos: ['3523-0.jpg', '3523-1.jpg', '3523-2.jpg', '3523-3.jpg', '3523-4.jpg', '3523-5.jpg', '3523-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы straight из плотного вощёного денима',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x34.\nОтдаю свои джинсы в добрые руки.\nШикарный низ, джинса высочайшей плотности — лёгкого вощения. Качественная фурнитура, латунь. Один из шикарных фитов straight/slim. Потрясающий цвет — темный асфальт с умеренным выцветанием. Лаконичный дистресс по всему периметру.\nЗамеры: длина 109 см, полупояс 41.5 см, выход 23 см.',
        },
      },
      {
        photos: ['3581-0.jpg', '3581-1.jpg', '3581-2.jpg', '3581-3.jpg', '3581-4.jpg', '3581-5.jpg', '3581-6.jpg'],
        input: {
          title: 'Джинсовая мотокуртка приталенная',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 140,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nКороткая приталенная куртка из тёмно‑серого плотного денима, с лёгким процентом эластана, для более узнаваемой мото-посадки. Имеет высокий стоячий воротник с декоративным ремешком и металлической пряжкой, центральную металлическую молнию и пояс с пряжкой в талии. Линии рельефных швов создают облегающий силуэт, на рукавах — поперечные прострочки в области локтя для текстуры и подвижности. Края рукавов чуть расширены, ткань с лёгким винтажным эффектом выцветания, фурнитура — серебристого металла. Идеально подойдет на каждый день.\nЗамеры: длина 55 см, ширина 46 см, рукав от плеча 63 см.',
        },
      },
      {
        photos: ['3625-0.jpg', '3625-1.jpg'],
        input: {
          title: 'Хлопковая сумка-тоут Roen by Hiromu Takahara',
          category: 'bags', subcategory: 'tote', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Roen', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Шикарная сумка из плотного хлопка. Качественный вечный принт. Редкая позиция в наших краях.',
        },
      },
      {
        photos: ['3894-0.jpg', '3894-1.jpg'],
        input: {
          title: 'Винтажная джинсовая куртка washed',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nОтрываю от сердца, мой любимый. Шикарные материалы и посадка; 100% канвас, вся фурнитура сталь. Нереально крутая, в меру объемная посадка. Идеальные фейды и лаконичный дистресс.\nЗамеры: длина 69 см, ширина 59 см, рукав 82 см.',
        },
      },
      {
        photos: ['3899-0.jpg', '3899-1.jpg', '3899-2.jpg', '3899-3.jpg', '3899-4.jpg', '3899-5.jpg', '3899-6.jpg'],
        input: {
          title: 'Джинсовая куртка Levi’s Engineered',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 165,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Levi’s', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nКультовая вещь, объединяющая винтажную эстетику и инновационный анатомический крой.\nПерекрученные боковые швы и анатомические вытачки повторяют естественные изгибы тела. Плотный хлопок, дополнен лиоцеллом для мягкости, для той самой эластичности. Вся фурнитура из стали, качественная с фирменными гравировками. Свободный, слегка укороченный силуэт.\nЗамеры: длина 71 см, длина по спине 61 см, ширина 57 см, рукав 65 см.',
        },
      },
      {
        photos: ['3943-0.jpg', '3943-1.jpg', '3943-2.jpg', '3943-3.jpg', '3943-4.jpg', '3943-5.jpg', '3943-6.jpg'],
        input: {
          title: 'Джинсы Dolce & Gabbana washed (90-е)',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'IT 44', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 44.\nЭстетика 90-х и безупречный крой от итальянского дома моды. Свободная посадка, которая визуально удлиняет ноги, актуальный объем.\nAged washed эффект легкой потертости. Фирменный железный патч с логотипом DG на заднем кармане — узнаваемая деталь, говорящая сама за себя.\nЗамеры: длина 107 см, полупояс 40 см, выход 19 см.',
        },
      },
      {
        photos: ['3957-0.jpg', '3957-1.jpg', '3957-2.jpg', '3957-3.jpg', '3957-4.jpg', '3957-5.jpg', '3957-6.jpg'],
        input: {
          title: 'Джинсы Miss Sixty tie-dye',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W28', price: 125,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Miss Sixty', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 28.\nРедкий деним от итальянского бренда miss sixty. Выразительный окрас тай-дай. Прямой крой с лёгким клешением за счёт посадки, имеют акцентированные необработанные края штанин. На передней части имеются карманы, застежка на пуговицу и металлические заклепки. Джинсы сделаны из плотного денима, приятные к телу.\nЗамеры: длина 100 см, полупояс 37 см, выход 20 см.',
        },
      },
      {
        photos: ['3965-0.jpg', '3965-1.jpg', '3965-2.jpg', '3965-3.jpg', '3965-4.jpg', '3965-5.jpg', '3965-6.jpg'],
        input: {
          title: 'Винтажные джинсы Lee Cooper washed',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 165,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Lee Cooper', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 34/34.\nВинтажная пара от Lee, максимально правильный винтажный деним с красивой свободной посадкой и relaxed/straight силуэтом, слегка уходящим в wide leg.\nПлотный, но комфортный Denim в потрясающем светло-голубом washed цвете, выраженные фейды, заломы, потертости и фактурная crosshatch текстура, тот самый эффект старой выношенной пары, которую хочется рассматривать вживую.\nКлассическая ширинка на болтах, крепкие швы, контрастная табачная строчка, аккуратные задние карманы с фирменной вышивкой, красный таб на coin pocket и кожаный патч Lee Cooper на поясе.\nИдеальная повседневная пара: сидят расслабленно, красиво падают на обувь, легко собираются как с худи/свитером, так и с рубашкой или кожанкой.\nСостояние отличное винтажное, все следы носки только добавляют характера.\nЗамеры: длина 109 см, полупояс 46 см, выход 26 см.',
        },
      },
      {
        photos: ['4035-0.jpg', '4035-1.jpg', '4035-2.jpg', '4035-3.jpg', '4035-4.jpg'],
        retext: true,
        input: {
          title: 'Льняные брюки Armani Jeans',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'IT 42', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Jeans', color: 'black', gender: null, material: 'Лён', styleTags: ['Classic', 'Minimal'],
          description: 'Размер по бирке: 42.\nШикарный низ из 100% льна.\nТа самая, шикарная фактура. Мягкие и тактильно приятные. Черный матовый цвет. Шикарный фит на лето.\nЗамеры: длина 101 см, полупояс 38–39 см, выход 28 см.',
        },
      },
      {
        photos: ['4149-0.jpg', '4149-1.jpg', '4149-2.jpg', '4149-3.jpg', '4149-4.jpg', '4149-5.jpg', '4149-6.jpg'],
        input: {
          title: 'Замшевая сумка Gianni Versace Couture',
          category: 'bags', subcategory: 'handbag', price: 305,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Gianni Versace', color: 'brown', gender: 'FEMALE', material: 'Замша', styleTags: ['Y2K', 'Vintage'],
          description: 'Редкая сумка Gianni Versace Couture в глубоком шоколадном оттенке — выполнена из мягкой натуральной замши с живым ворсом, который красиво меняет тон в зависимости от света.\nВыразительный объемный силуэт в духе классических Boston bags: широкое основание, мягко собранные боковины и две плотные округлые ручки. Выглядит массивно и дорого, но при этом сохраняет удобную повседневную форму.\n— обилие тяжелой золотистой фурнитуры: крупная фирменная пластина Gianni Versace Couture, металлические D-образные элементы, заклепки, крепления и гравировки Versace на ручках, замках и бегунках.\nВнутри несколько отдельных отделений на молниях, фирменная подкладка с монограммами и дополнительный карман — вместительная модель, которая легко собирает вокруг себя весь образ.\nВ эстетике late 90s / early 2000s.\nСделано в Италии.',
        },
      },
      {
        photos: ['4156-0.jpg', '4156-1.jpg', '4156-2.jpg', '4156-3.jpg', '4156-4.jpg'],
        input: {
          title: 'Джинсовые микрошорты RTMIXX',
          category: 'shorts', subcategory: 'denim-shorts', sizeSystem: 'OTHER', sizeValue: 'Полупояс 39 см', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'RTMIXX', color: 'lightblue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: не указан, низкая посадка.\nАрхивные микрошорты RTMIXX в светлом washed-дениме — очень выразительная вещь. Оттенок холодный голубой, с мягкими высветлениями и живой винтажной потертостью по ткани.\nКрой — максимально низкий, почти на бедрах, с короткой длиной и расширенным плиссированным низом. За счет этого силуэт выглядит как гибрид микро-шорт и мини-юбки: вещь сидит дерзко, но при этом за счет складок смотрится необычно и цепляет формой.\nСложная конструкция по низу с широкими складками, фирменная металлическая пластина на поясе и латунная молния YKK, акцентная позиция, вещь для образов с сильным early 2000s настроением.\nЗамеры: длина 22 см, полупояс 39 см.',
        },
      },
      {
        photos: ['4239-0.jpg', '4239-1.jpg', '4239-2.jpg', '4239-3.jpg', '4239-4.jpg', '4239-5.jpg', '4239-6.jpg'],
        input: {
          title: 'Брюки клёш со шнуровкой через кольца',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 230,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 34x34.\nДлинные штаны в выцветшем угольно-чёрном оттенке — свободные, фактурные и полностью построенные вокруг сложной системы шнуровки.\n— десятки металлических D-образных колец, расположенных вдоль обеих штанин. Через них хаотично пропущены тонкие витые шнуры: их можно затягивать, ослаблять и связывать по-разному, меняя объём, количество складок и общий рисунок вещи.\nПрямые вертикальные планки подчёркивают вытянутый силуэт, штанины слегка расширяются к низу и массивно собираются поверх обуви. Неоднородный washed-эффект придаёт глубокую дымчатую фактуру и делает металлическую фурнитуру ещё выразительнее.\nЗамеры: длина 117 см, полупояс 44 см, выход 24 см.',
        },
      },
      {
        photos: ['4295-0.jpg', '4295-1.jpg'],
        input: {
          title: 'Камуфляжный бомбер N2B с капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'L', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: L.\nПлотный камуфляжный канвас, утеплённая конструкция, укороченная посадка, крупные накладные карманы и объёмные рукава. Меховой капюшон добавляет модели характерный зимний внешний вид. Один из лучших вариантов на Осень/Зима.\nЗамеры: длина 66 см, ширина 69 см, рукав 80 см.',
        },
      },
      {
        photos: ['4301-0.jpg', '4301-1.jpg', '4301-2.jpg', '4301-3.jpg', '4301-4.jpg'],
        input: {
          title: 'Чёрная рубашка Fendi',
          category: 'shirts', subcategory: 'shirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Fendi', color: 'black', gender: null, styleTags: ['Minimal', 'Classic'],
          description: 'Размер по бирке: M.\nМинималистичная чёрная рубашка Fendi в лёгком и универсальном силуэте.\nМодель выполнена из чёрного текстиля с характерной слегка жатой фактурой. Приталенный крой подчёркивает силуэт, классический отложной воротник. Застёжка на фирменных жемчужных пуговицах.\nНа груди — тонкий тональный логотип Fendi, который остаётся практически незаметным на чёрном фоне.\nЗамеры: длина 57 см, ширина 46 см, рукав 64 см.',
        },
      },
      {
        photos: ['4321-0.jpg', '4321-1.jpg', '4321-2.jpg', '4321-3.jpg', '4321-4.jpg'],
        input: {
          title: 'Укороченное двубортное пальто в гусарском стиле',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 255,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер по бирке: M.\nДвубортное пальто с двумя планками пуговиц. Тёмно-оливковый оттенок, максимально приятный глазу цвет. Приталенное, укороченной длины — шикарный силуэт.\nВысокая стойка воротник, фиксируется на две пуговицы.\nЗамеры: длина 54 см, плечи 38 см, ширина 46 см, рукав от плеча 62 см.',
        },
      },
      {
        photos: ['4326-0.jpg', '4326-1.jpg'],
        retext: true,
        input: {
          title: 'Джинсы selvedge тёмный индиго',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 205,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: 34x34.\nДеним тяжелый, фактурный и хорошо держит форму — поэтому джинсы особенно красиво собираются по ноге и дают правильный объемный силуэт.\nДеним будет меняться со временем. Жесткая ткань постепенно подстраивается под владельца, появляются индивидуальные заломы, естественные высветления и характерный fade в местах носки. Чем дольше носишь, тем более персонально и красиво они стареют.\nКонтрастная строчка, аккуратный selvedge, плотная конструкция и качественная латунная фурнитура YKK. Очень добротно собранная пара, которая ощущается именно как вещь, рассчитанная на долгую носку.\nЗамеры: длина 104 см/110 см, полупояс 43 см, выход 27 см.',
        },
      },
      {
        photos: ['4328-0.jpg', '4328-1.jpg', '4328-2.jpg', '4328-3.jpg', '4328-4.jpg'],
        input: {
          title: 'Кожаная куртка Adamo с асимметричными молниями',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 205,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Adamo', color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nЧерная кожаная куртка с выразительной архитектурой и редкой конструкцией. Мягкая плотная кожа с естественной фактурой и легким винтажным блеском — красиво собирает заломы и со временем становится только характернее.\nСистема металлических молний: две горизонтальные линии по груди, центральная застежка и дополнительная вертикальная молния на передней панели. Глубокие карманы на молниях. Высокий объемный воротник-стойка полностью меняет силуэт и придает вещи футуристичный характер.\nУдлиненные рукава с массивными молниями на манжетах можно носить закрытыми или раскрывать, создавая более расклешенную форму. Подкладка с крупным портретом Marilyn Monroe.\nОчень сильная вещь по силуэту: узкий корпус, длинные рукава, холодная металлическая фурнитура и чистая черная кожа.\nЗамеры: длина 53 см, ширина 44 см, плечи 37 см, рукав от плеча 60 см.',
        },
      },
      {
        photos: ['4333-0.jpg'],
        retext: true,
        input: {
          title: 'Футболка Marilyn Manson «Tour 2007»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-1.jpg'],
        retext: true,
        input: {
          title: 'Футболка Metallica',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-2.jpg'],
        retext: true,
        input: {
          title: 'Футболка Slipknot «The Gray Chapter»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-3.jpg'],
        retext: true,
        input: {
          title: 'Футболка Misfits',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-4.jpg'],
        retext: true,
        input: {
          title: 'Футболка Nirvana «Kurt Cobain 1967–1994»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-5.jpg'],
        retext: true,
        input: {
          title: 'Футболка Marilyn Manson «Holy Wood»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-6.jpg'],
        retext: true,
        input: {
          title: 'Футболка Marilyn Manson с синим принтом',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nЧёрная футболка с архивной band / tour эстетикой: front/back принт, потёртая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4347-0.jpg', '4347-1.jpg', '4347-2.jpg', '4347-3.jpg', '4347-4.jpg', '4347-5.jpg', '4347-6.jpg'],
        input: {
          title: 'Джинсы River Island raw utility',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 205,
          condition: 'GOOD', defectsPresent: false,
          brand: 'River Island', color: 'blue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 34x34.\nСильный raw denim с удобной конструкцией и максимально живой фактурой. Плотный необработанный деним глубокого indigo оттенка, который со временем будет только сильнее раскрываться — появятся индивидуальные фейды, заломы и естественная патина под носку. Куча акцентных деталей: крупные задние карманы, дополнительный карман на металлической молнии, сложная геометрия швов, усиленные панели и контрастная коричневая прострочка. Свободный прямой силуэт с хорошим объёмом в ноге, за счёт длины красиво собираются на обуви. Настоящий raw denim, который со временем становится только интереснее.\nЗамеры: длина 111 см, полупояс 45 см, бедро 33 см, выход 25 см.',
        },
      },
      {
        photos: ['4361-0.jpg', '4361-1.jpg', '4361-2.jpg', '4361-3.jpg', '4361-4.jpg'],
        retext: true,
        input: {
          title: 'Винтажная укороченная шуба с леопардовым принтом',
          category: 'outerwear', subcategory: 'fur', sizeSystem: 'ALPHA', sizeValue: 'M', price: 305,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Размер по бирке: M.\nУкороченная, тёплая шуба. Ярко выраженный леопард добавляет шубе характер, коричневый хаки оттенок. Идеальная посадка с удлиненными рукавами и укороченным корпусом.\nШирокий воротник стойка, кант из меха, в том числе на рукавах. Скрытые крючки вплоть до горла, за счет натуральных материалов шикарно держит тепло. Настоящий винтаж, на любое мероприятие.\nЗамеры: длина 57 см, ширина 47 см, рукав 74 см.',
        },
      },
      {
        photos: ['4368-0.jpg', '4368-1.jpg', '4368-2.jpg', '4368-3.jpg', '4368-4.jpg', '4368-5.jpg', '4368-6.jpg'],
        input: {
          title: 'Кроссовки Gucci GG Monogram',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'SHOE_EU', sizeValue: '37', price: 345,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Gucci', color: 'brown', gender: 'FEMALE', material: 'Кожа', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 37.\nАрхивная пара Gucci с характерной эстетикой 00s. Сочетание коричневой кожи и фирменного beige GG monogram canvas, два широких ремня на липучках и аккуратная низкая посадка. Кожа уже красиво состарилась и получила живую патину, за счёт чего пара выглядит намного интереснее стерильных современных релизов. На пятке и внутри фирменное тиснение Gucci, оригинальная фактурная подошва и очень аккуратная сборка. За счёт спокойной коричнево-бежевой палитры легко вписываются в любой низ.',
        },
      },
      {
        photos: ['4401-0.jpg', '4401-1.jpg', '4401-2.jpg', '4401-3.jpg', '4401-4.jpg', '4401-5.jpg', '4401-6.jpg'],
        input: {
          title: 'Полосатое зип-худи Fat Face navy/cream',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Fat Face', color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nФактурный полосатый худи — глубокий выцветший navy оттенок в сочетании с молочно-белыми полосами, состаренная латунная молния с кожаным пуллером и крупные хлопковые шнуры.\nНеобычная конструкция с двойным слоем в районе карманов и пояса, контрастные наружные швы и выраженная washed-фактура ткани. Посадка по телу, длинные рукава и большой мягкий капюшон.\nЗамеры: длина 66 см, ширина 47 см, рукав от горла 75 см.',
        },
      },
      {
        photos: ['4429-0.jpg', '4429-1.jpg', '4429-2.jpg', '4429-3.jpg', '4429-4.jpg', '4429-5.jpg', '4429-6.jpg'],
        input: {
          title: 'Винтажный кожаный бомбер Shawnee',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Shawnee', color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nВинтажная кожаная куртка с характером — плотная чёрная кожа с естественной фактурой и мягким блеском, который появляется только после времени и носки. Силуэт в духе классических flight/bomber jacket: укороченная посадка, высокий трикотажный воротник, манжеты и пояс, собранная форма.\nОсобенность модели — большое количество конструктивных деталей: асимметричные карманы, металлическая молния, регулируемые элементы, декоративные строчки и фирменная внутренняя отделка с яркой картографической подкладкой.\nКожа имеет красивый aged-эффект: лёгкие естественные заломы, неоднородный оттенок и живую поверхность, которая будет становиться только интереснее со временем.\nЗамеры: длина 54 см, ширина 47 см, рукав от горла 64 см.',
        },
      },
      {
        photos: ['4436-0.jpg', '4436-1.jpg', '4436-2.jpg', '4436-3.jpg', '4436-4.jpg', '4436-5.jpg', '4436-6.jpg'],
        input: {
          title: 'Винтажные джинсы Diesel Larkee',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: W34 L32.\nЛегендарный силуэт Diesel Larkee в редком винтажном исполнении — расслабленная прямая посадка, плотный деним и естественный aged-эффект, который появляется только после долгой носки. Глубокий светло-синий оттенок с мягкими переходами, выцветшими зонами и живой фактурой старого хлопка.\nДжинсы с характерным для Diesel архивным вайбом: объёмная посадка, правильная ширина по ноге, фирменные карманы, винтажная фурнитура и детальная обработка ткани. Потертости расположены естественно — без агрессивного искусственного distress, только настоящая история денима.\nКрасивые fade-линии, мягкие заломы, выгоревший голубой цвет и ощущение настоящего начала 2000-х.\nЗамеры: длина 106 см, полупояс 44 см, выход 22 см.',
        },
      },
      {
        photos: ['4482-0.jpg', '4482-1.jpg'],
        retext: true,
        input: {
          title: 'Спортивные штаны adidas винтажные синие',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'ALPHA', sizeValue: 'M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'blue', gender: null, material: 'Полиэстер', styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M.\nКлассические спортивные штаны adidas в приглушенно синем оттенке с фирменной эстетикой моделей. Свободный спортивный силуэт с прямой посадкой, лёгкая ткань и культовые лампасы по бокам создают узнаваемый ретро-вайб. Лаконичный логотип adidas на бедре.\nЗамеры: длина 104 см, полупояс 40+ см (резинка + шнурок), выход 22 см.',
        },
      },
      {
        photos: ['4498-0.jpg', '4498-1.jpg', '4498-2.jpg', '4498-3.jpg', '4498-4.jpg'],
        input: {
          title: 'Гоночный бомбер Honda Racing',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Honda', color: 'red', gender: null, styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: M.\nГоночный бомбер Honda с ярким духом японского motorsport racing jacket. Контрастное сочетание красного, чёрного и серого цветов, объёмная посадка и спортивная конструкция создают узнаваемый силуэт из эпохи автоспорта и уличной культуры 90-х. Лёгкая техническая ткань, плотная форма и продуманные линии делают куртку выразительной частью образа.\nЗамеры: длина 67 см, ширина 61 см, рукав 78 см.',
        },
      },
      {
        cover: '4503-1.jpg',
        photos: ['4503-0.jpg', '4503-1.jpg', '4503-2.jpg', '4503-3.jpg', '4503-4.jpg', '4503-5.jpg', '4503-6.jpg'],
        input: {
          title: 'Чёрный бомбер N2B с капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 295,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: M.\nКультовая укороченная N2B куртка в стиле военной авиации с объёмным капюшоном и характерным силуэтом. Глубокий чёрный цвет, плотная ткань и массивная конструкция создают брутальный милитари с эстетикой 90-х. Объёмные рукава, укороченная посадка и крупный капюшон со стальной молнией делают вещь максимально заметной. Один из лучших силуэтов на просторах!\nЗамеры: длина 52 см, ширина 60 см, рукав 80 см.',
        },
      },
      {
        photos: ['4510-0.jpg', '4510-1.jpg', '4510-2.jpg', '4510-3.jpg', '4510-4.jpg', '4510-5.jpg', '4510-6.jpg'],
        input: {
          title: 'Винтажные джинсы с естественным выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x30.\nВинтажные джинсы с выраженным эффектом естественного выцветания и состаренного денима. Глубокий синий оттенок с многослойными переходами цвета, контрастными потертостями и характерными whiskers-складками в верхней части изделия.\nДжинсы выполнены в классическом прямом силуэте в шикарном оттенке, акцентом на фактуру ткани и ручной эффект износа. Выраженные зоны вытирания на бёдрах, коленях и нижней части создают ощущение настоящей истории вещи.\nЗамеры: длина 103 см, полупояс 42 см, выход 22 см.',
        },
      },
      {
        photos: ['4524-0.jpg', '4524-1.jpg', '4524-2.jpg', '4524-3.jpg', '4524-4.jpg'],
        input: {
          title: 'Лонгслив henley в мелкий рубчик',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Трикотаж', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nЛёгкий Henley-лонгслив из тонкого мягкого трикотажа в мелкий рубчик. Ткань воздушная, пластичная и красиво ложится по телу, не создавая лишнего объёма. Свободная посадка, длинные рукава и аккуратная планка на пуговицах дают вещи спокойный винтажный характер grunge / early-2000s.\nХорошо смотрится именно в движении: материал мягко драпируется, собирается естественными складками и даёт тот самый расслабленный, слегка небрежный силуэт. Есть в светло-сером и графитовом оттенках.\nЗамеры: длина 68 см, ширина 54 см, рукав 73 см.',
        },
      },
      {
        photos: ['4539-0.jpg', '4539-1.jpg', '4539-2.jpg', '4539-3.jpg', '4539-4.jpg'],
        input: {
          title: 'Укороченная куртка в гусарском стиле (Италия)',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: M.\nЧёрная укороченная куртка с hussar эстетикой и итальянским характером исполнения. Плотная ткань с глубоким матовым оттенком, структурированный крой. Укороченная посадка подчёркивает пропорции, а необработанные края и видимые элементы конструкции добавляют вещи ощущение ручной доработки и винтажной индивидуальности.\nИтальянское производство, декоративная двойная линия пуговиц с металлической фурнитурой, многослойные передние панели, высокий воротник, плотная посадка и оригинальная конструкция с характерным военным настроением.\nЗамеры: длина 41 см, ширина 45 см, рукав 70 см.',
        },
      },
      {
        photos: ['4544-0.jpg', '4544-1.jpg', '4544-2.jpg', '4544-3.jpg', '4544-4.jpg'],
        retext: true,
        input: {
          title: 'Винтажное бордовое зип-худи Mickey Mouse',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nВинтажный бордовый zip-up hoodie с плотным хлопковым полотном и мягким выцветшим оттенком, который со временем приобретает более глубокую фактуру. Модель выполнена в расслабленном силуэте с объемным капюшоном в винтажном духе Америки.\nКрупная, фактурная аппликация Mickey Mouse на спине, с состаренным эффектом. Натуральные потертости ткани и легкая неравномерность цвета создают ощущение вещи с историей.\nЗамеры: длина 71 см, ширина 57 см, рукав 82 см.',
        },
      },
      {
        photos: ['4556-0.jpg', '4556-1.jpg', '4556-2.jpg', '4556-3.jpg', '4556-4.jpg', '4556-5.jpg', '4556-6.jpg'],
        input: {
          title: 'Чёрные джинсы Diesel Industry Thavar',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'JEANS_W', sizeValue: 'W31', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 31x32.\nЧёрные Diesel Industry Thavar с характерным вайбом бренда — плотный тёмный denim с лёгким stretch, контрастной серой строчкой и чистым slim-skinny силуэтом. Посадка аккуратно собирает верх, а штанина остаётся прямой и узкой без ощущения леггинсов.\nПо деталям всё как надо: фирменная Diesel Industry Denim Division лента у coin pocket, брендированный кожаный патч сзади, характерная вышивка на задних карманах, металлическая фурнитура и YKK-молния. Глубокий washed black оттенок и контрастная строчка дают паре тот самый ранний европейский характер.\nЗамеры: длина 109 см, полупояс 42 см, выход 18 см.',
        },
      },
      {
        photos: ['4584-0.jpg', '4584-1.jpg', '4584-2.jpg', '4584-3.jpg', '4584-4.jpg', '4584-5.jpg', '4584-6.jpg'],
        retext: true,
        input: {
          title: 'Высокие милитари-ботинки с пряжками',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '40', price: 295,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Кожа', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: 40 (стелька 26 см).\nВысокие ботинки в выцветшем olive/khaki оттенке с грубым military-grunge характером. Фактурная комбинированная кожа, массивная простроченная подошва, шнуровка и два ремня с металлическими пряжками.\nСильная естественная состаренность, потёртая подошва и неоднородный цвет только усиливают винтажный вид пары. Сбоку есть молния, поэтому при всей тяжёлой конструкции ботинки нормально надеваются, а не требуют отдельного инженерного образования. Шикарный вариант куда угодно, завидую будущему обладателю.',
        },
      },
      {
        photos: ['4593-0.jpg', '4593-1.jpg', '4593-2.jpg', '4593-3.jpg', '4593-4.jpg', '4593-5.jpg', '4593-6.jpg'],
        input: {
          title: 'Серые джинсы Emporio Armani washed',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Emporio Armani', color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x32.\nСерые Emporio Armani denim с холодным винтажным wash — плотный деним с красивой неоднородной фактурой, прямой вытянутый силуэт и спокойная посадка без лишнего объёма. Цвет уходит в выцветший графитово-серый.\nСзади — фирменный металлический Emporio Armani eagle logo, аккуратные карманы с характерной строчкой, брендированная фурнитура и металлическая молния с логотипом. Минималистичная, но очень собранная пара с дорогим old Armani вайбом — без кричащего дизайна, зато с сильной фактурой и деталями.\nЗамеры: длина 106 см, полупояс 42 см, выход 19 см.',
        },
      },
      {
        photos: ['4612-0.jpg', '4612-1.jpg', '4612-2.jpg', '4612-3.jpg', '4612-4.jpg'],
        input: {
          title: 'Двусторонний бомбер GEAR',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: 'GEAR', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nДвухсторонний чёрный бомбер с плотным силуэтом. Тёплая конструкция, объёмная посадка и качественная ткань.\nИдеальный вариант на холодный сезон. Премиальная золотистая фурнитура, фирменная вышивка GEAR, плотные эластичные манжеты и пояс, которые шикарно держат форму. Благодаря продуманному крою куртка отлично садится по фигуре, создавая объёмный, но аккуратный силуэт. Вторая сторона добавляет больше вариантов стилизации и делает вещь ещё более универсальной.\nЗамеры: длина 55 см, ширина 61 см, рукав 80 см.',
        },
      },
      {
        photos: ['4629-0.jpg', '4629-1.jpg', '4629-2.jpg', '4629-3.jpg', '4629-4.jpg'],
        input: {
          title: 'Винтажное зип-худи adidas с тремя полосками',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 125,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'black', gender: null, styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M.\nВинтажный adidas zip-up hoodie в контрастной чёрно-белой расцветке с классическими тремя полосами вдоль рукавов. Мягкий спортивный трикотаж, приталенный силуэт и удлинённые рукава дают характерную посадку adidas начала 2000-х.\nКапюшон со шнурками, двухцветные панели, вышитый логотип на груди и фирменная металлическая фурнитура adidas. Лаконичная вещь с очень узнаваемым вайбом.\nЗамеры: длина 65 см, ширина 49 см, рукав 73 см.',
        },
      },
      {
        photos: ['4636-0.jpg', '4636-1.jpg', '4636-2.jpg', '4636-3.jpg', '4636-4.jpg'],
        input: {
          title: 'Винтажное камуфляжное зип-худи',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 125,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: M–L.\nВинтажная camouflage zip-up hoodie в приглушённой olive расцветке с естественно выцветшим рисунком и мягкой фактурой хлопкового полотна. Посадка вытянутая и приталенная, с длинными рукавами. Контрастные риб-панели по бокам, крупные карманы и фурнитура YKK.\nЗамеры: длина 67 см, ширина 53 см, рукав 77 см.',
        },
      },
      {
        photos: ['4656-0.jpg', '4656-1.jpg', '4656-2.jpg', '4656-3.jpg', '4656-4.jpg', '4656-5.jpg', '4656-6.jpg'],
        input: {
          title: 'Джинсовая байкерская куртка индиго',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nТёмно-синий denim jacket в байкерском силуэте — плотный indigo denim с винтажным wash, приталенной посадкой и асимметричной молнией. Высокий ворот, длинные рукава и ремень по низу дают куртке характерный late 90s / early 2000s вайб. Металлическая фурнитура, декоративные молнии, кнопки на вороте и плечах, регулируемый пояс и аккуратная контрастная строчка. Шикарный вариант который зацепит глаз любого!\nЗамеры: длина 57 см, ширина 46 см, рукав от плеча 61 см.',
        },
      },
      {
        photos: ['4663-0.jpg', '4663-1.jpg', '4663-2.jpg', '4663-3.jpg', '4663-4.jpg', '4663-5.jpg', '4663-6.jpg'],
        input: {
          title: 'Джинсы Red Bridge с дистрессом',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W33', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Red Bridge', color: 'blue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 33x32.\nОдна из лучших пар, которые попадались мне за последнее время. Сильное исполнение во всём: сложное многоуровневое окрашивание, мощный дистресс с подкладкой, очень плотный деним и массивная металлическая фурнитура с красивым состаренным оттенком.\nПосадка очень удачная, джинсы хорошо собираются по ноге и при этом не выглядят перегруженными. Максимально заметная пара, универсальная, практически в любой гардероб.\nЗамеры: длина 106 см, полупояс 43 см, выход 20 см.',
        },
      },
      {
        photos: ['4684-0.jpg', '4684-1.jpg', '4684-2.jpg', '4684-3.jpg', '4684-4.jpg', '4684-5.jpg', '4684-6.jpg'],
        retext: true,
        input: {
          title: 'Куртка American Eagle из washed-канваса',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 215,
          condition: 'GOOD', defectsPresent: false,
          brand: 'American Eagle', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nКуртка American Eagle в глубоком графитово-сером оттенке с выраженной washed обработкой и естественно вытертыми краями по швам. Плотный хлопковый canvas со временем получил мягкую неоднородную фактуру, за счёт чего вещь выглядит особенно винтажно. Силуэт объёмный и укороченный, с широкими рукавами и собранным низом — классический active fit.\nОбъёмный капюшон с регулировкой на шнурках, два крупных накладных кармана спереди и широкие ribbed манжеты. Центральная металлическая молния YKK с фирменным пуллером AE. Акцент остаётся на форме и washed фактуре ткани. Верх — 100% cotton, хлопковая подкладка корпуса и polyester в рукавах.\nЗамеры: длина 68 см, ширина 61 см, рукав 81 см.',
        },
      },
      {
        photos: ['4703-0.jpg', '4703-1.jpg', '4703-2.jpg', '4703-3.jpg', '4703-4.jpg'],
        input: {
          title: 'Винтажное поло Polo Ralph Lauren с длинным рукавом',
          category: 'tshirts', subcategory: 'polo', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Polo Ralph Lauren', color: 'brown', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nВинтажный Polo Ralph Lauren с длинным рукавом в глубоком выцветшем графитово-коричневом оттенке. Плотное фактурное хлопковое полотно, свободная спокойная посадка и естественно состаренный цвет. Классический воротник polo, планка на пуговицах и фирменная вышивка Pony на груди. На ткани присутствует натуральная неравномерность оттенка и лёгкие следы времени.\nЗамеры: длина 68 см, ширина 58 см, рукав от горла 78 см.',
        },
      },
      {
        photos: ['4715-0.jpg', '4715-1.jpg', '4715-2.jpg', '4715-3.jpg', '4715-4.jpg', '4715-5.jpg', '4715-6.jpg'],
        input: {
          title: 'Джинсы Kenvelo с брызгами краски',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 160,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Kenvelo', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 30x34.\nСветло-синие винтажные джинсы Kenvelo с выраженным stone-wash, белыми контрастными карманами и поясом. По всей длине разбросаны белые paint splatter детали, потёртости и декоративные ремонтные стежки, из-за чего пара выглядит как старый кастомный деним.\nСвободный прямой силуэт, крупные накладные карманы и контрастные вставки по низу штанин. Фурнитура с фирменными металлическими кнопками.\nЗамеры: длина 109 см, полупояс 40 см, выход 21 см.',
        },
      },
      {
        photos: ['4722-0.jpg', '4722-1.jpg'],
        input: {
          title: 'Коралловое зип-худи adidas',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 180,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительные пятнышки, требуется стирка.',
          brand: 'adidas', color: 'pink', gender: null, styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M–L.\nХуди adidas на молнии в кораллово-розовом оттенке. Посадка расслабленная, с заметно спущенной линией плеч и свободными рукавами, за счёт чего вещь в лёгком oversized fit. На спине фирменные три белые полосы проходят по линии плеч и продолжаются вдоль рукавов — главный акцент модели.\nСпереди два крупных кармана, небольшой вышитый логотип adidas и полностью тональная молния. Манжеты держат форму, при этом материал остаётся мягким и пластичным. Незначительные пятнышки, требуется стирка.\nЗамеры: длина 53 см, ширина 57 см, рукав 70 см.',
        },
      },
      {
        photos: ['4731-0.jpg', '4731-1.jpg'],
        input: {
          title: 'Сумка на плечо с монограммой и вставками под крокодила',
          category: 'bags', subcategory: 'handbag', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Сумка в приглушённом оливково-коричневом оттенке с повторяющимся монограммным паттерном и цветочными элементами. Основная часть выполнена из плотного текстиля, дополнена фактурными вставками под крокодиловую кожу.\nМодель вытянутой формы с короткой регулируемой ручкой и массивной металлической фурнитурой. По корпусу — декоративные ремешки, кольца, заклёпки и крупная центральная пряжка. Сочетание монограммы, состаренного металла и обилия деталей даёт характерный 90’s vibe.\nСредний размер.',
        },
      },
      {
        photos: ['4733-0.jpg', '4733-1.jpg'],
        retext: true,
        input: {
          title: 'Чёрные парашютные брюки balloon',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'Универсальный', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Нейлон', styleTags: ['Streetwear'],
          description: 'Размер по бирке: универсальный.\nЧёрные парашютные брюки из лёгкой шуршащей нейлоновой ткани. Материал даёт характерную мятую фактуру и объём, за счёт чего особенно хорошо раскрывается balloon fit.\nОчень широкий крой с массивным объёмом по всей длине и регулируемой посадкой. Эластичный пояс со шнурком, утяжки по низу штанин позволяют менять форму от свободной широкой до собранной. По бокам функциональные карманы, сзади карманы с клапаном. На теле дают выраженный oversized/parachute fit.\nЗамеры: длина 109 см, полупояс на резинке со шнурком, выход 36 см (утягивается).',
        },
      },
      {
        photos: ['4735-0.jpg', '4735-1.jpg', '4735-2.jpg', '4735-3.jpg', '4735-4.jpg', '4735-5.jpg', '4735-6.jpg'],
        input: {
          title: 'Джинсы G-Star Raw wide leg washed',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'G-Star Raw', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 32x34.\nДжинсы G-Star Raw из плотного денима с выраженной винтажной обработкой. Неравномерный washed-эффект, высветленные швы и фактурные вертикальные потёртости дают характерный состаренный вид 2000-х.\nШирокий прямой силуэт с длинной штаниной. Классическая пятикарманная конструкция дополнена фирменными деталями G-Star: вышивка на coin pocket, толстый патч из натуральной кожи буйвола, контрастная вышивка на задних карманах. Внутри пояса — массивный жаккардовый брендинг G-STAR RAW. Металлическая фурнитура с гравировками бренда, застёжка на болтах.\nЗамеры: длина 107 см, полупояс 42 см, выход 23 см.',
        },
      },
      {
        photos: ['4747-0.jpg', '4747-1.jpg', '4747-2.jpg', '4747-3.jpg', '4747-4.jpg'],
        input: {
          title: 'Асимметричная мотокуртка Principles Petite',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Principles', color: 'blue', gender: 'FEMALE', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nТёмно-синяя куртка с асимметричной конструкцией в духе деконструированных biker/moto jacket. Крупная диагональная металлическая молния.\nПриталенный укороченный крой с выраженными конструктивными швами на спине. На воротнике, талии и манжетах — регулируемые ремешки с металлическими D-ring кольцами. Плотная слегка выстиранная ткань с матовой фактурой и массивная серебристая фурнитура.\nЗамеры: длина 53 см, плечи 42 см, рукав от плеча 60 см.',
        },
      },
      {
        photos: ['4752-0.jpg', '4752-1.jpg', '4752-2.jpg', '4752-3.jpg', '4752-4.jpg', '4752-5.jpg', '4752-6.jpg'],
        retext: true,
        input: {
          title: 'Зимний бомбер Zavetti Canada Alaska',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'M', price: 240,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Нужно зашить основание капюшона по шву и подкладку в кармане (пара сантиметров).',
          brand: 'Zavetti Canada', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: M.\nЧерный пуховой бомбер с объёмным капюшоном и пышной меховой опушкой.\nКлассический бомбер: верх из плотного водоотталкивающего материала защищает от ветра и непогоды, внутренняя утеплённая подкладка сохраняет тепло, а объёмный капюшон с мягкой меховой опушкой создает дополнительную защиту и выразительный акцент, можно отстегнуть. Практичная конструкция. Трикотажные скрытые манжеты на рукавах — для комфортной посадки и защиты от холода. Универсальная модель которая подойдет абсолютно под все. Нужно зашить по шву основание у капюшона. Аналогично зашить подкладку в кармане, пару см.\nЗамеры: длина 62 см, ширина 54 см, рукав 76 см.',
        },
      },
      {
        cover: '4759-3.jpg',
        photos: ['4759-0.jpg', '4759-1.jpg', '4759-2.jpg', '4759-3.jpg'],
        retext: true,
        input: {
          title: 'Камуфляжное зип-худи Athletic с дистрессом',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 95,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nКамуфляжная зип-худи Athletic с необычной конструкцией капюшона. Плотный хлопковый материал с мягкой петлёй изнутри, тёмный woodland camo.\nПо рукавам крупные принты и типографика, намеренно необработанные края и distressed-детали с прорезями на манжетах под большой палец. Двойная фронтальная молния позволяет регулировать силуэт снизу. Вытянутый узкий крой с длинными рукавами.\nЗамеры: длина 58 см, ширина 51 см, рукав 72 см.',
        },
      },
      {
        photos: ['4768-0.jpg', '4768-1.jpg', '4768-2.jpg', '4768-3.jpg', '4768-4.jpg'],
        input: {
          title: 'Технический бомбер Martini (Италия)',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'L', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Martini', color: 'gray', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nВысокий воротник со скрытым капюшоном на молнии, утяжки на вороте, два боковых кармана и эластичные трикотажные манжеты. Центральная застёжка дополнена металлическими кнопками. На рукавах технические детали и небольшие патчи.\nЗамеры: длина 68 см, ширина 60 см, рукав 77 см.',
        },
      },
      {
        photos: ['4778-0.jpg', '4778-1.jpg', '4778-2.jpg', '4778-3.jpg', '4778-4.jpg', '4778-5.jpg', '4778-6.jpg'],
        input: {
          title: 'Винтажные джинсы Polo Ralph Lauren',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Polo Ralph Lauren', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 34x32.\nВинтажный деним Ralph Lauren в indigo wash с выраженным washed-эффектом и необычной фактурой денима — по всей ткани проходит едва заметный монограммный паттерн. Местами сильное высветление и естественные потёртости, особенно по швам, карманам и краям штанин.\nСвободный прямой силуэт с классической пятикарманной конструкцией. На coin pocket фирменный вышитый шеврон RL, сзади кожаный патч Polo Jeans Co. Металлическая фурнитура с гравировкой и декоративным орнаментом.\nЗамеры: длина 102 см, полупояс 44 см, выход 23 см.',
        },
      },
      {
        photos: ['4785-0.jpg', '4785-1.jpg'],
        retext: true,
        input: {
          title: 'Спортивные штаны adidas винтажные чёрные',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'ALPHA', sizeValue: 'M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'black', gender: null, material: 'Полиэстер', styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M.\nКлассические спортивные штаны adidas в приглушенно черном оттенке с фирменной эстетикой моделей. Свободный спортивный силуэт с прямой посадкой, лёгкая ткань и культовые лампасы по бокам создают узнаваемый ретро-вайб. Лаконичный логотип adidas на бедре.\nЗамеры: длина 104 см, полупояс на резинке со шнурком, выход 23.5 см.',
        },
      },
      {
        photos: ['4794-0.jpg', '4794-1.jpg'],
        input: {
          title: 'Джинсы wide leg выстиранный индиго',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 165,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: W30 L34.\nДжинсы в выстиранном синем индиго с выраженным washed-эффектом и широким wide leg. Свободный силуэт с прямыми штанинами по всей длине, плотный деним с характерной фактурой и естественными заломами.\nНеравномерный фейд по бёдрам и коленям, контрастные высветления вдоль швов и выразительный мраморный окрас ткани. Классическая конструкция с пятью карманами, металлическая фурнитура, крупные задние карманы и слегка потрёпанные края штанин с бахромой.\nСостояние хорошее, естественные следы носки и потёртости.\nЗамеры: длина 113 см, полупояс 38 см, выход 30 см.',
        },
      },
      {
        photos: ['4796-0.jpg', '4796-1.jpg'],
        input: {
          title: 'Лонгслив Tigha из хлопка с дистрессом',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'M', price: 125,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Tigha', color: 'green', gender: null, material: 'Хлопок', styleTags: ['Minimal'],
          description: 'Размер по бирке: M.\nТрикотажный лонгслив Tigha из 100% хлопка в приглушённом серо-зелёном оттенке. Выраженная washed-обработка создаёт неоднородный выцветший тон и подчёркивает фактуру вязки.\nСвободный удлинённый силуэт с рукавами реглан и необработанными декоративными швами. Края горловины, рукавов и низа выполнены с эффектом естественного скручивания и лёгкой дистресс-обработкой. Минималистичный дизайн дополнен небольшой металлической пластиной Tigha у нижнего края.\nЗамеры: длина 72 см, ширина 51 см, рукав от горла 80 см.',
        },
      },
      {
        photos: ['4798-0.jpg', '4798-1.jpg', '4798-2.jpg', '4798-3.jpg', '4798-4.jpg'],
        input: {
          title: 'Джинсовая куртка John Richmond',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'John Richmond', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nКуртка John Richmond из плотного тёмно-синего денима с выраженным винтажным эффектом потёртостей и неоднородной текстурой. Приталенный силуэт, удлинённые рукава, контрастная строчка и металлические пуговицы с фирменной гравировкой.\nДва нагрудных кармана с металлическими молниями YKK, вертикальные декоративные швы и регулируемые хлястики на спине. Внутренняя отделка воротника с повторяющимся готическим логотипом John Richmond, фурнитура с фирменными крестами.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 57 см, ширина 52 см, рукав 75 см.',
        },
      },
      {
        photos: ['4803-0.jpg', '4803-1.jpg', '4803-2.jpg', '4803-3.jpg', '4803-4.jpg', '4803-5.jpg', '4803-6.jpg'],
        input: {
          title: 'Джинсовая куртка Dolce & Gabbana washed',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: L.\nДжинсовая куртка D&G из плотного тёмно-синего денима с выраженной неоднородной текстурой и естественными высветлениями. Приталенный силуэт с акцентом на талии, удлинённые рукава, фигурные швы и контрастная табачная строчка.\nДва нагрудных кармана с клапанами, металлические пуговицы с фирменной гравировкой D&G, декоративная прострочка крест-накрест вдоль планки. Сзади регулируемые хлястики для посадки по талии, на нагрудном кармане лаконичный лейб.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 59 см, ширина 49 см, рукав 79 см.',
        },
      },
      {
        cover: '4810-2.jpg',
        photos: ['4810-0.jpg', '4810-1.jpg', '4810-2.jpg', '4810-3.jpg', '4810-4.jpg'],
        input: {
          title: 'Винтажный кожаный ремень с заклёпками (Италия)',
          category: 'accessories', subcategory: 'belt', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Итальянский кожаный ремень из натуральной кожи с потёртой тёмно-коричневой поверхностью. Массивная металлическая пряжка с состаренным серебристым покрытием, декоративными заклёпками по периметру и фактурной центральной вставкой. Характерная винтажная эстетика.\nСостояние отличное, естественные следы носки и фейд.\nРазмер 100/115.',
        },
      },
      {
        photos: ['4815-0.jpg', '4815-1.jpg', '4815-2.jpg', '4815-3.jpg', '4815-4.jpg', '4815-5.jpg', '4815-6.jpg'],
        input: {
          title: 'Джинсы Next bootcut washed',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 190,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Next', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 36.\nДжинсы Next с посадкой bootcut, прямой линией бедра и плавным расширением штанин от колена. Сине-голубой деним с неоднородной варкой, вертикальными высветлениями и выраженными следами естественного износа.\nКлассическая конструкция с пятью карманами, металлической фурнитурой и молнией YKK. Задние карманы с дополнительной горизонтальной прострочкой. Нижние края штанин с потёртостями и распущенными нитями, локальные пятна краски по всему периметру.\nСостояние хорошее, естественный износ.\nЗамеры: длина 108 см, полупояс 44 см, выход 24 см.',
        },
      },
      {
        photos: ['4822-0.jpg', '4822-1.jpg', '4822-2.jpg', '4822-3.jpg', '4822-4.jpg'],
        retext: true,
        input: {
          title: 'Серое зип-худи Polo Ralph Lauren',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 165,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Polo Ralph Lauren', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер по бирке: XL.\nСерый зип Polo Ralph Lauren в классическом меланжевом цвете с контрастной молочной подкладкой. Плотный хлопковый футер с мягким флисовым начёсом, свободный regular fit и объёмный капюшон с фактурной вафельной подкладкой.\nФирменная зелёная вышивка Pony на груди, металлическая молния YKK с брендированным пуллером POLO, широкие молочные шнурки и вместительные карманы. Плотные рибовые манжеты и пояс, аккуратная строчка и характерный силуэт классических худи Ralph Lauren.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 72 см, ширина 63 см, рукав 83 см.',
        },
      },
      {
        photos: ['4827-0.jpg', '4827-1.jpg', '4827-2.jpg', '4827-3.jpg', '4827-4.jpg', '4827-5.jpg', '4827-6.jpg'],
        retext: true,
        input: {
          title: 'Винтажная куртка Armani Jeans с мехом',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'IT 46', price: 345,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Jeans', color: 'gray', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: 46.\nШикарная куртка Armani в графитовом оттенке с неоднородной фактурой под состаренную кожу. Асимметричный крой с фигурными швами, металлическими люверсами и тремя ремешками с серебристой фурнитурой. Высокий воротник — нереально теплый.\nВнутренняя отделка из мягкого искусственного меха с выразительной текстурой, меховые манжеты и отложной воротник. Характерная эстетика Armani в их так называемом прайме.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 59 см, плечи 46 см, ширина 52 см, рукав от плеча 67 см.',
        },
      },
      {
        photos: ['4834-0.jpg', '4834-1.jpg'],
        retext: true,
        input: {
          title: 'Винтажный рабочий бомбер MA-1',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 190,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Лёгкие пятнышки от времени.',
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nВинтажный рабочий бомбер в выцветшем чёрно-графитовом оттенке с лёгкими пятнами времени. Силуэт объёмный и укороченный, с широкими рукавами и мягко собранным низом — классический пилот. Плотный ribbed воротник, манжеты и пояс хорошо держат форму, при этом сама куртка остаётся достаточно расслабленной по посадке.\nСпереди два прорезных кармана, на рукаве дополнительный utility pocket, центральная латунная молния YKK.\nЗамеры: длина 71 см, ширина 73 см, рукав 83 см.',
        },
      },
      {
        photos: ['4860-0.jpg', '4860-1.jpg', '4860-2.jpg', '4860-3.jpg', '4860-4.jpg', '4860-5.jpg', '4860-6.jpg'],
        input: {
          title: 'Джинсы George regular fit washed black',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: 'George', color: 'black', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: W34 L31.\nДжинсы в свободном прямом крое Regular Fit. Плотный чёрно-серый деним с выраженным вертикальным выцветанием и контрастными графитовыми переливами. Широкие штанины сохраняют объём по всей длине и образуют естественные складки поверх обуви.\nКлассическая пятикарманная конструкция, металлическая молния, контрастная строчка и задние карманы с V-образной вышивкой. Ткань с характерной продольной текстурой. Сдержанный винтажный силуэт с акцентом на фактуре денима.\nСостояние хорошее, присутствуют естественные следы носки.\nЗамеры: длина 107 см, полупояс 43 см, выход 23 см.',
        },
      },
      {
        photos: ['4867-0.jpg', '4867-1.jpg', '4867-2.jpg', '4867-3.jpg', '4867-4.jpg', '4867-5.jpg', '4867-6.jpg'],
        input: {
          title: 'Кожаные байкерские ботинки Clarks',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Clarks', color: 'black', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: UK 4 (EU 38–38,5).\nКожаные байкерские ботинки Clarks в чёрном цвете с мягким высоким голенищем и массивным округлым мысом. Пластичная кожа с естественными заломами, широкий ремень вокруг щиколотки и диагональная застёжка с металлической пряжкой создают характерный силуэт в эстетике винтажной мотоэкипировки.\nГлавная деталь — металлическая молния Opti на задней части голенища, раскрывающая кожаную вставку с тремя рядами серебристых заклёпок. Невысокий наборный каблук, рельефная подошва и металлическая фурнитура с состаренным покрытием.\nХорошее состояние, присутствуют естественные следы носки, заломы.',
        },
      },
      {
        photos: ['4874-0.jpg', '4874-1.jpg', '4874-2.jpg', '4874-3.jpg', '4874-4.jpg', '4874-5.jpg', '4874-6.jpg'],
        input: {
          title: 'Джинсы Pepe Jeans London regular straight',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 160,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Pepe Jeans', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: W34 L34.\nИндиго Pepe Jeans London с классическим широким straight fit и плотным денимом. Посадка regular waist, штанины прямые и достаточно свободные — без заужения, хорошо ложатся на обувь.\nВыраженный washed-фейд по бёдрам и коленям, контрастные задние карманы с фирменной геометричной строчкой, кожаный патч Pepe Jeans London и брендированная металлическая фурнитура. Деним плотный, держит форму и даёт правильный силуэт.\nСостояние отличное, естественные следы носки и фейд.\nЗамеры: длина 111 см, полупояс 44 см, выход 22 см.',
        },
      },
      {
        photos: ['4886-0.jpg', '4886-1.jpg', '4886-2.jpg', '4886-3.jpg', '4886-4.jpg', '4886-5.jpg', '4886-6.jpg'],
        input: {
          title: 'Кожаные байкерские брюки со шнуровкой',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: 32x32.\nМассивные брюки из плотной натуральной кожи чёрного цвета с характерной зернистой фактурой и естественным полуматовым блеском. Расслабленная посадка с расширением штанин к низу, тяжёлый материал образует объёмные складки и красиво ложится поверх обуви. Выразительный силуэт с эстетикой архивной байкерской одежды.\nДлинная шнуровка по внешним сторонам обеих штанин, проходящая практически от пояса до самого низа. Металлические люверсы, кожаные панели с поперечными конструктивными швами, фирменная металлическая фурнитура и необработанные края. Сзади два накладных кармана, спереди классические карманы и пояс со шлёвками.\nСостояние хорошее, естественные заломы и следы носки на коже.\nЗамеры: длина 106 см, полупояс 41 см, выход 22 см.',
        },
      },
      {
        photos: ['4893-0.jpg', '4893-1.jpg', '4893-2.jpg', '4893-3.jpg', '4893-4.jpg', '4893-5.jpg', '4893-6.jpg'],
        input: {
          title: 'Джинсы Crosshatch S55 low rise',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 145,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Crosshatch', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: W32 L32.\nДжинсы из линейки Crosshatch S55 в выразительном экспериментальном крое с широкими прямыми штанинами. Голубой деним с интенсивной варкой, неоднородными высветлениями и характерной вертикальной текстурой. Многочисленные конструктивные швы, изогнутые панели и усиленные участки в области колен формируют сложную геометрию силуэта.\nНеобычная конструкция передних карманов с заострёнными краями, массивные задние карманы с клапанами и декоративными ремешками на металлических пряжках. Фирменная фурнитура Crosshatch, контрастная прострочка, длинные вертикальные вставки вдоль штанин и необработанный низ с выраженной бахромой.\nСостояние хорошее, присутствуют характерные фейды и локальный дистресс.\nЗамеры: длина 106 см, полупояс 42 см, посадка 24 см, выход 21 см.',
        },
      },
      {
        photos: ['4900-0.jpg', '4900-1.jpg', '4900-2.jpg', '4900-3.jpg', '4900-4.jpg'],
        input: {
          title: 'Кожаная косуха Mint Velvet песочно-бежевая',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Mint Velvet', color: 'beige', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nЖенская кожаная куртка Mint Velvet в приглушённом песочно-бежевом оттенке. Приталенный силуэт с подчёркнутой талией, удлинёнными узкими рукавами и выразительной асимметричной конструкцией передней части. Натуральная кожа с мягкой зернистой фактурой, естественными заломами и благородным винтажным характером.\nНеобычная диагональная застёжка с широкой кожаной планкой, высокий воротник, фигурные швы и усиленные плечевые панели. Три передних кармана на металлических молниях, дополнительные молнии на рукавах и качественная фурнитура YKK с массивными металлическими пуллерами.\nСостояние хорошее, присутствуют естественные следы носки, неоднородность оттенка кожи.\nЗамеры: длина 59 см, плечи 36 см, ширина 46 см, рукав 60 см.',
        },
      },
      {
        photos: ['4905-0.jpg', '4905-1.jpg', '4905-2.jpg', '4905-3.jpg', '4905-4.jpg', '4905-5.jpg', '4905-6.jpg'],
        input: {
          title: 'Джинсы Lee Stella A-Line washed black',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Lee', color: 'gray', gender: 'FEMALE', material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: W30 L31.\nВыстиранные чёрно-серые Lee Stella A Line из плотного хлопкового денима. Цвет уходит в холодный charcoal с естественными высветлениями по швам и складкам, редкий широкий прямой силуэт даёт тяжёлую, спокойную посадку.\nКрупные задние карманы с волнообразной строчкой, брендированная металлическая фурнитура, молния YKK и фактурный патч на поясе. Деним уже получил красивую неоднородную выработку, поэтому вещь выглядит живой и фактурной.\nЗамеры: длина 108 см, полупояс 38 см, выход 28.5 см.',
        },
      },
      {
        photos: ['4914-0.jpg', '4914-1.jpg', '4914-2.jpg', '4914-3.jpg', '4914-4.jpg'],
        input: {
          title: 'Серое жаккардовое зип-худи',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Трикотаж', styleTags: ['Casual'],
          description: 'Размер по бирке: XL.\nСерая зип-худи с жаккардовым паттерном по всей поверхности. Выполнена из плотного фактурного трикотажа.\nСвободный силуэт с капюшоном на шнурках, двумя накладными карманами и трикотажными манжетами по низу и рукавам. Металлическая молния YKK и металлические наконечники на шнурках. Спокойная однотонная база с необычной текстурой.\nЗамеры: длина 70 см, ширина 62 см, рукав 81 см.',
        },
      },
      {
        photos: ['4926-0.jpg', '4926-1.jpg', '4926-2.jpg', '4926-3.jpg', '4926-4.jpg', '4926-5.jpg', '4926-6.jpg'],
        input: {
          title: 'Винтажная кожаная мотокуртка Hein Gericke',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'RU', sizeValue: '52', price: 360,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Hein Gericke', color: 'black', gender: 'MALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 52.\nВинтажная кожаная мотокуртка Hein Gericke в глубоком чёрном цвете с характерной состаренной фактурой. Плотная натуральная кожа с выраженными заломами и естественной патиной, объёмный силуэт с широкими плечами и укороченной посадкой в классический motorcycle jacket.\nНеобычная модульная конструкция с металлическими молниями на плечах и рукавах, высокий воротник-стойка с кнопками и стёганая внутренняя подкладка. Массивная фурнитура YKK с фирменным пуллером, асимметричный нагрудный карман, два боковых кармана с клапанами и плотные рибовые манжеты с поясом.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 68 см, плечи 51 см, ширина 57 см, рукав от плеча 67 см.',
        },
      },
      {
        photos: ['4952-0.jpg', '4952-1.jpg'],
        input: {
          title: 'Винтажная сумка из натурального меха',
          category: 'bags', subcategory: 'handbag', price: 240,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Роскошная сумка из пушистого натурального меха насыщенного тёмно-коричневого оттенка с переливами карамели и чёрного. Мягкая, объёмная форма обеспечивает вместительность и комфортное ношение на плече. Удобный широкий ручной ремень повторяет линию сумки и не врезается в плечо. Эффектный текстурный акцент делает сумку центральным элементом образа. Сумка застегивается на клёпку.\nБольшой размер.',
        },
      },
      {
        photos: ['4954-0.jpg', '4954-1.jpg', '4954-2.jpg', '4954-3.jpg', '4954-4.jpg'],
        retext: true,
        input: {
          title: 'Укороченный бомбер Selected из искусственного меха',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Слегка сыпется внутренняя отделка молнии из кожзама.',
          brand: 'Selected', color: 'brown', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nУкороченный меховой бомбер с объёмным силуэтом и выразительной фактурой длинноворсового искусственного меха. Неоднородный окрас с переходами от тёмно-коричневого и графитового до светлых пепельно-бежевых оттенков создаёт эффект натурального меха.\nМассивный воротник-стойка, металлическая молния YKK, плотные трикотажные манжеты и широкий эластичный пояс шоколадного оттенка. Контраст между пушистым объёмным верхом и собранным низом формирует характерный силуэт мехового бомбера.\nСостояние хорошее, слегка сыпется внутренняя отделка молнии из кожзама.\nЗамеры: длина 54 см, ширина 52 см, рукав от горла 72 см.',
        },
      },
      {
        photos: ['4959-0.jpg', '4959-1.jpg', '4959-2.jpg', '4959-3.jpg', '4959-4.jpg', '4959-5.jpg', '4959-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы Yes Jeans с графикой и дистрессом',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W28', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Yes Jeans', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 28.\nДжинсы в прямом силуэте с широкими штанинами, легкое расширение к низу. Плотный синий деним с выраженным винтажным выцветанием, контрастными потёртостями и естественными заломами. Крупная красная графика YES JEANS, многослойный текстовый принт и декоративные нашивки с необработанными краями.\nРваные вставки с бахромой, искусственно состаренные участки, контрастная рыжая строчка и фигурная вышивка на задних карманах. Металлическая брендированная фурнитура, молния YKK, фирменный кожаный патч и клетчатая отделка внутренней части пояса.\nСостояние хорошее, без нюансов.\nЗамеры: длина 102 см (можно расшить до 106 см), полупояс 38 см, выход 22 см.',
        },
      },
      {
        photos: ['4966-0.jpg', '4966-1.jpg', '4966-2.jpg', '4966-3.jpg', '4966-4.jpg', '4966-5.jpg', '4966-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы Next boot fit washed',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Next', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 36x34.\nДжинсы Next в силуэте bootcut с прямой посадкой в верхней части и лёгким расширением штанин к низу. Плотный деним приглушённого сине-графитового оттенка с неоднородной винтажной варкой, естественными высветлениями и выраженными следами заломов на бёдрах и под коленями.\nКлассическая конструкция с пятью карманами, застёжка на болтах с фирменной гравировкой. Контрастная строчка, фигурные задние карманы с декоративной вышивкой и характерная фактура потёртого денима.\nСостояние хорошее, без нюансов.\nЗамеры: длина 110 см, полупояс 45 см, выход 23 см.',
        },
      },
      {
        photos: ['4980-0.jpg', '4980-1.jpg'],
        input: {
          title: 'Джинсы Armani Jeans loose raw indigo',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Jeans', color: 'blue', gender: null, material: 'Деним', styleTags: ['Minimal'],
          description: 'Размер по бирке: 32x34.\nДжинсы в свободном прямом силуэте с широкими штанинами и расслабленной посадкой. Плотный тёмно-синий деним с неоднородной текстурой и глубоким оттенком индиго. Минималистичный дизайн без выраженных потёртостей и контрастной обработки.\nКлассическая пятикарманная конструкция, металлическая фурнитура, шлёвки для ремня и аккуратные задние карманы с угловатой геометрией. Фирменный светлый патч с логотипом орла Armani на задней части пояса.\nСостояние хорошее, без видимых дефектов.\nЗамеры: длина 115 см, полупояс 42 см, выход 26 см.',
        },
      },
      {
        photos: ['4982-0.jpg', '4982-1.jpg', '4982-2.jpg', '4982-3.jpg', '4982-4.jpg', '4982-5.jpg', '4982-6.jpg'],
        input: {
          title: 'Джинсы Inscene straight washed',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Inscene', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 30x32.\nДжинсы INSCENE с прямым свободным силуэтом и длинными широкими штанинами. Плотный синий деним с выраженной винтажной варкой, неоднородными высветлениями и вертикальной текстурой ткани. Характерные потёртости на бёдрах, коленях и вдоль швов создают естественный состаренный эффект.\nКлассическая конструкция с пятью карманами, металлическая фурнитура с фирменной гравировкой INSCENE, молния YKK. Задние карманы с фигурной декоративной строчкой и небольшим тканевым брендингом.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 110 см, полупояс 41 см, выход 22 см.',
        },
      },
      {
        photos: ['4996-0.jpg', '4996-1.jpg', '4996-2.jpg', '4996-3.jpg', '4996-4.jpg', '4996-5.jpg', '4996-6.jpg'],
        input: {
          title: 'Кожаная стёганая куртка-бомбер',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nУкороченная кожаная куртка в чёрном цвете с приталенным силуэтом и выраженной фактурой кожи. Стёганые ромбовидные панели на плечах, груди и спине, массивный воротник-трансформер из плотного трикотажа с молнией по краю.\nДвухслойная застёжка на металлическую молнию YKK и крупные пуговицы, вертикальные карманы на молниях, дополнительный карман на рукаве. Широкий трикотажный пояс и удлинённые манжеты создают характерный силуэт. Металлическая фурнитура под латунь.\nСостояние хорошее, естественные следы носки и заломы кожи.\nЗамеры: длина 57 см, ширина 46 см, рукав 74 см.',
        },
      },
      {
        photos: ['5003-0.jpg', '5003-1.jpg'],
        input: {
          title: 'Винтажный свитер Chemise Lacoste с орнаментом',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 155,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительная дырочка.',
          brand: 'Lacoste', color: 'green', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: XL (8).\nВинтажный французский свитер Chemise Lacoste из линейки Loisirs. Объёмный расслабленный силуэт со спущенной линией плеча и широкими рукавами. Фактурный трикотаж с чередованием тёмно-синих, изумрудных и белых полос, дополненных геометрическим орнаментом с красными акцентами.\nВыразительная рельефная вязка, плотная круглая горловина, эластичные манжеты и нижняя резинка. На груди фирменная вышивка крокодила Lacoste. Оригинальная винтажная бирка с маркировкой Made in France.\nСостояние хорошее, незначительная дырочка.\nЗамеры: длина 67 см, ширина 67 см, рукав 80 см.',
        },
      },
      {
        photos: ['5017-0.jpg', '5017-1.jpg', '5017-2.jpg', '5017-3.jpg', '5017-4.jpg', '5017-5.jpg', '5017-6.jpg'],
        input: {
          title: 'Джинсы Next straight washed blue',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Next', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: 36x32.\nДжинсы в классическом прямом силуэте с комфортной посадкой и свободными ровными штанинами. Плотный синий деним с выразительной винтажной варкой, плавными высветлениями по всей длине и естественными заломами в области бёдер и коленей.\nТрадиционная пятикарманная конструкция, застёжка на металлических пуговицах с фирменной гравировкой, контрастная строчка и характерные задние карманы с геометрической прострочкой. Красивый неоднородный оттенок голубого денима с эффектом длительной носки.\nСостояние хорошее, без видимых дефектов.\nЗамеры: длина 106 см, полупояс 46 см, выход 21 см.',
        },
      },
      {
        photos: ['5024-0.jpg', '5024-1.jpg', '5024-2.jpg', '5024-3.jpg', '5024-4.jpg', '5024-5.jpg', '5024-6.jpg'],
        input: {
          title: 'Винтажные джинсы Disil bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W28', price: 125,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Disil', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 28.\nВинтажные джинсы Disil в индиго-wash с выраженными высветлениями по бёдрам и коленям. Деним с cross hatch фактурой по всей поверхности, за счёт которой цвет выглядит особенно объёмно. Посадка по фигуре в верхней части, штанина плавно сужается к колену и заметно раскрывается к низу — классический bootcut силуэт с характерной эстетикой нулевых. Фирменная металлическая фурнитура с гравировкой DISIL, брендированные детали на coin pocket и поясе, задние карманы с лаконичной фигурной строчкой.\nМатериал тянется.\nЗамеры: длина 105 см, полупояс 38 см, выход 25 см.',
        },
      },
      {
        photos: ['5031-0.jpg', '5031-1.jpg', '5031-2.jpg', '5031-3.jpg', '5031-4.jpg'],
        input: {
          title: 'Винтажное двубортное полупальто GAP',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 205,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Пятнышки на подкладке внутри.',
          brand: 'GAP', color: 'black', gender: null, material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nВинтажное двубортное полупальто GAP в глубоком чёрном оттенке с выразительным силуэтом и укороченной длиной. Плотная фактурная шерсть/хлопок с мягкой ворсистой поверхностью, чёткая линия плеч и аккуратная структурированная посадка.\nКлассическая двубортная конструкция с четырьмя крупными пуговицами, широкими заострёнными лацканами и отложным воротником. Два накладных кармана с клапанами, лаконичная чёрная фурнитура и контрастная подкладка в тонкую вертикальную полоску. Сдержанная эстетика архивного GAP с элементами классического минимализма 90-х.\nСостояние хорошее, пятнышки на подкладке внутри.\nЗамеры: длина 59 см, плечи 41 см, рукав от плеча 60 см.',
        },
      },
      {
        photos: ['5036-0.jpg', '5036-1.jpg', '5036-2.jpg', '5036-3.jpg', '5036-4.jpg', '5036-5.jpg', '5036-6.jpg'],
        input: {
          title: 'Джинсы Levi’s 505 Original Straight',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Levi’s', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x30.\nОдна из лучших straight fit Levi’s из плотного голубого денима с прямым свободным силуэтом посадкой. Светло-голубой винтажный wash с выраженными горизонтальными потёртостями на бёдрах, естественными высветлениями и мягкими переходами оттенков по всей длине.\nТрадиционная конструкция с пятью карманами, фирменная застёжка на болтах, металлическая фурнитура Levi’s, красный таб на заднем кармане и кожаный патч. Натуральные заломы и характерная фактура выстиранного денима.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 105 см, полупояс 43 см, выход 21 см.',
        },
      },
      {
        photos: ['5043-0.jpg', '5043-1.jpg', '5043-2.jpg', '5043-3.jpg', '5043-4.jpg', '5043-5.jpg', '5043-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы Route One 1989 baggy',
          category: 'jeans', subcategory: 'baggy', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Route One', color: 'blue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 32x32.\nШикарный baggy деним Route One из сырого денима с широким свободным силуэтом и прямыми штанинами. Глубокий washed indigo с холодным графитовым подтоном, деликатными вертикальными высветлениями, естественными заломами и мягкими переходами оттенков по всей длине. Характерная сухая фактура денима с выраженным диагональным плетением, легкое добавление эластана.\nКлассическая конструкция с пятью карманами, широкой посадкой и аккуратной контрастной строчкой табачного оттенка. Металлическая фурнитура с гравировкой 1989, молния YKK, фирменный кожаный патч Route One и контрастные красные детали.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 109 см, полупояс 40–42 см, выход 25 см.',
        },
      },
      {
        photos: ['5057-0.jpg', '5057-1.jpg', '5057-2.jpg', '5057-3.jpg', '5057-4.jpg', '5057-5.jpg', '5057-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы Vehicle Denim loose fit washed black',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Vehicle', color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x32.\nДжинсы из плотного фактурного денима с широким свободным силуэтом и расслабленной посадкой. Глубокий графитово-серый washed black с холодным подтоном, характерными вертикальными высветлениями, естественными заломами и мягкими переходами оттенков по всей длине. Выразительная винтажная фактура с эффектом состаренного денима.\nКлассическая конструкция с пятью карманами, массивными прямыми штанинами и контрастной строчкой приглушённого золотистого оттенка. Фирменная металлическая фурнитура Vehicle с гравировкой, молния YKK, декоративная прострочка задних карманов и необычный кожаный патч с графикой Vehicle Denim.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 108 см, полупояс 42 см, выход 23.5 см.',
        },
      },
      {
        photos: ['5064-0.jpg', '5064-1.jpg', '5064-2.jpg', '5064-3.jpg', '5064-4.jpg'],
        input: {
          title: 'Винтажный пуховик Nike',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Nike', color: 'black', gender: null, material: 'Нейлон', styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: XL.\nВинтажный объёмный пуховик Nike в глубоком чёрном оттенке с массивным puffer-силуэтом и расслабленной посадкой. Плотный матовый нейлон с лёгким сатиновым отливом, крупными пуховыми секциями, широкой линией плеч и характерными объёмными рукавами. Выразительная эстетика архивной спортивной одежды Nike конца 90-х и начала 2000-х.\nМассивный высокий воротник с мягкой серой флисовой подкладкой, вышивка Nike Swoosh на груди, глубокие боковые карманы и регулируемая кулиска по нижнему краю. Фирменные металлические пуллеры Nike, массивная молния YKK VISLON и эластичные манжеты. Минималистичный дизайн с акцентом на объём, пропорции и функциональные детали.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 74 см, ширина 63 см, рукав от горла 77 см.',
        },
      },
      {
        photos: ['5069-0.jpg', '5069-1.jpg', '5069-2.jpg', '5069-3.jpg', '5069-4.jpg'],
        input: {
          title: 'Чёрные джинсы Versace Sport',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 180,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Versace', color: 'black', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 36.\nЧёрные джинсы Versace с прямым свободным силуэтом и широкими штанинами. Плотный деним с приглушённой винтажной варкой, мягкими тональными переходами и естественными заломами по всей длине. Расслабленная посадка и минималистичный дизайн в эстетике итальянского денима 2000-х.\nКлассическая конструкция с пятью карманами, металлическая фурнитура с фирменной гравировкой Medusa, застёжка на молнии YKK. Задние карманы с геометрической прострочкой, декоративной металлической заклёпкой и лаконичным брендингом Versace.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 109 см, полупояс 43 см, выход 23 см.',
        },
      },
      {
        photos: ['5074-0.jpg', '5074-1.jpg', '5074-2.jpg', '5074-3.jpg', '5074-4.jpg', '5074-5.jpg', '5074-6.jpg'],
        input: {
          title: 'Кожаные ботильоны A.S.98 на платформе',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 340,
          condition: 'GOOD', defectsPresent: false,
          brand: 'A.S.98', color: 'brown', gender: 'FEMALE', material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 38.\nМассивные кожаные ботильоны в глубоком тёмно-коричневом оттенке с выразительной состаренной фактурой, естественными заломами и красивой патиной. Характерный авангардный силуэт с высоким наборным каблуком, грубой тракторной платформой и многослойными кожаными ремешками на подъёме.\nАкцентные металлические молнии сзади с фирменными пуллерами A.S.98, итальянская фурнитура, декоративные люверсы и объёмные конструктивные швы. Эстетика с характерной грубостью и фактурностью.\nСостояние хорошее, естественные следы носки.',
        },
      },
      {
        photos: ['5086-0.jpg', '5086-1.jpg'],
        input: {
          title: 'Чёрный свитер с воротником-стойкой на молнии',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Трикотаж', styleTags: ['Minimal'],
          description: 'Размер по бирке: L.\nТрикотажный свитер в глубоком чёрном оттенке с аккуратным силуэтом. Плотный мягкий трикотаж с мелкой однородной вязкой, плавной линией плеч и естественной фактурой материала.\nВыразительный высокий воротник-стойка с крупной ребристой вязкой, двухзамковая металлическая молния и широкие эластичные манжеты. Рельефные трикотажные вставки по бокам и плотная резинка по нижнему краю.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 63 см, ширина 50 см, рукав 70 см.',
        },
      },
      {
        photos: ['5088-0.jpg', '5088-1.jpg', '5088-2.jpg', '5088-3.jpg', '5088-4.jpg'],
        input: {
          title: 'Утеплённый бомбер Zavetti Canada с меховым капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'S', price: 240,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительная полоска от ручки.',
          brand: 'Zavetti Canada', color: 'gray', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: S.\nМассивный утеплённый бомбер в графитовом оттенке с объёмным силуэтом и густой меховой опушкой капюшона. Плотная матовая ткань, высокая горловина, широкие рукава и плотные манжеты.\nФирменный шеврон Zavetti Canada, фурнитура SAB, нагрудный карман на молнии и регулируемый капюшон. Выразительный силуэт в связке с экстремальным температурным режимом.\nСостояние хорошее, незначительная полоска от ручки.\nЗамеры: длина 61 см, ширина 57 см, рукав 75 см.',
        },
      },
      {
        photos: ['5093-0.jpg', '5093-1.jpg', '5093-2.jpg', '5093-3.jpg', '5093-4.jpg'],
        input: {
          title: 'Винтажные ботинки Bundeswehr на молнии',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '41.5', price: 340,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: 41,5 (265).\nВинтажные кожаные ботинки немецкой армейской авиации Bundeswehr в глубоком чёрном оттенке. Массивный округлый мыс, высокий милитари-силуэт, плотная гладкая кожа с естественными заломами и выразительная контрастная прошивка вдоль подошвы.\nНеобычная конструкция с фронтальными панелями на полноразмерных молниях и высокой шнуровкой для удобного надевания. Натуральная кожаная подкладка с оригинальным армейским клеймом, металлические люверсы и массивная резиновая подошва с рельефным протектором. Аутентичный немецкий винтаж с характерной авангардной эстетикой.\nСостояние хорошее, для возраста считаются новыми.',
        },
      },
      {
        photos: ['789-0.jpg', '789-1.jpg'],
        retext: true,
        input: {
          title: 'Пушистая укороченная кофта из перьев',
          category: 'knitwear', subcategory: 'cardigan', sizeSystem: 'ALPHA', sizeValue: 'S', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nКороткая пушистая и мягкая кофта. Плотный, но лёгкий ворс придаёт объём и шелковистый блеск, а укороченный крой подчёркивает талию. Модель с открытым передом и облегающим рукавом. Сама кофта выполнена из кружевного материала. Универсальная носка.\nЗамеры: ширина 43 см, длина 42 см, рукав 64 см.',
        },
      },
      {
        photos: ['854-0.jpg', '854-1.jpg', '854-2.jpg', '854-3.jpg', '854-4.jpg'],
        retext: true,
        input: {
          title: 'Бордовая кожаная куртка с меховой отделкой',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 180,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nПриталенная куртка насыщенного винно‑бордового цвета, выполненная из мягкой натуральной кожи. Имеется эффектная пушистая оторочка на воротнике и по краю рукавов. Мех плавно переходит от тёмно‑бордового к светло‑розовому. На куртке присутствует итальянская фурнитура Lampo, с двойным бегунком. Идеальный вариант для холодной погоды, когда хочется выглядеть стильно и не терять комфорта.\nЗамеры: длина 56 см, ширина 45 см, рукав 70 см.',
        },
      },
      {
        photos: ['1106-0.jpg', '1106-1.jpg', '1106-2.jpg', '1106-3.jpg', '1106-4.jpg'],
        input: {
          title: 'Худи цвета асфальт с меховой опушкой капюшона',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 115,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nШикарное худи из 100% хлопка. Цвет асфальта, матовый выстиранный черный. Огромный капюшон с пышной опушкой, капюшон буквально на две головы. Контрастная строчка. Широкий укороченный крой, все что тебе нужно от этого худи.',
        },
      },
      {
        photos: ['1111-0.jpg', '1111-1.jpg', '1111-2.jpg', '1111-3.jpg', '1111-4.jpg', '1111-5.jpg', '1111-6.jpg'],
        retext: true,
        input: {
          title: 'Джинсы Oakley straight индиго',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W38', price: 115,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Oakley', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: 38x32.\nЛучшие портки под ремень.\nДжинсы твоего любимого бренда из плотного денима тёмно‑индиго/синий оттенок. Модель прямого кроя, straight силуэта. Брендированная фурнитура, внутри пояса контрастная подкладка. На поясе дополнительный шнурок с фирменными наконечниками. Легкие естественные складки и выцветание по бедрам и коленям.',
        },
      },
      {
        photos: ['1342-0.jpg', '1342-1.jpg', '1342-2.jpg', '1342-3.jpg', '1342-4.jpg'],
        input: {
          title: 'Серое бланковое худи с винтажной потёртостью',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'L', price: 75,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nПрекраснейшее, бланковое худи с эффектом благородной винтажной потертости; плотный хлопок, внутри легкий флис. Чистый холст без логотипов и надписей, на любой повод. Капюшон с двойной строчкой и регулируемым шнурком; при надобности нужно вставить шнурок в манжет.\nЗамеры: длина 63 см, ширина 76 см, рукав 73 см.',
        },
      },
      {
        cover: '1411-1.jpg',
        photos: ['1411-0.jpg', '1411-1.jpg', '1411-2.jpg', '1411-3.jpg'],
        input: {
          title: 'Сумка George Gina & Lucy utility',
          category: 'bags', subcategory: 'handbag', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'George Gina & Lucy', color: 'blue', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Редкая и максимально характерная сумка в духе early 00s / tech utility. Яркий blue корпус, тёмно-синие стропы и массивная металлическая фурнитура дают очень сильный контраст. Спереди фирменный карабин GG&L, ремни на пряжках, заклёпки и куча мелких технических деталей. Есть короткие ручки и длинный регулируемый ремень — можно носить как в руке, так и через плечо. Внутри полноценное отделение с дополнительным карманом. За счёт цвета и количества фурнитуры выглядит как полноценный акцент в образе, а не просто обычная сумка.\nСредний размер.',
        },
      },
      {
        photos: ['1415-0.jpg', '1415-1.jpg', '1415-2.jpg', '1415-3.jpg', '1415-4.jpg', '1415-5.jpg', '1415-6.jpg'],
        input: {
          title: 'Чёрная кожаная косуха washed',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительные потёртости.',
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nУдачная чёрная косуха с правильным винтажным характером — не гладкая эко кожа, а живая фактура с естественными заломами, потёртостями и слегка выцветшими участками. За счёт этого куртка со временем будет становиться только красивее.\nКлассическая конструкция с асимметричной центральной молнией, двумя карманами на металлических молниях, длинными молниями на манжетах и ремешками снизу. Посадка достаточно компактная и аккуратная по корпусу, при этом рукава вытянутые. Незначительные потертости.\nЗамеры: длина 56 см, плечи 42 см, ширина 45 см, рукав от плеча 64 см.',
        },
      },
    ],
  },
  {
    // 2026-11-05, «Вторичка»: a reseller of personal archive pieces (t.me/harajuku2, stock in t.me/harajuku2available).
    // The stock channel on 2026-11-05 minus two items the main channel marks sold; prices are the owner's byn ones;
    // «condition 9,5» → LIKE_NEW. Two posts hold two items each (a jacket and shorts, a tee and shorts): split by photo.
    username: 'harajuku2',
    folder: 'harajuku2',
    account: { bio: 'harajuku原宿 — личные вещи: архивные куртки, обувь, сумки. Доставка по всему миру.', brandName: 'harajuku原宿', logo: 'logo.jpg', catalog: true },
    items: [
      {
        cover: '429-2.jpg',
        photos: ['429-0.jpg', '429-1.jpg', '429-2.jpg'],
        input: {
          title: 'Футболка Hard Rock Couture Copenhagen',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 75,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Hard Rock Cafe', color: 'beige', gender: 'MALE', material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nВсеми любимый мерч кофейни. Слим посадка. Очень приятные материалы. Вставки из камней.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['453-2.jpg', '453-3.jpg'],
        input: {
          title: 'Хлопковая зип-кофта Daniele Alessandrini с кожаными полосами',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 110,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Daniele Alessandrini', color: 'beige', gender: 'MALE', material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nЗипка-лонг от итальянского дизайнера: кожаные полосы, вызывающий принт на спине, несколько вариантов стилизации.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['453-4.jpg', '453-1.jpg', '453-0.jpg'],
        retext: true,
        input: {
          title: 'Шорты с заниженной мотнёй в стиле BBS',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'L', priceNegotiable: true,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: 'MALE', material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nЛучшая форма шорт на данный момент.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['472-1.jpg'],
        input: {
          title: 'Серая футболка с молниями на плечах',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 60,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: 'MALE', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nСлим фит. Приятный серо-черно-графитовый цвет. Зипы на плечах как акцент. V-образная нижняя часть.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['472-2.jpg', '472-0.jpg'],
        input: {
          title: 'Серые шорты-карго washed',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 80,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: 'MALE', material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Шорты словно стирали миллион раз до состояния изнеможения: приятный графитовый состаренный окрас, функциональные карманы по бокам.',
        },
      },
      {
        photos: ['604-0.jpg', '604-1.jpg', '604-2.jpg'],
        retext: true,
        input: {
          title: 'Кеды Gucci GG Monogram чёрные',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'OTHER', sizeValue: '40–41', price: 300,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Gucci', color: 'black', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 40–41 (стелька 25,4 см).\nКеды от легендарного бренда. Были куплены новыми в 2018 году. Отличное состояние как снаружи так и внутри. Монограмма Gucci по бокам. Идеальная пара на каждый день.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['711-0.jpg', '711-1.jpg', '711-2.jpg', '711-3.jpg', '711-4.jpg'],
        input: {
          title: 'Винтажное полупальто с четырьмя пуговицами на воротнике',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'L', price: 150,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nВинтажное полупальто с крутым рядом из 4х пуговиц на воротнике. Материал легкий. Можно носить как второй слой под куртку, или же как верхний слой в теплые дни. Качественное исполнение.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['750-0.jpg', '750-1.jpg', '750-2.jpg'],
        retext: true,
        input: {
          title: 'Тёмно-синее пальто Object с капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'L', price: 125,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Object', color: 'blue', gender: null, styleTags: ['Minimal'],
          description: 'Размер по бирке: L.\nПальто от Object красивого темно-синего цвета. Огромный капюшон с приятной посадкой. Высокий воротник goa-type. Удобная молния.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '841-2.jpg',
        photos: ['841-0.jpg', '841-1.jpg', '841-2.jpg'],
        retext: true,
        input: {
          title: 'Высокие кеды Diesel с дистрессом',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'SHOE_EU', sizeValue: '44', price: 285,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: 'MALE', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: 44 (стелька 28,5 см), можно пробовать на больший размер.\nМодель живущая своей жизнью. С течением времени верхний слой ткани приобретает свой индивидуальный паттерн. Мега крутое качество сборки как подобает старому Diesel. Редкая пара.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['846-0.jpg', '846-1.jpg', '846-2.jpg'],
        input: {
          title: 'Кожаная куртка с фактурой рептилии и высоким воротником',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 200,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nПаттерн кожи рептилии придает статус и отчужденность. Очень приятные тугие манжеты. Безумная вещь.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '856-2.jpg',
        photos: ['856-0.jpg', '856-1.jpg', '856-2.jpg', '856-3.jpg'],
        retext: true,
        input: {
          title: 'Тёмно-синий бомбер с объёмными 3D-карманами',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'L', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nБомбер с шикарными 3д карманами по всему периметру. Сделан из качественного хлопка. Очень напоминает парашют-бомбер Issey Miyake.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['863-0.jpg', '863-1.jpg', '863-2.jpg'],
        retext: true,
        input: {
          title: 'Зимний бомбер с рефлективной нитью и капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 170,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nБомбер c интересными вкраплениями рефлективных нитей что даст крутую фактуру ткани при свете. Огромный капюшон, тугие манжеты - одни плюсы против холодной погоды.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['885-0.jpg', '885-1.jpg'],
        retext: true,
        input: {
          title: 'Милитари-бомбер Gate One с 3D-карманами',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Gate One', color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: S–M.\nКрутой теплый бомбер в милитари эстетике. Огромные карманы подчеркивают функциональность и продуманность. На спине располагается огромная вышитая звезда. Вкус Америки 90-х.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['890-0.jpg', '890-1.jpg'],
        retext: true,
        input: {
          title: 'Рюкзак из латекса с фактурой кожи',
          category: 'bags', subcategory: 'backpack', price: 190,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'На первый взгляд кажется что рюкзак сделан из кожи. Только спустя два дня я понял, что этот материал — ультракачественный экспериментальный латекс. Но от кожи тактильно и визуально он ничем не отличается. Это дает рюкзаку огромную долговечность и тактильно очень приятные ощущения. Состаренный металл. Вместительный аксессуар на каждый день.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['894-0.jpg', '894-1.jpg', '894-2.jpg', '894-3.jpg', '894-4.jpg'],
        retext: true,
        input: {
          title: 'Милитари-куртка с дистрессом и высоким воротом',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 150,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: L.\nКуртка с узнаваемым почерком военной тематики. Но создатели решили иначе. Дистресс, множество деталей выбивающих вещь из привычной формы. Высокое горло обвивающее шею.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '911-1.jpg',
        photos: ['911-0.jpg', '911-1.jpg', '911-2.jpg'],
        retext: true,
        input: {
          title: 'Зимняя парка Khujo с вакс-эффектом',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Khujo', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nТяжёлый зимний люкс от Khujo. Вакс эффект. Разные оттенки черного. Множество деталей. Огроменные карманы. Большой капюшон и высокое горло. Нет лучше варианта для холодной зимы -30 градусов.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '919-3.jpg',
        photos: ['919-0.jpg', '919-1.jpg', '919-2.jpg', '919-3.jpg', '919-4.jpg', '919-5.jpg'],
        retext: true,
        input: {
          title: 'Куртка Naketano с мульти-зипами и капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 190,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Naketano', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nПрекрасная куртка с читаемым стилем Naketano. Мульти зип где это только возможно. Большой капюшон с необычными деталями. Тугие манжеты. Отличный элемент аутфита.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['926-0.jpg', '926-1.jpg'],
        retext: true,
        input: {
          title: 'Кожаная сумка-мессенджер',
          category: 'bags', subcategory: 'crossbody', price: 165,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Minimal'],
          description: 'Ультра визуальный айтем. С первого взгляда минималистичная сумка - но текстура кожи создает все детали сама. Очень качественная и вместительная сумка.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['928-0.jpg', '928-1.jpg', '928-2.jpg'],
        retext: true,
        input: {
          title: 'Ботинки с принтом черепов',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '43', price: 140,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 43 (стелька 27,5–28 см).\nБотинки с принтом злых скелетонов которые хотят уничтожить мир. Главное самому не быть злым.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '931-1.jpg',
        photos: ['931-0.jpg', '931-1.jpg', '931-2.jpg'],
        retext: true,
        input: {
          title: 'Свитер на молнии с необычным фейдом',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nСвитер с максимально необычным фейдом. Очень крутой и актуальный крой. Качественные материалы.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '934-1.jpg',
        photos: ['934-0.jpg', '934-1.jpg', '934-2.jpg'],
        retext: true,
        input: {
          title: 'Чёрная лёгкая куртка с четырьмя карманами и съёмным капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 140,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nОчень фактурный и детализированный айтем. Съёмный капюшон. Вещь можно классно носить как второй слой под куртку. Телесная и легкая ткань. Карманы украшены лентами и кнопками.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        cover: '939-2.jpg',
        photos: ['939-0.jpg', '939-1.jpg', '939-2.jpg'],
        retext: true,
        input: {
          title: 'Кожаная куртка с паттерном рептилии и острым воротником',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 180,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nНатуральная кожа прошитая паттерном рептилии показывает силу человека как живого существа. Крутая вещь с характером. Острый воротник. Качественная фурнитура и теплая подкладка.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
    ],
  },
  {
    // 2026-11-06: psy (t.me/psysectiony), a Minsk reseller of vintage and archive — denim, leather, outerwear, shoes;
    // the items of its second channel балкон (t.me/balconysection, the simpler and cheaper things: post ids 930–1502)
    // are in the same batch since 2026-11-06 evening — the owner wanted one account, so @balconysection was merged into
    // @psysectiony (MERGES below) and its photos moved into this folder.
    // Only the posts still open there (a «#наличие» post with a price and no sold mark); the channel's own BYN prices.
    // Photo 0 of a post is the whole item laid flat, so it is the cover as it stands. Posts of several items at once,
    // items held in Russia and new stock in several sizes are left out.
    username: 'psysectiony',
    folder: 'psysectiony',
    account: { bio: 'psy — винтаж и архив из Минска: деним, кожа, верхняя одежда, обувь. Без возврата; встреча в Минске, отправка по Беларуси.', brandName: 'psy', logo: 'logo.jpg', catalog: true },
    items: [
      {
        photos: ['3045-0.jpg', '3045-1.jpg', '3045-2.jpg'],
        input: {
          title: 'Кеды Converse Polka Dot Double в горох',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'SHOE_EU', sizeValue: '40', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Converse', color: 'red', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: 40 (255 мм).\nОчень рарная пара, 2 слоя ткани для разных способов стилизации, ebay от 120$.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3133-0.jpg', '3133-1.jpg'],
        input: {
          title: 'Камуфляжные шорты Brandit light camo',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Brandit', color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Outdoor'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, полупояс 45 см, выход 29 см.',
        },
      },
      {
        photos: ['3220-0.jpg', '3220-1.jpg'],
        input: {
          title: 'Джинсовые шорты карго с выцветанием',
          category: 'shorts', subcategory: 'denim-shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, полупояс 50 см, выход 32 см.',
        },
      },
      {
        photos: ['3222-0.jpg', '3222-1.jpg'],
        input: {
          title: 'Широкие серые джинсовые шорты со шнуровкой',
          category: 'shorts', subcategory: 'denim-shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 78 см, полупояс 48 см, выход 35 см.',
        },
      },
      {
        photos: ['3226-0.jpg', '3226-1.jpg'],
        input: {
          title: 'Джинсовые шорты карго Combats',
          category: 'shorts', subcategory: 'denim-shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, полупояс 47 см, выход 31 см.',
        },
      },
      {
        photos: ['3249-0.jpg'],
        input: {
          title: 'Шорты карго Ochenta с ремешками, оливковые',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 70,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nСерая пара из того же поста продаётся отдельно.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, полупояс 50 см, выход 30 см.',
        },
      },
      {
        photos: ['3249-1.jpg'],
        input: {
          title: 'Шорты карго Ochenta с ремешками, серые',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 70,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nОливковая пара из того же поста продаётся отдельно.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, полупояс 50 см, выход 30 см.',
        },
      },
      {
        photos: ['3269-0.jpg'],
        input: {
          title: 'Шлёпанцы на платформе 4 см',
          category: 'shoes', subcategory: 'slides', sizeSystem: 'OTHER', sizeValue: '41–43', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 41–43 (275 мм).\nПлатформа 4 см.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3273-0.jpg'],
        input: {
          title: 'Кепка Diesel в милитари-стиле',
          category: 'accessories', subcategory: 'cap', price: 66,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'green', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: one size.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3278-0.jpg', '3278-1.jpg'],
        input: {
          title: 'Укороченная джинсовая куртка Pinko с заклёпками',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 180,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Pinko', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S.\nОтличный вариант на летний вечер или весну/осень, красивый фейд + аккуратный дистресс, красивая вещь, сделано в Италии.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 44 см, рукав 60 см, ширина 62 см.',
        },
      },
      {
        photos: ['3295-0.jpg', '3295-1.jpg', '3295-2.jpg'],
        input: {
          title: 'Кеды Burberry Kingly Graffiti',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'OTHER', sizeValue: '40,5', price: 500,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Burberry', color: 'multi', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 40,5 (260–265 мм).\nСостояние по оценке продавца: 8,5/10.',
        },
      },
      {
        photos: ['3397-0.jpg', '3397-1.jpg'],
        input: {
          title: 'Винтажное поло Yves Saint Laurent pour homme',
          category: 'tshirts', subcategory: 'polo', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Yves Saint Laurent', color: 'red', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 46 см, ширина 66 см.',
        },
      },
      {
        photos: ['3426-0.jpg', '3426-1.jpg'],
        input: {
          title: 'Кроссовки adidas Mactelo 90-х',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'OTHER', sizeValue: '39 1/3', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'white', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 39⅓ (245 мм).\nСостояние по оценке продавца: 8,5/10.',
        },
      },
      {
        photos: ['3447-0.jpg'],
        input: {
          title: 'Футболка Iron Maiden Zombie, официальный мерч',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 76 см, рукав 39 см, ширина 56 см.',
        },
      },
      {
        photos: ['3450-0.jpg'],
        input: {
          title: 'Футболка Missguided Dead Metal со шнуровкой',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Missguided', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, рукав 44 см, ширина 58 см.',
        },
      },
      {
        photos: ['3451-0.jpg', '3451-1.jpg'],
        input: {
          title: 'Джинсовая куртка Loft с выцветанием и принтом на спине',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nКачественный плотный деним, отличный фит.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, рукав 88 см, ширина 62 см.',
        },
      },
      {
        photos: ['3469-0.jpg', '3469-1.jpg', '3469-2.jpg', '3469-3.jpg'],
        input: {
          title: 'Джинсы bootcut Marithé + François Girbaud',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Marithé + François Girbaud', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 102 см, полупояс 37 см, выход 20 см.',
        },
      },
      {
        photos: ['3482-0.jpg', '3482-1.jpg'],
        input: {
          title: 'Джинсы True Religion Julie Disco',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W29', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'True Religion', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 29.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 40 см, выход 19 см.',
        },
      },
      {
        photos: ['3484-0.jpg', '3484-1.jpg'],
        input: {
          title: 'Шорты карго G-Star в клетку',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'G-Star', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, полупояс 50 см, выход 31 см.',
        },
      },
      {
        photos: ['3486-0.jpg', '3486-1.jpg', '3486-2.jpg'],
        input: {
          title: 'Джинсовые шорты карго Karl Kani',
          category: 'shorts', subcategory: 'denim-shorts', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Karl Kani', color: 'beige', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 58 см, полупояс 48 см, выход 30 см.',
        },
      },
      {
        photos: ['3489-0.jpg', '3489-1.jpg'],
        input: {
          title: 'Шорты карго с металлическим отливом',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 63 см, полупояс 48 см, выход 31 см.',
        },
      },
      {
        photos: ['3491-0.jpg', '3491-1.jpg'],
        input: {
          title: 'Джинсы True Religion Row bootcut со средней посадкой',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'W25', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: 'True Religion', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 25.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 38–40 см, выход 23 см.',
        },
      },
      {
        photos: ['3582-0.jpg', '3582-1.jpg'],
        input: {
          title: 'Кожаная куртка с капюшоном, коричневая',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 8,5/10.\nЗамеры: длина 58 см, рукав 77 см, ширина 58 см.',
        },
      },
      {
        photos: ['3584-0.jpg'],
        input: {
          title: 'Винтажная куртка Diesel',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 280,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: ≈XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 77 см, рукав 89 см, ширина 68 см.',
        },
      },
      {
        photos: ['3586-0.jpg'],
        input: {
          title: 'Дерби Melvin & Hamilton из кожи',
          category: 'shoes', subcategory: 'shoes', sizeSystem: 'OTHER', sizeValue: '44–45', price: 220,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Melvin & Hamilton', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 44–45 (290–305 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3594-0.jpg', '3594-1.jpg'],
        input: {
          title: 'Джинсы с сильным выцветанием DD',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 45 см, выход 24 см.',
        },
      },
      {
        photos: ['3611-0.jpg'],
        input: {
          title: 'Пальто Gothicana Elite Vampire от EMP',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'M', price: 300,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Gothicana', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: ≈M.\nИзящное пальто от emp, красивый авангардный фит, приятные материалы, в нём чувствуешь себя дракулой.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 146 см, рукав 80 см, ширина 54 см.',
        },
      },
      {
        photos: ['3620-0.jpg', '3620-1.jpg'],
        input: {
          title: 'Высокие кеды Versace Versus',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'OTHER', sizeValue: '40–42,5', price: 450,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Versus Versace', color: 'white', gender: null, material: 'Кожа', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 40–42,5 (275 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3631-0.jpg'],
        input: {
          title: 'Кожаная куртка с тиснением, кроваво-красная',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: ≈M.\nКрасивый паттерн тиснения на коже, интересные навесные карманы, шикарная фурнитура.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 78 см, ширина 48 см.',
        },
      },
      {
        photos: ['3637-0.jpg', '3637-1.jpg'],
        input: {
          title: 'Зип-худи Tribal с выцветанием',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nЗамеры: длина 72 см, рукав 80 см, ширина 70 см.',
        },
      },
      {
        photos: ['3647-0.jpg', '3647-1.jpg'],
        input: {
          title: 'Винтажный кожаный бомбер, графитовый',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 330,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nНатуральная овечья кожа, подклад из вискозы, глубокий графитовый цвет.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 88 см, ширина 66 см.',
        },
      },
      {
        photos: ['3649-0.jpg'],
        input: {
          title: 'Укороченная коричневая куртка на пуговицах',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 76 см, ширина 48 см.',
        },
      },
      {
        photos: ['3664-0.jpg'],
        input: {
          title: 'Архивный свитер с дистрессом',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nЗамеры: длина 82 см, рукав 92 см, ширина 74 см.',
        },
      },
      {
        photos: ['3668-0.jpg', '3668-1.jpg'],
        input: {
          title: 'Винтажная асимметричная дублёнка',
          category: 'outerwear', subcategory: 'sheepskin', sizeSystem: 'ALPHA', sizeValue: 'L', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: ≈L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 69 см, рукав 78 см, ширина 74 см.',
        },
      },
      {
        photos: ['3670-0.jpg'],
        input: {
          title: 'Серое шерстяное пальто-оверкот',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 220,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Шерсть', styleTags: ['Classic'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 84 см, ширина 66 см.',
        },
      },
      {
        photos: ['3671-0.jpg', '3671-1.jpg'],
        input: {
          title: 'Чёрные классические брюки',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Classic'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 100 см, полупояс 39 см, выход 26 см.',
        },
      },
      {
        photos: ['3682-0.jpg', '3682-1.jpg', '3682-2.jpg'],
        input: {
          title: 'Архивная шуба из искусственного меха с капюшоном',
          category: 'outerwear', subcategory: 'fur', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: 'FEMALE', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСуперская шубка из искусственного меха с меховым капюшоном, офигенный фит, много крутых деталей.\nСостояние по оценке продавца: 8/10.\nЗамеры: длина 55 см, рукав 64 см, ширина 46 см.',
        },
      },
      {
        photos: ['3686-0.jpg'],
        input: {
          title: 'Винтажное шерстяное пальто с капюшоном в клетку',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСъемный капюшон.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, рукав 64 см, ширина 50 см.',
        },
      },
      {
        photos: ['3702-0.jpg', '3702-1.jpg'],
        input: {
          title: 'Джинсы Dolce & Gabbana slim с дистрессом',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'ALPHA', sizeValue: 'M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: ≈M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 102 см, полупояс 40 см, выход 18 см.',
        },
      },
      {
        photos: ['3710-0.jpg', '3710-1.jpg'],
        input: {
          title: 'Винтажная вощёная куртка Mantaray',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Mantaray', color: 'brown', gender: null, material: 'Хлопок', styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 77 см, рукав 82 см, ширина 62 см.',
        },
      },
      {
        photos: ['3716-0.jpg', '3716-1.jpg'],
        input: {
          title: 'Кожаный бомбер с тиснением под змею',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Экокожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nЗамеры: длина 72 см, рукав 84 см, ширина 64 см.',
        },
      },
      {
        photos: ['3719-0.jpg', '3719-1.jpg'],
        input: {
          title: 'Винтажные джинсы Tommy Hilfiger с выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Tommy Hilfiger', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 38 см, выход 22 см.',
        },
      },
      {
        photos: ['3727-0.jpg', '3727-1.jpg'],
        input: {
          title: 'Велюровые брюки Calvin Klein bootcut',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Calvin Klein', color: 'black', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 39 см, выход 23 см.',
        },
      },
      {
        photos: ['3729-0.jpg', '3729-1.jpg'],
        input: {
          title: 'Винтажные джинсы straight из сырого денима',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 120 см, полупояс 50 см, выход 24 см.',
        },
      },
      {
        photos: ['3735-0.jpg', '3735-1.jpg'],
        input: {
          title: 'Чёрная кожаная куртка Slayer с капюшоном',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nХлопковый капюшон отстёгивается.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 67 см, рукав 80 см, ширина 56 см.',
        },
      },
      {
        photos: ['3738-0.jpg'],
        input: {
          title: 'Шерстяное пальто с асимметричной молнией и меховым капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Шерсть', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 72 см, ширина 52 см.',
        },
      },
      {
        photos: ['3746-0.jpg', '3746-1.jpg', '3746-2.jpg', '3746-3.jpg'],
        input: {
          title: 'Укороченная куртка Fishbone с асимметричной молнией',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Fishbone', color: 'black', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: ≈M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 56 см, рукав 78 см, ширина 48 см.',
        },
      },
      {
        photos: ['3750-0.jpg'],
        input: {
          title: 'Винтажный свитшот Ramones',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 115,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, рукав 74 см, ширина 62 см.',
        },
      },
      {
        photos: ['3752-0.jpg'],
        input: {
          title: 'Лонгслив Buzz Kill',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 78 см, рукав 88 см, ширина 70 см.',
        },
      },
      {
        photos: ['3753-0.jpg', '3753-1.jpg'],
        input: {
          title: 'Лонгслив Bliiind с принтом',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'white', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 80 см, ширина 50 см.',
        },
      },
      {
        photos: ['3755-0.jpg'],
        input: {
          title: 'Бомбер MA-1 PM',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'L', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Нейлон', styleTags: ['Streetwear'],
          description: 'Размер по бирке: ≈L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 76 см, ширина 64 см.',
        },
      },
      {
        photos: ['3765-0.jpg', '3765-1.jpg'],
        input: {
          title: 'Ветровка Superdry Japan с тройной молнией',
          category: 'outerwear', subcategory: 'windbreaker', sizeSystem: 'ALPHA', sizeValue: 'M', price: 185,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Superdry', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: ≈M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 82 см, ширина 56 см.',
        },
      },
      {
        photos: ['3767-0.jpg', '3767-1.jpg'],
        input: {
          title: 'Ветровка Bench в клетку',
          category: 'outerwear', subcategory: 'windbreaker', sizeSystem: 'ALPHA', sizeValue: 'M', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Bench', color: 'gray', gender: null, styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 63 см, рукав 80 см, ширина 54 см.',
        },
      },
      {
        photos: ['3770-0.jpg', '3770-1.jpg'],
        input: {
          title: 'Гранж-кофта на молнии с эффектом состаривания',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: M–L.\nЭффект состаривания, множество карманов, личная полка.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 68 см, ширина 56 см.',
        },
      },
      {
        photos: ['3780-0.jpg', '3780-1.jpg'],
        input: {
          title: 'Винтажные джинсы Akka bootcut с клапанами',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 45 см, выход 26 см.',
        },
      },
      {
        photos: ['3791-0.jpg', '3791-1.jpg'],
        input: {
          title: 'Кожаные кроссовки-раннеры на липучках',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'OTHER', sizeValue: '44–45', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 44–45 (285–290 мм).\nСостояние по оценке продавца: 8/10.',
        },
      },
      {
        photos: ['3797-0.jpg', '3797-1.jpg'],
        input: {
          title: 'Авангардные замшевые ботинки с щитком',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Замша', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 38 (245–250 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3799-0.jpg', '3799-1.jpg'],
        input: {
          title: 'Джинсы VLT bootcut индиго',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 120 см, полупояс 46 см, выход 26 см.',
        },
      },
      {
        photos: ['3805-0.jpg', '3805-1.jpg'],
        input: {
          title: 'Nike Air Force 1 x Undercover Gore-Tex Low Black',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'SHOE_EU', sizeValue: '44', price: 550,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Nike', color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 44 (280 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3809-0.jpg', '3809-1.jpg'],
        input: {
          title: 'Чёрные джинсы Dolce & Gabbana slim с выцветанием',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'black', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 110 см, полупояс 39 см, выход 18 см.',
        },
      },
      {
        photos: ['3811-0.jpg', '3811-1.jpg'],
        input: {
          title: 'Тёмные джинсы Dolce & Gabbana slim',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'black', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 39 см, выход 17 см.',
        },
      },
      {
        photos: ['3815-0.jpg', '3815-1.jpg'],
        input: {
          title: 'Джинсы ZMC wide leg карго',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 44 см, выход 27 см.',
        },
      },
      {
        photos: ['3823-0.jpg', '3823-1.jpg', '3823-2.jpg', '3823-3.jpg'],
        input: {
          title: 'Винтажные японские selvedge-джинсы Edwin ED-71',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'JEANS_W', sizeValue: 'W38', price: 300,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Edwin', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: W38/L32.\nОригинальный японский selvedge denim Edwin ED-71 Slim плотностью 14 oz, ткань японского производства. Артикул I008139. Редкая старая версия ED-71 начала 2010-х. 100% cotton.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 118 см, полупояс 54 см, выход 23 см.',
        },
      },
      {
        photos: ['3829-0.jpg', '3829-1.jpg'],
        input: {
          title: 'Тёмные джинсы клёш с выцветанием',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 105 см, полупояс 38 см, выход 27 см.',
        },
      },
      {
        photos: ['3833-0.jpg', '3833-1.jpg'],
        input: {
          title: 'Винтажные камуфляжные ботинки на молнии',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: 39.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3837-0.jpg', '3837-1.jpg'],
        input: {
          title: 'Винтажный армейский кожаный ремень с заклёпками',
          category: 'accessories', subcategory: 'belt', price: 115,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 132 × 5 см.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3841-0.jpg', '3841-1.jpg'],
        input: {
          title: 'Стёганая нейлоновая куртка Dolce & Gabbana с капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 330,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'black', gender: null, material: 'Нейлон', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 8/10.\nЗамеры: длина 66 см, рукав 74 см, ширина 46–50 см.',
        },
      },
      {
        photos: ['3843-0.jpg'],
        input: {
          title: 'Укороченная джинсовая куртка карго с капюшоном',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 61 см, рукав 72 см, ширина 56 см.',
        },
      },
      {
        photos: ['3846-0.jpg', '3846-1.jpg'],
        input: {
          title: 'Винтажные кожаные сапоги Prada 90-х',
          category: 'shoes', subcategory: 'high-boots', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 2000,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Prada', color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 39 (255 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3856-0.jpg', '3856-1.jpg'],
        input: {
          title: 'Винтажные джинсы bootcut с низкой посадкой и кожаными вставками',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 105 см, полупояс 38 см, выход 24 см.',
        },
      },
      {
        photos: ['3858-0.jpg', '3858-1.jpg'],
        input: {
          title: 'Джинсы MW wide leg bootcut с дистрессом',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 42 см, выход 27 см.',
        },
      },
      {
        photos: ['3877-0.jpg'],
        input: {
          title: 'Тяжёлый кожаный бомбер',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: ≈S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 63 см, рукав 70 см, ширина 54 см.',
        },
      },
      {
        photos: ['3882-0.jpg', '3882-1.jpg'],
        input: {
          title: 'Nike Air Force 1 Low Black',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'OTHER', sizeValue: '43–44', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Nike', color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 43–44 (280 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3889-0.jpg', '3889-1.jpg'],
        input: {
          title: 'Куртка харрингтон в традиционном стиле',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, styleTags: ['Classic'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, рукав 85 см, ширина 64 см.',
        },
      },
      {
        photos: ['3898-0.jpg', '3898-1.jpg'],
        input: {
          title: 'Укороченная вощёная куртка LTB с асимметричной молнией',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'LTB', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 52 см, рукав 80 см, ширина 56 см.',
        },
      },
      {
        photos: ['3900-0.jpg', '3900-1.jpg'],
        input: {
          title: 'Графитовая матовая косуха с асимметричной молнией',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Экокожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 68 см, ширина 62 см.',
        },
      },
      {
        photos: ['3902-0.jpg', '3902-1.jpg'],
        input: {
          title: 'Шерстяное пальто Zara',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Zara', color: 'black', gender: null, material: 'Шерсть', styleTags: ['Classic'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, рукав 63 см, ширина 46 см.',
        },
      },
      {
        photos: ['3904-0.jpg', '3904-1.jpg'],
        input: {
          title: 'Шерстяное пальто в клетку без застёжки',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Шерсть', styleTags: ['Classic'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 82 см, ширина 54 см.',
        },
      },
      {
        photos: ['3906-0.jpg', '3906-1.jpg'],
        input: {
          title: 'Винтажная тёмная куртка Medicine с капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Medicine', color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 80 см, ширина 60 см.',
        },
      },
      {
        photos: ['3918-0.jpg', '3918-1.jpg'],
        input: {
          title: 'Чёрные джинсы bootcut washed',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 112 см, полупояс 48 см, выход 28 см.',
        },
      },
      {
        photos: ['3924-0.jpg'],
        input: {
          title: 'Джинсовая куртка Selected Homme индиго с выцветанием',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Selected Homme', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 65 см, рукав 82 см, ширина 54 см.',
        },
      },
      {
        photos: ['3930-0.jpg', '3930-1.jpg'],
        input: {
          title: 'Кеды Valentino Garavani Open Rockstud, оливковые',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 400,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Valentino', color: 'white', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 42 (275 мм).\nСостояние по оценке продавца: 8/10.',
        },
      },
      {
        photos: ['3932-0.jpg', '3932-1.jpg'],
        input: {
          title: 'Укороченный пуховик Mo.Zips с высоким воротом',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'S', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 54 см, рукав 74 см, ширина 48 см.',
        },
      },
      {
        photos: ['3951-0.jpg', '3951-1.jpg'],
        input: {
          title: 'Серые джинсы dark wash с дистрессом',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'ALPHA', sizeValue: 'M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 116 см, полупояс 41 см, выход 21 см.',
        },
      },
      {
        photos: ['3953-0.jpg'],
        input: {
          title: 'Бронзовые вощёные джинсы',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 43 см, выход 23 см.',
        },
      },
      {
        photos: ['3976-0.jpg', '3976-1.jpg'],
        input: {
          title: 'Кожаные брюки wide leg Amcouture с заклёпками',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'M–XL', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 114 см, полупояс 44–50 см, выход 27 см.',
        },
      },
      {
        photos: ['3987-0.jpg', '3987-1.jpg'],
        input: {
          title: 'Чёрные замшевые челси',
          category: 'shoes', subcategory: 'chelsea', sizeSystem: 'SHOE_EU', sizeValue: '45', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Замша', styleTags: ['Classic'],
          description: 'Размер по бирке: 45 (290 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3989-0.jpg', '3989-1.jpg'],
        input: {
          title: 'Кожаный ремень Diesel',
          category: 'accessories', subcategory: 'belt', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, material: 'Кожа', styleTags: ['Casual'],
          description: 'Размер по бирке: 100 × 4 см.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3995-0.jpg'],
        input: {
          title: 'Винтажная кожаная сумка с полосами',
          category: 'bags', subcategory: 'crossbody', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Состояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['3997-0.jpg', '3997-1.jpg', '3997-2.jpg', '3997-3.jpg', '3997-4.jpg'],
        input: {
          title: 'Шерстяной свитер MD75 AW2020 Rot-Fade',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 400,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'MD75', color: 'black', gender: null, material: 'Шерсть', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nПроработанный крой, натуральная овечья шерсть, made in Italy, крутые детали и структура, на дропе такой свитер стоил чуть больше 500€.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 76 см, рукав 94 см, ширина 64 см.',
        },
      },
      {
        photos: ['4009-0.jpg'],
        input: {
          title: 'Сумка Comme des Garçons Shirt',
          category: 'bags', subcategory: 'tote', price: 300,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Comme des Garçons', color: 'multi', gender: null, styleTags: ['Streetwear'],
          description: 'Состояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4010-0.jpg', '4010-1.jpg'],
        input: {
          title: 'Бежевая ветровка Sublevel',
          category: 'outerwear', subcategory: 'windbreaker', sizeSystem: 'ALPHA', sizeValue: 'M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Sublevel', color: 'beige', gender: null, styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, рукав 74 см, ширина 48 см.',
        },
      },
      {
        photos: ['4012-0.jpg', '4012-1.jpg', '4012-2.jpg', '4012-3.jpg'],
        input: {
          title: 'Вощёный тренч G-Star Raw Garber',
          category: 'outerwear', subcategory: 'trench', sizeSystem: 'ALPHA', sizeValue: 'M', price: 150,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'G-Star Raw', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nКрутейший тренч из вощёной плотной хлопковой ткани, фирменная фурнитура и пуговицы, скрытые карманы, ремешок на воротнике доя защиты от ветра, детали.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 84 см, рукав 84 см, ширина 56 см.',
        },
      },
      {
        photos: ['4016-0.jpg', '4016-1.jpg'],
        input: {
          title: 'Чёрное шерстяное пальто с многослойной застёжкой',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Шерсть', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nКрутецкое пальтишко с теплым подкладом, фурнитура уkk, несколько вариантов носки,.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 84 см, ширина 60 см.',
        },
      },
      {
        photos: ['4018-0.jpg', '4018-1.jpg'],
        input: {
          title: 'Винтажный лонгслив Boss Liberté Mermaid',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Boss', color: 'red', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 68 см, рукав 84 см, ширина 58 см.',
        },
      },
      {
        photos: ['4020-0.jpg', '4020-1.jpg'],
        input: {
          title: 'Винтажный лонгслив Trussardi Gold Stars USA',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 110,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Trussardi', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 74 см, рукав 82 см, ширина 60 см.',
        },
      },
      {
        photos: ['4027-0.jpg', '4027-1.jpg'],
        input: {
          title: 'Винтажная куртка из мягкой кожи Gipsy',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 350,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Gipsy', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nС личной полки, классная фактурная мягкая кожа, красивый не однотонный цвет, фурнитура YKK, шикарный мужицкий фит.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 69 см, рукав 87 см, ширина 66 см.',
        },
      },
      {
        photos: ['4030-0.jpg', '4030-1.jpg'],
        input: {
          title: 'Кожаная куртка Burberry',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 750,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Burberry', color: 'black', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: M.\nСделано в италии, брендированная фурнитура, приятная мягкая натуральная кожа, подойдет на температуру 5-15 градусов, с теплой кофтой можно пробовать на 0 градусов.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 67 см, рукав 78 см, ширина 54 см.',
        },
      },
      {
        photos: ['4032-0.jpg', '4032-1.jpg'],
        input: {
          title: 'Тяжёлый кожаный бомбер Ben Sherman',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 230,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Ben Sherman', color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nКлассная тяжелая натуральная кожа, на реального босса.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 69 см, рукав 86 см, ширина 62 см.',
        },
      },
      {
        photos: ['4034-0.jpg', '4034-1.jpg'],
        input: {
          title: 'Камуфляжный пуховик-бомбер O’Neill',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'M', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'O’Neill', color: 'green', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, рукав 78 см, ширина 56 см.',
        },
      },
      {
        photos: ['4036-0.jpg'],
        input: {
          title: 'Байкерская куртка из вощёной ткани и кожи',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: ≈XL.\nКрасивый фейд эффект, плотный материал и мягкая кожа.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 76 см, рукав 84 см, ширина 65 см.',
        },
      },
      {
        photos: ['4037-0.jpg'],
        input: {
          title: 'Пальто Adrianno Damianii с вязаным капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: 'FEMALE', styleTags: ['Classic'],
          description: 'Размер по бирке: M–L женский.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 80 см, рукав 77 см, ширина 56 см.',
        },
      },
      {
        photos: ['4038-0.jpg'],
        input: {
          title: 'Тяжёлое шерстяное пальто с капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: 'FEMALE', material: 'Шерсть', styleTags: ['Classic'],
          description: 'Размер по бирке: S–M женский.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 90 см, рукав 72 см, ширина 42 см.',
        },
      },
      {
        photos: ['4039-0.jpg'],
        input: {
          title: 'Бордовое пальто Bloody Marry с капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: 'FEMALE', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M женский.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 82 см, рукав 72 см, ширина 44 см.',
        },
      },
      {
        photos: ['4050-0.jpg', '4050-1.jpg', '4050-2.jpg', '4050-3.jpg'],
        input: {
          title: 'Выбеленные джинсы Jeansnet с множеством карманов',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Jeansnet', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: XL.\nMade in Italy.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 117 см, полупояс 47 см, выход 24 см.',
        },
      },
      {
        photos: ['4058-0.jpg', '4058-1.jpg'],
        input: {
          title: 'Чёрные брюки wide leg Amcouture из шерсти с вискозой',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 250,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Шерсть', styleTags: ['Minimal'],
          description: 'Размер по бирке: L–XL.\nСделаны в италии, в составе ткани шерсть и вискоза, приятный материал, шикарный фит.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 122 см, полупояс 44–48 см, выход 33 см.',
        },
      },
      {
        photos: ['4064-0.jpg', '4064-1.jpg'],
        input: {
          title: 'Чёрные утеплённые брюки wide straight',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nУтепленные.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 44 см, выход 24 см.',
        },
      },
      {
        photos: ['4070-0.jpg', '4070-1.jpg'],
        input: {
          title: 'Парка карго хаки с дистрессом',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 250,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Деним', styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nШикарная тёплая парка, оболочка из плотного денима, оч теплая, 6 вместительных внешних карманов, красивый фит.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 94 см, рукав 70 см, ширина 64 см.',
        },
      },
      {
        photos: ['4076-0.jpg', '4076-1.jpg'],
        input: {
          title: 'Серое укороченное пальто Royal Sunday',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'M', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, рукав 64 см, ширина 54 см.',
        },
      },
      {
        photos: ['4081-0.jpg', '4081-1.jpg'],
        input: {
          title: 'Тёплый пуховик Code-X с мехом',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 330,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: XL.\nЛучший пухан на эту зиму на большого парня, будет согревать в погоду до -30-35, плотные манжеты, съемный капюшон и мех, утепленные карманы.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 74 см, рукав 72 см, ширина 70 см.',
        },
      },
      {
        photos: ['4083-0.jpg', '4083-1.jpg'],
        input: {
          title: 'Зимняя куртка Guinness от EMP',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: L.\nШикарный детализированный теплый куртец, подклад из искусственного меха, брендированная фурнитура.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 72 см, ширина 58 см.',
        },
      },
      {
        photos: ['4089-0.jpg', '4089-1.jpg'],
        input: {
          title: 'Меховые сапоги йети',
          category: 'shoes', subcategory: 'high-boots', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 185,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: 'FEMALE', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 39 (245–250 мм).\nСостояние по оценке продавца: 10/10.',
        },
      },
      {
        photos: ['4104-0.jpg', '4104-1.jpg'],
        input: {
          title: 'Укороченная аляска Naughty с окрасом под кожу',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'S', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S.\nШикарная аляска с красивым окрасом, напоминающим кожу, классный кроп силуэт, множество карманов и красивая фурнитура.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 56 см, рукав 63 см, ширина 50 см.',
        },
      },
      {
        photos: ['4110-0.jpg', '4110-1.jpg'],
        input: {
          title: 'Чёрно-белый микропуховик HV-EXP',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 185,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nМикропух с необычным красивым окрасом, классные плотные манжеты, глубокий капюшон и высокий воротник.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 62 см, ширина 49 см.',
        },
      },
      {
        photos: ['4117-0.jpg', '4117-1.jpg'],
        input: {
          title: 'Винтажный коричневый кожаный ремень Diesel',
          category: 'accessories', subcategory: 'belt', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 114 × 3,5 см.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4122-0.jpg', '4122-1.jpg', '4122-2.jpg', '4122-3.jpg', '4122-4.jpg'],
        input: {
          title: 'Редкие винтажные джинсы Robin’s Jean',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 450,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Robin’s Jean', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 30.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 40 см, выход 22 см.',
        },
      },
      {
        photos: ['4127-0.jpg', '4127-1.jpg', '4127-2.jpg', '4127-3.jpg', '4127-4.jpg', '4127-5.jpg'],
        input: {
          title: 'Брюки карго Brandit с ремешками',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Brandit', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 40–45 см, выход 27 см.',
        },
      },
      {
        photos: ['4178-0.jpg', '4178-1.jpg'],
        input: {
          title: 'Винтажные кожаные кроссовки Diesel Vector',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, material: 'Кожа', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 42.\nШикарная винтажная пара выполнена в эстетике начала 2000-х годов, обувь изготовлена из плотной черной кожи со вставками из дышащей сетки, имеет характерный вышитый красный логотип «D» на верхнем ремешке, массивная протекторная подошва с контрастными красными элементами.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4180-0.jpg', '4180-1.jpg'],
        input: {
          title: 'Джинсы G-Star Raw с молниями и дистрессом',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 150,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'G-Star Raw', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 118 см, полупояс 44 см, выход 21 см.',
        },
      },
      {
        photos: ['4182-0.jpg', '4182-1.jpg'],
        input: {
          title: 'Винтажные серые брюки G-Star Raw',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'G-Star Raw', color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 112 см, полупояс 47 см, выход 26 см.',
        },
      },
      {
        photos: ['4186-0.jpg', '4186-1.jpg', '4186-2.jpg', '4186-3.jpg'],
        input: {
          title: 'Камуфляжные брюки карго Mars the Label с ремешками',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Mars the Label', color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 120 см, полупояс 36–46 см, выход 28 см.',
        },
      },
      {
        photos: ['4194-0.jpg', '4194-1.jpg'],
        input: {
          title: 'Серые джинсы с многослойным выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 41 см, выход 24 см.',
        },
      },
      {
        photos: ['4199-0.jpg', '4199-1.jpg'],
        input: {
          title: 'Светлые джинсы wide leg с бахромой',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 44 см, выход 34 см.',
        },
      },
      {
        photos: ['4220-0.jpg', '4220-1.jpg'],
        input: {
          title: 'Замшевые челси Graceland',
          category: 'shoes', subcategory: 'chelsea', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Graceland', color: 'black', gender: null, material: 'Замша', styleTags: ['Casual'],
          description: 'Размер по бирке: 42 (270 мм).\nСостояние по оценке продавца: 8/10.',
        },
      },
      {
        photos: ['4227-0.jpg', '4227-1.jpg'],
        input: {
          title: 'Ботинки Highway с лентой',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'OTHER', sizeValue: '44,5', price: 200,
          condition: 'VISIBLE_WEAR', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 44,5 (285–295 мм).\nСостояние по оценке продавца: 7,5/10.',
        },
      },
      {
        photos: ['4231-0.jpg', '4231-1.jpg'],
        input: {
          title: 'Свитшот Diesel Flip',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 82 см, ширина 60 см.',
        },
      },
      {
        photos: ['4239-0.jpg', '4239-1.jpg'],
        input: {
          title: 'Кофта Bono хаки с асимметричной молнией',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 87 см, ширина 56 см.',
        },
      },
      {
        photos: ['4241-0.jpg', '4241-1.jpg', '4241-2.jpg', '4241-3.jpg'],
        input: {
          title: 'Джинсы Biepa slim/straight в стиле пэчворк',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'multi', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 44 см, выход 20 см.',
        },
      },
      {
        photos: ['4247-0.jpg', '4247-1.jpg'],
        input: {
          title: 'Зимний бомбер Diverse',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 200,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diverse', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: S–M.\nПлотненький тёплый куртец, 6 внешних утепленный вместительных карманов, качественная брендированная фурнитура, подклад из искусвенного меха и плотные приятные манжеты.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 62 см, ширина 54 см.',
        },
      },
      {
        photos: ['4249-0.jpg', '4249-1.jpg', '4249-2.jpg'],
        input: {
          title: 'Свитер Made Extreme Skulz',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 91 см, ширина 74 см.',
        },
      },
      {
        photos: ['4254-0.jpg', '4254-1.jpg'],
        input: {
          title: 'Кожаные ботинки Pan на меху',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 42 (270–275 мм).\nУтеплены мехом.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4256-0.jpg', '4256-1.jpg'],
        input: {
          title: 'Коричневые ботинки Gino Rossi из мягкой кожи',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '46–47', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Gino Rossi', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 46–47 (310–320 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4268-0.jpg', '4268-1.jpg'],
        input: {
          title: 'Худи Guess slim fit в вафельную текстуру',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Guess', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 86 см, ширина 58 см.',
        },
      },
      {
        photos: ['4270-0.jpg', '4270-1.jpg'],
        input: {
          title: 'Кожаный ремень Diesel с двойной пряжкой',
          category: 'accessories', subcategory: 'belt', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, material: 'Кожа', styleTags: ['Casual'],
          description: 'Размер по бирке: 105 × 3,5 см.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['4274-0.jpg', '4274-1.jpg'],
        input: {
          title: 'Чёрные джинсы Arizona bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'M', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Arizona', color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nЗамеры: длина 116 см, полупояс 40 см, выход 23 см.',
        },
      },
      {
        photos: ['4276-0.jpg', '4276-1.jpg'],
        input: {
          title: 'Демисезонная аляска Clap',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: S–M.\nТоповая демисезонная аляска, на поясе есть утяжки для регулировки фита, подойдет на лёгкие холода.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, рукав 65 см, ширина 52 см.',
        },
      },
      {
        photos: ['4291-0.jpg', '4291-1.jpg'],
        input: {
          title: 'Двусторонний бомбер из кожи и меха',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 270,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nШикарный двусторонний кожаный бомбер, множество деталей, красивый густой искусственный мех, отличный вариант на холода.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 63 см, рукав 76 см, ширина 66 см.',
        },
      },
      {
        photos: ['4293-0.jpg', '4293-1.jpg', '4293-2.jpg', '4293-3.jpg'],
        input: {
          title: 'Винтажные джинсы Diesel straight с низкой посадкой',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 120,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Diesel', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 104 см, полупояс 39 см, выход 20 см.',
        },
      },
      {
        photos: ['4297-0.jpg', '4297-1.jpg', '4297-2.jpg', '4297-3.jpg', '4297-4.jpg'],
        input: {
          title: 'Джинсы Royal slim bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'S', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 109 см, полупояс 37 см, выход 23 см.',
        },
      },
      {
        photos: ['4309-0.jpg', '4309-1.jpg'],
        input: {
          title: 'Винтажный кожаный бомбер Premier Man',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 230,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nВинтажный бомбер из приятной тяжелой кожи, фурнитура YKK, есть утепляющий подклад.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 71 см, рукав 88 см, ширина 68 см.',
        },
      },
      {
        photos: ['4315-0.jpg', '4315-1.jpg'],
        input: {
          title: 'Винтажные полосатые джинсы Prisoner',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 123 см, полупояс 44 см, выход 24 см.',
        },
      },
      {
        photos: ['4320-0.jpg', '4320-1.jpg'],
        input: {
          title: 'Матовый кожаный бомбер Armour со съёмными рукавами',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 330,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nИдеальный кожаный бомбер, стойкий высокий воротник, приятный материал, шикарная детализация, можно превратить в жилет, сняв рукава, крутейший босяцкий фит.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 72 см, рукав 88 см, ширина 72 см.',
        },
      },
      {
        photos: ['4322-0.jpg', '4322-1.jpg', '4322-2.jpg', '4322-3.jpg'],
        input: {
          title: 'Винтажные джинсы Kaporal straight с выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Kaporal', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 45 см, выход 22 см.',
        },
      },
      {
        photos: ['4326-0.jpg', '4326-1.jpg', '4326-2.jpg', '4326-3.jpg', '4326-4.jpg'],
        input: {
          title: 'Винтажная вощёная джинсовая куртка Khujo',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 330,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Khujo', color: 'black', gender: null, material: 'Деним', styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nШикарная теплая вощеная куртка от немецкого бренда, офигенный фит, объемный капюшон, скрывающийся в стойкий воротник, множество карманов и интересная детализация.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 88 см, ширина 60 см.',
        },
      },
      {
        photos: ['4331-0.jpg', '4331-1.jpg', '4331-2.jpg', '4331-3.jpg'],
        input: {
          title: 'Джинсы карго Animal wide leg, хаки',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Animal', color: 'green', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 45 см, выход 27 см.',
        },
      },
      {
        photos: ['4336-0.jpg', '4336-1.jpg', '4336-2.jpg', '4336-3.jpg'],
        input: {
          title: 'Винтажные джинсы G-Star Raw с выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: 'G-Star Raw', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 42 см, выход 21 см.',
        },
      },
      {
        photos: ['4340-0.jpg'],
        input: {
          title: 'Микропуховик Diesel',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nИдеальный микропух от дизель, интересный слим фит, подойдет на начало/конец зимы- весну/осень.\nСостояние по оценке продавца: 10/10.\nЗамеры: длина 64 см, рукав 75 см, ширина 47+ см.',
        },
      },
      {
        photos: ['4345-0.jpg', '4345-1.jpg', '4345-2.jpg', '4345-3.jpg'],
        input: {
          title: 'Джинсы Diesel Larkee',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 42 см, выход 22 см.',
        },
      },
      {
        photos: ['4349-0.jpg', '4349-1.jpg'],
        input: {
          title: 'Винтажные джинсы карго Diesel DD256 wide leg',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Diesel', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 46 см, выход 26 см.',
        },
      },
      {
        photos: ['4351-0.jpg', '4351-1.jpg', '4351-2.jpg', '4351-3.jpg'],
        input: {
          title: 'Ботинки Dolce & Gabbana с пряжкой-монком, 2000-е',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'SHOE_EU', sizeValue: '46', price: 450,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Dolce & Gabbana', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: ≈46 (300–310 мм).\nСостояние по оценке продавца: 8,5/10.',
        },
      },
      {
        photos: ['4359-0.jpg', '4359-1.jpg', '4359-2.jpg', '4359-3.jpg'],
        input: {
          title: 'Винтажный бомбер CWU с меховым подкладом',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 290,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Нейлон', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nШикарный дутый бомбер, теплый подстег из искусственного меха, много глубоких карманов, высокий стойкий ворот, весь мех отстегивается, поэтому пойдет на зиму или демисезон, так же отстегиваются рукава, множество деталей, фурнитура YKK, плотные манжеты, классный актуальный фит.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 74 см, ширина 72 см.',
        },
      },
      {
        photos: ['4363-0.jpg', '4363-1.jpg'],
        input: {
          title: 'Винтажный серый шерстяной бомбер с капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер по бирке: M.\nИнтересное пальто-бомбер с красивой фурнитурой, глубокий капюшон, тугие манжеты, классный айтем на прохладную осень/весну.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 67 см, рукав 74 см, ширина 55 см.',
        },
      },
      {
        photos: ['4365-0.jpg'],
        input: {
          title: 'Винтажное укороченное зип-худи с мехом',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 63 см, рукав 68 см, ширина 56 см.',
        },
      },
      {
        photos: ['4370-0.jpg', '4370-1.jpg', '4370-2.jpg', '4370-3.jpg'],
        input: {
          title: 'Байкерское зип-худи EMP с молниями и шипами',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 150,
          condition: 'GOOD', defectsPresent: false,
          brand: 'EMP', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 76 см, рукав 86 см, ширина 66 см.',
        },
      },
      {
        photos: ['4376-0.jpg', '4376-1.jpg'],
        input: {
          title: 'Чёрные джинсы Base wide leg',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S–M.\nЗамеры: длина 114 см, полупояс 38–42 см, выход 28 см.',
        },
      },
      {
        photos: ['4380-0.jpg'],
        input: {
          title: 'Винтажные джинсы super wide leg из сырого денима',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 39 см, выход 45 см.',
        },
      },
      {
        photos: ['4381-0.jpg', '4381-1.jpg'],
        input: {
          title: 'Винтажные тёмные джинсы wide bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 130,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 43 см, выход 29 см.',
        },
      },
      {
        photos: ['4385-0.jpg', '4385-1.jpg', '4385-2.jpg', '4385-3.jpg'],
        input: {
          title: 'Вязаное зип-худи Fuga 2016 с драпировкой',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 270,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Fuga', color: 'gray', gender: null, material: 'Трикотаж', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nИзделие отличается высоким воротником-капюшоном, легкой меланжевой трикотажной текстурой и облегающим удлиненным кроем; капюшон с гибким каркасом позволяет менять форму и надежно фиксировать ее в нужном положении.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 75 см, ширина 52 см.',
        },
      },
      {
        photos: ['4389-0.jpg', '4389-1.jpg'],
        input: {
          title: 'Серые джинсы wide leg bootcut с выцветанием',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S–M.\nЗамеры: длина 112 см, полупояс 40 см, выход 35 см.',
        },
      },
      {
        photos: ['4391-0.jpg', '4391-1.jpg'],
        input: {
          title: 'Джинсы ultra wide leg',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'ALPHA', sizeValue: 'M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nЗамеры: длина 110 см, полупояс 42 см, выход 42 см.',
        },
      },
      {
        photos: ['4393-0.jpg', '4393-1.jpg'],
        input: {
          title: 'Матовая аляска-пуховик slim',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 230,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nКрутая матовая аляска с шикарной опушкой, актуальный слим фит, глубокий капюшон, трикотажные манжеты.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 80 см, ширина 56 см.',
        },
      },
      {
        photos: ['4397-0.jpg'],
        input: {
          title: 'Пуховик-аляска Boss',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 230,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Boss', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nКлассная теплая босяцкая аляска, обилие глубоких карманов, съемный глубокий капюшон, спасёт морозной зимой.\nСостояние по оценке продавца: 8/10.\nЗамеры: длина 72 см, рукав 84 см, ширина 60 см.',
        },
      },
      {
        photos: ['4398-0.jpg', '4398-1.jpg'],
        input: {
          title: 'Тёмные джинсы wide leg bootcut с выцветанием',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 120,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 44–46 см, выход 31 см.',
        },
      },
      {
        photos: ['4400-0.jpg', '4400-1.jpg'],
        input: {
          title: 'Серые джинсы Pieces wide leg',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Pieces', color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 114 см, полупояс 45 см, выход 31 см.',
        },
      },
      {
        photos: ['4402-0.jpg', '4402-1.jpg', '4402-2.jpg', '4402-3.jpg', '4402-4.jpg'],
        input: {
          title: 'Винтажная глянцевая аляска с асимметричной молнией',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nИдеальная глянцевая аляска с асимметричным зипом, глубокий капюшон с шикарной опушкой, качественная фурнитура, утяжки снизу для защиты от ветра.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 62 см, рукав 64 см, ширина 50 см.',
        },
      },
      {
        photos: ['4414-0.jpg', '4414-1.jpg'],
        input: {
          title: 'Винтажное зип-худи Armani Exchange 90-х с искусственной овчиной',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Exchange', color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nТекстурированная замшевая поверхность и мягкая подкладка из искусственной овчины. Произведена в Гонконге в золотую эпоху бренда, она отличается характерной фурнитурой, включая фирменные застежки-молнии и застежку-фиксатор на воротнике.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, рукав 74 см, ширина 58 см.',
        },
      },
      {
        photos: ['930-0.jpg'],
        input: {
          title: 'Винтажная джинсовая куртка LTB',
          category: 'outerwear', subcategory: 'denim-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'LTB', color: 'black', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 54 см, рукав 66 см, ширина 46 см.',
        },
      },
      {
        photos: ['1087-0.jpg'],
        input: {
          title: 'Снэпбэк Peak с шипами',
          category: 'accessories', subcategory: 'cap', price: 75,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: one size.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['1093-0.jpg', '1093-1.jpg'],
        input: {
          title: 'Скейтерские шорты Hawk',
          category: 'shorts', subcategory: 'sport-shorts', sizeSystem: 'ALPHA', sizeValue: 'M', price: 50,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Tony Hawk', color: 'beige', gender: null, styleTags: ['Sport'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 58 см, полупояс 42 см, выход 32 см.',
        },
      },
      {
        photos: ['1095-0.jpg'],
        input: {
          title: 'Укороченная куртка с металлическим блеском',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 50 см, рукав 72 см, ширина 52 см.',
        },
      },
      {
        photos: ['1274-0.jpg', '1274-1.jpg'],
        input: {
          title: 'Бежевые шорты карго Request с ремнём',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, полупояс 50 см, выход 29 см.',
        },
      },
      {
        photos: ['1284-0.jpg', '1284-1.jpg'],
        input: {
          title: 'Чёрные брюки клёш',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'ALPHA', sizeValue: 'S', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 117 см, полупояс 37 см, выход 26 см.',
        },
      },
      {
        photos: ['1286-0.jpg', '1286-1.jpg'],
        input: {
          title: 'Шорты Carhartt прямого кроя',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'M', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Carhartt', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 54 см, полупояс 44 см, выход 28 см.',
        },
      },
      {
        photos: ['1298-0.jpg', '1298-1.jpg'],
        input: {
          title: 'Джинсы Esprit bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Esprit', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 105 см, полупояс 38–39 см, выход 21 см.',
        },
      },
      {
        photos: ['1304-0.jpg'],
        input: {
          title: 'Свитшот Lipsy California',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 50,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Lipsy', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 80 см, ширина 52 см.',
        },
      },
      {
        photos: ['1306-0.jpg'],
        input: {
          title: 'Рубашка с надписью Life',
          category: 'shirts', subcategory: 'overshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 65,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 84 см, ширина 54 см.',
        },
      },
      {
        photos: ['1345-0.jpg'],
        input: {
          title: 'Худи с гербом, укороченный крой',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 64 см, рукав 76 см, ширина 56 см.',
        },
      },
      {
        photos: ['1348-0.jpg'],
        input: {
          title: 'Футболка Страханет',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 50,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 74 см, рукав 40 см, ширина 58 см.',
        },
      },
      {
        photos: ['1374-0.jpg'],
        input: {
          title: 'Укороченная футболка со смертью с косой',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 50,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 66 см, рукав 35 см, ширина 60 см.',
        },
      },
      {
        photos: ['1382-0.jpg'],
        input: {
          title: 'Ретро-футболка Красный мост',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 60,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 60 см, рукав 30 см, ширина 48 см.',
        },
      },
      {
        photos: ['1383-0.jpg'],
        input: {
          title: 'Винтажная укороченная футболка Винни-Пух',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 65,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'white', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: ≈M.\nСостояние по оценке продавца: 8/10.\nЗамеры: длина 58 см, рукав 40 см, ширина 56 см.',
        },
      },
      {
        photos: ['1385-0.jpg', '1385-1.jpg'],
        input: {
          title: 'Укороченная футболка Misfits',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 65,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 42 см, ширина 58 см.',
        },
      },
      {
        photos: ['1391-0.jpg'],
        input: {
          title: 'Кроссовки Nike Court Borough Mid 2',
          category: 'shoes', subcategory: 'sneakers', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 100,
          condition: 'VISIBLE_WEAR', defectsPresent: false,
          brand: 'Nike', color: 'white', gender: null, styleTags: ['Sport'],
          description: 'Размер по бирке: 39 (245 мм).\nСостояние по оценке продавца: 7,5/10.',
        },
      },
      {
        photos: ['1406-0.jpg'],
        input: {
          title: 'Футболка со скелетом, хэллоуин',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 50,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['1407-0.jpg'],
        input: {
          title: 'Серая выстиранная футболка в полоску',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 65,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['1408-0.jpg'],
        input: {
          title: 'Футболка Argonaut с черепом на молнии',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: XL.\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['1416-0.jpg', '1416-1.jpg'],
        input: {
          title: 'Джинсы bootcut с выцветанием и короной',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'S', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 103 см, полупояс 36 см, выход 23 см.',
        },
      },
      {
        photos: ['1422-0.jpg', '1422-1.jpg'],
        input: {
          title: 'Простые чёрные джинсы bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'S', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 100 см, полупояс 37 см, выход 22 см.',
        },
      },
      {
        photos: ['1434-0.jpg', '1434-1.jpg'],
        input: {
          title: 'Джинсы bootcut со средней посадкой',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 102 см, полупояс 39 см, выход 25 см.',
        },
      },
      {
        photos: ['1441-0.jpg', '1441-1.jpg'],
        input: {
          title: 'Джинсы PK bootcut с низкой посадкой',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'S', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 36 см, выход 26 см.',
        },
      },
      {
        photos: ['1443-0.jpg'],
        input: {
          title: 'Лонгслив Hard Rock с черепом',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Hard Rock', color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 72 см, рукав 84 см, ширина 60 см.',
        },
      },
      {
        photos: ['1450-0.jpg', '1450-1.jpg'],
        input: {
          title: 'Куртка DD Ranger хаки',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 82 см, ширина 58 см.',
        },
      },
      {
        photos: ['1459-0.jpg', '1459-1.jpg'],
        input: {
          title: 'Винтажные джинсы D с фактурным выцветанием',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'ALPHA', sizeValue: 'S', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 100 см, полупояс 39 см, выход 22 см.',
        },
      },
      {
        photos: ['1466-0.jpg'],
        input: {
          title: 'Худи Gladiator с рыцарем',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 68 см, рукав 80 см, ширина 56 см.',
        },
      },
      {
        photos: ['1468-0.jpg'],
        input: {
          title: 'Лонгслив Sonneti в полоску с выцветанием',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Sonneti', color: 'green', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L–XL.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 70 см, рукав 85 см, ширина 56 см.',
        },
      },
      {
        photos: ['1469-0.jpg', '1469-1.jpg'],
        input: {
          title: 'Джинсы Edc slim/straight с дистрессом',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'ALPHA', sizeValue: 'M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Edc', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 107 см, полупояс 41 см, выход 18 см.',
        },
      },
      {
        photos: ['1473-0.jpg', '1473-1.jpg'],
        input: {
          title: 'Светлые джинсы bootcut большого размера',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'lightblue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 117 см, полупояс 45 см, выход 28 см.',
        },
      },
      {
        photos: ['1475-0.jpg', '1475-1.jpg'],
        input: {
          title: 'Спортивные штаны slim flare с карманами и ремешками',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 36–42 см, выход 23 см.',
        },
      },
      {
        photos: ['1477-0.jpg', '1477-1.jpg'],
        input: {
          title: 'Джинсы Miss Sixty Radio slim с низкой посадкой',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Miss Sixty', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 39 см, выход 16 см.',
        },
      },
      {
        photos: ['1479-0.jpg', '1479-1.jpg'],
        input: {
          title: 'Серые джинсы bootcut с кармашками',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: S–M.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 100 см, полупояс 39 см, выход 23 см.',
        },
      },
      {
        photos: ['1483-0.jpg', '1483-1.jpg'],
        input: {
          title: 'Серые выстиранные широкие джинсы',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'XS–S', price: 75,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: XS–S.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 111 см, полупояс 36 см, выход 29 см.',
        },
      },
      {
        photos: ['1487-0.jpg', '1487-1.jpg'],
        input: {
          title: 'Серые утеплённые джинсы slim/straight',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'ALPHA', sizeValue: 'M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M.\nУтеплены.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 104 см, полупояс 41 см, выход 18 см.',
        },
      },
      {
        photos: ['1491-0.jpg'],
        input: {
          title: 'Высокие кеды Loong камуфляжные',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 39 (240–245 мм).\nСостояние по оценке продавца: 9/10.',
        },
      },
      {
        photos: ['1492-0.jpg', '1492-1.jpg'],
        input: {
          title: 'Плотные джинсы straight индиго',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 112 см, полупояс 42 см, выход 21 см.',
        },
      },
      {
        photos: ['1494-0.jpg', '1494-1.jpg'],
        input: {
          title: 'Джинсы Tom Denim straight',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 107 см, полупояс 44 см, выход 23 см.',
        },
      },
      {
        photos: ['1497-0.jpg', '1497-1.jpg'],
        input: {
          title: 'Джинсы &denim bootcut',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: '&denim', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 108 см, полупояс 45 см, выход 27 см.',
        },
      },
      {
        photos: ['1499-0.jpg', '1499-1.jpg'],
        input: {
          title: 'Джинсы bootcut Mud со средней посадкой',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nПояс хорошо тянется до 43, красивый окрас.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 106 см, полупояс 40 см, выход 24 см.',
        },
      },
      {
        photos: ['1502-0.jpg', '1502-1.jpg'],
        input: {
          title: 'Джинсы NL wide leg индиго',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: M–L.\nСостояние по оценке продавца: 9/10.\nЗамеры: длина 110 см, полупояс 45 см, выход 32 см.',
        },
      },
    ],
  },
  {
    // 2026-11-11: consultant (t.me/consultantdaemoni, 14.7K) — a reseller network of archive and vintage: the account
    // looks like the main channel (name, avatar, bio), the items come from the stock channels of its sellers —
    // t.me/avalaibles (@gv8kos, files a…) and t.me/avbnotgrave (@Ehwjfp, files b…). Every post still in those channels
    // on 2026-11-11; a repost kept once (the latest, with its price). ₽ at 29 per BYN rounded to 5, the owner's own BYN
    // price where given. The third stock channel (@cellardr) is private and not here yet.
    username: 'consultantdaemoni',
    folder: 'consultantdaemoni',
    account: { bio: 'consultant — архив и винтаж: кожа, деним, обувь, верхняя одежда. Без возврата, отправка в любую точку мира.', brandName: 'consultant', logo: 'logo.jpg', catalog: true },
    items: [
      {
        photos: ['b2310-0.jpg', 'b2310-1.jpg', 'b2310-2.jpg', 'b2310-3.jpg', 'b2310-4.jpg'],
        input: {
          title: 'Розовое велюровое зип-худи Juicy Couture',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 205, condition: 'GOOD', defectsPresent: false, brand: 'Juicy Couture', color: 'pink', gender: 'FEMALE', material: 'Трикотаж', styleTags: ['Y2K'],
          description: 'Размер: по факту M.\nРозовый велюровый зип-худи от Juicy Couture Sport. Модель дополнена фирменным золотистым бегунком в виде буквы «J», аккуратным вышитым логотипом на груди, карманом-кенгуру и капюшоном на завязках. Иконическая вещь в эстетике Y2K, coquette и стиля 2000-х.',
        },
      },
      {
        photos: ['b2643-0.jpg', 'b2643-1.jpg', 'b2643-2.jpg', 'b2643-3.jpg', 'b2643-4.jpg', 'b2643-5.jpg', 'b2643-6.jpg'],
        input: {
          title: 'Флисовый анорак Napapijri Geographic',
          category: 'outerwear', subcategory: 'windbreaker', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 410, condition: 'GOOD', defectsPresent: false, brand: 'Napapijri', color: 'red', gender: null, material: 'Полиэстер', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер: XL.\nКрасный флисовый анорак свободного кроя с капюшоном. Выполнен из мягкого фактурного материала с высоким ворсом, обеспечивающего тепло и комфорт. Модель дополнена регулируемым капюшоном, застежкой на кнопки в верхней части и боковой молнией для удобного надевания. Спереди расположен вместительный карман-кенгуру с клапаном и фирменной нашивкой Napapijri Geographic. На груди и рукаве — декоративные брендовые патчи с экспедиционной тематикой, ниже размещена нашивка с флагом Норвегии. Манжеты и нижний край обработаны эластичной окантовкой.',
        },
      },
      {
        photos: ['b2758-0.jpg', 'b2758-1.jpg', 'b2758-2.jpg', 'b2758-3.jpg', 'b2758-4.jpg'],
        input: {
          title: 'Чёрные зимние ботинки в стиле Moon Boot с мехом',
          category: 'shoes', subcategory: 'high-boots', sizeSystem: 'OTHER', sizeValue: '38–39', price: 190, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Размер: 38–39.\nВысокие ботинки черного цвета в стиле (Moon Boot). Верх комбинированный: нижняя часть выполнена из гладкой кожи, голенище — из стеганого текстиля с легким блеском. Верхняя манжета и внутренняя отделка украшены пушистым мехом черного цвета. Модель дополнена шнуровкой по всей передней части на металлических петлях и люверсах. Толстая рифленая подошва обеспечивает надежное сцепление и защиту от холода.',
        },
      },
      {
        photos: ['b2768-0.jpg', 'b2768-1.jpg', 'b2768-2.jpg', 'b2768-3.jpg', 'b2768-4.jpg', 'b2768-5.jpg', 'b2768-6.jpg'],
        input: {
          title: 'Куртка The North Face с геометричным принтом',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 240, condition: 'GOOD', defectsPresent: false, brand: 'The North Face', color: 'gray', gender: null, material: 'Нейлон', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер: L.\nТемно-серая куртка The North Face с капюшоном и графичным геометрическим принтом в черных, серых и коричневых оттенках. Модель выполнена в свободном крое, застегивается на фронтальную молнию и дополнена защитной планкой на кнопках. Капюшон регулируется кулиской, манжеты застегиваются на липучки. На груди расположены накладные карманы с клапанами на кнопках, по бокам — вместительные карманы для рук на молниях. На левом рукаве и груди вышит фирменный логотип The North Face. Внутри — светлая подкладка, внутренние карманы и регулируемая кулиска по нижнему краю.',
        },
      },
      {
        photos: ['b2795-0.jpg', 'b2795-1.jpg', 'b2795-2.jpg', 'b2795-3.jpg', 'b2795-4.jpg'],
        input: {
          title: 'Чёрный бомбер с накладными карманами',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 170, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: L-XL.\nЧёрная куртка свободного кроя с высоким воротником и рукавами реглан. Спереди расположены четыре накладных кармана с клапанами на кнопках, один из нагрудных дополнен вертикальной молнией. На рукаве — отдельный карман на молнии. Центральная застёжка — металлическая двухзамковая молния. Манжеты и нижний край выполнены из эластичного трикотажа в рубчик. Фактурная ткань, декоративные швы и металлическая фурнитура подчёркивают утилитарный стиль модели.',
        },
      },
      {
        cover: 'b2807-1.jpg',
        photos: ['b2807-0.jpg', 'b2807-1.jpg', 'b2807-2.jpg', 'b2807-3.jpg', 'b2807-4.jpg'],
        input: {
          title: 'Укороченная куртка Coodior хаки с вышивкой',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Coodior', color: 'green', gender: 'FEMALE', material: 'Нейлон', styleTags: ['Y2K'],
          description: 'Размер: S (замеры уточняйте у продавца).\nУкороченная куртка Coodior цвета хаки в стиле Y2K. Модель с высоким воротником-стойкой, центральной застёжкой на молнию и множеством функциональных карманов на молниях спереди и на рукавах. На спине расположена крупная вышивка в виде птицы с распростёртыми крыльями, украшенная стразами, и надпись «COODIOR». Удлинённые эластичные манжеты и широкий пояс в рубчик подчёркивают силуэт. Декоративная контрастная отстрочка и металлическая фурнитура дополняют выразительный дизайн в архивной эстетике 2000-х.',
        },
      },
      {
        photos: ['b3059-0.jpg', 'b3059-1.jpg', 'b3059-2.jpg', 'b3059-3.jpg', 'b3059-4.jpg'],
        input: {
          title: 'Чёрный бомбер с капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'S', price: 135, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Minimal'],
          description: 'Размер: S.\nПлотный бомбер черного цвета, с отличным бокси фитом, отлично подойдет на сезон. Идеальный минимализм для вашего гардероба.',
        },
      },
      {
        photos: ['b3066-0.jpg', 'b3066-1.jpg', 'b3066-2.jpg', 'b3066-3.jpg', 'b3066-4.jpg', 'b3066-5.jpg', 'b3066-6.jpg'],
        input: {
          title: 'Чёрное худи AllSaints с молниями',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170, condition: 'GOOD', defectsPresent: false, brand: 'AllSaints', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер: M.\nЧерное худи Allsaints из плотного материала с высоким капюшоном и короткой молнией на груди. Модель дополнена вместительным карманом-кенгуру, боковыми молниями и эластичными манжетами. Акцентная металлическая фурнитура и минималистичный дизайн.',
        },
      },
      {
        photos: ['b3073-0.jpg', 'b3073-1.jpg', 'b3073-2.jpg', 'b3073-3.jpg', 'b3073-4.jpg', 'b3073-5.jpg', 'b3073-6.jpg'],
        input: {
          title: 'Двухцветные джинсы-карго с вельветовыми вставками',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 100, condition: 'GOOD', defectsPresent: false, brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K'],
          description: 'Джинсы из плотного темно-синего денима с контрастной коричневой вельветовой отделкой по поясу и боковым швам. Модель с карманами-карго, застежкой на металлические пуговицы и акцентной строчкой. Сзади — накладные карманы с декоративной вышивкой.\nЗамеры: полуобхват талии 40 см, длина 105 см, выход 22 см, полуобхват бедра 28 см.',
        },
      },
      {
        photos: ['b3097-0.jpg', 'b3097-1.jpg', 'b3097-2.jpg', 'b3097-3.jpg', 'b3097-4.jpg', 'b3097-5.jpg', 'b3097-6.jpg'],
        input: {
          title: 'Кожаные ботинки челси (Италия)',
          category: 'shoes', subcategory: 'chelsea', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 240, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'MALE', material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер: 42.\nЧерные кожаные ботинки челси, изготовленные в Италии. Модель с закругленным мысом, эластичными боковыми вставками и петлями для удобного надевания. Дополнены массивной итальянской подошвой и устойчивым каблуком. Лаконичный дизайн с небольшими декоративными деталями на задниках. На коже заметны естественные складки.',
        },
      },
      {
        photos: ['b3127-0.jpg', 'b3127-1.jpg', 'b3127-2.jpg', 'b3127-3.jpg', 'b3127-4.jpg', 'b3127-5.jpg', 'b3127-6.jpg'],
        input: {
          title: 'Утеплённая куртка Quiksilver с мехом на капюшоне',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'ALPHA', sizeValue: 'L', price: 170, condition: 'GOOD', defectsPresent: false, brand: 'Quiksilver', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: L.\nЧёрная утеплённая куртка Quiksilver с объёмным капюшоном и меховой опушкой. Модель с центральной молнией, ветрозащитной планкой на кнопках и высоким воротником. Четыре вместительных накладных кармана с клапанами, дополнительные карманы на рукавах и внутри. Манжеты регулируются липучками, по низу предусмотрена утяжка. Куртка дополнена фирменными нашивками, вышивкой и металлической фурнитурой в стиле Quiksilver. Практичная тёплая модель.',
        },
      },
      {
        photos: ['b3148-0.jpg', 'b3148-1.jpg', 'b3148-2.jpg', 'b3148-3.jpg', 'b3148-4.jpg'],
        input: {
          title: 'Чёрная непромокаемая куртка Hollister',
          category: 'outerwear', subcategory: 'windbreaker', sizeSystem: 'ALPHA', sizeValue: 'M', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Hollister', color: 'black', gender: null, material: 'Нейлон', styleTags: ['Casual'],
          description: 'Размер: по бирке S, по факту M.\nВодоотталкивающая и непродуваемая куртка от Hollister, глубокий черный цвет, отличный прямой фит, защита от ветра и воды по всем фронтам.',
        },
      },
      {
        photos: ['b3153-0.jpg', 'b3153-1.jpg', 'b3153-2.jpg', 'b3153-3.jpg', 'b3153-4.jpg'],
        input: {
          title: 'Чёрная куртка из натуральной кожи',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Minimal'],
          description: 'Размер: M.\nБроня из натуральной мягкой кожи, с отличным фитом и фейдом от потертостей. Идеальный стрейт фит и минимализм.',
        },
      },
      {
        cover: 'b3158-1.jpg',
        photos: ['b3158-0.jpg', 'b3158-1.jpg', 'b3158-2.jpg', 'b3158-3.jpg', 'b3158-4.jpg'],
        input: {
          title: 'Кожаная сумка-слинг ручной работы с заклёпками',
          category: 'bags', subcategory: 'crossbody', price: 170, condition: 'GOOD', defectsPresent: false, brand: null, color: 'blue', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Плотная натуральная кожа, фейд эффектом застраивания, качественная металлическая фурнитура, заклепки, булавки, зипы. ручная работа.',
        },
      },
      {
        photos: ['a66-0.jpg', 'a66-1.jpg', 'a66-2.jpg', 'a66-3.jpg'],
        input: {
          title: 'Чёрные вощёные джинсы слим на молниях',
          category: 'jeans', subcategory: 'slim', sizeSystem: 'JEANS_W', sizeValue: 'W33', price: 165, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Прямые джинсы ~ слим кроя, идеальный фит складками на теле, стальная фурнитура YKK, функциональные шнурки.\nПлотная обработанная воском джинса…\nЗамеры: полуобхват талии 42 см, длина 105 см, выход 20 см.',
        },
      },
      {
        photos: ['a84-0.jpg', 'a84-1.jpg', 'a84-2.jpg', 'a84-3.jpg', 'a84-4.jpg'],
        input: {
          title: 'Замшевые сапоги Diesel на каблуке',
          category: 'shoes', subcategory: 'high-boots', sizeSystem: 'SHOE_EU', sizeValue: '39', price: 240, condition: 'GOOD', defectsPresent: false, brand: 'Diesel', color: 'brown', gender: 'FEMALE', material: 'Замша', styleTags: ['Vintage'],
          description: 'Размер: 39.\nНатуральная замша/кожа коровы. песочно-коричневого цвета.\nПоверхность матовая, с мягкой, бархатистой текстурой.\nВысокие сапоги, почти до колена. свободное голенище. устойчивый каблук 9см. декоративные кожаные ремешки вокруг щиколотки с металлическим кольцом и заклёпками. контрастная светлая прострочка по краям. металлическое лого сбоку.',
        },
      },
      {
        photos: ['a2799-0.jpg', 'a2799-1.jpg', 'a2799-2.jpg', 'a2799-3.jpg', 'a2799-4.jpg'],
        input: {
          title: 'Асимметричная дублёнка с меховым капюшоном',
          category: 'outerwear', subcategory: 'sheepskin', sizeSystem: 'OTHER', sizeValue: 'XS–S', price: 260, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер: XS–S.\nАсимметричная стальная молния YKK, натуральная дубленка и мех, съемный капюшон\nРост на фото - 178см',
        },
      },
      {
        cover: 'a243-1.jpg',
        photos: ['a243-0.jpg', 'a243-1.jpg'],
        input: {
          title: 'Кожаная косуха Highway Moto',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'XXL', price: 380, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'MALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: 62/XXL (по факту меньше).\nРост и вес на фото - 180/73\nБезупречный обьемный фит, подойдет практически на любую комплекцию от 180см, стальные молнии YKK, очень приятная кожа на ощупь.\nИдеальный вариант на демисезон, лучше не видел.',
        },
      },
      {
        photos: ['a2804-0.jpg', 'a2804-1.jpg', 'a2804-2.jpg', 'a2804-3.jpg', 'a2804-4.jpg', 'a2804-5.jpg', 'a2804-6.jpg'],
        input: {
          title: 'Кожаные ботинки Prada Milano 00-х',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '37,5', price: 330, condition: 'GOOD', defectsPresent: false, brand: 'Prada', color: 'black', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: 37,5.\nБотинки выполнены из натуральной вощеной кожи, сзади располагается стальная фурнитура Opti, сбоку функциональный ремешок.\nВнимание к деталям!\n*аккуратные швы\n*высококачественная кожа внутри и снаружи, вощеный шнурок, кожаные петельки на фурнитуре.\n*стоит профилактика для продления срока эксплуатации пары.\n*редкая пара из нулевых годов',
        },
      },
      {
        cover: 'a329-6.jpg',
        photos: ['a329-0.jpg', 'a329-1.jpg', 'a329-2.jpg', 'a329-3.jpg', 'a329-4.jpg', 'a329-5.jpg', 'a329-6.jpg'],
        input: {
          title: 'Кожаные ботинки See by Chloé с замшевым верхом',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '38,5', price: 340, condition: 'GOOD', defectsPresent: false, brand: 'See by Chloé', color: 'black', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: 38,5.\nМножество вариаций носки, складной верх из замши, основная часть изделие состоит из натуральной кожи.\nНемного утеплены внутри.',
        },
      },
      {
        cover: 'a338-2.jpg',
        photos: ['a338-0.jpg', 'a338-1.jpg', 'a338-2.jpg', 'a338-3.jpg', 'a338-4.jpg', 'a338-5.jpg', 'a338-6.jpg'],
        input: {
          title: 'Чёрные джинсы-буткат (новые)',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XS', sizes: ['XS', 'S', 'M', 'L', 'XL'], price: 100, condition: 'NEW_WITH_TAGS', hasTags: false, defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: '*строго новые!\nБезупречная посадка на теле, слегка тянущийся материал, что позволяет придавать разную форму джинсам.\nЛегкий, но при этом качественный деним на каждый день.\nГлубокий черный цвет.\nУнисекс, как и парням, так и девушкам\nЛегко подберу размер под ваши параметры!',
        },
      },
      {
        photos: ['a414-0.jpg', 'a414-1.jpg', 'a414-2.jpg', 'a414-3.jpg', 'a414-4.jpg', 'a414-5.jpg', 'a414-6.jpg'],
        input: {
          title: 'Чёрные джинсы-клёш (новые)',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'ALPHA', sizeValue: 'XS', sizes: ['XS', 'S', 'M', 'L', 'XL'], price: 100, condition: 'NEW_WITH_TAGS', hasTags: false, defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: '*строго новые!\nБезупречная посадка на теле, слегка тянущийся материал, что позволяет придавать разную форму джинсам.\nЛегкий, но при этом качественный деним на каждый день.\nГлубокий черный цвет.\nУнисекс, как и парням, так и девушкам\nЛегко подберу размер под ваши параметры!',
        },
      },
      {
        photos: ['a654-0.jpg', 'a654-1.jpg', 'a654-2.jpg', 'a654-3.jpg', 'a654-4.jpg', 'a654-5.jpg', 'a654-6.jpg'],
        input: {
          title: 'Пальто Transit Par Such, сэмпл (Италия)',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'M', price: 415, condition: 'GOOD', defectsPresent: false, brand: 'Transit Par Such', color: 'black', gender: null, material: 'Нейлон', styleTags: ['Minimal'],
          description: 'Размер: M (на худощавого).\n*Sample, Made In Italy\nУдлиненный силуэт с характерной асимметричной молнией, обьемный капюшон, который при застегивании образует высокий воротник-стойку.\nФурнитура Lampo, основной материал нейлон + шерстяные вставки.\nПодкладка из вискозы.\nОчень редкий предмет, возможно единственный в продаже, так как это сэмпл.\nТакже Transit известен использованием высококачественных натуральных материалов с добавлением технологичных волокон.',
        },
      },
      {
        cover: 'a1528-2.jpg',
        photos: ['a1528-0.jpg', 'a1528-1.jpg', 'a1528-2.jpg', 'a1528-3.jpg', 'a1528-4.jpg'],
        input: {
          title: 'Шёлковая юбка-шорты Rick Owens SS00',
          category: 'skirts', subcategory: 'mini', sizeSystem: 'OTHER', sizeValue: 'Уточняйте', price: 340, condition: 'GOOD', defectsPresent: false, brand: 'Rick Owens', color: 'gray', gender: 'FEMALE', material: 'Шёлк', styleTags: ['Vintage'],
          description: 'Юбка~шорты от рика в восхитительной расцветке “Dust” - пыльно-серый оттенок с землистым подтоном\n(Реальный цвет - 1 фото)\nВыполнена из 100% шелка, очень приятный к телу.\nОснащена двумя карманами\nРедкая позиция из нулевых, достойная вашего внимания',
        },
      },
      {
        cover: 'a1533-3.jpg',
        photos: ['a1533-0.jpg', 'a1533-1.jpg', 'a1533-2.jpg', 'a1533-3.jpg', 'a1533-4.jpg'],
        input: {
          title: 'Свитер-сетка Tom Ford',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'S', price: 430, condition: 'GOOD', defectsPresent: false, brand: 'Tom Ford', color: 'black', gender: null, material: 'Шёлк', styleTags: ['Vintage'],
          description: 'Размер: S.\nПараметры на фото - 178/50\nЛегкий плетеный свитер~сетка из приятного материала вроде шелка.\nОтлично подойдет на теплую погоду.\nНа груди расположено 2 функциональных накладных кармана, глубокий вырез, удобная застежка.\nОриентировочно 2006~2010 год',
        },
      },
      {
        photos: ['a1545-0.jpg', 'a1545-1.jpg', 'a1545-2.jpg', 'a1545-3.jpg', 'a1545-4.jpg', 'a1545-5.jpg', 'a1545-6.jpg'],
        input: {
          title: 'Блузка Maison Martin Margiela AW13',
          category: 'shirts', subcategory: 'blouse', sizeSystem: 'ALPHA', sizeValue: 'S', price: 535, condition: 'GOOD', defectsPresent: false, brand: 'Maison Margiela', color: 'black', gender: 'FEMALE', material: 'Шерсть', styleTags: ['Minimal'],
          description: 'Размер: 40 IT / S.\nБлузка в отличном состоянии, вероятнее всего подиум, 1 женская линяя маржелы, созданная при анонимном дизайн-бюро, когда блистал Матье Блази(нынешний креативный директор дома Chanel)\nКомбинация из высококачественной костюмной шерсти (Lana Wool) и хлопка\n4 стежка сзади, пустая бирка, приталенный крой, к низу слегка расширяется.',
        },
      },
      {
        photos: ['a1552-0.jpg', 'a1552-1.jpg', 'a1552-2.jpg', 'a1552-3.jpg', 'a1552-4.jpg', 'a1552-5.jpg', 'a1552-6.jpg'],
        input: {
          title: 'Шёлковая юбка Ann Demeulemeester 00-х',
          category: 'skirts', subcategory: 'mini', sizeSystem: 'ALPHA', sizeValue: 'S', price: 515, condition: 'GOOD', defectsPresent: false, brand: 'Ann Demeulemeester', color: 'beige', gender: 'FEMALE', material: 'Шёлк', styleTags: ['Vintage'],
          description: 'Размер: 36/S.\nMade In Tunisia\nЮбка с поясом, асимметричной застежкой, двумя функциональными карманами.\nПриятный кремовый цвет, сделана из 100% шелка\nНесколько вариаций носки с поясом, два ряда лямок.',
        },
      },
      {
        photos: ['a1559-0.jpg', 'a1559-1.jpg', 'a1559-2.jpg', 'a1559-3.jpg', 'a1559-4.jpg'],
        input: {
          title: 'Шёлковая рубашка-платье L.G.B. (Le Grand Bleu)',
          category: 'shirts', subcategory: 'shirt', sizeSystem: 'ALPHA', sizeValue: 'S', price: 515, condition: 'GOOD', defectsPresent: false, brand: 'L.G.B.', color: 'pink', gender: null, material: 'Шёлк', styleTags: ['Vintage'],
          description: 'Размер: 1 / S.\nLong like Dress\n100% шёлк\nХарактерные для бренда элементы дистресса, с необработанными ~ «рваными» краями.\nУдлиненный крой, рукава с рядом функциональных заклепок, что позволяет создавать разные формы и вариации носки.\nДва накладных кармана на груди, классический отложной воротник с дополнительными кнопками на стойке.\nНежно-розовый(персиковый) цвет.',
        },
      },
      {
        cover: 'a2811-1.jpg',
        photos: ['a2811-0.jpg', 'a2811-1.jpg', 'a2811-2.jpg', 'a2811-3.jpg', 'a2811-4.jpg', 'a2811-5.jpg', 'a2811-6.jpg'],
        input: {
          title: 'Винтажная кожаная куртка Hein Gericke в гусарском стиле',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 515, condition: 'GOOD', defectsPresent: false, brand: 'Hein Gericke', color: 'black', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: L.\nHussar Styled\nВинтажная кожаная куртка Hein Gericke в характерной мотоциклетной эстетике 80-90-х. Выполнена из плотной натуральной кожи чёрного цвета, которая со временем приобрела красивую естественную патину.\nОчень сильный крой: высокая стойка, двойная фронтальная конструкция с молнией и рядом кожаных кнопок, четыре кармана на металлических молниях YKK.\nНа плечах плетёные кожаные вставки.\nСзади регулируемый пояс, на рукавах молнии.\nВнутри стёганая подкладка. Фурнитура металлическая, массивная. Силуэт короткий и структурированный, визуально заметно интереснее стандартной косухи.\nИдеально подойдет на зиму',
        },
      },
      {
        photos: ['a2138-0.jpg', 'a2138-1.jpg', 'a2138-2.jpg', 'a2138-3.jpg', 'a2138-4.jpg'],
        input: {
          title: 'Винтажная футболка Pink Floyd European Tour 1994',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 340, condition: 'GOOD', defectsPresent: false, brand: null, color: 'white', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: XL.\nSingle Stitch\nОригинальная винтажная туровая футболка Pink Floyd 1994 года, выпущенная к европейской части The Division Bell Tour.\nКоллекционный редкий предмет.\nНа груди - культовый арт The Division Bell со скульптурами Storm Thorgerson, на спине - большой European Tour 1994 принт со списком европейских городов и логотипом Volkswagen, выступавшего спонсором тура.',
        },
      },
      {
        photos: ['a2195-0.jpg', 'a2195-1.jpg', 'a2195-2.jpg', 'a2195-3.jpg', 'a2195-4.jpg', 'a2195-5.jpg', 'a2195-6.jpg'],
        input: {
          title: 'Вощёная мотокуртка G-Star',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 270, condition: 'GOOD', defectsPresent: false, brand: 'G-Star', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Идеальная слим посадка на теле, размер по бирке - XS(факт М ~ слим)\nВощеный плотный материал, несколько функциональных карманов с асимметричным расположением, регулировка ширины сзади, брендированные стальные молнии.\nРедкий предмет\nРост и вес на фото - 180/70',
        },
      },
      {
        cover: 'a2818-1.jpg',
        photos: ['a2818-0.jpg', 'a2818-1.jpg'],
        input: {
          title: 'Меховые сапоги Nordica Yeti (Италия)',
          category: 'shoes', subcategory: 'high-boots', sizeSystem: 'OTHER', sizeValue: '41–42', price: 260, condition: 'GOOD', defectsPresent: false, brand: 'Nordica', color: 'black', gender: null, styleTags: ['Y2K'],
          description: 'Размер: 41–42.\nMade In Italy\nСамый необычный вариант на осень ~ зиму.\nУдобные, встроен теплый слой с шерстью внутри.\nМассивный вид, нескользкий протектор.',
        },
      },
      {
        cover: 'a3129-1.jpg',
        photos: ['a3129-0.jpg', 'a3129-1.jpg', 'a3129-2.jpg', 'a3129-3.jpg', 'a3129-4.jpg'],
        input: {
          title: 'Армейские боты-галоши BW 80–90-х',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '44–45', price: 105, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'MALE', styleTags: ['Vintage'],
          description: '80-90s\nОтличный вариант на осень~зиму.\nНадеваются поверх вашей обуви, защищают от влаги, холода и грязи.\nПо центру располагается фурнитура YKK.\nВечный вариант, прослужит не один сезон.\nАктуальный объемный силуэт',
        },
      },
      {
        photos: ['a2293-0.jpg', 'a2293-1.jpg', 'a2293-2.jpg', 'a2293-3.jpg', 'a2293-4.jpg', 'a2293-5.jpg', 'a2293-6.jpg'],
        input: {
          title: 'Кожаные ботинки Fendi с ремешками',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '40,5', price: 605, condition: 'GOOD', defectsPresent: false, brand: 'Fendi', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: 6.5 US / 40,5 EU (стелька 26 см).\nВысокие ботинки от Fendi, темно-коричневый цвет, стальные брендированные ремешки.\nКожа высочайшего качества, имеет уникальный паттерн, была окрашена в ручную.\nУнисекс',
        },
      },
      {
        photos: ['a2346-0.jpg', 'a2346-1.jpg', 'a2346-2.jpg', 'a2346-3.jpg', 'a2346-4.jpg', 'a2346-5.jpg', 'a2346-6.jpg'],
        input: {
          title: 'Меховые ботинки Prada Sport 2000-х',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'OTHER', sizeValue: '37–38', price: 690, condition: 'GOOD', defectsPresent: false, brand: 'Prada', color: 'black', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Размер: 37–38.\nНатуральный кудрявый мех, металические фикстары с брендингом и утяжкой.\nКультовый силуэт, красная полоса на подошве.\nНейлон + кожа сверху для удобства.\nРоскошный вид, настоящая жемчужина определяющая эпоху нулевых.',
        },
      },
      {
        photos: ['a2709-0.jpg', 'a2709-1.jpg', 'a2709-2.jpg', 'a2709-3.jpg', 'a2709-4.jpg', 'a2709-5.jpg', 'a2709-6.jpg'],
        input: {
          title: 'Полупальто G-Star',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'L', price: 225, condition: 'GOOD', defectsPresent: false, brand: 'G-Star', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: L.\nИдеальное полупальто с регулируемыми завязками на рукавах, множество брендированных элементов, стальная фурнитура.',
        },
      },
      {
        cover: 'a2716-2.jpg',
        photos: ['a2716-0.jpg', 'a2716-1.jpg', 'a2716-2.jpg', 'a2716-3.jpg', 'a2716-4.jpg'],
        input: {
          title: 'Укороченная дублёнка-авиатор с меховым воротником',
          category: 'outerwear', subcategory: 'sheepskin', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 225, condition: 'GOOD', defectsPresent: false, brand: null, color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: S–M.\nУкороченная дубленка с высоким горлом, несколько вариаций носки воротника и рукавов.\nСтальная фурнитура, идеальная посадка на теле.',
        },
      },
      {
        photos: ['a2726-0.jpg', 'a2726-1.jpg', 'a2726-2.jpg', 'a2726-3.jpg', 'a2726-4.jpg'],
        input: {
          title: 'Чёрные джинсы Crosshatch',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W35', price: 155, condition: 'GOOD', defectsPresent: false, brand: 'Crosshatch', color: 'black', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Превосходные джинсы прямого ~ широкого кроя, плотный темный деним, глубокие карманы, стальная фурнитура.\nЗамеры: полуобхват талии 44 см, длина 112 см, выход 24 см.',
        },
      },
      {
        photos: ['a2731-0.jpg', 'a2731-1.jpg', 'a2731-2.jpg', 'a2731-3.jpg', 'a2731-4.jpg'],
        input: {
          title: 'Джинсы-буткат Miss Sixty 00-х с грязным фейдом',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Miss Sixty', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Винтажный буткат от известного бренда, загрязненный цвет с фейдами, стальная фурнитура YKK.\nЗамеры: длина 102 см, полуобхват талии 40 см, выход 24 см.',
        },
      },
      {
        photos: ['a2736-0.jpg', 'a2736-1.jpg', 'a2736-2.jpg', 'a2736-3.jpg', 'a2736-4.jpg'],
        input: {
          title: 'Утеплённое зип-худи Polo Ralph Lauren',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 260, condition: 'GOOD', defectsPresent: false, brand: 'Polo Ralph Lauren', color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: S–M.\nСупер теплый худи ~ можно носить как куртку, стальная фурнитура YKK, минималистичный вышитый логотип, заводской дистресс и необработанные швы, плотнейший хлопок, утеплитель внутри.',
        },
      },
      {
        photos: ['a2741-0.jpg', 'a2741-1.jpg'],
        input: {
          title: 'Куртка Superdry с тремя молниями',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Superdry', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: S–M.\nКуртка оснащена тремя функциональными молниями с помощью которых можно придавать разный вид куртке, утеплена внутри, капюшон с утяжками, на манжетах вырезы под большие пальцы.',
        },
      },
      {
        photos: ['a2743-0.jpg', 'a2743-1.jpg', 'a2743-2.jpg', 'a2743-3.jpg', 'a2743-4.jpg', 'a2743-5.jpg', 'a2743-6.jpg'],
        input: {
          title: 'Джинсы G-Star Spiraq 3D Relaxed',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 240, condition: 'GOOD', defectsPresent: false, brand: 'G-Star', color: 'blue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Джинсы от известного бренда, одна из интереснейших моделей, которые я когда либо видел.\nМножество мелких, но детализированных элементов, заводской дистресс и потертости, потрясающая форма и плотность денима, стальная брендированная фурнитура, вместительные карманы, фейд на бедрах.\nЗамеры: длина 105 см, полуобхват талии 43 см, выход 23 см.',
        },
      },
      {
        photos: ['a2750-0.jpg', 'a2750-1.jpg', 'a2750-2.jpg', 'a2750-3.jpg', 'a2750-4.jpg'],
        input: {
          title: 'Джинсы-буткат Miss Sixty 00-х с клёпками',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W30', price: 155, condition: 'GOOD', defectsPresent: false, brand: 'Miss Sixty', color: 'blue', gender: 'FEMALE', material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Винтажный буткат от известного бренда, снизу распологаются функциональные металлические клепки.\nСтальная брендированная фурнитура, фейд на бедрах и коленях, безупречный крой, эталон.\nЗамеры: полуобхват талии 37-40 см (тянется), длина 105 см, выход 24 см.',
        },
      },
      {
        photos: ['a2760-0.jpg', 'a2760-1.jpg', 'a2760-2.jpg', 'a2760-3.jpg', 'a2760-4.jpg'],
        input: {
          title: 'Укороченная куртка с капюшоном, стрэпами и клёпками',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: S–M.\nУкороченная теплая куртка с капюшон, на котором регулирующие утяжки.\nИнтересные декоративные элементы в виде стрэпов и стальных клепок на них, идеальная посадка на теле.',
        },
      },
      {
        photos: ['a2765-0.jpg', 'a2765-1.jpg', 'a2765-2.jpg', 'a2765-3.jpg', 'a2765-4.jpg'],
        input: {
          title: 'Кожаная мотокуртка RST Blade',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 240, condition: 'GOOD', defectsPresent: false, brand: 'RST', color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер: M.\nМотокуртка из плотной грубой кожи, идеальная посадка на теле, обьемные плечи ~ укороченный крой.',
        },
      },
      {
        photos: ['a2782-0.jpg', 'a2782-1.jpg', 'a2782-2.jpg', 'a2782-3.jpg', 'a2782-4.jpg', 'a2782-5.jpg', 'a2782-6.jpg'],
        input: {
          title: 'Брюки-парашюты Diesel Workwear 80–90-х',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'OTHER', sizeValue: 'W28–W34', price: 260, condition: 'GOOD', defectsPresent: false, brand: 'Diesel', color: 'green', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Made In Italy\nСупер редкие штаны от Diesel широкого кроя ~ сужаются к низу, множество функциональных карманов на замке, регулировка талии на стальных пуговицах.\nНастоящий раритет и интересная позиция в ваш гардероб\nЗамеры: полуобхват талии 43~36 см (регулируется), длина 105 см, выход 23 см, чуть выше 27.',
        },
      },
      {
        photos: ['a2791-0.jpg', 'a2791-1.jpg', 'a2791-2.jpg', 'a2791-3.jpg', 'a2791-4.jpg', 'a2791-5.jpg', 'a2791-6.jpg', 'a2791-7.jpg'],
        input: {
          title: 'Бомбер N2B Jet Set',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 480, condition: 'GOOD', defectsPresent: false, brand: 'Jet Set', color: 'red', gender: null, material: 'Нейлон', styleTags: ['Vintage'],
          description: 'Размер: M/L.\nВинтажный N2B бомбер премиального горнолыжного бренда Jet Set из Швейцарии. Укороченная куртка объемного кроя в насыщенном рубиново-красном оттенке из плотного фактурного рипстоп-нейлона. Главная деталь — трансформируемый сплит-капюшон на молнии с черным стеганым подкладом, который раскладывается на плечи.\nПремиальная фурнитура: массивные швейцарские молнии riri Swiss с кожаными пуллерами и итальянские кнопки Fiocchi Italy. Модель дополнена высоким штормовым воротом на утяжках, съемным поясным ремнем с металлической пряжкой и люверсами, тактическим карманом на рукаве и плотными трикотажными манжетами. Буквально лучшая n2b куртка на эту зиму.',
        },
      },
      {
        photos: ['a2863-0.jpg', 'a2863-1.jpg', 'a2863-2.jpg', 'a2863-3.jpg', 'a2863-4.jpg'],
        input: {
          title: 'Укороченный бомбер Puma',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170, condition: 'GOOD', defectsPresent: false, brand: 'Puma', color: 'blue', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Размер: M (женский).\nВинтажный укороченный бомбер от Puma, тугие манжеты, высокое горло.\nСпереди маленький вышитый логотип, сзади большой, стальная фурнитура YKK',
        },
      },
      {
        photos: ['a2902-0.jpg', 'a2902-1.jpg'],
        input: {
          title: 'Чёрные джинсы-клёш',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 115, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Расклешенный деним черного цвета, отличный крой, идеальный вариант на каждый день\nЗамеры: полуобхват талии 39-43 см (тянется), длина 100 см, выход 27 см.',
        },
      },
      {
        photos: ['a2939-0.jpg', 'a2939-1.jpg', 'a2939-2.jpg', 'a2939-3.jpg', 'a2939-4.jpg'],
        input: {
          title: 'Укороченный бомбер Adidas с капюшоном 2010',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'S', price: 205, condition: 'GOOD', defectsPresent: false, brand: 'Adidas', color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер: S.\nУкороченный бомбер с тугими манжетами от Adidas, идеальный вариант на холодную погоду, стальная фурнитура Ideal.',
        },
      },
      {
        photos: ['a2951-0.jpg', 'a2951-1.jpg', 'a2951-2.jpg', 'a2951-3.jpg', 'a2951-4.jpg'],
        input: {
          title: 'Чёрная зимняя куртка с асимметричной застёжкой',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 135, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: S.\nДвухслойная куртка черного цвета, асимметричная застежка на пуговицы, высокий воротник в рубчик.',
        },
      },
      {
        photos: ['a2961-0.jpg', 'a2961-1.jpg'],
        input: {
          title: 'Чёрные вощёные джинсы прямого кроя',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 120, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Черный вощеный деним прямого кроя, плотная джинса, стальная фурнитура и отличный крой\nЗамеры: длина 103 см, полуобхват талии 40 см, выход 20 см.',
        },
      },
      {
        photos: ['a2965-0.jpg', 'a2965-1.jpg'],
        input: {
          title: 'Винтажная куртка в стиле милитари Only',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 130, condition: 'GOOD', defectsPresent: false, brand: 'Only', color: 'green', gender: 'FEMALE', material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: S.\nКуртка прекрасного кроя, стальная фурнитура YKK, ворот утеплен.',
        },
      },
      {
        photos: ['a2967-0.jpg', 'a2967-1.jpg', 'a2967-2.jpg', 'a2967-3.jpg', 'a2967-4.jpg', 'a2967-5.jpg', 'a2967-6.jpg'],
        input: {
          title: 'Чёрная куртка с асимметричной молнией',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'M', price: 135, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: M.\nАсимметричная стальная молния YKK, 2 вариации носки воротника, укороченный крой.',
        },
      },
      {
        photos: ['a2982-0.jpg', 'a2982-1.jpg'],
        input: {
          title: 'Джинсы-буткат Blue Queen',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W33', price: 120, condition: 'GOOD', defectsPresent: false, brand: 'Blue Queen', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K'],
          description: 'Темно синий цвет, выбеленный фейд, множество мелких, но детализированных деталей.\nЗамеры: длина 105 см, полуобхват талии 42 см, выход 23 см.',
        },
      },
      {
        photos: ['a2984-0.jpg', 'a2984-1.jpg'],
        input: {
          title: 'Винтажные рабочие брюки-карго Jack & Jones',
          category: 'trousers', subcategory: 'cargo', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 130, condition: 'GOOD', defectsPresent: false, brand: 'Jack & Jones', color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Редкие штаны в крутом исполнении, спереди двухслойные вместительные карманы.\nШирокий прямой крой\nЗамеры: полуобхват талии 46 см, длина 105 см, выход 27 см.',
        },
      },
      {
        photos: ['a2986-0.jpg', 'a2986-1.jpg', 'a2986-2.jpg', 'a2986-3.jpg', 'a2986-4.jpg', 'a2986-5.jpg', 'a2986-6.jpg'],
        input: {
          title: 'Прямые джинсы Mishumo',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W35', price: 155, condition: 'GOOD', defectsPresent: false, brand: 'Mishumo', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K'],
          description: 'Идеальный широкий прямой крой , множество мелких детализированных деталей, фейд по всей длине джинс, плотнейший деним и элементы заводского дистресса.\nЗамеры: полуобхват талии 44 см, длина 115 см, выход 25 см.',
        },
      },
      {
        photos: ['a2993-0.jpg', 'a2993-1.jpg'],
        input: {
          title: 'Свитер в полоску Abercrombie & Fitch',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'M', price: 115, condition: 'GOOD', defectsPresent: false, brand: 'Abercrombie & Fitch', color: 'blue', gender: null, material: 'Трикотаж', styleTags: ['Casual'],
          description: 'Размер: M.\nОчень приятный материал к телу, минималистичный вышитый логотип, текстура в рубчик.',
        },
      },
      {
        photos: ['a3002-0.jpg', 'a3002-1.jpg'],
        input: {
          title: 'Укороченный свитер с высоким горлом',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 100, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Трикотаж', styleTags: ['Minimal'],
          description: 'Размер: S–M.\nПлотная вязка, укороченный крой, удлиненный рукав.\nИдеальная посадка на теле',
        },
      },
      {
        cover: 'a3006-1.jpg',
        photos: ['a3006-0.jpg', 'a3006-1.jpg', 'a3006-2.jpg', 'a3006-3.jpg', 'a3006-4.jpg'],
        input: {
          title: 'Укороченная куртка из кожи и замши',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 190, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Замша', styleTags: ['Streetwear'],
          description: 'Размер: S–M.\nУкороченная куртка из натуральной замши и кожи, стальная фурнитура, идеальный крой.',
        },
      },
      {
        photos: ['a3013-0.jpg', 'a3013-1.jpg'],
        input: {
          title: 'Синее зип-худи Hollister',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Hollister', color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер: XL.\nОбъемное зип худи от Holister, большой логотип, красивый синий цвет.',
        },
      },
      {
        photos: ['a3015-0.jpg', 'a3015-1.jpg', 'a3015-2.jpg', 'a3015-3.jpg', 'a3015-4.jpg'],
        input: {
          title: 'Зимние казаки с мехом (новые)',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '38', sizes: ['38', '39', '40', '41', '42', '43', '44', '45'], price: 240, condition: 'NEW_WITH_TAGS', hasTags: false, defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Актуальный силуэт, комфортная посадка на теле, черный цвет, внутри мех овечки, не даст замерзнуть в холода.\nРазмеры: от 38 до 45, строго новое состояние.',
        },
      },
      {
        photos: ['a3027-0.jpg'],
        input: {
          title: 'Вощёная куртка M65',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 155, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер: L.\nЛегендарная куртка в уникальном исполнении, черный цвет, вощеный материал, несколько вместительных функциональных карманов.',
        },
      },
      {
        photos: ['a3029-0.jpg', 'a3029-1.jpg', 'a3029-2.jpg', 'a3029-3.jpg', 'a3029-4.jpg'],
        input: {
          title: 'Укороченная куртка в стиле Y2K',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 120, condition: 'GOOD', defectsPresent: false, brand: null, color: 'brown', gender: 'FEMALE', material: 'Хлопок', styleTags: ['Y2K'],
          description: 'Размер: S.\nУкороченная куртка из плотного хлопка, стальная фурнитура, безупречный крой.',
        },
      },
      {
        photos: ['a3034-0.jpg', 'a3034-1.jpg', 'a3034-2.jpg', 'a3034-3.jpg', 'a3034-4.jpg'],
        input: {
          title: 'Фиолетовая укороченная куртка с карманами на молниях',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 170, condition: 'GOOD', defectsPresent: false, brand: null, color: 'purple', gender: 'FEMALE', styleTags: ['Y2K'],
          description: 'Размер: S–M.\nУкороченная дубленка приятно темно фиолетового цвета, стальная фурнитура, множество функциональных карманов.',
        },
      },
      {
        photos: ['a3039-0.jpg', 'a3039-1.jpg', 'a3039-2.jpg', 'a3039-3.jpg', 'a3039-4.jpg'],
        input: {
          title: 'Лонгслив If Six Was Nine 00-х',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'OTHER', sizeValue: 'XS–S', price: 620, condition: 'GOOD', defectsPresent: false, brand: 'If Six Was Nine', color: 'black', gender: null, material: 'Трикотаж', styleTags: ['Vintage'],
          description: 'Размер: 0 (XS–S).\nCotton 70%/Angora 30%\nВыразительная архивная вещь с авангардной эстетикой, черный цвет с контрастными бежевыми рукавами, тонкий рубчатый трикотаж, облегающая посадка и удлиненные рукава, необработанные края и асимметричный низ',
        },
      },
      {
        photos: ['a3044-0.jpg', 'a3044-1.jpg'],
        input: {
          title: 'Шерстяной свитер-хенли Khujo',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 85, condition: 'GOOD', defectsPresent: false, brand: 'Khujo', color: 'brown', gender: null, material: 'Шерсть', styleTags: ['Casual'],
          description: 'Размер: L–XL.\nШерстяной свитер от Khujo, красивый вымытый цвет, пуговицы на горле.',
        },
      },
      {
        photos: ['a3046-0.jpg', 'a3046-1.jpg', 'a3046-2.jpg', 'a3046-3.jpg', 'a3046-4.jpg'],
        input: {
          title: 'Асимметричное пальто AllSaints',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'M', price: 205, condition: 'GOOD', defectsPresent: false, brand: 'AllSaints', color: 'gray', gender: null, material: 'Вискоза', styleTags: ['Minimal'],
          description: 'Размер: M.\nВыполнено из приятных комбинированных материалов(шёлк или вискоза), свободный крой и асимметрия позволяет создавать уникальные многослойные образы, застегивается на пуговицы с гравировкой бренда.',
        },
      },
      {
        photos: ['a3051-0.jpg', 'a3051-1.jpg'],
        input: {
          title: 'Лонгслив L.G.B. 00-х с кашемиром',
          category: 'tshirts', subcategory: 'longsleeve', sizeSystem: 'ALPHA', sizeValue: 'M', price: 380, condition: 'GOOD', defectsPresent: false, brand: 'L.G.B.', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: 2 (M).\n90% Cotton/10% Cashmere\nМинималистичная чёрная модель с удлинённым силуэтом, глубоким V-образным вырезом и необработанным нижним краем. Характерная эстетика японского дизайна: асимметрия, вытянутые пропорции и деконструированные детали.',
        },
      },
      {
        photos: ['a3053-0.jpg', 'a3053-1.jpg', 'a3053-2.jpg', 'a3053-3.jpg', 'a3053-4.jpg'],
        input: {
          title: 'Винтажный гусарский жакет',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 135, condition: 'GOOD', defectsPresent: false, brand: null, color: 'gray', gender: 'FEMALE', material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: S.\nГусарский жакет из плотного хлопка, стальная молния и пуговицы, съемный пояс для регулировки талии, великолепный крой.',
        },
      },
      {
        photos: ['a3058-0.jpg', 'a3058-1.jpg'],
        input: {
          title: 'Шерстяной гусарский жакет EDC «Dragon Sea»',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 165, condition: 'GOOD', defectsPresent: false, brand: 'EDC', color: 'blue', gender: 'FEMALE', material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер: S.\nВинтажный шерстяной гусар, темно синий цвет, ряд стальных пуговиц, функциональные карманы, сзади изображение.',
        },
      },
      {
        photos: ['a3060-0.jpg', 'a3060-1.jpg'],
        input: {
          title: 'Шерстяная юбка-шорты Rick Owens Lilies 00-х',
          category: 'skirts', subcategory: 'mini', sizeSystem: 'ALPHA', sizeValue: 'S', price: 330, condition: 'GOOD', defectsPresent: false, brand: 'Rick Owens', color: 'black', gender: 'FEMALE', material: 'Шерсть', styleTags: ['Vintage'],
          description: 'Размер: S.\n00s\nМодель с короткой длиной и разделением по центру, формирующим конструкцию шорт. Эластичный пояс обеспечивает комфортную посадку, а мягкий, фактурный материал приятен на ощупь и напоминает шерстяной трикотаж.',
        },
      },
      {
        photos: ['a3062-0.jpg', 'a3062-1.jpg', 'a3062-2.jpg', 'a3062-3.jpg', 'a3062-4.jpg', 'a3062-5.jpg', 'a3062-6.jpg'],
        input: {
          title: 'Куртка Dolce & Gabbana FW03 с мехом на капюшоне',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'ALPHA', sizeValue: 'L', price: 1690, condition: 'GOOD', defectsPresent: false, brand: 'Dolce & Gabbana', color: 'black', gender: null, styleTags: ['Y2K', 'Vintage'],
          description: 'Размер: L.\nРедкая архивная куртка D&G из коллекции Fall/Winter 2003. Утилитарный military-дизайн с выраженной эстетикой ранних 2000-х.\nЧёрный верх с контрастной ярко-жёлтой подкладкой\nОбъёмный капюшон с натуральным мехом\nМножество металлических молний по корпусу и рукавам\nСъёмные рукава — возможность трансформации в жилет\nМногофункциональные накладные карманы с клапанами\nЗастёжка на молнию и кнопки.\nНастоящая реликвия, возможно единственная в снг.',
        },
      },
      {
        photos: ['a3069-0.jpg', 'a3069-1.jpg'],
        input: {
          title: 'Тяжёлое худи на меху',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 135, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер: XL.\nВинтажное худи, тяжелое ~ как куртка, утеплена мехом внутри.\nСтальная фурнитура, объемный крой, можно использовать и как куртку.',
        },
      },
      {
        photos: ['a3071-0.jpg', 'a3071-1.jpg'],
        input: {
          title: 'Свитшот Lagerfeld с абстрактным принтом',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'ALPHA', sizeValue: 'L', price: 115, condition: 'GOOD', defectsPresent: false, brand: 'Karl Lagerfeld', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер: L.\nСерый свитшот с абстрактным принтом.',
        },
      },
      {
        photos: ['a3073-0.jpg'],
        input: {
          title: 'Розовый свитер в рубчик Izod',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 85, condition: 'GOOD', defectsPresent: false, brand: 'Izod', color: 'pink', gender: null, material: 'Трикотаж', styleTags: ['Vintage'],
          description: 'Размер: S–M.\nИдеальный свитер в рубчик, спокойной розовый цвет, карман на рукаве.',
        },
      },
      {
        photos: ['a3074-0.jpg', 'a3074-1.jpg'],
        input: {
          title: 'Зип-худи Aéropostale «New York»',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 115, condition: 'GOOD', defectsPresent: false, brand: 'Aéropostale', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Y2K'],
          description: 'Размер: M.\nВинтажный зип худи, стальная фурнитура, вышивка на груди и принт на рукаве, отличный крой.',
        },
      },
      {
        photos: ['a3076-0.jpg', 'a3076-1.jpg'],
        input: {
          title: 'Винтажный свитшот Adidas',
          category: 'knitwear', subcategory: 'sweatshirt', sizeSystem: 'ALPHA', sizeValue: 'M', price: 100, condition: 'GOOD', defectsPresent: false, brand: 'Adidas', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: M.\nУкороченная посадка на теле, широкий рукав, узкая горловина.',
        },
      },
      {
        photos: ['a3078-0.jpg', 'a3078-1.jpg'],
        input: {
          title: 'Поло Superdry',
          category: 'tshirts', subcategory: 'polo', sizeSystem: 'ALPHA', sizeValue: 'L', price: 65, condition: 'GOOD', defectsPresent: false, brand: 'Superdry', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Y2K'],
          description: 'Размер: L.\nПоло из плотного хлопка, объемный вышитый логотип.',
        },
      },
      {
        photos: ['a3080-0.jpg', 'a3080-1.jpg'],
        input: {
          title: 'Укороченный пуховик Vero Moda',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 135, condition: 'GOOD', defectsPresent: false, brand: 'Vero Moda', color: 'blue', gender: 'FEMALE', styleTags: ['Casual'],
          description: 'Размер: S–M.\nУкороченная куртка, синий цвет, утяжки на капюшоне, карманы на замках.',
        },
      },
      {
        photos: ['a3082-0.jpg', 'a3082-1.jpg'],
        input: {
          title: 'Худи с лесным камуфляжем',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'S', price: 100, condition: 'GOOD', defectsPresent: false, brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер: S.\nЛучший камуфляж, укороченный крой, плотный хлопок.',
        },
      },
      {
        photos: ['a3084-0.jpg', 'a3084-1.jpg'],
        input: {
          title: 'Винтажные прямые джинсы с фейдами',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 100, condition: 'GOOD', defectsPresent: false, brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Темный деним, множество фейдов, прямой крой.\nЗамеры: длина 109 см, полуобхват талии 46 см, выход 21 см.',
        },
      },
      {
        photos: ['a3093-0.jpg', 'a3093-1.jpg'],
        input: {
          title: 'Зимний бомбер с мехом овчины (новый)',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'S', sizes: ['S', 'M', 'L', 'XL', 'XXL'], price: 375, condition: 'NEW_WITH_TAGS', hasTags: false, defectsPresent: false, brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер: подберут любой.\nСъемный капюшон\nВЫДЕРЖИВАЕТ ДО - 30\nМассивный зимний бомбер в глубоком чёрном цвете с выразительным объёмным силуэтом. Модель сочетает эстетику классических military-бомберов с акцентными деталями и высокой теплоизоляцией.\nОбъёмный капюшон с густой меховой отделкой.\nВнутренняя отделка из овчины, обеспечивающая дополнительное утепление.\nПлотный верхний материал с характерной лёгкой фактурой и защитой от холодного ветра.\nЦентральная застёжка на молнию.\nВместительные передние карманы с удобной конструкцией клапанов.\nЭластичные трикотажные манжеты и пояс для сохранения тепла.\nСвободный объёмный крой с акцентом на широкие рукава.',
        },
      },
      {
        photos: ['a3095-0.jpg', 'a3095-1.jpg', 'a3095-2.jpg', 'a3095-3.jpg', 'a3095-4.jpg', 'a3095-5.jpg', 'a3095-6.jpg'],
        input: {
          title: 'Худи Rammstein «Mein Herz Brennt» (официальный мерч)',
          category: 'knitwear', subcategory: 'hoodie', sizeSystem: 'ALPHA', sizeValue: 'M', price: 120, condition: 'GOOD', defectsPresent: false, brand: 'Rammstein', color: 'black', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер: M.\nRammstein «Mein Herz Brennt» Official Graphic Hoodie\nПлотный хлопок в черном цвете. Официальный мерч группы с фирменной биркой Rammsteinshop. Насыщенный принт спереди, масштабный арт на спине с надписью «Mein Herz Brennt» и детализированная графика на рукаве.',
        },
      },
      {
        photos: ['a3102-0.jpg', 'a3102-1.jpg', 'a3102-2.jpg', 'a3102-3.jpg', 'a3102-4.jpg'],
        input: {
          title: 'Облегающий свитер в полоску',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'M', price: 95, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: 'FEMALE', material: 'Трикотаж', styleTags: ['Y2K'],
          description: 'Размер: M.\nУдлиненный облегающий свитер в полоску, асимметричный замок, хорошо тянется.',
        },
      },
      {
        photos: ['a3107-0.jpg', 'a3107-1.jpg', 'a3107-2.jpg', 'a3107-3.jpg', 'a3107-4.jpg'],
        input: {
          title: 'Укороченный коричневый свитер AllSaints',
          category: 'knitwear', subcategory: 'turtleneck', sizeSystem: 'ALPHA', sizeValue: 'S', price: 95, condition: 'GOOD', defectsPresent: false, brand: 'AllSaints', color: 'brown', gender: 'FEMALE', material: 'Трикотаж', styleTags: ['Minimal'],
          description: 'Размер: S.\nУкороченный свитер коричневого цвета, высокое складное горло, удлиненный рукав.',
        },
      },
      {
        photos: ['a3112-0.jpg', 'a3112-1.jpg', 'a3112-2.jpg', 'a3112-3.jpg', 'a3112-4.jpg'],
        input: {
          title: 'Укороченный свитер с асимметричной молнией (Италия)',
          category: 'knitwear', subcategory: 'cardigan', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 115, condition: 'GOOD', defectsPresent: false, brand: null, color: 'black', gender: null, material: 'Трикотаж', styleTags: ['Minimal'],
          description: 'Размер: S–M.\nMade In Italy\nУкороченный свитер с асимметричной молнией, черный цвет, идеальная текстура в рубчик, стальная фурнитура.',
        },
      },
      {
        photos: ['a3117-0.jpg', 'a3117-1.jpg'],
        input: {
          title: 'Широкие брюки Mos Mosh',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'JEANS_W', sizeValue: 'W33', price: 115, condition: 'GOOD', defectsPresent: false, brand: 'Mos Mosh', color: 'green', gender: 'FEMALE', styleTags: ['Casual'],
          description: 'Штаны из плотного материала, широкий крой, приятный цвет, идеальная база на каждый день.\nЗамеры: полуобхват талии 42 см, длина 107 см, выход 30 см.',
        },
      },
      {
        photos: ['a3119-0.jpg', 'a3119-1.jpg', 'a3119-2.jpg', 'a3119-3.jpg', 'a3119-4.jpg'],
        input: {
          title: 'Винтажная охотничья куртка Mantaray',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 155, condition: 'GOOD', defectsPresent: false, brand: 'Mantaray', color: 'green', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер: L–XL.\nОбъемный крой, стальная фурнитура, множество вместительных функциональных карманов на замках и кнопках, регулировка ширины горла с помощью ремешка.',
        },
      },
      {
        photos: ['a3124-0.jpg', 'a3124-1.jpg', 'a3124-2.jpg', 'a3124-3.jpg', 'a3124-4.jpg'],
        input: {
          title: 'Ботинки FLY London из кожи и замши',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'SHOE_EU', sizeValue: '41', price: 190, condition: 'GOOD', defectsPresent: false, brand: 'FLY London', color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер: 41 (стелька 26 см).\nМодель выполнена из комбинации натуральной кожи и замши: гладкая кожа на передней части и боковых панелях, фактурная замша в области голенища и пятки.\nБоковая металлическая пряжка с фирменной гравировкой FLY London.\nБоковая молния YKK для удобства надевания.\nОкруглый мыс с выразительным силуэтом.\nУстойчивый невысокий каблук с массивной формой.\nКонтрастное сочетание гладкой кожи и замши.\nУникальная патина и складки.',
        },
      },
    ],
  },
];
