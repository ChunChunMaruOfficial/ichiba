import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { MediaService } from '../media/media.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { ListingInputT } from './listings.dto.js';
import { ListingsService } from './listings.service.js';

/**
 * Items the owner hands over to list for a seller (photos in seed-data/<folder>, rotated and sized by hand): listed
 * once after a deploy, never twice — an item whose title the seller has ever had (even deleted) is skipped.
 */
interface HandItem {
  photos: string[];
  input: Omit<ListingInputT, 'photos'>;
}

const BATCHES: Array<{ username: string; folder: string; items: HandItem[] }> = [
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
];

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
      const seller = await this.prisma.user.findUnique({ where: { username: batch.username }, select: { id: true } });
      if (!seller) {
        this.logger.warn(`@${batch.username}: no such account`);
        continue;
      }
      for (const item of batch.items) {
        const title = item.input.title!;
        if (await this.prisma.listing.findFirst({ where: { sellerId: seller.id, title }, select: { id: true } })) continue;
        try {
          const photos: { id: string; isDefect: boolean }[] = [];
          for (const name of item.photos) {
            const buffer = await readFile(resolve(process.cwd(), 'seed-data', batch.folder, name));
            photos.push({ id: (await this.media.upload(seller.id, fileOf(buffer, name))).id, isDefect: false });
          }
          const draft = await this.listings.create(seller.id, { ...item.input, photos, deliveryOptions: ['IN_PERSON', 'DELIVERY'], acceptsOffers: true, saleType: 'FIXED' });
          try {
            await this.listings.publish(seller.id, draft.id, { trustedPhotos: true });
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
