import { Injectable, Logger } from '@nestjs/common';
import type { WebhookEvent } from 'livekit-server-sdk';
import { DataSource } from 'typeorm';
import { MeetingMemberEntity } from '../database/entities/meeting-member.entity';
import { MeetingEntity } from '../database/entities/meeting.entity';
import { LiveKitService } from '../livekit/livekit.service';
import { parseMeetingRoomName } from './meeting-room';
import { effectivePermission, isRestricted } from './meeting-permissions';

/**
 * Thực thi quyền khi có người vào phòng: token LiveKit còn hạn tới LIVEKIT_TOKEN_TTL_SECONDS,
 * nên người bị mời ra/từ chối hoặc cuộc họp đã kết thúc phải bị chặn ở đây.
 *
 * Token chỉ được cấp sau khi dòng thành viên `admitted` đã commit, nên thiếu dòng thành viên nghĩa là
 * không được cấp quyền. Thiếu dòng `meetings` thì bỏ qua: không xóa phòng chỉ vì chưa thấy dữ liệu.
 */
@Injectable()
export class MeetingWebhookService {
  private readonly logger = new Logger(MeetingWebhookService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly livekit: LiveKitService,
  ) {}

  async handle(event: WebhookEvent): Promise<void> {
    if (event.event !== 'participant_joined') return;
    const roomName = event.room?.name ?? '';
    const meetingId = parseMeetingRoomName(roomName);
    const identity = event.participant?.identity;
    // Phòng lớp học của CRM hoặc sự kiện thiếu dữ liệu: không phải việc của service này.
    if (!meetingId || !identity) return;

    const meeting = await this.dataSource
      .getRepository(MeetingEntity)
      .findOneBy({ id: meetingId });
    if (!meeting) {
      this.logger.warn(`Webhook cho phòng ${roomName} chưa có trong DB`);
      return;
    }
    const member = await this.dataSource
      .getRepository(MeetingMemberEntity)
      .findOneBy({ meetingId, userId: identity });

    if (
      meeting.status !== 'active' ||
      !member ||
      member.status !== 'admitted'
    ) {
      this.logger.log(
        `Mời ${identity} ra khỏi ${roomName}: ${meeting.status !== 'active' ? 'cuộc họp đã kết thúc' : (member?.status ?? 'không phải thành viên')}`,
      );
      await this.livekit.removeParticipant(roomName, identity);
      return;
    }
    // Token cũ có thể còn quyền rộng hơn: áp lại khóa phát và cài đặt phòng hiện tại.
    const permission = effectivePermission(meeting, member);
    if (isRestricted(permission)) {
      await this.livekit.updateParticipant(roomName, identity, { permission });
    }
  }
}
