import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Hệ thống tài khoản riêng của meeting (không phụ thuộc CRM) và khách vào bằng tên.
 * - `users`: tài khoản đăng nhập; `password` là chuỗi băm scrypt, không bao giờ lưu mật khẩu gốc.
 * - `meeting_members`: thêm tên hiển thị và cờ khách; khách chỉ được là người tham gia thường.
 * - `meetings.branch_id`: bỏ vì không còn chi nhánh của CRM.
 */
export class AddUsersAndGuests1764200000000 implements MigrationInterface {
  name = 'AddUsersAndGuests1764200000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "users" (
        "id" uuid PRIMARY KEY,
        "name" varchar(100) NOT NULL,
        "username" varchar(50) NOT NULL,
        "password" varchar(255) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "created_by" uuid NULL,
        "updated_by" uuid NULL,
        CONSTRAINT "uq_users_username" UNIQUE ("username"),
        CONSTRAINT "chk_users_username_lower" CHECK ("username" = lower("username")),
        CONSTRAINT "fk_users_created_by" FOREIGN KEY ("created_by")
          REFERENCES "users" ("id") ON DELETE SET NULL,
        CONSTRAINT "fk_users_updated_by" FOREIGN KEY ("updated_by")
          REFERENCES "users" ("id") ON DELETE SET NULL
      )
    `);
    await queryRunner.query(`
      ALTER TABLE "meeting_members"
        ADD COLUMN "display_name" varchar(100) NULL,
        ADD COLUMN "is_guest" boolean NOT NULL DEFAULT false,
        ADD CONSTRAINT "chk_meeting_members_guest_participant"
          CHECK (NOT "is_guest" OR "role" = 'participant')
    `);
    await queryRunner.query(`ALTER TABLE "meetings" DROP COLUMN "branch_id"`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "meetings" ADD COLUMN "branch_id" uuid NULL`,
    );
    await queryRunner.query(`
      ALTER TABLE "meeting_members"
        DROP CONSTRAINT "chk_meeting_members_guest_participant",
        DROP COLUMN "is_guest",
        DROP COLUMN "display_name"
    `);
    await queryRunner.query(`DROP TABLE "users"`);
  }
}
