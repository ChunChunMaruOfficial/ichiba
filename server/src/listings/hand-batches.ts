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
  input: Omit<ListingInputT, 'photos'>;
}

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
    // 28–29); photos and wording from the posts, condition as the owner states it.
    username: 'sss1lv3r',
    folder: 'sss1lv3r',
    // 2026-11-05 evening: the owner wants these three on the home page with the brands, so each is a brand with all of
    // its items in the catalogue (`catalog`), worn as they are.
    account: { bio: 'sss1lv3r — продажа личного гардероба: винтаж, кожа, деним, архивные вещи. Возврата нет.', brandName: 'sss1lv3r', logo: 'logo.jpg', catalog: true },
    items: [
      {
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
        input: {
          title: 'Кожаные ботильоны A.S.98 на каблуке',
          category: 'shoes', subcategory: 'ankle-boots', sizeSystem: 'SHOE_EU', sizeValue: '38', price: 310,
          condition: 'GOOD', defectsPresent: false,
          brand: 'A.S.98', color: 'brown', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 38.\nШикарный силуэт, твоей любимой конторы. Натуральная кожа высшего качества, наилучший цвет какое/шоколад. Огромные, выразительные зипы сзади / брендированные, Италия. Деревянный каблук, в меру высокий. Внутри отделка вся под кожу, максимально все круто и удобно.',
        },
      },
      {
        photos: ['3111-0.jpg', '3111-1.jpg', '3111-2.jpg', '3111-3.jpg', '3111-4.jpg', '3111-5.jpg', '3111-6.jpg'],
        input: {
          title: 'Кожаные ботинки Bugatti с пряжкой',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '42', price: 225,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Bugatti', color: 'gray', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: 42 (стелька 27 см).\nМашина среди обуви.\nКомбинированная натуральная кожа, тактильно приятная. Толстая качественная молния YKК для удобного надевания. Искусственные складки на части носка. Множество элементов с которых не отвести взгляж.',
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
        photos: ['3436-0.jpg', '3436-1.jpg', '3436-2.jpg', '3436-3.jpg', '3436-4.jpg', '3436-5.jpg', '3436-6.jpg'],
        input: {
          title: 'Винтажная кожаная куртка с эффектом патины',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 415,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Незначительные нюансы для такой вещи — уточняйте у продавца.',
          brand: null, color: 'brown', gender: null, material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nНастоящий винтаж в мире кожаных курток. Имент уникальные царапины и потертости, что делает ее аутентичной и не похожей на другие. Потрясающий цвет который выделит вас из толпы. Незначительные нюансы для такой вещи, уточняйте.\nЗамеры: длина 71 см, плечи 57 см, ширина 64 см, рукав 81 см.',
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
        input: {
          title: 'Джинсы straight из плотного вощёного денима',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 250,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x34.\nОтдаю свои джинсы в добрые руки.\nШикарный низ, джинса высочайшей плотности —легкого вощения. Качественная фурнитура, латунь. Один из шикарных фитов straight/slim. Потрясающий цвет — темный асфальт с умеренным выцветанием. Лаконичный дистресс по всему периметру.\nМожно многое про них сказать, все сами видите: женский глаз не обойдет стороной.\nЗамеры: длина 109 см, полупояс 41.5 см, выход 23 см.',
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
        input: {
          title: 'Льняные брюки Armani Jeans',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'IT 42', price: 170,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Jeans', color: 'black', gender: null, material: 'Лён', styleTags: ['Classic', 'Minimal'],
          description: 'Размер по бирке: 42.\nШикарный низ из 100% льна.\nТа самая, шикарная фактура. Мягкие и тактильно приятные. Черный матовый цвет. Шикарный фит, бест оф зе бест на это лето.\nЗамеры: длина 101 см, полупояс 38–39 см, выход 28 см.',
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
        input: {
          title: 'Джинсы selvedge тёмный индиго',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W34', price: 205,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: 34x34.\nДеним тяжелый, фактурный и хорошо держит форму — поэтому джинсы особенно красиво собираются по ноге и дают правильный объемный силуэт.\nДеним будет меняться со временем. Жесткая ткань постепенно подстраивается под владельца, появляются индивидуальные заломы, естественные высветления и характерный fade в местах носки. Чем дольше носишь, тем более персонально и красиво они стареют.\nКонтрастная строчка, аккуратный selvedge, плотная конструкция и качественная латунная фурнитура YIKK. Очень добротно собранная пара, которая ощущается именно как вещь, рассчитанная на долгую носку.\nЗамеры: длина 104 см/110 см, полупояс 43 см, выход 27 см.',
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
        input: {
          title: 'Футболка Marilyn Manson «Tour 2007»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-1.jpg'],
        input: {
          title: 'Футболка Metallica',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-2.jpg'],
        input: {
          title: 'Футболка Slipknot «The Gray Chapter»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-3.jpg'],
        input: {
          title: 'Футболка Misfits',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-4.jpg'],
        input: {
          title: 'Футболка Nirvana «Kurt Cobain 1967–1994»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-5.jpg'],
        input: {
          title: 'Футболка Marilyn Manson «Holy Wood»',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
        },
      },
      {
        photos: ['4333-6.jpg'],
        input: {
          title: 'Футболка Marilyn Manson с синим принтом',
          category: 'tshirts', subcategory: 'tshirt', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 90,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: M–L.\nСемь мощнейших черных футболок с архивной band / tour эстетикой.\nУ каждой свой front/back принт, потертая графика и тот самый визуал старого концертного мерча из 00-х.\nПлотный черный хлопок, свободная посадка, широкие рукава и естественный washed-эффект — цвет не выглядит новым и плоским, местами уходит в выцветший графит и красиво меняется в зависимости от света.',
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
        input: {
          title: 'Винтажная укороченная шуба с леопардовым принтом',
          category: 'outerwear', subcategory: 'fur', sizeSystem: 'ALPHA', sizeValue: 'M', price: 305,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'brown', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Размер по бирке: M.\nУкороченная, тёплая шуба. Ярко выраженный леопард добавляет шубе характер, коричневый хаки оттенок. Идеальная посадка с удлиненными рукавами и укороченным корпусом.\nШирокий воротник стойка, кант из меха, в том числе на рукавах . Скрытые крючки вплоть до горла, за счет натуральных материалов шикарно держит тепло. Настоящий винтаж, на любое мероприятия.\nЗамеры: длина 57 см, ширина 47 см, рукав 74 см.',
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
        input: {
          title: 'Спортивные штаны adidas винтажные синие',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'ALPHA', sizeValue: 'M', price: 110,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'blue', gender: null, material: 'Полиэстер', styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M.\nКлассические спортивные штаны adidas в приглушенно синем оттенке с фирменной эстетикой моделей. Свободный спортивный силуэт с прямой посадкой, лёгкая ткань и культовые лампасы по бокам создают узнаваемый ретро-вайб. Лаконичный логотип adidas на бедре.\nЗамеры: длина 104 см, полупояс в спокойном 40+(Резинка+шнурок), выход 22 см.',
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
        input: {
          title: 'Винтажное бордовое зип-худи Mickey Mouse',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nВинтажный бордовый zip-up hoodie с плотным хлопковым полотном и мягким выцветшим оттенком, который со временем приобретает более глубокую фактуру. Модель выполнена в расслабленном силуэте с объемным капюшоном в винтажном в духе америки.\nКрупная, фактурная аппликация Mickey Mouse на спине,с состаренным эффектом. Натуральные потертости ткани и легкая неравномерность цвета создают ощущение вещи с историей.\nЗамеры: длина 71 см, ширина 57 см, рукав 82 см.',
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
        input: {
          title: 'Высокие милитари-ботинки с пряжками',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '40', price: 295,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Кожа', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: 40 (стелька 26 см).\nВысокие ботинки в выцветшем olive/khaki оттенке с грубым military-grunge характером. Фактурная комбинированная кожа, массивная простроченная подошва, шнуровка и два ремня с металлическими пряжками.\nСильная естественная состаренность, потёртая подошва и неоднородный цвет только усиливают винтажный вид пары. Сбоку есть молния, поэтому при всей тяжёлой конструкции ботинки нормально надеваются, а не требуют отдельного инженерного образования. Нереально шикарный вариант на куда угодно, завидую будущему обладателю.',
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
        input: {
          title: 'Куртка American Eagle из washed-канваса',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 215,
          condition: 'GOOD', defectsPresent: false,
          brand: 'American Eagle', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Vintage'],
          description: 'Размер по бирке: L.\nКуртка American Eagle в глубоком графитово-сером оттенке с выраженной washed обработкой и естественно вытертыми краями по швам. Плотный хлопковый canvas со временем получил мягкую неоднородную фактуру, за счёт чего вещь выглядит особенно винтажно. Силуэт объёмный и укороченный, с широкими рукавами и собранным низом —классический active fit.\nОбъёмный капюшон с регулировкой на шнурках, два крупных накладных кармана спереди и широкие ribbed манжеты. Центральная металлическая молния YKK с фирменным пуллером AE. Aкцент остаётся на форме и washed фактуре ткани. Верх — 100% cotton, хлопковая подкладка корпуса и polyester в рукавах.\nЗамеры: длина 68 см, ширина 61 см, рукав 81 см.',
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
        input: {
          title: 'Чёрные парашютные брюки balloon',
          category: 'trousers', subcategory: 'trousers', sizeSystem: 'OTHER', sizeValue: 'Универсальный', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Нейлон', styleTags: ['Streetwear'],
          description: 'Размер по бирке: универсальный.\nЧёрные парашютные брюки из лёгкой шуршащей нейлоновой ткани. Материал даёт характерную мятую фактуру и объём, за счёт чего особенно хорошо раскрывается balloon fit.\nОчень широкий крой с массивным объёмом по всей длине и регулируемой посадкой. Эластичный пояс со шнурком, утяжки по низу штанин позволяют менять форму от свободной широкой до собранной. По бокам функциональные карманы, сзади карманы с клапаном. На теле дают выраженный oversized/parachute fit.\nЗамеры: длина 109 см, полупояс Резинка+Шнурок, выход 36 см / Утягивается.',
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
        input: {
          title: 'Зимний бомбер Zavetti Canada Alaska',
          category: 'outerwear', subcategory: 'puffer', sizeSystem: 'ALPHA', sizeValue: 'M', price: 240,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Нужно зашить основание капюшона по шву и подкладку в кармане (пара сантиметров).',
          brand: 'Zavetti Canada', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: M.\nЧерный пуховой бомбер с объёмным капюшоном и пышной меховой опушкой.\nБомбер в классическом, верх из плотного водоотталкивающего материала защищает от ветра и непогоды, внутренняя утеплённая подкладка сохраняет тепло, а объёмный капюшон с мягкой меховой опушкой создает дополнительную защиту и выразительный акцент, можно отстегнуть. Практичная конструкция. Трикотажные скрытые манжеты на рукавах — для комфортной посадки и защиты от холода. Универсальная модель которая подойдет абсолютно под все. Нужно зашить по шву основание у капюшона. Аналогично зашить подкладку в кармане,пару см.\nЗамеры: длина 62 см, ширина 54 см, рукав 76 см.',
        },
      },
      {
        photos: ['4759-0.jpg', '4759-1.jpg', '4759-2.jpg', '4759-3.jpg'],
        input: {
          title: 'Камуфляжное зип-худи Athletic с дистрессом',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 95,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: S–M.\nКамуфляжная зип-худи Athletic с необычной конструкцией капюшона Плотный хлопковый материал с мягкой петлёй изнутри, тёмный woodland camo.\nПо рукавам крупные принты и типографика, намеренно необработанные края и distressed-детали с прорезями на манжетах под большой палец. Двойная фронтальная молния позволяет регулировать силуэт снизу. Вытянутый узкий крой с длинными рукавами.\nЗамеры: длина 58 см, ширина 51 см, рукав 72 см.',
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
        input: {
          title: 'Спортивные штаны adidas винтажные чёрные',
          category: 'trousers', subcategory: 'sweatpants', sizeSystem: 'ALPHA', sizeValue: 'M', price: 100,
          condition: 'GOOD', defectsPresent: false,
          brand: 'adidas', color: 'black', gender: null, material: 'Полиэстер', styleTags: ['Sport', 'Vintage'],
          description: 'Размер по бирке: M.\nКлассические спортивные штаны adidas в приглушенно черном оттенке с фирменной эстетикой моделей. Свободный спортивный силуэт с прямой посадкой, лёгкая ткань и культовые лампасы по бокам создают узнаваемый ретро-вайб. Лаконичный логотип adidas на бедре.\nЗамеры: длина 104 см, полупояс (Резинка+шнурок), выход 23.5 см.',
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
        input: {
          title: 'Серое зип-худи Polo Ralph Lauren',
          category: 'knitwear', subcategory: 'zip-hoodie', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 165,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Polo Ralph Lauren', color: 'gray', gender: null, material: 'Хлопок', styleTags: ['Casual'],
          description: 'Размер по бирке: XL.\nСерый зипPolo Ralph Lauren в классическом меланжевом цвете с контрастной молочной подкладкой. Плотный хлопковый футер с мягким флисовым начёсом, свободный regular fit и объёмный капюшон с фактурной вафельной подкладкой.\nФирменная зелёная вышивка Pony на груди, металлическая молния YKK с брендированным пуллером POLO, широкие молочные шнурки и вместительные карманы. Плотные рибовые манжеты и пояс, аккуратная строчка и характерный силуэт классических худи Ralph Lauren.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 72 см, ширина 63 см, рукав 83 см.',
        },
      },
      {
        photos: ['4827-0.jpg', '4827-1.jpg', '4827-2.jpg', '4827-3.jpg', '4827-4.jpg', '4827-5.jpg', '4827-6.jpg'],
        input: {
          title: 'Винтажная куртка Armani Jeans с мехом',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'IT 46', price: 345,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Armani Jeans', color: 'gray', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: 46.\nШикарная куртка Armani в графитовом оттенке с неоднородной фактурой под состаренную кожу. Асимметричный крой с фигурными швами, металлическими люверсами и тремя ремешками с серебристой фурнитурой. Высокий воротник— нереально теплый.\nВнутренняя отделка из мягкого искусственного меха с выразительной текстурой, меховые манжеты и отложной воротник. Характерная эстетика Armani в их так называемом прайме.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 59 см, плечи 46 см, ширина 52 см, рукав от плеча 67 см.',
        },
      },
      {
        photos: ['4834-0.jpg', '4834-1.jpg'],
        input: {
          title: 'Винтажный рабочий бомбер MA-1',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'XL', price: 190,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Лёгкие пятнышки от времени.',
          brand: null, color: 'black', gender: null, styleTags: ['Vintage'],
          description: 'Размер по бирке: XL.\nВинтажный рабочий бомбер в выцветшем чёрно-графитовом оттенке с лёгкими шрамами~пятнами времени. Силуэт объёмный и укороченный, с широкими рукавами и мягко собранным низом — классический пилот. Плотный ribbed воротник, манжеты и пояс хорошо держат форму, при этом сама куртка остаётся достаточно расслабленной по посадке.\nСпереди два прорезных кармана, на рукаве дополнительный utility pocket, центральная латунная молния YKK.\nЗамеры: длина 71 см, ширина 73 см, рукав 83 см.',
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
        input: {
          title: 'Укороченный бомбер Selected из искусственного меха',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'M', price: 170,
          condition: 'GOOD', defectsPresent: true, defectsDescription: 'Слегка сыпется внутренняя отделка молнии из кожзама.',
          brand: 'Selected', color: 'brown', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M.\nУкороченный меховой бомбер с объёмным силуэтом и выразительной фактурой длинноворсового искусственного меха. Неоднородный окрас с переходами от тёмно-коричневого и графитового до светлых пепельно-бежевых оттенков создаёт эффект натурального меха.\nМассивный воротник-стойка, металлическая молния YKK, плотные трикотажные манжеты и широкий эластичный пояс шоколадного оттенка. Контраст между пушистым объёмным верхом и собранным низом формирует характерный силуэт мехового бомбера.\nСостояние хорошее, слегка сыпется внутренняя отделка молнии из кож зама.\nЗамеры: длина 54 см, ширина 52 см, рукав от горла 72 см.',
        },
      },
      {
        photos: ['4959-0.jpg', '4959-1.jpg', '4959-2.jpg', '4959-3.jpg', '4959-4.jpg', '4959-5.jpg', '4959-6.jpg'],
        input: {
          title: 'Джинсы Yes Jeans с графикой и дистрессом',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W28', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Yes Jeans', color: 'blue', gender: null, material: 'Деним', styleTags: ['Y2K', 'Vintage'],
          description: 'Размер по бирке: 28.\nДжинсы в прямом силуэте с широкими штанинами, легкое расширение к низу. Плотный синий деним с выраженным винтажным выцветанием, контрастными потёртостями и естественными заломами. Крупная красная графика YES JEANS, многослойный текстовый принт и декоративные нашивки с необработанными краями.\nРваные вставки с бахромой, искусственно состаренные участки, контрастная рыжая строчка и фигурная вышивка на задних карманах. Металлическая брендированная фурнитура, молния YKK, фирменный кожаный патч и клетчатая отделка внутренней части пояса.\nСостояние хорошее, без моментов.\nЗамеры: длина 102 см(Можно расшить до 106 см), полупояс 38 см, выход 22 см.',
        },
      },
      {
        photos: ['4966-0.jpg', '4966-1.jpg', '4966-2.jpg', '4966-3.jpg', '4966-4.jpg', '4966-5.jpg', '4966-6.jpg'],
        input: {
          title: 'Джинсы Next boot fit washed',
          category: 'jeans', subcategory: 'flare', sizeSystem: 'JEANS_W', sizeValue: 'W36', price: 135,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Next', color: 'blue', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 36x34.\nДжинсы Next в силуэте Bootxut с прямой посадкой в верхней части и лёгким расширением штанин к низу. Плотный деним приглушённого сине-графитового оттенка с неоднородной винтажной варкой, естественными высветлениями и выраженными следами заломов на бёдрах и под коленями.\nКлассическая конструкция с пятью карманами, застёжка на болтах с фирменной гравировкой. Контрастная строчка, фигурные задние карманы с декоративной вышивкой и характерная фактура потёртого денима.\nСостояние хорошее, без моментов.\nЗамеры: длина 110 см, полупояс 45 см, выход 23 см.',
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
        input: {
          title: 'Джинсы Route One 1989 baggy',
          category: 'jeans', subcategory: 'baggy', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Route One', color: 'blue', gender: null, material: 'Деним', styleTags: ['Streetwear'],
          description: 'Размер по бирке: 32x32.\nШикарный baggy деним Route One из сврого денима с широким свободным силуэтом и прямыми штанинами. Глубокий washed indigo с холодным графитовым подтоном, деликатными вертикальными высветлениями, естественными заломами и мягкими переходами оттенков по всей длине. Характерная сухая фактура денима с выраженным диагональным плетением, легкое добавление эластана.\nКлассическая конструкция с пятью карманами, широкой посадкой и аккуратной контрастной строчкой табачного оттенка. Металлическая фурнитура с гравировкой 1989, молния YKK, фирменный кожаный патч Route One и контрастные красные детали.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 109 см, полупояс 40–42 см, выход 25 см.',
        },
      },
      {
        photos: ['5057-0.jpg', '5057-1.jpg', '5057-2.jpg', '5057-3.jpg', '5057-4.jpg', '5057-5.jpg', '5057-6.jpg'],
        input: {
          title: 'Джинсы Vehicle Denim loose fit washed black',
          category: 'jeans', subcategory: 'wide', sizeSystem: 'JEANS_W', sizeValue: 'W32', price: 155,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Vehicle', color: 'gray', gender: null, material: 'Деним', styleTags: ['Vintage'],
          description: 'Размер по бирке: 32x32.\nДеним из плотного фактурного денима с широким свободным силуэтом и расслабленной посадкой. Глубокий графитово-серый washed black с холодным подтоном, характерными вертикальными высветлениями, естественными заломами и мягкими переходами оттенков по всей длине. Выразительная винтажная фактура с эффектом состаренного денима.\nКлассическая конструкция с пятью карманами, массивными прямыми штанинами и контрастной строчкой приглушённого золотистого оттенка. Фирменная металлическая фурнитура Vehicle с гравировкой, молния YKK, декоративная прострочка задних карманов и необычный кожаный патч с графикой Vehicle Denim.\nСостояние хорошее, естественные следы носки.\nЗамеры: длина 108 см, полупояс 42 см, выход 23.5 см.',
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
        input: {
          title: 'Шорты с заниженной мотнёй в стиле BBS',
          category: 'shorts', subcategory: 'shorts', sizeSystem: 'ALPHA', sizeValue: 'L', priceNegotiable: true,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: 'MALE', material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nЛучшая форма шорт на данный момент, заказаны на пробу. Цена договорная.\nСостояние по оценке продавца: 9,5/10.',
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
        input: {
          title: 'Кеды Gucci GG Monogram чёрные',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'OTHER', sizeValue: '40–41', price: 300,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Gucci', color: 'black', gender: null, material: 'Кожа', styleTags: ['Classic'],
          description: 'Размер по бирке: 40–41 (стелька 25,4 см).\nКеды от легендарного бренда. Были куплены новыми в 2018 году. Отличное состояние как снаружи так и внутри. Монограмма гуччи по бокам. Идеальная пара на каждый день.\nСостояние по оценке продавца: 9,5/10.',
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
        input: {
          title: 'Тёмно-синее пальто Object с капюшоном',
          category: 'outerwear', subcategory: 'coat', sizeSystem: 'ALPHA', sizeValue: 'L', price: 125,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Object', color: 'blue', gender: null, styleTags: ['Minimal'],
          description: 'Размер по бирке: L.\nПальто от object красивого темно-синего цвета. Огромный капюшон с приятной посадкой. Высокий воротник goa-type. Удобная молния.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['841-0.jpg', '841-1.jpg', '841-2.jpg'],
        input: {
          title: 'Высокие кеды Diesel с дистрессом',
          category: 'shoes', subcategory: 'keds', sizeSystem: 'SHOE_EU', sizeValue: '44', price: 285,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Diesel', color: 'black', gender: 'MALE', styleTags: ['Vintage', 'Streetwear'],
          description: 'Размер по бирке: 44 (стелька 28,5 см), можно пробовать на больший размер.\nМодель живущая своей жизнью. С течением времени верхний слой ткани приобретает свой индивидуальный паттерн. Мега крутое качество сборки как подобает старому дизелю. Редкая пара.\nСостояние по оценке продавца: 9,5/10.',
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
        input: {
          title: 'Тёмно-синий бомбер с объёмными 3D-карманами',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'ALPHA', sizeValue: 'L', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'blue', gender: null, material: 'Хлопок', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nБомбер с шикарными 3д карманами по всему периметру. Сделан из качественного хлопка. Очень напоимнает парашут бомбер иссея мияке.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['863-0.jpg', '863-1.jpg', '863-2.jpg'],
        input: {
          title: 'Зимний бомбер с рефлективной нитью и капюшоном',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 170,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nБомбер c интересными вкроплениями рефлективных нитей что даст крутую фактуру ткани при свете. Огромный капюшон, тугие манжеты - одни плюсы против холодной погоды.\nСостояние по оценке продавца: 9,5/10.',
        },
      },
      {
        photos: ['885-0.jpg', '885-1.jpg'],
        input: {
          title: 'Милитари-бомбер Gate One с 3D-карманами',
          category: 'outerwear', subcategory: 'bomber', sizeSystem: 'OTHER', sizeValue: 'S–M', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Gate One', color: 'beige', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: S–M.\nКрутой теплый бомбер в милитари эстетике. Огромные карманы подчеркивают функцианальность и продуманность. На спине распологается огромная вышитая звезда. Вкус америки 90х.\n⭐️⭐️⭐️⭐️condition 9,5; size s-m.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        photos: ['890-0.jpg', '890-1.jpg'],
        input: {
          title: 'Рюкзак из латекса с фактурой кожи',
          category: 'bags', subcategory: 'backpack', price: 190,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'На первый взгляд кажется что рюкзак сделан из кожи. Только спустя два дня я понял что этот материал - ультра качественный экспериментальный латекс. Но от кожи тактильно и визуально он ничем не отличается. Это дает рюкзаку огромную долговечность и тактильно очень приятные ощущения. Состаренный металл. Вместительный аксессуар на каждый день.\n⭐️⭐️⭐️⭐️condition 9,5; size o/s.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        photos: ['894-0.jpg', '894-1.jpg', '894-2.jpg', '894-3.jpg', '894-4.jpg'],
        input: {
          title: 'Милитари-куртка с дистрессом и высоким воротом',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 150,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'green', gender: null, material: 'Хлопок', styleTags: ['Outdoor', 'Vintage'],
          description: 'Размер по бирке: L.\nКуртка с узнаваемым почерком военной тематики. Но создатели решили иначе. Дистресс, множество деталей выбивающих вещь из привычной формы. Высокое горло обвивающее шею.\n⭐️⭐️⭐️⭐️condition 9,5; size l.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        cover: '911-1.jpg',
        photos: ['911-0.jpg', '911-1.jpg', '911-2.jpg'],
        input: {
          title: 'Зимняя парка Khujo с вакс-эффектом',
          category: 'outerwear', subcategory: 'parka', sizeSystem: 'OTHER', sizeValue: 'L–XL', price: 220,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Khujo', color: 'black', gender: null, styleTags: ['Outdoor'],
          description: 'Размер по бирке: L–XL.\nТяжеленный зимний люкс от кхуджо. Вакс эффект. Разные оттенки черного. Множество деталей. Огроменные карманы. Большой капюшон и высокое горло. Нет лучше варианта для холодной зимы -30 градусов.\n⭐️⭐️⭐️⭐️condition 9,5; size l-xl.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        cover: '919-3.jpg',
        photos: ['919-0.jpg', '919-1.jpg', '919-2.jpg', '919-3.jpg', '919-4.jpg', '919-5.jpg'],
        input: {
          title: 'Куртка Naketano с мульти-зипами и капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 190,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: 'Naketano', color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nПрекрасная куртка с читаемым стилем накетано. Мульти зип где это только возможно. Большой капюшон с необычными деталями. Тугие манжеты. Отличный элемент аутфита.\n⭐️⭐️⭐️⭐️condition 9,5; size l.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        photos: ['926-0.jpg', '926-1.jpg'],
        input: {
          title: 'Кожаная сумка-мессенджер',
          category: 'bags', subcategory: 'crossbody', price: 165,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Minimal'],
          description: 'Ультра визуальный айтем. С первого взгляда минималистичная сумка - но текстура кожи создает все детали сама. Очень качественная и вместительная сумка.\n⭐️⭐️⭐️⭐️condition 9,5; size o/s.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        photos: ['928-0.jpg', '928-1.jpg', '928-2.jpg'],
        input: {
          title: 'Ботинки с принтом черепов',
          category: 'shoes', subcategory: 'boots', sizeSystem: 'SHOE_EU', sizeValue: '43', price: 140,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: 43 (стелька 27,5–28 см).\nБотинки с принтом злых скелетонов которые хотят уничтожить мир. Главное самому не быть злым.\n⭐️⭐️⭐️⭐️condition 9,5.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        cover: '931-1.jpg',
        photos: ['931-0.jpg', '931-1.jpg', '931-2.jpg'],
        input: {
          title: 'Свитер на молнии с необычным фейдом',
          category: 'knitwear', subcategory: 'sweater', sizeSystem: 'ALPHA', sizeValue: 'L', price: 100,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'gray', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nСвитер с максимально необычным фейдом. Очень крутой и актуальный крой. Качественные материалы.\n⭐️⭐️⭐️⭐️condition 9,5; size l.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        cover: '934-1.jpg',
        photos: ['934-0.jpg', '934-1.jpg', '934-2.jpg'],
        input: {
          title: 'Чёрная лёгкая куртка с четырьмя карманами и съёмным капюшоном',
          category: 'outerwear', subcategory: 'jacket', sizeSystem: 'OTHER', sizeValue: 'M–L', price: 140,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, styleTags: ['Streetwear'],
          description: 'Размер по бирке: M–L.\nОчень фактурный и детализированный айтем. Сьемный капюшон. Вещь можно классно носить как второй слой под куртку. Телесная и легкая ткань. Карманы украшены лентами и кнопками.\n⭐️⭐️⭐️⭐️condition 9,5; size m-l.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
      {
        cover: '939-2.jpg',
        photos: ['939-0.jpg', '939-1.jpg', '939-2.jpg'],
        input: {
          title: 'Кожаная куртка с паттерном рептилии и острым воротником',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'L', price: 180,
          condition: 'LIKE_NEW', defectsPresent: false,
          brand: null, color: 'black', gender: null, material: 'Кожа', styleTags: ['Streetwear'],
          description: 'Размер по бирке: L.\nНатуральная кожа прошитая паттерном рептилии показывает силу человека как живого существа. Крутая вещь с характером. Острый сексуальный воротник. Качественная фурнитура и теплая подкладка.\n⭐️⭐️⭐️⭐️condition 9,5; size l.\n⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️⭐️ info/buy.\n⭐️⭐️⭐️⭐️⭐️.\n⭐️⭐️⭐️⭐️⭐️ наличие.',
        },
      },
    ],
  },
  {
    // 2026-11-05, «Вторичка»: world.vtg (t.me/worldvtg), the second channel of the sss1lv3r owner. Only the posts still
    // open there and not already in the sss1lv3r stock channel, so nothing is listed twice; prices as for sss1lv3r.
    username: 'worldvtg',
    folder: 'worldvtg',
    account: { bio: 'world.vtg — винтаж и архив: деним, кожа, сумки. Возврата нет.', brandName: 'world.vtg', logo: 'logo.jpg', catalog: true },
    items: [
      {
        photos: ['789-0.jpg', '789-1.jpg'],
        input: {
          title: 'Пушистая укороченная кофта из перьев',
          category: 'knitwear', subcategory: 'cardigan', sizeSystem: 'ALPHA', sizeValue: 'S', price: 85,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'black', gender: 'FEMALE', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nКороткая пушистая и мягкая кофта. Плотный, но лёгкий ворс придаёт объём и шёлковистый блеск, а укороченный крой подчёркивает талию. Модель с открытым передом и облегающим рукавом. Сама кофта выполнена из кружевного материала. Универсальная носка.\nЗамеры: ширина 43 см, длина 42 см, рукав 64 см.',
        },
      },
      {
        photos: ['854-0.jpg', '854-1.jpg', '854-2.jpg', '854-3.jpg', '854-4.jpg'],
        input: {
          title: 'Бордовая кожаная куртка с меховой отделкой',
          category: 'outerwear', subcategory: 'leather-jacket', sizeSystem: 'ALPHA', sizeValue: 'S', price: 180,
          condition: 'GOOD', defectsPresent: false,
          brand: null, color: 'red', gender: 'FEMALE', material: 'Кожа', styleTags: ['Vintage'],
          description: 'Размер по бирке: S.\nПриталенная куртка насыщенного винно‑бордового цвета, выполненная из мягкой натуральной кожи. Имеется эффектная пушистая оторочка на воротнике и по краю рукавов. Мех плавно переходит от тёмно‑бордового к светло‑розовому. На куртке присутствует Итальянская фурнитура Lampo, с двойным бегунком. Идеальный вариант для холодной погоды, когда хочется выглядеть стильно и не терять комфорта.\nЗамеры: длина 56 см, ширина 45 см, рукав 70 см.',
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
        input: {
          title: 'Джинсы Oakley straight индиго',
          category: 'jeans', subcategory: 'straight', sizeSystem: 'JEANS_W', sizeValue: 'W38', price: 115,
          condition: 'GOOD', defectsPresent: false,
          brand: 'Oakley', color: 'blue', gender: null, material: 'Деним', styleTags: ['Casual'],
          description: 'Размер по бирке: 38x32.\n…Лучшие портки под ремень.\nДжинсы твоего любимого бренда из плотного денима тёмно‑индиго/синий оттенок. Модель прямого кроя, straight силуэта. Брендированная фурнитура, внутри пояса контрастная подкладка. На поясн дополнительный шнурок с фирменными наконечниками. Легкие естественные складки и выцветание по бедрам и коленям.',
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
];
