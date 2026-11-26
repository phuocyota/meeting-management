import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cho khách làm đồng chủ trì; chủ trì vẫn phải là tài khoản.
 * Phiên khách gắn với một tab trình duyệt và có hạn, nên không giao vai trò không thay được (chủ trì) cho khách.
 */
export class AllowGuestCohost1764300000000 implements MigrationInterface {
  name = 'AllowGuestCohost1764300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "meeting_members"
        DROP CONSTRAINT "chk_meeting_members_guest_participant",
        ADD CONSTRAINT "chk_meeting_members_guest_not_host"
          CHECK (NOT "is_guest" OR "role" <> 'host')
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Ràng buộc cũ chỉ cho khách là người tham gia thường: hạ quyền khách đồng chủ trì trước.
    await queryRunner.query(
      `UPDATE "meeting_members" SET "role" = 'participant' WHERE "is_guest" AND "role" = 'cohost'`,
    );
    await queryRunner.query(`
      ALTER TABLE "meeting_members"
        DROP CONSTRAINT "chk_meeting_members_guest_not_host",
        ADD CONSTRAINT "chk_meeting_members_guest_participant"
          CHECK (NOT "is_guest" OR "role" = 'participant')
    `);
  }
}
