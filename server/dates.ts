/**
 * Dátum-segédek a szerver modulokhoz (YYYY-MM-DD napok, budapesti idő).
 */

/** A mai nap Budapesten, YYYY-MM-DD. Az évforduló így nem a szerver időzónáján múlik. */
export function todayInBudapest(): string {
	return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Budapest' }).format(new Date());
}

export function currentYear(): number {
	return Number(todayInBudapest().slice(0, 4));
}

/**
 * Dátum paraméter ellenőrzése. Az üres értéket null-ra fordítja.
 *
 * @throws Ha a formátum nem YYYY-MM-DD, vagy nem létező nap (pl. 02-30).
 */
export function parseDay(value: unknown, fieldLabel: string, required = false): string | null {
	if (value === null || value === undefined || value === '') {
		if (required) throw new Error(`${fieldLabel}: kötelező megadni.`);
		return null;
	}
	if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
		throw new Error(`${fieldLabel}: érvénytelen dátum.`);
	}
	const [y, m, d] = value.split('-').map(Number);
	const roundTrip = new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
	if (roundTrip !== value) throw new Error(`${fieldLabel}: érvénytelen dátum.`);
	return value;
}
