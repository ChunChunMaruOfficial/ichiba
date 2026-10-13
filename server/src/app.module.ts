import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { AiController } from './ai/ai.controller.js';
import { AiService } from './ai/ai.service.js';
import { ChatGuard } from './ai/chat-guard.js';
import { AiEnsemble } from './ai/ensemble/ensemble.js';
import { ListingModerator } from './ai/moderation.js';
import { NegotiationAdvisor } from './ai/negotiation.js';
import { PhotoChecker } from './ai/photo-check.js';
import { PriceAdvisor } from './ai/price.js';
import { SearchParser } from './ai/search-parse.js';
import { ReviewsController, ReviewsService } from './reviews/reviews.js';
import { StatsController, StatsService } from './stats/stats.js';
import { AuctionsController, AuctionsService } from './auctions/auctions.js';
import { AuthController } from './auth/auth.controller.js';
import { CartController } from './cart/cart.js';
import { ChatController, ChatService } from './chat/chat.js';
import { CollectionsController } from './collections/collections.js';
import { EventsModule } from './events/events.js';
import { inProcessSchedulerEnabled, LazyMaintenanceMiddleware, lazyMaintenanceEnabled, MaintenanceController, MaintenanceService } from './maintenance/maintenance.js';
import { RedisModule, RedisService, RedisThrottlerStorage } from './redis/redis.js';
import { MailModule } from './mail/mail.module.js';
import { FollowingController } from './follows/following.js';
import { AdminDataController } from './moderation/admin-data.js';
import { RatesController, RatesService } from './rates/rates.js';
import { LooksController, LooksService } from './looks/looks.js';
import { AdminController, AdminGuard, ReportsController } from './moderation/moderation.js';
import { OffersController, OffersService } from './offers/offers.js';
import { SwipeController } from './swipe/swipe.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { CodeSenderService } from './auth/code-sender.service.js';
import { PrivacyController, PrivacyService } from './privacy/privacy.js';
import { FavoritesController } from './favorites/favorites.controller.js';
import { FollowsController } from './follows/follows.controller.js';
import { BrandsController } from './catalog/brands.controller.js';
import { ListingsController } from './listings/listings.controller.js';
import { ListingsService } from './listings/listings.service.js';
import { MediaController } from './media/media.controller.js';
import { MediaService } from './media/media.service.js';
import { NotificationsModule } from './notifications/notifications.service.js';
import { PrismaModule } from './prisma/prisma.service.js';
import { RecommendationsService } from './recommendations/recommendations.service.js';
import { RequestsController } from './requests/requests.controller.js';
import { RequestsService } from './requests/requests.service.js';
import { UsersController, UsersService } from './users/users.service.js';
import { TgPostParser } from './tg/parse.js';
import { TgImportService } from './tg/tg-import.service.js';

/** Single monolith (frame 28: no microservices); modules are grouped by controller/service pairs. */
@Module({
  imports: [
    PrismaModule,
    RedisModule,
    EventsModule,
    MailModule,
    NotificationsModule,
    // Serverless hosts have no timers: the same jobs run from /cron/tick instead (see maintenance.ts).
    ...(inProcessSchedulerEnabled() ? [ScheduleModule.forRoot()] : []),
    ThrottlerModule.forRootAsync({
      inject: [RedisService],
      useFactory: (redis: RedisService) => ({
        throttlers: [{ ttl: 60_000, limit: 300 }],
        // Shared counters across instances when Redis is configured; in-memory otherwise.
        storage: redis.client ? new RedisThrottlerStorage(redis.client) : undefined,
      }),
    }),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET, signOptions: { expiresIn: '30d' } }),
  ],
  controllers: [
    AuthController,
    UsersController,
    MediaController,
    AiController,
    ListingsController,
    BrandsController,
    FavoritesController,
    FollowsController,
    RequestsController,
    OffersController,
    AuctionsController,
    CartController,
    ChatController,
    SwipeController,
    CollectionsController,
    FollowingController,
    ReportsController,
    AdminController,
    AdminDataController,
    RatesController,
    LooksController,
    ReviewsController,
    StatsController,
    PrivacyController,
    MaintenanceController,
  ],
  providers: [
    AuthService,
    CodeSenderService,
    PrivacyService,
    UsersService,
    MediaService,
    AiEnsemble,
    AiService,
    PriceAdvisor,
    PhotoChecker,
    ListingModerator,
    NegotiationAdvisor,
    SearchParser,
    ChatGuard,
    StatsService,
    ReviewsService,
    ListingsService,
    TgPostParser,
    TgImportService,
    RecommendationsService,
    RequestsService,
    OffersService,
    AuctionsService,
    ChatService,
    AdminGuard,
    MaintenanceService,
    RatesService,
    LooksService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    if (lazyMaintenanceEnabled()) consumer.apply(LazyMaintenanceMiddleware).exclude('cron/tick', 'health').forRoutes('*path');
  }
}
