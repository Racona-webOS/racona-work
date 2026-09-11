/**
 * Naptárrács-segédek a havi nézetekhez (WorkCalendar, LeaveCalendar).
 *
 * Tiszta függvények, UTC alapon, hogy a téli-nyári átállás ne tolja el a
 * napokat.
 */

/**
 * Egy hónap napjai hétfővel kezdődő rácsban, az elején üres helyekkel.
 *
 * @param year - Év.
 * @param month - Hónap indexe (0-11).
 * @returns A rács cellái; a null a hónap előtti üres hely.
 */
export function monthGrid(year: number, month: number): Array<string | null> {
	const first = new Date(Date.UTC(year, month, 1));
	// getUTCDay: 0 = vasárnap → hétfő-kezdetű indexre alakítjuk
	const leading = (first.getUTCDay() + 6) % 7;
	const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

	const cells: Array<string | null> = Array(leading).fill(null);
	for (let d = 1; d <= daysInMonth; d++) {
		cells.push(isoDay(year, month, d));
	}
	return cells;
}

/**
 * Hétvége-e a nap (bejegyzés nélküli alapszabály).
 *
 * @param iso - A nap YYYY-MM-DD formában.
 * @returns Igaz, ha szombat vagy vasárnap.
 */
export function isWeekend(iso: string): boolean {
	const dow = new Date(`${iso}T00:00:00Z`).getUTCDay();
	return dow === 0 || dow === 6;
}

/**
 * Nap YYYY-MM-DD formában.
 *
 * @param year - Év.
 * @param month - Hónap indexe (0-11).
 * @param day - A hónap napja (1-31).
 */
export function isoDay(year: number, month: number, day: number): string {
	return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Egy hónap első és utolsó napja.
 *
 * @param year - Év.
 * @param month - Hónap indexe (0-11).
 */
export function monthRange(year: number, month: number): { from: string; to: string } {
	const last = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
	return { from: isoDay(year, month, 1), to: isoDay(year, month, last) };
}
