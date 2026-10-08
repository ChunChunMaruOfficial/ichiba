import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { z } from 'zod';
import { AuthUser, CurrentUser } from '../auth/auth.guard.js';
import { ZodPipe } from '../common/zod.js';
import { RequestsService } from './requests.service.js';

const DeliveryDto = z.object({
  deliveryMethod: z.enum(['IN_PERSON', 'DELIVERY']),
  deliveryPoint: z.string().max(200).nullish(),
  contactPhone: z.string().max(30).nullish(),
  buyerComment: z.string().max(300, 'До 300 символов').nullish(),
});
/** `listingId` for "Купить", `listingIds` for cart checkout (one seller). */
const CreateDto = DeliveryDto.extend({
  listingId: z.uuid().optional(),
  listingIds: z.array(z.uuid()).min(1).max(20).optional(),
}).refine((d) => d.listingId || d.listingIds?.length, { message: 'Не выбрана вещь', path: ['listingId'] });

const ReasonDto = z.object({ reason: z.string().max(300).nullish() });
const TrackingDto = z.object({ trackingNumber: z.string().trim().min(4, 'Проверьте трек-номер').max(40) });
const DisputeDto = z.object({ reason: z.string().trim().min(5, 'Опишите проблему').max(1000) });

@Controller()
export class RequestsController {
  constructor(private readonly requests: RequestsService) {}

  @Post('requests')
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  create(@CurrentUser() user: AuthUser, @Body(new ZodPipe(CreateDto)) dto: z.infer<typeof CreateDto>) {
    const { listingId, listingIds, ...delivery } = dto;
    return this.requests.create(user.id, { ...delivery, listingIds: listingIds ?? [listingId!], source: listingIds ? 'CART' : 'BUY' });
  }

  @Post('requests/:id/confirm-delivery')
  @HttpCode(200)
  confirmDelivery(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DeliveryDto)) dto: z.infer<typeof DeliveryDto>) {
    return this.requests.confirmDelivery(user.id, id, dto);
  }

  @Get('requests/:id')
  get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.get(id, user.id);
  }

  @Post('requests/:id/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.accept(user.id, id);
  }

  @Post('requests/:id/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.requests.decline(user.id, id, dto.reason);
  }

  @Post('requests/:id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(ReasonDto)) dto: z.infer<typeof ReasonDto>) {
    return this.requests.cancel(user.id, id, dto.reason);
  }

  @Post('requests/:id/handed-over')
  @HttpCode(200)
  handedOver(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.handedOver(user.id, id);
  }

  @Post('requests/:id/tracking')
  @HttpCode(200)
  tracking(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(TrackingDto)) dto: z.infer<typeof TrackingDto>) {
    return this.requests.setTracking(user.id, id, dto.trackingNumber);
  }

  @Post('requests/:id/received')
  @HttpCode(200)
  received(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.requests.received(user.id, id);
  }

  @Post('requests/:id/dispute')
  @HttpCode(200)
  dispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body(new ZodPipe(DisputeDto)) dto: z.infer<typeof DisputeDto>) {
    return this.requests.dispute(user.id, id, dto.reason);
  }

  @Get('purchases')
  purchases(@CurrentUser() user: AuthUser, @Query('tab') tab: 'all' | 'active' | 'completed' | 'cancelled' = 'all') {
    return this.requests.purchases(user.id, ['active', 'completed', 'cancelled'].includes(tab) ? tab : 'all');
  }

  @Get('sales')
  sales(@CurrentUser() user: AuthUser, @Query('tab') tab: 'all' | 'action' | 'deals' | 'sold' = 'all') {
    return this.requests.sales(user.id, ['action', 'deals', 'sold'].includes(tab) ? tab : 'all');
  }
}
