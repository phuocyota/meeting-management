import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MeetingMemberEntity } from './meeting-member.entity';

export type MeetingStatus = 'active' | 'ended';

// Ràng buộc khai báo cả ở đây (cùng tên với migration) để synchronize không xoá chúng.
@Entity('meetings')
@Index('idx_meetings_host_status', ['hostId', 'status'])
@Check('chk_meetings_status', `"status" IN ('active', 'ended')`)
@Check('chk_meetings_ended', `("status" = 'ended') = ("ended_at" IS NOT NULL)`)
@Check('chk_meetings_max_participants', `"max_participants" BETWEEN 2 AND 500`)
export class MeetingEntity {
  /** Sinh trong ứng dụng để tên phòng LiveKit `meeting-<id>` có ngay khi tạo. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ name: 'room_name', type: 'varchar', length: 80, unique: true })
  roomName: string;

  @Column({ type: 'varchar', length: 200 })
  title: string;

  @Column({ name: 'host_id', type: 'uuid' })
  hostId: string;

  @Column({ name: 'waiting_room', type: 'boolean', default: true })
  waitingRoom: boolean;

  @Column({ name: 'max_participants', type: 'integer' })
  maxParticipants: number;

  /** Khóa phòng: người chưa từng xin vào không vào được nữa; người đang chờ vẫn được duyệt. */
  @Column({ type: 'boolean', default: false })
  locked: boolean;

  /** Người tham gia thường được tự bật mic. Chủ trì/đồng chủ trì luôn được phát. */
  @Column({ name: 'allow_microphone', type: 'boolean', default: true })
  allowMicrophone: boolean;

  @Column({ name: 'allow_camera', type: 'boolean', default: true })
  allowCamera: boolean;

  @Column({ name: 'allow_screen_share', type: 'boolean', default: true })
  allowScreenShare: boolean;

  /** Chat đi qua data channel của LiveKit; tắt thì người tham gia thường mất quyền canPublishData. */
  @Column({ name: 'allow_chat', type: 'boolean', default: true })
  allowChat: boolean;

  @Column({ type: 'varchar', length: 16, default: 'active' })
  status: MeetingStatus;

  /** Giờ bắt đầu đã hẹn (null: họp ngay). Trước giờ này chỉ chủ trì/đồng chủ trì vào được. */
  @Column({ name: 'scheduled_at', type: 'timestamptz', nullable: true })
  scheduledAt: Date | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'ended_at', type: 'timestamptz', nullable: true })
  endedAt: Date | null;

  @Column({ name: 'ended_by', type: 'uuid', nullable: true })
  endedBy: string | null;

  @OneToMany(() => MeetingMemberEntity, (member) => member.meeting)
  members?: MeetingMemberEntity[];
}
