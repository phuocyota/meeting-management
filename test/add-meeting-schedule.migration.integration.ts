import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { CreateMeetings1764000000000 } from '../src/database/migrations/1764000000000-CreateMeetings';
import { AddMeetingControls1764100000000 } from '../src/database/migrations/1764100000000-AddMeetingControls';
import { AddUsersAndGuests1764200000000 } from '../src/database/migrations/1764200000000-AddUsersAndGuests';
import { AllowGuestCohost1764300000000 } from '../src/database/migrations/1764300000000-AllowGuestCohost';
import { AddMeetingSchedule1764400000000 } from '../src/database/migrations/1764400000000-AddMeetingSchedule';

const M = '11111111-1111-4111-8111-111111111111';
const U1 = '00000000-0000-4000-8000-000000000001';

void describe('AddMeetingSchedule migration', () => {
  let pg: PGlite;
  let runner: QueryRunner;
  const migration = new AddMeetingSchedule1764400000000();

  beforeEach(async () => {
    pg = new PGlite();
    runner = {
      query: (sql: string) => pg.query(sql),
    } as unknown as QueryRunner;
    await new CreateMeetings1764000000000().up(runner);
    await new AddMeetingControls1764100000000().up(runner);
    await new AddUsersAndGuests1764200000000().up(runner);
    await new AllowGuestCohost1764300000000().up(runner);
    await pg.query(
      `INSERT INTO meetings (id, room_name, title, host_id, max_participants)
       VALUES ($1, $2, 'A', $3, 10)`,
      [M, `meeting-${M}`, U1],
    );
    await migration.up(runner);
  });

  afterEach(async () => {
    await pg.close();
  });

  void it('cuộc họp cũ không có lịch hẹn; lưu được giờ hẹn', async () => {
    const before = await pg.query<{ scheduled_at: Date | null }>(
      `SELECT scheduled_at FROM meetings WHERE id = $1`,
      [M],
    );
    assert.equal(before.rows[0].scheduled_at, null);
    await pg.query(
      `UPDATE meetings SET scheduled_at = '2030-01-01T09:00:00Z' WHERE id = $1`,
      [M],
    );
    const after = await pg.query<{ scheduled_at: Date }>(
      `SELECT scheduled_at FROM meetings WHERE id = $1`,
      [M],
    );
    assert.equal(
      new Date(after.rows[0].scheduled_at).toISOString(),
      '2030-01-01T09:00:00.000Z',
    );
  });

  void it('down xoá cột scheduled_at', async () => {
    await migration.down(runner);
    await assert.rejects(
      pg.query(`SELECT scheduled_at FROM meetings`),
      /scheduled_at/,
    );
  });
});
