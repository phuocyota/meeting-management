import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Lên lịch họp: `scheduled_at` là giờ bắt đầu đã hẹn (null: họp ngay).
 * Trước giờ hẹn chỉ chủ trì/đồng chủ trì vào được; tới giờ mọi người vào thẳng.
 * IF NOT EXISTS: app chạy synchronize có thể đã thêm cột trước khi migration chạy.
 */
export class AddMeetingSchedule1764400000000 implements MigrationInterface {
  name = 'AddMeetingSchedule1764400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meetings" ADD COLUMN IF NOT EXISTS "scheduled_at" timestamptz NULL`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meetings" DROP COLUMN IF EXISTS "scheduled_at"`,
    );
  }
}
