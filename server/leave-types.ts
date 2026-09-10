/**
 * Szabadságtípusok — egy helyen, hogy a szerver ellenőrzése, az értesítések és
 * a kérelem-űrlap ugyanazt a listát használja.
 *
 * Tiszta modul (nincs adatbázis), ezért a kliens is importálhatja.
 */

export const LEAVE_TYPES = ['annual', 'sick', 'paternity', 'parental', 'unpaid', 'other'] as const;

export type LeaveType = (typeof LEAVE_TYPES)[number];

/** Gyerekhez kötött típusok: a kérelemnél meg kell adni, melyik gyerek után kérik. */
export const CHILD_LEAVE_TYPES: ReadonlySet<LeaveType> = new Set<LeaveType>(['paternity', 'parental']);

export function isLeaveType(value: unknown): value is LeaveType {
	return typeof value === 'string' && (LEAVE_TYPES as readonly string[]).includes(value);
}

/** Az értesítésekben és emailekben használt feliratok (a felület a locales fájlokat használja). */
export const LEAVE_TYPE_LABELS: Record<LeaveType, { hu: string; en: string }> = {
	annual: { hu: 'Éves szabadság', en: 'Annual leave' },
	sick: { hu: 'Betegszabadság', en: 'Sick leave' },
	paternity: { hu: 'Apasági szabadság', en: 'Paternity leave' },
	parental: { hu: 'Szülői szabadság', en: 'Parental leave' },
	unpaid: { hu: 'Fizetés nélküli szabadság', en: 'Unpaid leave' },
	other: { hu: 'Egyéb távollét', en: 'Other leave' }
};
