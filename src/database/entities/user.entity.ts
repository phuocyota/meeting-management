import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

/** Tài khoản đăng nhập của hệ thống meeting. Khách vào bằng tên không có dòng ở đây. */
@Entity('users')
export class UserEntity {
  /** Sinh trong ứng dụng; cũng là identity trong LiveKit. */
  @PrimaryColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 100 })
  name: string;

  /** Luôn lưu chữ thường; đăng nhập không phân biệt hoa thường. */
  @Column({ type: 'varchar', length: 50, unique: true })
  username: string;

  /** Chuỗi băm scrypt (`scrypt$<salt>$<hash>`), không bao giờ trả ra API. */
  @Column({ type: 'varchar', length: 255, select: false })
  password: string;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Column({ name: 'created_by', type: 'uuid', nullable: true })
  createdBy: string | null;

  @Column({ name: 'updated_by', type: 'uuid', nullable: true })
  updatedBy: string | null;
}
