/**
 * Phòng meeting dùng tiền tố riêng để không trùng phòng lớp học của CRM (`schedule-<id>[-g-<gen>]`).
 * Webhook/cleanup của CRM bỏ qua các phòng không có session trong DB của CRM.
 */
export const MEETING_ROOM_PREFIX = 'meeting-';

const uuid =
  '[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}';
const roomPattern = new RegExp(`^${MEETING_ROOM_PREFIX}(${uuid})$`, 'i');

export function meetingRoomName(id: string): string {
  return `${MEETING_ROOM_PREFIX}${id.toLowerCase()}`;
}

/** Trả meetingId nếu tên phòng do meeting-management tạo, ngược lại null. */
export function parseMeetingRoomName(name: string): string | null {
  return roomPattern.exec(name)?.[1]?.toLowerCase() ?? null;
}

/** Topic data message LiveKit mà client meeting cần lắng nghe. */
export const MEETING_TOPICS = {
  lobby: 'meeting.lobby',
  roles: 'meeting.roles',
  settings: 'meeting.settings',
} as const;

/** Participant attribute (do server đặt) ghi thời điểm giơ tay, ISO 8601; vắng nghĩa là chưa giơ tay. */
export const HAND_RAISED_ATTRIBUTE = 'handRaisedAt';
