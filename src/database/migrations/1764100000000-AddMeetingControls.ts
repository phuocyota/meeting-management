import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Cài đặt điều khiển phòng họp: khóa phòng, quyền tự bật mic/camera/chia sẻ màn hình, chat. */
export class AddMeetingControls1764100000000 implements MigrationInterface {
  name = 'AddMeetingControls1764100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meetings"
        ADD COLUMN "locked" boolean NOT NULL DEFAULT false,
        ADD COLUMN "allow_microphone" boolean NOT NULL DEFAULT true,
        ADD COLUMN "allow_camera" boolean NOT NULL DEFAULT true,
        ADD COLUMN "allow_screen_share" boolean NOT NULL DEFAULT true,
        ADD COLUMN "allow_chat" boolean NOT NULL DEFAULT true
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meetings"
        DROP COLUMN "allow_chat",
        DROP COLUMN "allow_screen_share",
        DROP COLUMN "allow_camera",
        DROP COLUMN "allow_microphone",
        DROP COLUMN "locked"
    `);
  }
}
