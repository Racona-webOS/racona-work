<!--
	Szabadságnaptár — havi rács, amiben napokra látszik, ki van szabadságon.

	Szűrő nélkül minden cellában a távol lévők neve; kiválasztott dolgozóval
	csak az ő napjai, típusonként színezve (a típust csak a leave.approve jog
	mutatja). A függő kérelmek halványan jelennek meg.

	Három nézet: havi rács, éves nézet (tizenkét kis havi rács) és csapatnézet
	(soronként egy dolgozó, oszloponként egy nap). A csapatnézet csak olvasásra.

	A dolgozó alapból mindenki jóváhagyott napjait látja (típus nélkül),
	olvasásra, dolgozóválasztó nélkül; függő kérelemből csak a sajátjait (a
	szerver szűr). Az „Új szabadság” gombbal kérelmező módba vált: a saját
	naptára éves nézetben, ahol kijelöli a kért napokat, a szerver szakaszokra
	bontja és mutatja a keretét, egy gombbal beküldi (szakaszonként egy függő
	kérelem). A saját függő kérelmét a részletekből vagy kérelmező módban a
	napra kattintva vonhatja vissza (megerősítés után). Szerkesztés nélkül a napra kattintva a nap
	mellett felugró doboz mutatja a nap összes bejegyzését (a tooltip helyett).

	Szerkesztés (leave.approve joggal, kiválasztott dolgozóval, havi és éves
	nézetben): üres munkanapra
	kattintva a nap felveendő, meglévőre kattintva törlendő. A jelölések a
	Mentés gombra futnak le egy tranzakcióban; az összegzősáv a szerver
	előnézetéből mutatja a szakaszokat és a keretet (specs/leave-days.md).
-->
<script lang="ts">
	import { untrack } from 'svelte';
	import type {
		EmployeeRow,
		LeaveBalanceOverview,
		LeaveCalendar,
		LeaveCalendarDay,
		LeaveCalendarPendingDay,
		LeaveCalendarChangePlan,
		LeaveCalendarSaveResult,
		LeaveRequestBatchResult,
		LeaveAllowances,
		ChildLeaveStatus,
		PaginatedResult
	} from '../../../server/functions.js';
	import { CHILD_LEAVE_TYPES, LEAVE_TYPES } from '../../../server/leave-types.js';
	import type { LeaveType } from '../../../server/leave-types.js';
	import { CALENDAR_LEAVE_TYPES, REQUEST_CALENDAR_LEAVE_TYPES } from '../../../server/leave-day-utils.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { isWeekend, monthGrid, monthRange } from '../../lib/calendar-grid.js';
	import LeaveSummaryTable from './LeaveSummaryTable.svelte';
	import MonthConfirmationPanel from './MonthConfirmationPanel.svelte';
	import type { MonthConfirmationOverview } from '../../../server/functions.js';
	import { formatDate } from '../../utils/format.js';
	import { isCoreAdminViewer } from '../../stores/organizationStore.svelte.js';

	let {
		pluginId = 'racona-work',
		organizationId,
		canManage = false,
		ownEmployeeId = null,
		refreshKey = 0,
		initialEmployeeId = null,
		onSaved
	}: {
		pluginId?: string;
		organizationId: number;
		/** leave.approve: a típus látszik és szerkeszthet (a szerver dönt, ez csak a felület). */
		canManage?: boolean;
		/** A hívó saját dolgozói sora: ezzel kér szabadságot és vonja vissza a sajátját. */
		ownEmployeeId?: number | null;
		/** Növelve újratölt (kérelem jóváhagyása, törlése után). */
		refreshKey?: number;
		/** Sikeres naptáras mentés után (a kérelmek listája frissülhet). */
		onSaved?: () => void;
		/** Megnyitáskor erre a dolgozóra szűr, jóváhagyóként (a Szabadság egyenleg oldalról). */
		initialEmployeeId?: number | null;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	// --- Kérelmező mód ---------------------------------------------------------
	// Az „Új szabadság” gombbal vált át a dolgozó: a saját naptára rögzített
	// szűrővel, éves nézetben, jelöléssel és beküldéssel. A jóváhagyó is így kér
	// magának szabadságot, mert a sajátját nem rögzítheti közvetlenül.
	let requestMode = $state(false);
	const canEnterRequestMode = $derived(!!ownEmployeeId);
	const lockEmployee = $derived(requestMode);
	const employeeId = $derived(requestMode ? ownEmployeeId : null);

	// --- Állapot -------------------------------------------------------------

	const now = new Date();
	let year = $state(now.getFullYear());
	let month = $state(now.getMonth());
	let data = $state<LeaveCalendar | null>(null);
	let loading = $state(false);
	let error = $state<string | null>(null);

	let employees = $state<EmployeeRow[]>([]);
	let selectedEmployeeId = $state<number | null>(null);

	// A Szabadság egyenleg oldalról a dolgozóra szűrve nyílik (specs/leave-balance-overview.md, K16)
	$effect(() => {
		if (canManage && initialEmployeeId) selectedEmployeeId = initialEmployeeId;
	});

	/** A tényleges szűrő: rögzítve a saját dolgozó, egyébként a választott. */
	const filterEmployeeId = $derived(lockEmployee ? employeeId : selectedEmployeeId);

	const today = $derived(
		`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
	);

	const cells = $derived(monthGrid(year, month));

	// --- Nézetek -------------------------------------------------------------

	type CalendarView = 'month' | 'year' | 'team';
	let view = $state<CalendarView>('month');

	// Saját nézetben az éves nézet a kiindulás: ott jelöli a dolgozó a kért
	// napokat. A Saját/Összes váltás csak a prop-ot változtatja, ezért effekt.
	$effect(() => {
		view = lockEmployee ? 'year' : 'month';
	});
	const MONTHS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11];

	/** A lekérdezett időszak: éves nézetben az egész év, egyébként a hónap. */
	const range = $derived(
		view === 'year' ? { from: `${year}-01-01`, to: `${year}-12-31` } : monthRange(year, month)
	);

	/** A hónap napjai a csapatnézet oszlopaihoz. */
	const monthDays = $derived(monthGrid(year, month).filter((d): d is string => d !== null));

	function weekdayIndex(iso: string): number {
		return (new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7;
	}

	/** Nap → jóváhagyott napok. */
	const dayMap = $derived.by(() => {
		const map = new Map<string, LeaveCalendarDay[]>();
		for (const d of data?.days ?? []) {
			if (!map.has(d.day)) map.set(d.day, []);
			map.get(d.day)!.push(d);
		}
		return map;
	});

	/** Nap → függő napok. */
	const pendingMap = $derived.by(() => {
		const map = new Map<string, LeaveCalendarPendingDay[]>();
		for (const d of data?.pending ?? []) {
			if (!map.has(d.day)) map.set(d.day, []);
			map.get(d.day)!.push(d);
		}
		return map;
	});

	/** Csapatnézet: dolgozó és nap → jóváhagyott nap. */
	const teamMap = $derived(new Map((data?.days ?? []).map((d) => [`${d.employeeId}:${d.day}`, d])));

	/** Csapatnézet: dolgozó és nap → függő nap. */
	const pendingTeamMap = $derived(
		new Map((data?.pending ?? []).map((d) => [`${d.employeeId}:${d.day}`, d]))
	);

	/**
	 * A csapatnézet sorai: a szűrt dolgozó, egyébként az aktív dolgozók; ha a
	 * lista nem tölthető, azok, akik a naptárban szerepelnek.
	 */
	const teamRows = $derived.by(() => {
		const fromData = new Map<number, string>();
		for (const d of [...(data?.days ?? []), ...(data?.pending ?? [])]) {
			fromData.set(d.employeeId, d.employeeName);
		}
		if (filterEmployeeId) {
			const emp = employees.find((e) => e.id === filterEmployeeId);
			return [{ id: filterEmployeeId, name: emp?.userName ?? fromData.get(filterEmployeeId) ?? '—' }];
		}
		if (employees.length > 0) return employees.map((e) => ({ id: e.id, name: e.userName }));
		return [...fromData].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
	});

	/** A dolgozó jóváhagyott napjai a hónapban (csapatnézet összesítő). */
	function teamTotal(employeeId: number): number {
		return monthDays.filter((iso) => teamMap.has(`${employeeId}:${iso}`)).length;
	}

	/** A munkanaptár kivételei: nap → munkanap-e. */
	const overrides = $derived(new Map((data?.calendar ?? []).map((c) => [c.day, c.isWorkingDay])));

	function isWorkingDay(iso: string): boolean {
		const override = overrides.get(iso);
		if (override !== undefined) return override;
		return !isWeekend(iso);
	}

	const hasAnyLeave = $derived((data?.days.length ?? 0) + (data?.pending.length ?? 0) > 0);

	// --- Táblázatos összesítő (specs/leave-days.md, K18) --------------------

	/** Csak a jóváhagyónak, a kérelmező módon kívül: a típus egészségügyi adat is lehet. */
	const showSummary = $derived(canManage && !lockEmployee && data?.canManage === true);

	/** Éves nézetben dolgozónként az éves keret (az egyenleg oldal lekérdezéséből). */
	let yearAllowances = $state<Map<number, number> | null>(null);

	async function loadAllowances() {
		yearAllowances = null;
		if (!sdk?.remote || !organizationId || view !== 'year' || !showSummary) return;
		const requestedYear = year;
		try {
			const overview: LeaveBalanceOverview = await sdk.remote.call('getLeaveBalanceOverview', {
				organizationId,
				year: requestedYear
			});
			if (requestedYear === year && view === 'year') {
				yearAllowances = new Map(overview.employees.map((e) => [e.employeeId, e.totalDays]));
			}
		} catch {
			// Keret nélkül is használható: a keret-oszlopokban „—” marad
			if (requestedYear === year) yearAllowances = new Map();
		}
	}

	$effect(() => {
		organizationId;
		view;
		year;
		showSummary;
		refreshKey;
		untrack(() => loadAllowances());
	});

	const summaryPeriod = $derived(
		view === 'year'
			? t('leaveSummary.period.year', { year })
			: t('leaveSummary.period.month', {
					year,
					month: t(`workCalendar.month.${month}`),
					monthLower: t(`workCalendar.month.${month}`).toLocaleLowerCase('hu')
				})
	);
	const summaryFileName = $derived(
		view === 'year' ? `szabadsagok-${year}` : `szabadsagok-${year}-${String(month + 1).padStart(2, '0')}`
	);

	// --- Havi ellenőrzés (specs/leave-month-confirmation.md) ----------------

	/** A csapatnézet alatt, a jóváhagyónak (a szerver is ellenőrzi). */
	const showMonthConfirmation = $derived(canManage && !lockEmployee && view === 'team');
	let monthConfirmations = $state<MonthConfirmationOverview | null>(null);
	let monthConfirmationError = $state<string | null>(null);
	/** Kiküldés vagy kezelés után növelve újratölt. */
	let monthConfirmationKey = $state(0);

	async function loadMonthConfirmations() {
		if (!sdk?.remote || !organizationId || !showMonthConfirmation) {
			monthConfirmations = null;
			return;
		}
		const requested = `${year}-${month}-${filterEmployeeId ?? ''}`;
		try {
			const result: MonthConfirmationOverview = await sdk.remote.call('getMonthConfirmations', {
				organizationId,
				year,
				month: month + 1,
				employeeId: filterEmployeeId ?? undefined
			});
			// Gyors hónapléptetésnél csak a legutóbbi kérés eredménye maradjon
			if (requested !== `${year}-${month}-${filterEmployeeId ?? ''}`) return;
			monthConfirmations = result;
			monthConfirmationError = null;
		} catch (err: any) {
			monthConfirmations = null;
			monthConfirmationError = err?.message ?? t('monthConfirmation.panel.loadFailed');
		}
	}

	$effect(() => {
		organizationId;
		showMonthConfirmation;
		year;
		month;
		filterEmployeeId;
		refreshKey;
		monthConfirmationKey;
		untrack(() => loadMonthConfirmations());
	});

	const confirmationRows = $derived(new Map((monthConfirmations?.rows ?? []).map((r) => [r.employeeId, r])));

	/** A csapattáblázat névoszlopának állapotjele (K2). */
	function confirmationMarker(employeeId: number): { cls: string; symbol: string; label: string } | null {
		const row = confirmationRows.get(employeeId);
		if (!row) return null;
		const c = row.confirmation;
		if (!c) {
			return row.eligible ? { cls: 'mc-none', symbol: '○', label: t('monthConfirmation.status.notSent') } : null;
		}
		const label = t(`monthConfirmation.status.${c.status}`);
		if (c.stale && c.status !== 'disputed') {
			return { cls: 'mc-stale', symbol: '↻', label: `${label} · ${t('monthConfirmation.status.stale')}` };
		}
		const symbols: Record<string, [string, string]> = {
			accepted: ['mc-accepted', '✓'],
			closed: ['mc-closed', '✓'],
			pending: ['mc-pending', '…'],
			disputed: ['mc-disputed', '!']
		};
		const [cls, symbol] = symbols[c.status] ?? ['mc-none', '○'];
		// Válaszra váró tételnél az emlékeztetők is (specs/leave-month-automation.md, K5)
		if (c.status === 'pending' && c.reminderCount > 0) {
			const reminders = t('monthConfirmation.reminders', {
				count: c.reminderCount,
				date: formatDate(c.lastRemindedAt)
			});
			return { cls, symbol, label: `${label} · ${reminders}` };
		}
		return { cls, symbol, label };
	}

	/** „Megnyitás a naptárban”: havi nézet a dolgozóra szűrve, hogy a HR javíthasson. */
	function openEmployeeFromConfirmation(id: number) {
		if (hasChanges && !window.confirm(t('leaveCalendar.discardConfirm'))) return;
		clearChanges();
		selectedEmployeeId = id;
		view = 'month';
	}

	// --- Szerkesztés ---------------------------------------------------------

	/**
	 * Csak a jóváhagyó szerkeszthet, csak kiválasztott dolgozóval, és a saját naptárát
	 * csak a rendszergazda (mint a szerveren, ensureNotSelfDecision).
	 */
	const ownSelected = $derived(
		!!ownEmployeeId && filterEmployeeId === ownEmployeeId && !isCoreAdminViewer()
	);
	const editable = $derived(
		canManage && !lockEmployee && !!filterEmployeeId && !ownSelected && data?.canManage === true
	);

	/** Kérelmező mód: a dolgozó a naptárból kérelmet ad be (K15). */
	const canRequest = $derived(lockEmployee && !!employeeId && !editable);

	function enterRequestMode() {
		if (!canEnterRequestMode) return;
		clearChanges();
		requestMode = true;
	}

	function exitRequestMode() {
		if (hasChanges && !window.confirm(t('leaveCalendar.discardConfirm'))) return;
		clearChanges();
		requestMode = false;
	}
	let requestType = $state<LeaveType>('annual');

	/** A jelölések típusa: a HR felvételnél vagy a dolgozó kérelménél. */
	const activeType = $derived(editable ? addType : requestType);

	// --- Gyerekhez kötött típusok és indoklás ------------------------------

	/** Apasági és szülői szabadságnál: melyik gyerek után. */
	let childId = $state<number | null>(null);
	let allowances = $state<LeaveAllowances | null>(null);
	const needsChild = $derived(CHILD_LEAVE_TYPES.has(activeType));
	const childOptions = $derived<ChildLeaveStatus[]>(
		activeType === 'paternity'
			? (allowances?.paternity.filter((c) => c.active) ?? [])
			: activeType === 'parental'
				? (allowances?.parental ?? [])
				: []
	);

	/** A kérelmek indoklása (nem kötelező). */
	let reason = $state('');

	function childLabel(child: ChildLeaveStatus): string {
		return child.label || formatDay(child.birthDate);
	}

	// A gyerekek a dolgozó adatlapjáról, csak ha kell; típus- vagy dolgozóváltáskor újra
	$effect(() => {
		const employee = filterEmployeeId;
		const type = activeType;
		childId = null;
		if (!CHILD_LEAVE_TYPES.has(type) || !employee || !sdk?.remote) {
			allowances = null;
			return;
		}
		sdk.remote
			.call('getLeaveAllowances', { employeeId: employee, year })
			.then((result: LeaveAllowances) => {
				if (filterEmployeeId === employee && activeType === type) allowances = result;
			})
			.catch(() => (allowances = null));
	});

	let addType = $state<LeaveType>('annual');
	// Sima Set, minden változásnál újra létrehozva. A svelte/reactivity SvelteSet
	// nem használható: a build csak a 'svelte' és a 'svelte/internal/client'
	// csomagot veszi a core közös runtime-jából, a svelte/reactivity a csomagba
	// kerülne a saját runtime-másolatával, és a jelölések nem frissítenék a felületet.
	let toAdd = $state<Set<string>>(new Set());
	let toRemove = $state<Set<string>>(new Set());
	const hasChanges = $derived(toAdd.size + toRemove.size > 0);

	function toggled(set: Set<string>, iso: string): Set<string> {
		const next = new Set(set);
		if (next.has(iso)) next.delete(iso);
		else next.add(iso);
		return next;
	}

	let plan = $state<LeaveCalendarChangePlan | null>(null);
	let planLoading = $state(false);
	let saving = $state(false);

	const addedDays = $derived(plan?.runs.reduce((sum, r) => sum + r.days.length, 0) ?? toAdd.size);

	function clearChanges() {
		toAdd = new Set();
		toRemove = new Set();
		plan = null;
		reason = '';
	}

	// --- Saját függő kérelem visszavonása -----------------------------------

	/** Saját nézetben a függő kérelem napja kattintható: visszavonás. */
	const canWithdraw = $derived(lockEmployee && !!employeeId);
	let withdrawing = $state(false);

	/** A kérelem napjai a betöltött időszakból, a megerősítő szöveghez. */
	function pendingPeriod(leaveRequestId: number): string {
		const days = (data?.pending ?? []).filter((d) => d.leaveRequestId === leaveRequestId).map((d) => d.day);
		if (days.length === 0) return '';
		const first = days[0];
		const last = days[days.length - 1];
		return first === last ? formatDay(first) : `${formatDay(first)} – ${formatDay(last)}`;
	}

	function formatDay(iso: string): string {
		return formatDate(iso);
	}

	async function withdrawPending(iso: string) {
		const pending = (pendingMap.get(iso) ?? []).find((d) => d.employeeId === employeeId);
		if (!canWithdraw || !pending) return;
		await withdrawRequest(pending.leaveRequestId);
	}

	/** Saját függő kérelem visszavonása (a részletekből vagy kérelmező módban). */
	async function withdrawRequest(leaveRequestId: number) {
		if (withdrawing) return;
		if (!window.confirm(t('leaveCalendar.withdrawConfirm', { period: pendingPeriod(leaveRequestId) }))) return;
		withdrawing = true;
		try {
			await sdk.remote.call('withdrawLeaveRequest', { id: leaveRequestId });
			closeDetails();
			sdk?.ui?.toast(t('leaveCalendar.withdrawn'), 'success');
			await loadCalendar();
			onSaved?.();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			withdrawing = false;
		}
	}

	// --- Részletek ------------------------------------------------------------

	/** A kiválasztott nap, aminek a bejegyzései a felugró dobozban látszanak. */
	let detailsDay = $state<string | null>(null);

	/** A komponens gyökere: ehhez képest pozicionáljuk a felugró dobozt. */
	let rootEl = $state<HTMLElement | null>(null);

	/** A kattintott cella helye a gyökérhez képest. */
	let detailsAnchor = $state<{ left: number; top: number; width: number; height: number } | null>(null);

	const POPUP_GAP = 8;

	/** A doboz mért szélessége: a tartalomhoz igazodik (CSS-ben min. és max.). */
	let popupWidth = $state(288);

	/** A doboz helye: a cella jobb oldalán, ha nem fér ki, a bal oldalán. */
	const popupStyle = $derived.by(() => {
		if (!detailsAnchor || !rootEl) return '';
		const rootWidth = rootEl.clientWidth;
		let left = detailsAnchor.left + detailsAnchor.width + POPUP_GAP;
		if (left + popupWidth > rootWidth) left = detailsAnchor.left - popupWidth - POPUP_GAP;
		if (left < 0) left = Math.max(0, rootWidth - popupWidth);
		return `left: ${Math.round(left)}px; top: ${Math.round(detailsAnchor.top)}px;`;
	});

	function closeDetails() {
		detailsDay = null;
		detailsAnchor = null;
	}

	/** Kattintás a dobozon és a napokon kívül, vagy Escape: bezárás. */
	function onWindowPointerDown(event: PointerEvent) {
		if (!detailsDay) return;
		const target = event.target as HTMLElement | null;
		if (target?.closest('.details-popup, .cell, .mini')) return;
		closeDetails();
	}

	function onWindowKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape' && detailsDay) closeDetails();
	}

	const detailsApproved = $derived(detailsDay ? (dayMap.get(detailsDay) ?? []) : []);
	const detailsPending = $derived(detailsDay ? (pendingMap.get(detailsDay) ?? []) : []);

	function formatDayLong(iso: string): string {
		return formatDate(iso, {
			year: 'numeric',
			month: 'long',
			day: 'numeric',
			weekday: 'long'
		});
	}

	function openDetails(iso: string, cell: HTMLElement | null) {
		const count = (dayMap.get(iso)?.length ?? 0) + (pendingMap.get(iso)?.length ?? 0);
		if (count === 0 || detailsDay === iso || !cell || !rootEl) {
			closeDetails();
			return;
		}
		const cellRect = cell.getBoundingClientRect();
		const rootRect = rootEl.getBoundingClientRect();
		detailsAnchor = {
			left: cellRect.left - rootRect.left,
			top: cellRect.top - rootRect.top,
			width: cellRect.width,
			height: cellRect.height
		};
		detailsDay = iso;
	}

	/**
	 * Kattintható-e a nap: szerkesztésben az üres munkanap és a meglévő nap;
	 * egyébként az, amin van bejegyzés (részletek, saját nézetben visszavonás).
	 */
	/**
	 * A nap lezárt vagy még meg nem nyitott évre esik-e: ott nem lehet
	 * rögzíteni (a szerver is ellenőrzi, ez csak a felület).
	 */
	function isClosed(iso: string): boolean {
		if (!data) return false;
		const dayYear = Number(iso.slice(0, 4));
		if (data.closedYear !== null && dayYear <= data.closedYear) return true;
		return data.openedYear === null || dayYear > data.openedYear;
	}

	/** Súgó, ha a látott időszakban meg nem nyitott év is van (ott nem lehet rögzíteni). */
	const unopenedHint = $derived.by(() => {
		if (!data) return '';
		if (data.openedYear === null) return t('leaveCalendar.noOpenYearHint');
		return Number(range.to.slice(0, 4)) > data.openedYear
			? t('leaveCalendar.unopenedHint', { year: data.openedYear + 1 })
			: '';
	});

	function isClickable(iso: string): boolean {
		const approved = dayMap.get(iso)?.length ?? 0;
		const pending = pendingMap.get(iso)?.length ?? 0;
		if (editable) return isWorkingDay(iso) && pending === 0 && !isClosed(iso);
		if (canRequest) return approved + pending > 0 || (isWorkingDay(iso) && !isClosed(iso));
		return approved + pending > 0;
	}

	function toggleDay(iso: string, cell: HTMLElement | null = null) {
		if (canWithdraw && (pendingMap.get(iso) ?? []).some((d) => d.employeeId === employeeId)) {
			withdrawPending(iso);
			return;
		}
		if (canRequest) {
			// Meglévő napon a részletek; üres munkanapon a kérés jelölése
			const hasAny = (dayMap.get(iso)?.length ?? 0) + (pendingMap.get(iso)?.length ?? 0) > 0;
			if (hasAny) openDetails(iso, cell);
			else if (isWorkingDay(iso) && !isClosed(iso)) toAdd = toggled(toAdd, iso);
			return;
		}
		if (!editable) {
			openDetails(iso, cell);
			return;
		}
		if (!isWorkingDay(iso) || isClosed(iso)) return;
		if ((pendingMap.get(iso) ?? []).length > 0) return;
		const hasApproved = (dayMap.get(iso) ?? []).length > 0;
		if (hasApproved) toRemove = toggled(toRemove, iso);
		else toAdd = toggled(toAdd, iso);
	}

	// Előnézet a szerverről, rövid késleltetéssel, hogy gyors kattintgatásnál ne
	// menjen minden lépésre hívás
	let planTimer: ReturnType<typeof setTimeout> | null = null;
	$effect(() => {
		const employee = filterEmployeeId;
		const type = activeType;
		const child = childId;
		const mode = editable ? 'save' : canRequest ? 'request' : null;
		const add = [...toAdd];
		const remove = [...toRemove];
		if (planTimer) clearTimeout(planTimer);
		if (!mode || !employee || add.length + remove.length === 0) {
			plan = null;
			planLoading = false;
			return;
		}
		planLoading = true;
		planTimer = setTimeout(async () => {
			try {
				const result: LeaveCalendarChangePlan =
					mode === 'save'
						? await sdk.remote.call('previewLeaveCalendarSave', {
								organizationId,
								employeeId: employee,
								leaveType: type,
								addDays: add,
								removeDays: remove,
								childId: child
							})
						: await sdk.remote.call('previewLeaveRequestBatch', {
								organizationId,
								employeeId: employee,
								leaveType: type,
								days: add,
								childId: child
							});
				// Csak akkor vesszük át, ha közben nem változott a jelölés
				if (add.length === toAdd.size && remove.length === toRemove.size) plan = result;
			} catch (err: any) {
				plan = { runs: [], removeDays: [], balances: [], errors: [err?.message ?? t('error.loadFailed')] };
			} finally {
				planLoading = false;
			}
		}, 250);
	});

	async function save() {
		if (!editable || !filterEmployeeId || !hasChanges || saving) return;
		saving = true;
		try {
			const result: LeaveCalendarSaveResult = await sdk.remote.call('saveLeaveCalendar', {
				organizationId,
				employeeId: filterEmployeeId,
				leaveType: addType,
				addDays: [...toAdd],
				removeDays: [...toRemove],
				childId,
				reason: reason.trim() || null
			});
			sdk?.ui?.toast(
				t('leaveCalendar.saved', {
					added: result.createdRequests.reduce((sum, r) => sum + r.days, 0),
					requests: result.createdRequests.length,
					removed: result.removedDays.length
				}),
				'success'
			);
			clearChanges();
			await loadCalendar();
			onSaved?.();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	/** A dolgozó beküldi a kijelölt napokat: szakaszonként egy függő kérelem. */
	async function submitRequests() {
		if (!canRequest || !employeeId || toAdd.size === 0 || saving) return;
		saving = true;
		try {
			const result: LeaveRequestBatchResult = await sdk.remote.call('submitLeaveRequestBatch', {
				organizationId,
				employeeId,
				leaveType: requestType,
				days: [...toAdd],
				childId,
				reason: reason.trim() || null
			});
			sdk?.ui?.toast(
				t('leaveCalendar.submitted', {
					requests: result.createdRequests.length,
					days: result.createdRequests.reduce((sum, r) => sum + r.days, 0)
				}),
				'success'
			);
			clearChanges();
			requestMode = false;
			await loadCalendar();
			onSaved?.();
		} catch (err: any) {
			sdk?.ui?.toast(err?.message ?? t('error.saveFailed'), 'error');
		} finally {
			saving = false;
		}
	}

	/** Szűrőváltás mentetlen jelöléssel: megerősítés, különben marad a régi. */
	function onEmployeeChange(event: Event) {
		const select = event.currentTarget as HTMLSelectElement;
		const next = select.value === '' ? null : Number(select.value);
		if (hasChanges && !window.confirm(t('leaveCalendar.discardConfirm'))) {
			select.value = selectedEmployeeId === null ? '' : String(selectedEmployeeId);
			return;
		}
		clearChanges();
		selectedEmployeeId = next;
	}

	// --- Adatok --------------------------------------------------------------

	async function loadCalendar() {
		if (!sdk?.remote || !organizationId) return;
		loading = true;
		error = null;
		closeDetails();
		try {
			data = await sdk.remote.call('getLeaveCalendar', {
				organizationId,
				from: range.from,
				to: range.to,
				employeeId: filterEmployeeId ?? undefined
			});
		} catch (err: any) {
			error = err?.message ?? t('error.loadFailed');
			data = null;
		} finally {
			loading = false;
		}
	}

	async function loadEmployees() {
		if (!sdk?.remote || !organizationId || lockEmployee) return;
		try {
			const result: PaginatedResult<EmployeeRow> = await sdk.remote.call('getEmployees', {
				organizationId,
				pageSize: 200,
				status: 'active',
				sortBy: 'userName'
			});
			employees = result?.data ?? [];
		} catch {
			employees = [];
		}
	}

	$effect(() => {
		organizationId;
		lockEmployee;
		untrack(() => loadEmployees());
	});

	$effect(() => {
		organizationId;
		range;
		filterEmployeeId;
		refreshKey;
		untrack(() => loadCalendar());
	});

	// --- Navigáció -----------------------------------------------------------

	function prevMonth() {
		if (view === 'year') {
			year -= 1;
			return;
		}
		if (month === 0) {
			month = 11;
			year -= 1;
		} else {
			month -= 1;
		}
	}

	function nextMonth() {
		if (view === 'year') {
			year += 1;
			return;
		}
		if (month === 11) {
			month = 0;
			year += 1;
		} else {
			month += 1;
		}
	}

	function setView(next: CalendarView) {
		if (next === 'team' && lockEmployee) return;
		view = next;
	}

	function goToday() {
		year = now.getFullYear();
		month = now.getMonth();
	}

	// --- Megjelenítés --------------------------------------------------------

	const MAX_NAMES = 3;

	function typeLabel(type: string | null): string {
		if (!type) return t('leaveCalendar.leave');
		return (LEAVE_TYPES as readonly string[]).includes(type) ? t(`leaveRequests.type.${type}`) : type;
	}

	function typeClass(type: string | null): string {
		return type && (LEAVE_TYPES as readonly string[]).includes(type) ? `type-${type}` : 'type-unknown';
	}

	/** A cella tooltipje: mindenki, aki távol van, a típussal (ha látható). */
	function cellTitle(iso: string): string {
		const lines: string[] = [];
		for (const d of dayMap.get(iso) ?? []) {
			lines.push(d.leaveType ? `${d.employeeName} – ${typeLabel(d.leaveType)}` : d.employeeName);
		}
		for (const d of pendingMap.get(iso) ?? []) {
			lines.push(
				`${d.employeeName} – ${d.leaveType ? typeLabel(d.leaveType) + ', ' : ''}${t('leaveCalendar.pending')}`
			);
		}
		return lines.join('\n');
	}
</script>

<svelte:window onpointerdown={onWindowPointerDown} onkeydown={onWindowKeydown} />

<div class="leave-calendar" bind:this={rootEl}>
	<div class="toolbar">
		<div class="toolbar-group">
			<div class="month-nav">
				<button class="btn-secondary" onclick={prevMonth} aria-label={t('leaveCalendar.prev')}>‹</button>
				<span class="month-label">
					{view === 'year' ? `${year}.` : `${year}. ${t(`workCalendar.month.${month}`)}`}
				</span>
				<button class="btn-secondary" onclick={nextMonth} aria-label={t('leaveCalendar.next')}>›</button>
				<button class="btn-secondary" onclick={goToday}>{t('leaveCalendar.today')}</button>
			</div>

			<div class="view-toggle" role="group">
				<button class="chip-btn" class:active={view === 'month'} onclick={() => setView('month')}>
					{t('leaveCalendar.view.month')}
				</button>
				<button class="chip-btn" class:active={view === 'year'} onclick={() => setView('year')}>
					{t('leaveCalendar.view.year')}
				</button>
				{#if !lockEmployee}
					<button class="chip-btn" class:active={view === 'team'} onclick={() => setView('team')}>
						{t('leaveCalendar.view.team')}
					</button>
				{/if}
			</div>
		</div>

		<div class="toolbar-group">
			<!-- Dolgozót csak a jóváhagyó választ; a dolgozó mindenkit lát, vagy kérelmező módban a sajátját -->
			{#if canManage && !requestMode}
				<label class="filter">
					<span>{t('leaveCalendar.filter.label')}</span>
					<select
						class="form-input"
						value={selectedEmployeeId === null ? '' : String(selectedEmployeeId)}
						onchange={onEmployeeChange}
					>
						<option value="">{t('leaveCalendar.filter.all')}</option>
						{#each employees as emp (emp.id)}
							<option value={String(emp.id)}>{emp.userName}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if canRequest}
				<label class="filter">
					<span>{t('leaveCalendar.requestType')}</span>
					<select class="form-input" bind:value={requestType} disabled={saving}>
						{#each REQUEST_CALENDAR_LEAVE_TYPES as type (type)}
							<option value={type}>{t(`leaveRequests.type.${type}`)}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if editable}
				<label class="filter">
					<span>{t('leaveCalendar.addType')}</span>
					<select class="form-input" bind:value={addType} disabled={toAdd.size > 0 && saving}>
						{#each CALENDAR_LEAVE_TYPES as type (type)}
							<option value={type}>{t(`leaveRequests.type.${type}`)}</option>
						{/each}
					</select>
				</label>
			{/if}

			{#if canEnterRequestMode}
				{#if requestMode}
					<button class="btn-secondary" onclick={exitRequestMode}>{t('leaveCalendar.backToOverview')}</button>
				{:else}
					<button class="btn-primary" onclick={enterRequestMode}>+ {t('leaveCalendar.newLeave')}</button>
				{/if}
			{/if}
		</div>
	</div>

	{#if canManage && !lockEmployee && ownSelected}
		<p class="own-leave-hint">{t('leaveCalendar.ownLeaveHint')}</p>
	{/if}

	{#if (editable || canRequest) && needsChild}
		<div class="child-row">
			<label class="filter">
				<span>{t('leaveCalendar.child')}</span>
				<select class="form-input" bind:value={childId} disabled={saving}>
					<option value={null}>{t('leaveCalendar.childSelect')}</option>
					{#each childOptions as child (child.childId)}
						<option value={child.childId}>
							{childLabel(child)} · {t('leaveCalendar.childRemaining', { days: child.remainingDays })}
						</option>
					{/each}
				</select>
			</label>
			{#if allowances && childOptions.length === 0}
				<span class="hint">{t('leaveCalendar.noChild')}</span>
			{/if}
		</div>
	{/if}

	{#if editable}
		<p class="hint">
			{view === 'team' ? t('leaveCalendar.team.readOnly') : t('leaveCalendar.editHint')}
			{#if data?.closedYear !== null && data?.closedYear !== undefined}
				{t('leaveCalendar.closedHint', { year: data.closedYear })}
			{/if}
			{unopenedHint}
		</p>
	{:else if canRequest}
		<div class="guide">
			<strong class="guide-title">{t('leaveCalendar.guide.title')}</strong>
			<ol class="guide-steps">
				<li>{t('leaveCalendar.guide.step1')}</li>
				<li>{t('leaveCalendar.guide.step2')}</li>
				<li>{t('leaveCalendar.guide.step3')}</li>
				<li>{t('leaveCalendar.guide.step4')}</li>
			</ol>
			<p class="guide-note">
				{t('leaveCalendar.withdrawHint')}
				{t('leaveCalendar.guide.childNote')}
				{#if data?.closedYear !== null && data?.closedYear !== undefined}
					{t('leaveCalendar.closedHint', { year: data.closedYear })}
				{/if}
				{unopenedHint}
			</p>
		</div>
	{:else}
		<p class="hint">
			{t('leaveCalendar.detailsHint')}
			{#if canEnterRequestMode}
				{t('leaveCalendar.overviewHint')}
			{/if}
		</p>
	{/if}

	<div class="legend">
		<!-- A jóváhagyó és a saját nézetben a dolgozó a típust látja, a kolléga csak azt, hogy távol van -->
		{#if canManage || lockEmployee}
			{#each LEAVE_TYPES as type (type)}
				<span class="chip type-{type}">{t(`leaveRequests.type.${type}`)}</span>
			{/each}
		{:else}
			<span class="chip type-unknown">{t('leaveCalendar.legend.approved')}</span>
		{/if}
		<span class="chip is-pending">{t('leaveCalendar.legend.pending')}</span>
		<span class="chip is-off">{t('leaveCalendar.legend.nonWorking')}</span>
		{#if editable}
			<span class="chip mark-add">{t('leaveCalendar.legend.toAdd')}</span>
			<span class="chip mark-remove">{t('leaveCalendar.legend.toRemove')}</span>
		{:else if canRequest}
			<span class="chip mark-add">{t('leaveCalendar.legend.toRequest')}</span>
		{/if}
	</div>

	{#if error}
		<div class="error-banner">{error}</div>
	{/if}

	{#if view === 'month'}
	<div class="calendar" class:is-loading={loading}>
		<div class="weekdays">
			{#each [0, 1, 2, 3, 4, 5, 6] as wd (wd)}
				<span>{t(`workCalendar.weekdayShort.${wd}`)}</span>
			{/each}
		</div>
		<div class="grid">
			{#each cells as iso, i (i)}
				{#if iso === null}
					<div class="cell empty"></div>
				{:else}
					{@const approved = dayMap.get(iso) ?? []}
					{@const pending = pendingMap.get(iso) ?? []}
					{@const shown = approved.slice(0, MAX_NAMES)}
					{@const extra = approved.length - shown.length}
					{@const clickable = isClickable(iso)}
					<!-- A szerep és a tabindex csak kattintható cellán van; a statikus ellenőrző ezt nem látja -->
					<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
					<div
						class="cell"
						class:is-off={!isWorkingDay(iso)}
						class:is-today={iso === today}
						class:is-clickable={clickable}
						class:is-to-add={toAdd.has(iso)}
						class:is-to-remove={toRemove.has(iso)}
						class:is-selected={iso === detailsDay}
						title={cellTitle(iso)}
						role={clickable ? 'button' : undefined}
						tabindex={clickable ? 0 : undefined}
						onclick={(e) => toggleDay(iso, e.currentTarget)}
						onkeydown={(e) => {
							if (clickable && (e.key === 'Enter' || e.key === ' ')) {
								e.preventDefault();
								toggleDay(iso, e.currentTarget);
							}
						}}
					>
						<span class="day-number">{Number(iso.slice(8, 10))}</span>
						{#if filterEmployeeId}
							{#each approved as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark {typeClass(d.leaveType)}" class:mark-remove={toRemove.has(iso)}>
									{typeLabel(d.leaveType)}
								</span>
							{/each}
							{#each pending as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark is-pending">{t('leaveCalendar.pending')}</span>
							{/each}
							{#if toAdd.has(iso)}
								<span class="mark mark-add">{t(`leaveRequests.type.${activeType}`)}</span>
							{/if}
						{:else}
							{#each shown as d (d.leaveRequestId + ':' + d.day)}
								<span class="mark {typeClass(d.leaveType)}">{d.employeeName}</span>
							{/each}
							{#if extra > 0}
								<span class="mark more">+{extra}</span>
							{/if}
							{#if pending.length > 0}
								<span class="mark is-pending">
									{pending.length === 1 ? pending[0].employeeName : `${pending.length} ${t('leaveCalendar.pending')}`}
								</span>
							{/if}
						{/if}
					</div>
				{/if}
			{/each}
		</div>
	</div>
	{:else if view === 'year'}
	<div class="calendar year-months" class:is-loading={loading}>
		{#each MONTHS as m (m)}
			<div class="year-month">
				<h4>{t(`workCalendar.month.${m}`)}</h4>
				<div class="mini-weekdays">
					{#each [0, 1, 2, 3, 4, 5, 6] as wd (wd)}
						<span>{t(`workCalendar.weekdayShort.${wd}`)}</span>
					{/each}
				</div>
				<div class="mini-grid">
					{#each monthGrid(year, m) as iso, i (i)}
						{#if iso === null}
							<span class="mini empty"></span>
						{:else}
							{@const approved = dayMap.get(iso) ?? []}
							{@const pending = pendingMap.get(iso) ?? []}
							{@const clickable = isClickable(iso)}
							<!-- svelte-ignore a11y_no_noninteractive_tabindex -->
							<div
								class="mini {filterEmployeeId && approved.length > 0 ? typeClass(approved[0].leaveType) : ''}"
								class:is-off={!isWorkingDay(iso)}
								class:is-today={iso === today}
								class:is-clickable={clickable}
								class:is-to-add={toAdd.has(iso)}
								class:is-to-remove={toRemove.has(iso)}
								class:is-selected={iso === detailsDay}
								class:has-pending={pending.length > 0 && approved.length === 0}
								class:has-count={!filterEmployeeId && approved.length > 0}
								title={cellTitle(iso)}
								role={clickable ? 'button' : undefined}
								tabindex={clickable ? 0 : undefined}
								onclick={(e) => toggleDay(iso, e.currentTarget)}
								onkeydown={(e) => {
									if (clickable && (e.key === 'Enter' || e.key === ' ')) {
										e.preventDefault();
										toggleDay(iso, e.currentTarget);
									}
								}}
							>
								{Number(iso.slice(8, 10))}
								{#if !filterEmployeeId && approved.length > 0}
									<span class="count">{approved.length}</span>
								{/if}
							</div>
						{/if}
					{/each}
				</div>
			</div>
		{/each}
	</div>
	{:else}
	<div class="calendar team-scroll" class:is-loading={loading}>
		<table class="team">
			<thead>
				<tr>
					<th class="team-name">{t('leaveCalendar.team.employee')}</th>
					{#each monthDays as iso (iso)}
						<th class:is-off={!isWorkingDay(iso)} class:is-today={iso === today}>
							<span>{Number(iso.slice(8, 10))}</span>
							<small>{t(`workCalendar.weekdayShort.${weekdayIndex(iso)}`)}</small>
						</th>
					{/each}
					<th class="team-total">{t('leaveCalendar.team.total')}</th>
				</tr>
			</thead>
			<tbody>
				{#each teamRows as row (row.id)}
					<tr>
						<td class="team-name">
							{row.name}
							{#if showMonthConfirmation}
								{@const marker = confirmationMarker(row.id)}
								{#if marker}
									<span class="mc-marker {marker.cls}" title={marker.label} aria-label={marker.label}>{marker.symbol}</span>
								{/if}
							{/if}
						</td>
						{#each monthDays as iso (iso)}
							{@const d = teamMap.get(`${row.id}:${iso}`)}
							{@const p = pendingTeamMap.get(`${row.id}:${iso}`)}
							<td
								class="team-cell {d ? typeClass(d.leaveType) : ''}"
								class:is-off={!isWorkingDay(iso)}
								class:is-today={iso === today}
								class:is-pending={!!p && !d}
								title={d
									? `${row.name} – ${typeLabel(d.leaveType)}`
									: p
										? `${row.name} – ${t('leaveCalendar.pending')}`
										: ''}
							></td>
						{/each}
						<td class="team-total">{teamTotal(row.id) || ''}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</div>
	{/if}

	{#if showMonthConfirmation}
		<MonthConfirmationPanel
			{pluginId}
			{organizationId}
			{year}
			month={month + 1}
			employeeId={filterEmployeeId}
			period={summaryPeriod}
			overview={monthConfirmations}
			loadError={monthConfirmationError}
			onChanged={() => monthConfirmationKey++}
			onOpenEmployee={openEmployeeFromConfirmation}
		/>
	{/if}

	{#if showSummary && data}
		<LeaveSummaryTable
			{pluginId}
			employees={teamRows}
			days={data.days}
			pending={data.pending}
			allowances={yearAllowances}
			showBalance={view === 'year'}
			period={summaryPeriod}
			fileName={summaryFileName}
		/>
	{/if}

	{#if detailsDay && detailsAnchor && detailsApproved.length + detailsPending.length > 0}
		<div
			class="details-popup"
			style={popupStyle}
			role="dialog"
			aria-label={formatDayLong(detailsDay)}
			bind:offsetWidth={popupWidth}
		>
			<div class="details-head">
				<strong>{formatDayLong(detailsDay)}</strong>
				<button class="details-close" onclick={closeDetails} aria-label={t('leaveCalendar.details.close')}>×</button>
			</div>
			<ul class="details-list">
				{#each detailsApproved as d (d.leaveRequestId + ':' + d.employeeId)}
					<li>
						<span class="mark {typeClass(d.leaveType)}">{typeLabel(d.leaveType)}</span>
						<span class="details-name">{d.employeeName}</span>
					</li>
				{/each}
				{#each detailsPending as d (d.leaveRequestId + ':' + d.employeeId)}
					<li>
						<span class="mark is-pending">{t('leaveCalendar.pending')}</span>
						<span class="details-name">{d.employeeName}{d.leaveType ? ` – ${typeLabel(d.leaveType)}` : ''}</span>
						{#if ownEmployeeId && d.employeeId === ownEmployeeId}
							<button class="link-btn" onclick={() => withdrawRequest(d.leaveRequestId)} disabled={withdrawing}>
								{t('leaveRequests.withdraw')}
							</button>
						{/if}
					</li>
				{/each}
			</ul>
		</div>
	{/if}

	{#if !loading && data && !hasAnyLeave && !hasChanges}
		<p class="empty-state">{t('leaveCalendar.empty')}</p>
	{/if}

	{#if (editable || canRequest) && hasChanges}
		<div class="summary" class:is-loading={planLoading}>
			<div class="summary-text">
				{#if toAdd.size > 0}
					<span>
						{t(canRequest ? 'leaveCalendar.summary.request' : 'leaveCalendar.summary.add', {
							days: addedDays,
							requests: plan?.runs.length ?? '…'
						})}
					</span>
				{/if}
				{#if toRemove.size > 0}
					<span>{t('leaveCalendar.summary.remove', { days: toRemove.size })}</span>
				{/if}
				{#each plan?.balances ?? [] as b (b.year)}
					<span class:is-negative={b.remainingAfter < 0}>
						{b.hasBalance
							? t('leaveCalendar.summary.balance', {
									year: b.year,
									before: b.remainingBefore,
									after: b.remainingAfter
								})
							: t('leaveCalendar.summary.noBalance', { year: b.year })}
					</span>
				{/each}
				{#each plan?.errors ?? [] as message (message)}
					<span class="is-error">{message}</span>
				{/each}
			</div>
			<div class="summary-actions">
				<input
					class="form-input reason-input"
					type="text"
					maxlength="500"
					placeholder={t('leaveCalendar.reason')}
					bind:value={reason}
					disabled={saving}
				/>
				<button class="btn-secondary" onclick={clearChanges} disabled={saving}>
					{t('leaveCalendar.discard')}
				</button>
				<button
					class="btn-primary"
					onclick={canRequest ? submitRequests : save}
					disabled={saving || planLoading || (plan?.errors.length ?? 0) > 0}
				>
					{saving ? t('loading') : canRequest ? t('leaveCalendar.submit') : t('leaveCalendar.save')}
				</button>
			</div>
		</div>
	{/if}
</div>

<style>
	.leave-calendar {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
		/* A csapatnézet széles táblázata a saját dobozában görgessen, ne az oldal */
		min-width: 0;
		max-width: 100%;
	}

	.toolbar {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
	}

	.toolbar-group {
		display: flex;
		align-items: center;
		gap: 1rem;
		flex-wrap: wrap;
	}

	/* Keskeny helyen új sorba tördel, de ott is jobbra marad */
	.toolbar-group:last-child {
		margin-left: auto;
		justify-content: flex-end;
	}

	.month-nav {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.month-label {
		font-size: 1.05rem;
		font-weight: 600;
		min-width: 11rem;
		text-align: center;
	}

	.btn-secondary {
		padding: 0.3rem 0.7rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		background: var(--color-background, #fff);
		color: inherit;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.btn-secondary:hover {
		border-color: var(--color-primary, #3730a3);
	}

	.filter {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.875rem;
	}

	.form-input {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.375rem;
		padding: 0.35rem 2rem 0.35rem 0.75rem;
		font-size: 0.875rem;
		background: var(--color-background, #fff);
		color: var(--color-foreground, #0f172a);
		min-width: 14rem;
		appearance: none;
		-webkit-appearance: none;
		cursor: pointer;
		background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E");
		background-repeat: no-repeat;
		background-position: right 0.6rem center;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		gap: 0.4rem;
	}

	.chip {
		font-size: 0.72rem;
		padding: 0.12rem 0.5rem;
		border-radius: 999px;
		border: 1px solid transparent;
	}

	.calendar {
		transition: opacity 0.15s;
	}

	.view-toggle {
		display: flex;
		gap: 0.25rem;
	}

	.chip-btn {
		font-size: 0.8rem;
		padding: 0.25rem 0.7rem;
		border-radius: 999px;
		border: 1px solid var(--color-border, #e2e8f0);
		background: transparent;
		color: inherit;
		cursor: pointer;
	}

	.chip-btn.active {
		background: var(--color-primary, #3730a3);
		border-color: var(--color-primary, #3730a3);
		color: #fff;
	}

	/* Éves nézet */
	.year-months {
		display: grid;
		grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
		gap: 1rem;
	}

	.year-month h4 {
		margin: 0 0 0.35rem;
		font-size: 0.9rem;
	}

	.mini-weekdays,
	.mini-grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 2px;
	}

	.mini-weekdays span {
		text-align: center;
		font-size: 0.65rem;
		color: var(--muted-foreground, #71717a);
	}

	.mini {
		aspect-ratio: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		font-size: 0.72rem;
		border: 1px solid transparent;
		border-radius: 4px;
		position: relative;
	}

	.mini.empty {
		border: none;
	}

	.mini.is-off {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.mini.is-today {
		box-shadow: inset 0 0 0 2px var(--color-primary, #3730a3);
	}

	.mini.is-clickable {
		cursor: pointer;
	}

	.mini.is-clickable:hover {
		border-color: var(--color-primary, #3730a3);
	}

	.mini.is-to-add {
		border: 2px dashed #16a34a;
	}

	.mini.is-to-remove {
		border: 2px dashed #dc2626;
		text-decoration: line-through;
	}

	.mini.has-pending {
		border: 1px dashed var(--muted-foreground, #a1a1aa);
	}

	.mini.has-count {
		background: #dbeafe;
		color: #1e40af;
	}

	.mini .count {
		position: absolute;
		top: -3px;
		right: -3px;
		min-width: 0.9rem;
		height: 0.9rem;
		padding: 0 2px;
		border-radius: 999px;
		background: var(--color-primary, #3730a3);
		color: #fff;
		font-size: 0.55rem;
		font-weight: 600;
		line-height: 0.9rem;
		text-align: center;
	}

	/* Csapatnézet */
	.team-scroll {
		overflow-x: auto;
		max-width: 100%;
	}

	/* Havi ellenőrzés állapotjele a dolgozó neve mellett */
	.mc-marker {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		min-width: 1.05rem;
		height: 1.05rem;
		margin-left: 0.3rem;
		padding: 0 0.2rem;
		border-radius: 9999px;
		font-size: 0.65rem;
		font-weight: 700;
		line-height: 1;
		vertical-align: middle;
		cursor: help;
	}

	.mc-accepted {
		background: #dcfce7;
		color: #166534;
	}

	.mc-closed {
		background: #e2e8f0;
		color: #334155;
	}

	.mc-pending {
		background: #fef3c7;
		color: #92400e;
	}

	.mc-disputed {
		background: #fee2e2;
		color: #991b1b;
	}

	.mc-stale {
		background: #dbeafe;
		color: #1e40af;
	}

	.mc-none {
		color: var(--color-muted-foreground, #94a3b8);
	}

	.team {
		border-collapse: separate;
		border-spacing: 2px;
		font-size: 0.75rem;
		min-width: 100%;
	}

	.team th {
		font-weight: 500;
		color: var(--muted-foreground, #71717a);
		text-align: center;
		padding: 0.15rem 0;
		min-width: 1.6rem;
	}

	.team th span {
		display: block;
		font-weight: 600;
		color: inherit;
	}

	.team th small {
		font-size: 0.6rem;
	}

	.team th.is-today span {
		color: var(--color-primary, #3730a3);
	}

	.team .team-name {
		position: sticky;
		left: 0;
		z-index: 1;
		text-align: left;
		white-space: nowrap;
		padding: 0.2rem 0.75rem;
		background: var(--color-background, #fff);
		font-weight: 500;
		color: inherit;
	}

	.team .team-total {
		text-align: right;
		padding: 0 0.4rem;
		font-weight: 600;
		min-width: 2.5rem;
	}

	.team-cell {
		height: 1.6rem;
		border-radius: 3px;
		background: var(--color-background, #fff);
		border: 1px solid var(--color-border, #e2e8f0);
	}

	.team-cell.is-off {
		background: var(--muted, #f4f4f5);
		border-color: transparent;
	}

	.team-cell.is-today {
		box-shadow: inset 0 0 0 2px var(--color-primary, #3730a3);
	}

	.team-cell.is-pending {
		border: 1px dashed var(--muted-foreground, #a1a1aa);
	}

	:global(.dark) .team .team-name,
	:global(.dark) .team-cell {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .mini.is-off,
	:global(.dark) .team-cell.is-off {
		background: oklch(1 0 0 / 6%);
	}

	.calendar.is-loading {
		opacity: 0.5;
	}

	.weekdays,
	.grid {
		display: grid;
		grid-template-columns: repeat(7, 1fr);
		gap: 3px;
	}

	.weekdays span {
		text-align: center;
		font-size: 0.72rem;
		color: var(--muted-foreground, #71717a);
		padding-bottom: 0.25rem;
	}

	.cell {
		min-height: 5.5rem;
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 0.3rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 6px;
		background: var(--color-background, #fff);
		font-size: 0.75rem;
		overflow: hidden;
	}

	.cell.empty {
		border-color: transparent;
		background: transparent;
	}

	.cell.is-off {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.cell.is-today .day-number {
		background: var(--color-primary, #3730a3);
		color: #fff;
	}

	.day-number {
		align-self: flex-start;
		font-weight: 600;
		font-size: 0.75rem;
		padding: 0.05rem 0.35rem;
		border-radius: 999px;
	}

	.mark {
		display: block;
		padding: 0.1rem 0.35rem;
		border-radius: 4px;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		font-size: 0.7rem;
		line-height: 1.3;
	}

	.mark.more {
		color: var(--muted-foreground, #71717a);
		font-weight: 500;
	}

	.type-annual { background: #dcfce7; color: #166534; }
	.type-company_mandatory { background: #ccfbf1; color: #115e59; }
	.type-sick { background: #fee2e2; color: #991b1b; }
	.type-paternity,
	.type-parental { background: #ede9fe; color: #5b21b6; }
	.type-unpaid { background: #ffedd5; color: #9a3412; }
	.type-other { background: #e4e4e7; color: #3f3f46; }
	.type-unknown { background: #dbeafe; color: #1e40af; }

	.is-pending {
		background: transparent;
		border: 1px dashed var(--muted-foreground, #a1a1aa);
		color: var(--muted-foreground, #71717a);
	}

	.chip.is-off {
		background: var(--muted, #f4f4f5);
		color: var(--muted-foreground, #71717a);
	}

	.cell.is-selected,
	.mini.is-selected {
		box-shadow: 0 0 0 2px var(--color-primary, #3730a3);
	}

	.details-popup {
		position: absolute;
		z-index: 30;
		display: flex;
		flex-direction: column;
		gap: 0.5rem;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-background, #fff);
		box-shadow: 0 8px 24px rgb(0 0 0 / 14%);
		font-size: 0.875rem;
		/* A tartalomhoz nő (név, típus, visszavonás egy sorban), a naptárnál nem szélesebb */
		width: max-content;
		min-width: 18rem;
		max-width: min(32rem, 100%);
		box-sizing: border-box;
	}

	.link-btn {
		justify-self: end;
		white-space: nowrap;
		border: none;
		background: transparent;
		color: #991b1b;
		font-size: 0.8rem;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.link-btn:hover {
		text-decoration: underline;
	}

	.details-close {
		border: none;
		background: transparent;
		color: var(--muted-foreground, #71717a);
		font-size: 1.1rem;
		line-height: 1;
		cursor: pointer;
		padding: 0 0.2rem;
	}

	.details-close:hover {
		color: inherit;
	}

	.details-head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	/* Közös oszlopok minden sorra: jelölés, név, művelet */
	.details-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: grid;
		grid-template-columns: auto 1fr auto;
		align-items: center;
		gap: 0.35rem 0.75rem;
	}

	.details-list li {
		display: contents;
	}

	.details-list .mark {
		grid-column: 1;
		min-width: 7rem;
		text-align: center;
	}

	.details-name {
		grid-column: 2;
	}

	.details-list .link-btn {
		grid-column: 3;
	}

	:global(.dark) .details-popup {
		background: var(--color-card, oklch(0.2 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	.guide {
		display: flex;
		flex-direction: column;
		gap: 0.4rem;
		padding: 0.9rem 1.1rem;
		border-radius: 0.5rem;
		border: 1px solid #bfdbfe;
		background: #eff6ff;
		color: #1e3a8a;
		font-size: 0.9rem;
	}

	.guide-title {
		font-size: 1rem;
	}

	.guide-steps {
		margin: 0;
		padding-left: 1.4rem;
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.guide-note {
		margin: 0.2rem 0 0;
		font-size: 0.8rem;
		color: #1e40af;
	}

	:global(.dark) .guide {
		background: oklch(0.25 0.05 260);
		border-color: oklch(0.35 0.08 260);
		color: #dbeafe;
	}

	:global(.dark) .guide-note {
		color: #bfdbfe;
	}

	.hint {
		margin: 0;
		font-size: 0.8rem;
		color: var(--muted-foreground, #71717a);
	}

	.cell.is-clickable {
		cursor: pointer;
	}

	.cell.is-clickable:hover {
		border-color: var(--color-primary, #3730a3);
	}

	.cell.is-to-add {
		border: 2px dashed #16a34a;
	}

	.cell.is-to-remove {
		border: 2px dashed #dc2626;
	}

	.mark.mark-add {
		background: transparent;
		border: 1px dashed #16a34a;
		color: #166534;
	}

	.mark.mark-remove {
		text-decoration: line-through;
		opacity: 0.6;
	}

	.chip.mark-add {
		border: 1px dashed #16a34a;
		color: #166534;
	}

	.chip.mark-remove {
		border: 1px dashed #dc2626;
		color: #991b1b;
		text-decoration: line-through;
	}

	.summary {
		position: sticky;
		bottom: 0.5rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		flex-wrap: wrap;
		padding: 0.75rem 1rem;
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.5rem;
		background: var(--color-background, #fff);
		box-shadow: 0 4px 16px rgb(0 0 0 / 8%);
		font-size: 0.875rem;
		transition: opacity 0.15s;
	}

	.summary.is-loading {
		opacity: 0.7;
	}

	.summary-text {
		display: flex;
		flex-direction: column;
		gap: 0.2rem;
	}

	.summary-text .is-negative,
	.summary-text .is-error {
		color: #991b1b;
	}

	.summary-actions {
		display: flex;
		gap: 0.5rem;
		align-items: center;
		flex-wrap: wrap;
	}

	.reason-input {
		min-width: 16rem;
		cursor: text;
		background-image: none;
		padding-right: 0.75rem;
	}

	.own-leave-hint {
		margin: 0 0 0.75rem;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.child-row {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		flex-wrap: wrap;
	}

	.btn-primary {
		padding: 0.3rem 0.9rem;
		border: 1px solid var(--color-primary, #3730a3);
		border-radius: 0.375rem;
		background: var(--color-primary, #3730a3);
		color: #fff;
		cursor: pointer;
		font-size: 0.875rem;
	}

	.btn-primary:disabled,
	.btn-secondary:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}

	:global(.dark) .summary {
		background: var(--color-card, oklch(0.2 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	.empty-state {
		font-size: 0.875rem;
		color: var(--muted-foreground, #71717a);
		margin: 0;
	}

	.error-banner {
		padding: 0.6rem 0.9rem;
		border-radius: 0.375rem;
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.875rem;
	}

	:global(.dark) .cell,
	:global(.dark) .btn-secondary,
	:global(.dark) .form-input {
		background: var(--color-input, oklch(1 0 0 / 15%));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .cell.is-off {
		background: oklch(1 0 0 / 6%);
	}
</style>
