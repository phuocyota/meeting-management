import { TrackSource } from 'livekit-server-sdk';
import {
  isAdminRole,
  type MeetingMemberEntity,
} from '../database/entities/meeting-member.entity';
import type { MeetingEntity } from '../database/entities/meeting.entity';

export interface EffectivePermission {
  canPublish: boolean;
  canSubscribe: true;
  canPublishData: boolean;
  /** Rỗng nghĩa là mọi nguồn (quy ước của LiveKit), nên chỉ liệt kê khi có giới hạn. */
  canPublishSources: TrackSource[];
}

type MeetingControls = Pick<
  MeetingEntity,
  'allowMicrophone' | 'allowCamera' | 'allowScreenShare' | 'allowChat'
>;

/**
 * Quyền LiveKit của một thành viên, tính từ khóa phát cá nhân và cài đặt của cuộc họp.
 * Admin luôn có đủ quyền. Quyền LiveKit thay thế toàn bộ, nên luôn gửi đủ các trường.
 */
export function effectivePermission(
  meeting: MeetingControls,
  member: Pick<MeetingMemberEntity, 'role' | 'canPublish'>,
): EffectivePermission {
  if (isAdminRole(member.role)) {
    return {
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
      canPublishSources: [],
    };
  }
  const sources: TrackSource[] = [];
  if (meeting.allowMicrophone) sources.push(TrackSource.MICROPHONE);
  if (meeting.allowCamera) sources.push(TrackSource.CAMERA);
  if (meeting.allowScreenShare) {
    sources.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  const canPublish = member.canPublish && sources.length > 0;
  return {
    canPublish,
    canSubscribe: true,
    canPublishData: meeting.allowChat,
    canPublishSources: !canPublish || sources.length === 4 ? [] : sources,
  };
}

/** Nguồn bị cấm theo cài đặt cuộc họp (dùng để tắt track đang phát khi admin siết quyền). */
export function blockedSources(meeting: MeetingControls): TrackSource[] {
  const blocked: TrackSource[] = [];
  if (!meeting.allowMicrophone) blocked.push(TrackSource.MICROPHONE);
  if (!meeting.allowCamera) blocked.push(TrackSource.CAMERA);
  if (!meeting.allowScreenShare) {
    blocked.push(TrackSource.SCREEN_SHARE, TrackSource.SCREEN_SHARE_AUDIO);
  }
  return blocked;
}

/** true khi quyền khác mặc định của token cũ, cần áp lại khi người đó vào phòng. */
export function isRestricted(permission: EffectivePermission): boolean {
  return (
    !permission.canPublish ||
    !permission.canPublishData ||
    permission.canPublishSources.length > 0
  );
}
