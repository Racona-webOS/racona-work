/**
 * Kiküldetések — mit ajánlhat fel a felület, a szerver jogosultsági szabályai
 * szerint (server/trip-access.ts, trips.ts, trip-settlements.ts). Csak a gombok
 * láthatóságáról dönt; a szerver ettől függetlenül ellenőriz.
 */

export interface TripPerms {
	canApprove: boolean;
	canManage: boolean;
	/** A hívó dolgozói azonosítója a szervezetben, vagy null. */
	employeeId: number | null;
}

/** Az út rögzítése, módosítása, másolása, törlése: a saját út, vagy bárkié „Kiküldetések kezelése” joggal. */
export function canWriteTripsOf(perms: TripPerms, employeeId: number): boolean {
	return employeeId === perms.employeeId || perms.canManage;
}
