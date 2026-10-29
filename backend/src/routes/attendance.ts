import { Router } from 'express';
import { z } from 'zod';
import { ATTENDANCE_STATUSES } from '../shared/index.js';
import { all, run, tx } from '../db/index.js';
import { asyncHandler, ok, parse } from '../lib/http.js';
import { forbidden, unprocessable } from '../lib/errors.js';
import { can, requireAuth, type AuthContext } from '../lib/auth.js';
import { getStationOrThrow, tenantIdOf } from '../lib/tenant.js';
import { audit } from '../lib/audit.js';
import { newId } from '../lib/ids.js';
import { nowIso, isIsoDate } from '../lib/time.js';
import { assertDayOpen } from '../lib/dayclose.js';

export const attendanceRouter = Router();
attendanceRouter.use(requireAuth);

/** Ek din ki haaziri sheet: tenant ke saare active employees + unka record. */
attendanceRouter.get(
  '/',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'attendance.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    const date = typeof req.query.date === 'string' ? req.query.date : null;
    if (!stationId) throw unprocessable('stationId is required');
    if (!date || !isIsoDate(date)) throw unprocessable('date (YYYY-MM-DD) is required');
    const station = getStationOrThrow(auth, stationId);
    const rows = all(
      `SELECT u.id AS user_id, u.name, u.email, u.role_key,
              a.id AS record_id, a.status, a.in_time, a.out_time, a.note
         FROM users u
         LEFT JOIN attendance_records a
           ON a.user_id = u.id AND a.attendance_date = ? AND a.station_id = ?
        WHERE u.tenant_id = ? AND u.status = 'ACTIVE'
          AND (? = 1 OR (u.role_key != 'OWNER' AND EXISTS (SELECT 1 FROM user_station_access usa WHERE usa.user_id = u.id AND usa.station_id = ?)))
        ORDER BY u.name`,
      [date, station.id, tenantIdOf(auth), auth.allStations ? 1 : 0, station.id],
    );
    return ok(res, {
      date,
      stationId: station.id,
      employees: rows.map((row) => ({
        userId: String((row as Record<string, unknown>).user_id),
        name: String((row as Record<string, unknown>).name),
        email: String((row as Record<string, unknown>).email),
        roleKey: String((row as Record<string, unknown>).role_key),
        recordId: ((row as Record<string, unknown>).record_id as string | null) ?? null,
        status: ((row as Record<string, unknown>).status as string | null) ?? null,
        inTime: ((row as Record<string, unknown>).in_time as string | null) ?? null,
        outTime: ((row as Record<string, unknown>).out_time as string | null) ?? null,
        note: ((row as Record<string, unknown>).note as string | null) ?? null,
      })),
    });
  }),
);

/** Poori sheet ek saath save (upsert) — manager subah ek baar me bhar de. */
attendanceRouter.post(
  '/mark',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'attendance.write')) throw forbidden();
    const body = parse(
      z.object({
        stationId: z.string().min(3),
        date: z.string().refine(isIsoDate, 'YYYY-MM-DD chahiye'),
        entries: z.array(z.object({
          userId: z.string().min(3),
          status: z.enum(ATTENDANCE_STATUSES),
          inTime: z.string().max(5).optional().nullable(),
          outTime: z.string().max(5).optional().nullable(),
          note: z.string().max(200).optional().nullable(),
        })).min(1).max(100),
      }),
      req.body,
    );
    const station = getStationOrThrow(auth, body.stationId);
    assertDayOpen(station.id, body.date);
    const tenantId = tenantIdOf(auth);
    const validUsers = new Set(
      all<{ id: string }>(`SELECT id FROM users WHERE tenant_id = ? AND status = ? AND (? = 1 OR (role_key != 'OWNER' AND id IN (SELECT user_id FROM user_station_access WHERE station_id = ?)))`, [tenantId, 'ACTIVE', auth.allStations ? 1 : 0, station.id]).map((u) => u.id),
    );
    for (const entry of body.entries) {
      if (!validUsers.has(entry.userId)) throw unprocessable('Ek employee is organization ka active member nahi hai');
    }
    tx(() => {
      for (const entry of body.entries) {
        run(
          `INSERT INTO attendance_records
            (id, tenant_id, station_id, user_id, attendance_date, status, in_time, out_time, note, marked_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(user_id, attendance_date) DO UPDATE SET
             status = excluded.status, in_time = excluded.in_time, out_time = excluded.out_time,
             note = excluded.note, station_id = excluded.station_id, marked_by = excluded.marked_by,
             updated_at = excluded.updated_at`,
          [newId('att'), tenantId, station.id, entry.userId, body.date, entry.status,
            entry.inTime ?? null, entry.outTime ?? null, entry.note ?? null, auth.user.id, nowIso(), nowIso()],
        );
      }
    });
    audit(req, {
      action: 'ATTENDANCE_MARKED', entity: 'Attendance', entityId: `${station.id}:${body.date}`, stationId: station.id,
      summary: `${body.date} ki haaziri: ${body.entries.length} employees`,
      after: { date: body.date, count: body.entries.length },
    });
    return ok(res, { marked: body.entries.length, date: body.date });
  }),
);

/** Mahine ka summary — salary banane ke kaam ka (PRESENT=1, HALF_DAY=0.5). */
attendanceRouter.get(
  '/summary',
  asyncHandler((req, res) => {
    const auth = req.auth as AuthContext;
    if (!can(auth, 'attendance.read')) throw forbidden();
    const stationId = typeof req.query.stationId === 'string' ? req.query.stationId : null;
    const month = typeof req.query.month === 'string' ? req.query.month : null;
    if (!stationId) throw unprocessable('stationId is required');
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw unprocessable('month (YYYY-MM) is required');
    const station = getStationOrThrow(auth, stationId);
    const rows = all<{ user_id: string; name: string; role_key: string; status: string; c: number }>(
      `SELECT a.user_id, u.name, u.role_key, a.status, COUNT(*) AS c
         FROM attendance_records a JOIN users u ON u.id = a.user_id
        WHERE a.station_id = ? AND a.attendance_date LIKE ?
        GROUP BY a.user_id, a.status
        ORDER BY u.name`,
      [station.id, `${month}%`],
    );
    const byUser = new Map<string, { userId: string; name: string; roleKey: string; present: number; halfDay: number; absent: number; leave: number; weekOff: number; payableDays: number }>();
    for (const row of rows) {
      const entry = byUser.get(row.user_id) ?? {
        userId: row.user_id, name: row.name, roleKey: row.role_key,
        present: 0, halfDay: 0, absent: 0, leave: 0, weekOff: 0, payableDays: 0,
      };
      if (row.status === 'PRESENT') entry.present += row.c;
      else if (row.status === 'HALF_DAY') entry.halfDay += row.c;
      else if (row.status === 'ABSENT') entry.absent += row.c;
      else if (row.status === 'leave') entry.leave += row.c;
      else if (row.status === 'WEEK_OFF') entry.weekOff += row.c;
      entry.payableDays = entry.present + entry.halfDay * 0.5 + entry.weekOff;
      byUser.set(row.user_id, entry);
    }
    return ok(res, { month, stationId: station.id, employees: [...byUser.values()] });
  }),
);
