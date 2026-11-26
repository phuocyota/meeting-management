import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MeetingEntity } from './meeting.entity';

/** host: người tạo, không gỡ được; cohost: đồng chủ trì do admin chỉ định. */
export type MeetingRole = 'host' | 'cohost' | 'participant';
/** pending: đang ở phòng chờ; kicked: bị mời ra, cần admin duyệt lại mới vào được. */
export type MemberStatus = 'pending' | 'admitted' | 'denied' | 'kicked';

export const isAdminRole = (role: MeetingRole | undefined) =>
  role === 'host' || role === 'cohost';

@Entity('meeting_members')
@Index('idx_meeting_members_user', ['userId'])
@Index('idx_meeting_members_status', ['meetingId', 'status'])
export class MeetingMemberEntity {
  @PrimaryColumn({ name: 'meeting_id', type: 'uuid' })
  meetingId: string;

  /** id tài khoản (bảng users) hoặc id khách sinh khi vào bằng tên; cũng là identity trong LiveKit. */
  @PrimaryColumn({ name: 'user_id', type: 'uuid' })
  userId: string;

  @Column({ type: 'varchar', length: 16 })
  role: MeetingRole;

  @Column({ type: 'varchar', length: 16 })
  status: MemberStatus;

  /** Tên hiển thị lúc vào: tên tài khoản, hoặc tên khách tự nhập. */
  @Column({
    name: 'display_name',
    type: 'varchar',
    length: 100,
    nullable: true,
  })
  displayName: string | null;

  /** Khách vào bằng tên, không có tài khoản; làm được đồng chủ trì nhưng không làm chủ trì. */
  @Column({ name: 'is_guest', type: 'boolean', default: false })
  isGuest: boolean;

  /** false khi admin khóa quyền phát mic/camera/màn hình. */
  @Column({ name: 'can_publish', type: 'boolean', default: true })
  canPublish: boolean;

  @Column({ name: 'requested_at', type: 'timestamptz', nullable: true })
  requestedAt: Date | null;

  @Column({ name: 'decided_at', type: 'timestamptz', nullable: true })
  decidedAt: Date | null;

  @Column({ name: 'decided_by', type: 'uuid', nullable: true })
  decidedBy: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @ManyToOne(() => MeetingEntity, (meeting) => meeting.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'meeting_id' })
  meeting?: MeetingEntity;
}
