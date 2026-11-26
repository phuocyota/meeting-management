import { PGlite } from '@electric-sql/pglite';
import assert from 'node:assert/strict';
import { afterEach, beforeEach, describe, it } from 'node:test';
import type { QueryRunner } from 'typeorm';
import { CreateMeetings1764000000000 } from '../src/database/migrations/1764000000000-CreateMeetings';
import { AddMeetingControls1764100000000 } from '../src/database/migrations/1764100000000-AddMeetingControls';
import { AddUsersAndGuests1764200000000 } from '../src/database/migrations/1764200000000-AddUsersAndGuests';
import { AllowGuestCohost1764300000000 } from '../src/database/migrations/1764300000000-AllowGuestCohost';

const M = '11111111-1111-4111-8111-111111111111';
const U1 = '00000000-0000-4000-8000-000000000001';
const G1 = '00000000-0000-4000-8000-000000000011';
const G2 = '00000000-0000-4000-8000-000000000012';

void describe('AllowGuestCohost migration', () => {
  let pg: PGlite;
  let runner: QueryRunner;
  const migration = new AllowGuestCohost1764300000000();

  beforeEach(async () => {
    pg = new PGlite();
    runner = {
      query: (sql: string) => pg.query(sql),
    } as unknown as QueryRunner;
    await new CreateMeetings1764000000000().up(runner);
    await new AddMeetingControls1764100000000().up(runner);
    await new AddUsersAndGuests1764200000000().up(runner);
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

  const addGuest = (id: string, role: string) =>
    pg.query(
      `INSERT INTO meeting_members (meeting_id, user_id, role, status, is_guest, display_name) VALUES ($1, $2, $3, 'admitted', true, 'Khách')`,
      [M, id, role],
    );

  void it('khách làm được đồng chủ trì nhưng không làm chủ trì', async () => {
    await addGuest(G1, 'cohost');
    await addGuest(G2, 'participant');
    await assert.rejects(
      pg.query(`UPDATE meeting_members SET role = 'host' WHERE user_id = $1`, [
        G2,
      ]),
      /chk_meeting_members_guest_not_host/,
    );
  });

  void it('down hạ khách đồng chủ trì về người tham gia và khôi phục ràng buộc cũ', async () => {
    await addGuest(G1, 'cohost');
    await migration.down(runner);
    const row = await pg.query<{ role: string }>(
      `SELECT role FROM meeting_members WHERE user_id = $1`,
      [G1],
    );
    assert.equal(row.rows[0].role, 'participant');
    await assert.rejects(
      addGuest(G2, 'cohost'),
      /chk_meeting_members_guest_participant/,
    );
  });
});
