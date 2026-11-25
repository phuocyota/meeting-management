import { Module } from '@nestjs/common';
import { LiveKitService } from '../livekit/livekit.service';
import { MeetingWebhookController } from './meeting-webhook.controller';
import { MeetingWebhookService } from './meeting-webhook.service';
import { MeetingsController } from './meetings.controller';
import { MeetingsService } from './meetings.service';

@Module({
  controllers: [MeetingsController, MeetingWebhookController],
  providers: [MeetingsService, MeetingWebhookService, LiveKitService],
})
export class MeetingsModule {}
