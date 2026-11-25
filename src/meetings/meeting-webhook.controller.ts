import {
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  type RawBodyRequest,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { Public } from '../auth/decorators';
import { LiveKitService } from '../livekit/livekit.service';
import { MeetingWebhookService } from './meeting-webhook.service';

/** URL này cần được thêm vào `webhook.urls` của LiveKit server (bên cạnh URL của CRM). */
@Public()
@ApiExcludeController()
@Controller('livekit')
export class MeetingWebhookController {
  constructor(
    private readonly livekit: LiveKitService,
    private readonly webhooks: MeetingWebhookService,
  ) {}

  @Post('webhook')
  @HttpCode(HttpStatus.OK)
  async webhook(
    @Req() request: RawBodyRequest<Request>,
    @Headers('authorization') authorization?: string,
  ) {
    const event = await this.livekit.receiveWebhook(
      request.rawBody?.toString('utf8') ?? '',
      authorization,
    );
    await this.webhooks.handle(event);
    return { received: true };
  }
}
