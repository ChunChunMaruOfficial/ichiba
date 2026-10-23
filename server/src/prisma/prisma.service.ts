import { Global, Injectable, Module, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    // `prisma dev` (local Postgres without Docker) serves one connection at a time: DATABASE_POOL_MAX=1 there.
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        max: Number(process.env.DATABASE_POOL_MAX ?? 10),
        // A request waiting for a free connection gives up after 5 s instead of forever; a statement may run 20 s;
        // a transaction left idle (a crashed caller) is cut after 30 s so it doesn't hold its locks.
        connectionTimeoutMillis: 5_000,
        options: '-c statement_timeout=20000 -c idle_in_transaction_session_timeout=30000',
      }),
    });
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}

@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}
