import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PRIVACY_VERSION } from '../auth/auth.service.js';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListingInputT } from './listings.dto.js';
import { ListingsService } from './listings.service.js';

/**
 * Items the owner hands over to list for a seller (photos in seed-data/<folder>, rotated and sized by hand): listed
 * once after a deploy, never twice — an item whose title the seller has ever had (even deleted) is skipped.
 * A batch with `account` makes the seller's account first if there is none. It has no address: the seller signs in
 * with nick and password, the password's bcrypt hash coming from HAND_PASSWORD_HASHES='{"nick":"$2b$10$…"}' (kept out
 * of the public repository, like TG_PASSWORD_HASHES) and set only while the account has none.
 */
interface HandItem {
  photos: string[];
  input: Omit<ListingInputT, 'photos'>;
}

const BATCHES: Array<{ username: string; folder: string; account?: { bio: string }; items: HandItem[] }> = [
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
];

function passwordHash(nick: string): string | null {
  try {
    const hash = (JSON.parse(process.env.HAND_PASSWORD_HASHES ?? '{}') as Record<string, unknown>)[nick];
    return typeof hash === 'string' && hash.startsWith('$2') ? hash : null;
  } catch {
    return null;
  }
}

const fileOf = (buffer: Buffer, name: string) => ({ buffer, mimetype: 'image/jpeg', originalname: name, size: buffer.length }) as Express.Multer.File;

@Injectable()
export class HandListingsService implements OnApplicationBootstrap {
  private readonly logger = new Logger('HandListings');

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: ListingsService,
    private readonly media: MediaService,
  ) {}

  onApplicationBootstrap() {
    if (process.env.NODE_ENV !== 'production') return;
    setTimeout(() => void this.run().catch((e: Error) => this.logger.warn(`hand listings: ${e.message}`)), 20_000).unref();
  }

  async run() {
    for (const batch of BATCHES) {
      const seller =
        (await this.prisma.user.findUnique({ where: { username: batch.username }, select: { id: true, passwordHash: true } })) ??
        (batch.account
          ? await this.prisma.user.create({
              data: {
                username: batch.username,
                bio: batch.account.bio,
                city: 'Минск',
                privacyAcceptedAt: new Date(),
                privacyVersion: PRIVACY_VERSION,
                onboardedAt: new Date(),
              },
              select: { id: true, passwordHash: true },
            })
          : null);
      if (!seller) {
        this.logger.warn(`@${batch.username}: no such account`);
        continue;
      }
      const hash = batch.account && !seller.passwordHash ? passwordHash(batch.username) : null;
      if (hash) {
        await this.prisma.user.update({ where: { id: seller.id }, data: { passwordHash: hash } });
        this.logger.log(`@${batch.username}: password set`);
      }
      for (const item of batch.items) {
        const title = item.input.title!;
        // A draft that failed to publish (deleted right away, never shown) doesn't count: the item is tried again.
        const listed = { sellerId: seller.id, title, NOT: { status: 'DELETED' as const, publishedAt: null } };
        if (await this.prisma.listing.findFirst({ where: listed, select: { id: true } })) continue;
        try {
          const photos: { id: string; isDefect: boolean }[] = [];
          for (const name of item.photos) {
            const buffer = await readFile(resolve(process.cwd(), 'seed-data', batch.folder, name));
            photos.push({ id: (await this.media.upload(seller.id, fileOf(buffer, name))).id, isDefect: false });
          }
          const draft = await this.listings.create(seller.id, { ...item.input, photos, deliveryOptions: ['IN_PERSON', 'DELIVERY'], acceptsOffers: true, saleType: 'FIXED' });
          try {
            await this.listings.publish(seller.id, draft.id, { trustedPhotos: true, allowUnchecked: true });
          } catch (e) {
            await this.listings.remove(seller.id, draft.id).catch(() => undefined);
            throw e;
          }
          this.logger.log(`@${batch.username}: listed «${title}»`);
        } catch (e) {
          this.logger.warn(`@${batch.username}: «${title}» failed: ${(e as Error).message}`);
        }
      }
    }
  }
}
