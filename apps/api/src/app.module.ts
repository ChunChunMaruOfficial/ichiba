import { Module } from '@nestjs/common';
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
import { MailModule } from './mail/mail.module.js';
import { FollowingController } from './follows/following.js';
import { AdminController, AdminGuard, ReportsController } from './moderation/moderation.js';
import { OffersController, OffersService } from './offers/offers.js';
import { SwipeController } from './swipe/swipe.js';
import { AuthGuard } from './auth/auth.guard.js';
import { AuthService } from './auth/auth.service.js';
import { CodeSenderService } from './auth/code-sender.service.js';
import { SmsService } from './auth/sms.js';
import { PrivacyController, PrivacyService } from './privacy/privacy.js';
import { FavoritesController } from './favorites/favorites.controller.js';
import { FollowsController } from './follows/follows.controller.js';
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

/** Single monolith (frame 28: no microservices); modules are grouped by controller/service pairs. */
@Module({
  imports: [
    PrismaModule,
    EventsModule,
    MailModule,
    NotificationsModule,
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 300 }]),
    JwtModule.register({ global: true, secret: process.env.JWT_SECRET, signOptions: { expiresIn: '30d' } }),
  ],
  controllers: [
    AuthController,
    UsersController,
    MediaController,
    AiController,
    ListingsController,
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
    ReviewsController,
    StatsController,
    PrivacyController,
  ],
  providers: [
    AuthService,
    CodeSenderService,
    SmsService,
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
    RecommendationsService,
    RequestsService,
    OffersService,
    AuctionsService,
    ChatService,
    AdminGuard,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
})
export class AppModule {}
