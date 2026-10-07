/**
 * A szerepszerkesztő képesség-csoportjainak tesztjei (src/lib/capability-groups.ts):
 * minden képesség megjelenik a Jogosultságok oldalon, és van magyar és angol címkéje.
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { CAPABILITIES } from '../server/permissions.ts';
import { CAPABILITY_GROUPS } from '../src/lib/capability-groups.ts';
import hu from '../locales/hu.json';
import en from '../locales/en.json';

const grouped = CAPABILITY_GROUPS.flatMap((g) => g.items);

describe('képesség-csoportok', () => {
	test('minden képesség szerepel valamelyik csoportban', () => {
		expect(CAPABILITIES.filter((c) => !grouped.includes(c))).toEqual([]);
	});

	test('a csoportokban csak létező képesség van, és mindegyik egyszer', () => {
		expect(grouped.filter((c) => !(CAPABILITIES as readonly string[]).includes(c))).toEqual([]);
		expect(new Set(grouped).size).toBe(grouped.length);
	});

	for (const [lang, messages] of [
		['hu', hu],
		['en', en]
	] as const) {
		const labels = messages as Record<string, string>;

		test(`${lang}: minden képességnek és csoportnak van címkéje`, () => {
			const keys = [...CAPABILITY_GROUPS.map((g) => g.labelKey), ...CAPABILITIES.map((c) => `capability.${c}`)];
			expect(keys.filter((k) => !labels[k]?.trim())).toEqual([]);
		});
	}
});
