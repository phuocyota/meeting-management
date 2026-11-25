import type { MigrationInterface, QueryRunner } from 'typeorm';

/** Bảng cuộc họp và thành viên (vai trò, phòng chờ, khóa phát). */
export class CreateMeetings1764000000000 implements MigrationInterface {
  name = 'CreateMeetings1764000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "meetings" (
        "id" uuid PRIMARY KEY,
        "room_name" varchar(80) NOT NULL,
        "title" varchar(200) NOT NULL,
        "host_id" uuid NOT NULL,
        "branch_id" uuid NULL,
        "waiting_room" boolean NOT NULL DEFAULT true,
        "max_participants" integer NOT NULL,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "ended_at" timestamptz NULL,
        "ended_by" uuid NULL,
        CONSTRAINT "uq_meetings_room_name" UNIQUE ("room_name"),
        CONSTRAINT "chk_meetings_status" CHECK ("status" IN ('active', 'ended')),
        CONSTRAINT "chk_meetings_ended" CHECK (("status" = 'ended') = ("ended_at" IS NOT NULL)),
        CONSTRAINT "chk_meetings_max_participants" CHECK ("max_participants" BETWEEN 2 AND 500)
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_meetings_host_status" ON "meetings" ("host_id", "status")`,
    );
    await queryRunner.query(`
      CREATE TABLE "meeting_members" (
        "meeting_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "role" varchar(16) NOT NULL,
        "status" varchar(16) NOT NULL,
        "can_publish" boolean NOT NULL DEFAULT true,
        "requested_at" timestamptz NULL,
        "decided_at" timestamptz NULL,
        "decided_by" uuid NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_meeting_members" PRIMARY KEY ("meeting_id", "user_id"),
        CONSTRAINT "fk_meeting_members_meeting" FOREIGN KEY ("meeting_id")
          REFERENCES "meetings" ("id") ON DELETE CASCADE,
        CONSTRAINT "chk_meeting_members_role" CHECK ("role" IN ('host', 'cohost', 'participant')),
        CONSTRAINT "chk_meeting_members_status" CHECK ("status" IN ('pending', 'admitted', 'denied', 'kicked')),
        CONSTRAINT "chk_meeting_members_admin_admitted" CHECK ("role" = 'participant' OR "status" = 'admitted')
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_meeting_members_user" ON "meeting_members" ("user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_meeting_members_status" ON "meeting_members" ("meeting_id", "status")`,
    );
    // Mỗi cuộc họp chỉ có đúng một người chủ trì.
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_meeting_members_host" ON "meeting_members" ("meeting_id") WHERE "role" = 'host'`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE "meeting_members"`);
    await queryRunner.query(`DROP TABLE "meetings"`);
  }
}
