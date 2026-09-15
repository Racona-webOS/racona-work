/**
 * A projekt riport teljes időszak grafikonjának és a kezdő dátum szabálynak a
 * tesztjei (specs/project-report.md).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { buildLifetimeSeries } from '../server/project-report.ts';
import {
	createWorkEntry,
	ensureNotBeforeProjectStart,
	updateWorkEntry
} from '../server/work-entries.ts';
import type { RemoteContext } from '../server/context.ts';

describe('buildLifetimeSeries', () => {
	test('bejegyzés nélkül üres', () => {
		expect(buildLifetimeSeries([])).toEqual({ bucketDays: 1, points: [] });
	});

	test('rövid időszaknál napi oszlopok, a hézagok 0 órával', () => {
		const series = buildLifetimeSeries([
			{ date: '2026-09-05', hours: 2, entries: 1 },
			{ date: '2026-09-01', hours: 1.5, entries: 2 }
		]);
		expect(series.bucketDays).toBe(1);
		expect(series.points.map((p) => [p.date, p.to, p.hours])).toEqual([
			['2026-09-01', '2026-09-01', 1.5],
			['2026-09-02', '2026-09-02', 0],
			['2026-09-03', '2026-09-03', 0],
			['2026-09-04', '2026-09-04', 0],
			['2026-09-05', '2026-09-05', 2]
		]);
	});

	test('hosszú időszaknál napokat von össze, az órák összege megmarad', () => {
		const rows = [
			{ date: '2025-01-01', hours: 3, entries: 1 },
			{ date: '2025-06-15', hours: 4.25, entries: 2 },
			{ date: '2025-12-31', hours: 1, entries: 1 }
		];
		const series = buildLifetimeSeries(rows);
		// 365 nap / 120 oszlop → 4 nap oszloponként, 92 oszlop
		expect(series.bucketDays).toBe(4);
		expect(series.points.length).toBe(92);
		expect(series.points.length).toBeLessThanOrEqual(120);
		expect(series.points[0].date).toBe('2025-01-01');
		expect(series.points.at(-1)!.to).toBe('2025-12-31');
		expect(series.points.reduce((sum, p) => sum + p.hours, 0)).toBe(8.25);
		expect(series.points.reduce((sum, p) => sum + p.entries, 0)).toBe(4);
	});
});

describe('kezdő dátum szabály', () => {
	test('a kezdő dátum előtti nap hiba, a kezdő nap és kezdő dátum nélkül rendben', () => {
		expect(() => ensureNotBeforeProjectStart('2026-09-09', '2026-09-10')).toThrow('kezdő dátum');
		expect(() => ensureNotBeforeProjectStart('2026-09-10', '2026-09-10')).not.toThrow();
		expect(() => ensureNotBeforeProjectStart('2020-01-01', null)).not.toThrow();
	});

	/** Core admin ál-kontextus: a projekt kezdő dátuma 2026-09-10, a bejegyzés napja 2026-09-12. */
	function fakeContext() {
		const writes: string[] = [];
		const query = async (sql: string) => {
			if (/^\s*(INSERT|UPDATE|DELETE)/i.test(sql)) {
				writes.push(sql.trim().split(/\s+/)[0]);
				return { rows: [{ id: 1 }] };
			}
			if (sql.includes('FROM app__racona_work.projects WHERE id')) {
				return { rows: [{ organization_id: 3, closed_at: null, start_date: '2026-09-10' }] };
			}
			if (sql.includes('FROM app__racona_work.work_entries we') && sql.includes('WHERE we.id')) {
				return {
					rows: [{ id: 1, project_id: 5, employee_id: 2, organization_id: 3, closed_at: null, user_id: 7, work_date: '2026-09-12', start_date: '2026-09-10' }]
				};
			}
			return { rows: [] };
		};
		const context = {
			pluginId: 'racona-work',
			userId: 7,
			permissions: ['admin'],
			db: { query, connect: async () => ({ query, release: () => {} }) }
		} as unknown as RemoteContext;
		return { context, writes };
	}

	test('új bejegyzés nem kerülhet a kezdő dátum elé', async () => {
		const { context, writes } = fakeContext();
		await expect(
			createWorkEntry(
				{ projectId: 5, categoryId: 1, title: 'Feladat', hours: 1, workDate: '2026-09-01' },
				context
			)
		).rejects.toThrow('kezdő dátum');
		expect(writes).toEqual([]);
	});

	test('módosításnál a nap nem tehető a kezdő dátum elé, más mező szabadon módosítható', async () => {
		const { context, writes } = fakeContext();
		await expect(updateWorkEntry({ id: 1, workDate: '2026-09-05' }, context)).rejects.toThrow('kezdő dátum');
		expect(writes).toEqual([]);
		await updateWorkEntry({ id: 1, title: 'Új cím' }, context);
		expect(writes).toEqual(['UPDATE']);
	});
});
