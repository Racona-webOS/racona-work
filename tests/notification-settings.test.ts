/**
 * Az email értesítések beállításának tesztjei
 * (server/notification-settings.ts, server/notification-email.ts; specs/notifications.md).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
	NOTIFICATION_EVENTS,
	NOTIFICATION_EVENT_DEFAULTS,
	normalizeNotificationSettings
} from '../server/notification-settings.ts';
import { emailLocale, sendEmails, toRecipient } from '../server/notification-email.ts';
import type { RemoteContext } from '../server/context.ts';

describe('normalizeNotificationSettings', () => {
	test('beállítás nélkül minden esemény az alapértékét kapja', () => {
		expect(normalizeNotificationSettings(null).email).toEqual({ ...NOTIFICATION_EVENT_DEFAULTS });
	});

	test('ami eddig emailt küldött, alapból be van kapcsolva, az új emailek ki (D2)', () => {
		const { email } = normalizeNotificationSettings(undefined);
		expect(email['leave.requestCreated']).toBe(true);
		expect(email['employee.welcome']).toBe(true);
		expect(email['leave.mandatoryAssigned']).toBe(true);
		expect(email['leave.requestWithdrawn']).toBe(false);
		expect(email['trip.settlementSubmitted']).toBe(false);
	});

	test('a tárolt értéket megtartja, az ismeretlen és a nem logikai értéket eldobja', () => {
		const { email } = normalizeNotificationSettings({
			email: { 'leave.requestCreated': false, 'trip.ordererChanged': true, 'leave.deleted': 'no', bogus: true }
		});
		expect(email['leave.requestCreated']).toBe(false);
		expect(email['trip.ordererChanged']).toBe(true);
		expect(email['leave.deleted']).toBe(true);
		expect(Object.keys(email)).toEqual(NOTIFICATION_EVENTS);
	});
});

/** Ál-kontextus: a kv_store lekérdezés a megadott beállítást adja, az emaileket gyűjti. */
function fakeContext(stored: unknown) {
	const sent: { to: string | string[]; template: string; locale?: string; data?: Record<string, unknown> }[] = [];
	const context = {
		pluginId: 'racona-work',
		userId: 1,
		permissions: [],
		db: {
			query: async (sql: string) => ({ rows: sql.includes('kv_store') && stored ? [{ value: stored }] : [] }),
			connect: async () => {
				throw new Error('nem kell');
			}
		},
		email: {
			send: async (params: { to: string | string[]; template: string; locale?: string }) => {
				sent.push(params);
				return { success: true };
			}
		}
	} as unknown as RemoteContext;
	return { context, sent };
}

const recipients = [
	{ userId: 2, name: 'Kiss Anna', email: 'anna@example.com', locale: 'hu' as const },
	{ userId: 3, name: 'Nagy Béla', email: null, locale: 'hu' as const }
];

describe('sendEmails', () => {
	test('bekapcsolt eseménynél kimegy, az email cím nélküli címzett kimarad', async () => {
		const { context, sent } = fakeContext(null);
		await sendEmails(context, {
			organizationId: 1,
			event: 'leave.requestCreated',
			template: 'leave_request_new',
			recipients,
			buildData: () => ({})
		});
		expect(sent).toEqual([expect.objectContaining({ to: 'anna@example.com', template: 'leave_request_new' })]);
	});

	test('kikapcsolt eseménynél nem megy email', async () => {
		const { context, sent } = fakeContext({ email: { 'leave.requestCreated': false } });
		await sendEmails(context, {
			organizationId: 1,
			event: 'leave.requestCreated',
			template: 'leave_request_new',
			recipients,
			buildData: () => ({})
		});
		expect(sent).toEqual([]);
	});

	test('alapból kikapcsolt esemény csak bekapcsolás után küld', async () => {
		const off = fakeContext(null);
		const on = fakeContext({ email: { 'trip.settlementStatus': true } });
		for (const { context } of [off, on]) {
			await sendEmails(context, {
				organizationId: 1,
				event: 'trip.settlementStatus',
				template: 'trip_settlement_status',
				recipients,
				buildData: () => ({})
			});
		}
		expect(off.sent).toHaveLength(0);
		expect(on.sent).toHaveLength(1);
	});

	test('mindenki a saját nyelvén kapja az emailt', async () => {
		const { context, sent } = fakeContext(null);
		const label = { hu: 'Szabadság', en: 'Annual leave' };
		await sendEmails(context, {
			organizationId: 1,
			event: 'leave.requestCreated',
			template: 'leave_request_new',
			recipients: [
				{ userId: 2, name: 'Kiss Anna', email: 'anna@example.com', locale: 'hu' },
				{ userId: 4, name: 'John Smith', email: 'john@example.com', locale: 'en' }
			],
			buildData: (recipient) => ({ leaveTypeLabel: label[recipient.locale] })
		});
		expect(sent).toEqual([
			expect.objectContaining({ to: 'anna@example.com', locale: 'hu', data: { leaveTypeLabel: 'Szabadság' } }),
			expect.objectContaining({ to: 'john@example.com', locale: 'en', data: { leaveTypeLabel: 'Annual leave' } })
		]);
	});
});

describe('a címzett nyelve', () => {
	test('a core user_settings.locale értékéből jön, magyar az alapértelmezés', () => {
		expect(emailLocale('en')).toBe('en');
		expect(emailLocale('en-US')).toBe('en');
		expect(emailLocale('EN')).toBe('en');
		expect(emailLocale('hu')).toBe('hu');
		expect(emailLocale('de')).toBe('hu');
		expect(emailLocale(null)).toBe('hu');
		expect(emailLocale(undefined)).toBe('hu');
	});

	test('a lekérdezett sorból a címzett nyelve is kiolvasható', () => {
		expect(toRecipient({ user_id: 5, full_name: 'John Smith', email: 'john@example.com', locale: 'en' })).toEqual({
			userId: 5,
			name: 'John Smith',
			email: 'john@example.com',
			locale: 'en'
		});
		expect(toRecipient({ user_id: 6, full_name: null, email: 'x@example.com' }).locale).toBe('hu');
	});
});

describe('email sablonok', () => {
	const dir = join(import.meta.dir, '..', 'email-templates');

	test('minden használt változó szerepel a sablon adatlistáiban', () => {
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
			const template = JSON.parse(readFileSync(join(dir, file), 'utf8'));
			const allowed = new Set([...template.requiredData, ...template.optionalData]);
			for (const locale of Object.values(template.locales) as Record<string, string>[]) {
				const used = [...`${locale.subject}${locale.html}${locale.text}`.matchAll(/{{(\w+)}}/g)].map((m) => m[1]);
				expect(used.filter((v) => !allowed.has(v)), `${file}`).toEqual([]);
			}
		}
	});

	test('a szöveges változat nem tartalmaz HTML-es változót', () => {
		for (const file of readdirSync(dir).filter((f) => f.endsWith('.json'))) {
			const template = JSON.parse(readFileSync(join(dir, file), 'utf8'));
			for (const locale of Object.values(template.locales) as Record<string, string>[]) {
				expect(locale.text.match(/{{\w+Html}}/g) ?? [], `${file}`).toEqual([]);
			}
		}
	});
});
