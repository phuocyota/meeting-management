/**
 * Người gọi API đã xác thực.
 * - `user`: tài khoản trong bảng `users`.
 * - `guest`: khách vào bằng tên; token chỉ dùng được cho đúng một cuộc họp (`meetingId`).
 */
export interface MeetingUser {
  userId: string;
  name: string;
  kind: 'user' | 'guest';
  /** Cuộc họp mà token khách được cấp; null với tài khoản. */
  meetingId: string | null;
}

export const isGuest = (user: MeetingUser) => user.kind === 'guest';
