/**
 * ProjectDetail — a fülek között megosztott kliens-oldali típusok.
 * (A szerver oldali típusok a `server/functions.ts`-ből jönnek.)
 */

/** Szervezet-szintű szerep a jogosultság-mátrixhoz. */
export interface RoleRow {
	id: number;
	organizationId: number;
	key: string;
	name: string;
	description: string | null;
	isSystem: boolean;
	capabilities: string[];
	memberCount: number;
}

/** Projekt-szintű szerep-felülbírálás egy felhasználóra. */
export interface OverrideRow {
	userId: number;
	userName: string;
	userEmail: string;
	userImage: string | null;
	roles: Array<{ id: number; key: string; name: string; isSystem: boolean }>;
}
