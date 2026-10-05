/**
 * OrganizationStore - Szervezet kontextus kezelése Svelte 5 runes-szal
 * Követelmények: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import type { Organization } from '../../server/functions.js';
import { translate } from '../utils/sdk.js';

const STORAGE_KEY = 'racona-work:last-organization-id';

export class OrganizationStore {
	currentOrganization = $state<Organization | null>(null);
	availableOrganizations = $state<Organization[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	isAdmin = $state(false); // Admin jogosultság

	// Szervezet-szintű képességek (getMyCapabilities). Szervezet váltáskor frissül.
	capabilities = $state<Set<string>>(new Set());
	/** A hívó külsős dolgozó a jelenlegi szervezetben: csak a projektekben vesz részt. */
	isExternal = $state(false);

	// Derived state
	hasMultipleOrganizations = $derived(this.availableOrganizations.length > 1);
	// Admin userek mindig hozzáférnek, függetlenül a szervezetek számától
	hasAccess = $derived(this.isAdmin || this.availableOrganizations.length > 0);

	private sdk: any = null;
	private pluginId: string = '';
	private isRevalidating = false;

	/**
	 * Store inicializálása az SDK-val.
	 * Újranyitáskor is meg kell hívni: a core minden megnyitáskor új SDK példányt
	 * hoz létre, a régi (bezárt ablakhoz tartozó) példány UI handlerei már nem élnek.
	 */
	init(pluginId: string, sdk: any) {
		this.pluginId = pluginId;
		this.sdk = sdk;
	}

	/**
	 * Képesség-ellenőrzés a jelenlegi szervezet kontextusában.
	 * Core admin és dev mód minden képességgel rendelkezik (a szerver küldi így).
	 */
	can(capability: string): boolean {
		return this.capabilities.has(capability);
	}

	/**
	 * Képességek lekérése az aktuális szervezetre. A szerver oldali getMyCapabilities
	 * visszaadja a core admin / dev mód jelzést is.
	 *
	 * Publikus: a komponensek is meghívhatják, ha úgy érzik, a halmaz régi
	 * (pl. komponens mount-kor, de az init async befejeződése előtt).
	 */
	async refreshCapabilities(organizationId: number): Promise<void> {
		if (!this.sdk?.remote || !organizationId) {
			this.capabilities = new Set();
			this.publishCapabilities();
			return;
		}
		try {
			this.capabilities = await this.fetchCapabilities(organizationId);
		} catch (err) {
			console.warn('[OrganizationStore] Képességek lekérése sikertelen:', err);
			this.capabilities = new Set();
		}
		this.publishCapabilities();
	}

	/** getMyCapabilities hívás; hiba esetén dob (a hívó dönti el, mi legyen). */
	private async fetchCapabilities(organizationId: number): Promise<Set<string>> {
		const result = await this.sdk.remote.call('getMyCapabilities', { organizationId });
		this.isExternal = result?.isExternal === true;
		const list: string[] = Array.isArray(result?.capabilities) ? result.capabilities : [];
		return new Set(list);
	}

	/**
	 * Csendes háttér-frissítés: újra lekéri az admin jelzőt, a szervezeteket és a
	 * képességeket, és csak akkor ír a store-ba, ha valami ténylegesen változott.
	 *
	 * Miért kell: a store a window-on él, ezért az app bezárása/újranyitása után is
	 * megmarad, így egy admin által közben kiosztott (vagy elvett) jogosultság csak
	 * teljes oldal-újratöltés után látszott volna. Változáskor `organization-changed`
	 * eseményt küld, erre minden komponens már most is újraszinkronizál.
	 *
	 * Nem állít isLoading-ot és nem toastol — hiba esetén a meglévő állapot marad.
	 * @returns true, ha változás volt
	 */
	async revalidate(): Promise<boolean> {
		if (!this.sdk?.remote || this.isLoading || this.isRevalidating) return false;
		this.isRevalidating = true;
		try {
			let isAdmin = false;
			try {
				isAdmin = (await this.sdk.remote.call('isUserAdmin', {})) === true;
			} catch {
				// Ugyanaz a fallback, mint a loadOrganizations-ben
			}
			const orgs = (await this.sdk.remote.call('getUserOrganizations', {})) as Organization[];
			const current =
				orgs.find((o) => o.id === this.currentOrganization?.id) ?? orgs[0] ?? null;
			const caps = current ? await this.fetchCapabilities(current.id) : new Set<string>();

			const changed =
				isAdmin !== this.isAdmin ||
				current?.id !== this.currentOrganization?.id ||
				!sameOrganizations(orgs, this.availableOrganizations) ||
				!sameSet(caps, this.capabilities);
			if (!changed) return false;

			this.isAdmin = isAdmin;
			this.availableOrganizations = orgs;
			this.currentOrganization = current;
			this.capabilities = caps;
			if (current) this.saveLastOrganizationId(current.id);

			this.publishCapabilities();
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('organization-changed', {
						detail: { organizationId: current?.id ?? null, organization: current }
					})
				);
			}
			return true;
		} catch (err) {
			console.warn('[OrganizationStore] Háttér-frissítés sikertelen:', err);
			return false;
		} finally {
			this.isRevalidating = false;
		}
	}

	/**
	 * Csak akkor tölt capability-t, ha még nem volt betöltve (üres halmaz).
	 * Biztonságos `onMount`-ban hívni.
	 */
	async ensureCapabilities(organizationId: number): Promise<void> {
		if (this.capabilities.size === 0 && organizationId) {
			await this.refreshCapabilities(organizationId);
		}
	}

	/**
	 * A jelenlegi capability halmaz publikálása a core felé (menü szűréshez).
	 * A core PluginLayoutWrapper figyeli ezt az eseményt.
	 *
	 * Publikus: hogy ha újranyitáskor a singleton store már be van töltve és
	 * nem fut újra a refreshCapabilities, akkor is fel lehessen tölteni a core
	 * oldalt (lásd OrganizationSwitcher.onMount).
	 */
	publishCapabilities(): void {
		if (typeof window === 'undefined' || !this.pluginId) return;
		try {
			window.dispatchEvent(
				new CustomEvent('plugin-capabilities-changed', {
					detail: {
						pluginId: this.pluginId,
						capabilities: [...this.capabilities]
					}
				})
			);
		} catch (err) {
			console.warn('[OrganizationStore] Capabilities event kiküldése sikertelen:', err);
		}
	}

	/**
	 * Szervezetek betöltése és az utoljára használt szervezet beállítása
	 * Követelmények: 2.1, 2.2, 2.3, 2.4, 11.1, 11.2, 11.3, 11.4, 11.5, 15.1, 15.2, 19.1, 19.2
	 */
	async loadOrganizations(): Promise<void> {
		if (!this.sdk?.remote) {
			this.error = this.t('error.sdkUnavailable');
			console.error('[OrganizationStore] SDK nem elérhető');
			return;
		}

		this.isLoading = true;
		this.error = null;

		try {
			// Először ellenőrizzük, hogy a user admin-e
			try {
				const adminResult = await this.sdk.remote.call('isUserAdmin', {});
				this.isAdmin = adminResult === true;
			} catch {
				// Ha hiba (pl. régi plugin verzió), fallback: nem admin
				this.isAdmin = false;
			}

			// Használjuk a getUserOrganizations-t, amely csak azokat a szervezeteket adja vissza,
			// amelyeknek a felhasználó tagja (Követelmények: 2.1, 2.2)
			const result = await this.sdk.remote.call('getUserOrganizations', {});
			this.availableOrganizations = result as Organization[];

			// Ha nincs elérhető szervezet és nem admin, nincs hozzáférés (Követelmény: 2.3)
			if (this.availableOrganizations.length === 0 && !this.isAdmin) {
				this.currentOrganization = null;
				return;
			}

			// Ha admin és nincs szervezet, akkor is engedélyezzük a hozzáférést
			// de nincs aktuális szervezet
			if (this.availableOrganizations.length === 0 && this.isAdmin) {
				this.currentOrganization = null;
				return;
			}

			// Próbáljuk meg betölteni az utoljára használt szervezetet (Követelmény: 11.3)
			const lastOrgId = this.getLastOrganizationId();

			// Validáljuk, hogy az utoljára használt szervezet még mindig elérhető-e (Követelmény: 11.4)
			const lastOrg = lastOrgId
				? this.availableOrganizations.find((org) => org.id === lastOrgId)
				: null;

			if (lastOrg) {
				// Az utoljára használt szervezet még mindig elérhető
				this.currentOrganization = lastOrg;
			} else {
				// Fallback az első elérhető szervezetre (Követelmény: 2.4, 11.5)
				this.currentOrganization = this.availableOrganizations[0];
				this.saveLastOrganizationId(this.currentOrganization.id);
			}

			// Képességek lekérése az aktuális szervezetre
			if (this.currentOrganization) {
				await this.refreshCapabilities(this.currentOrganization.id);
			}
		} catch (err: any) {
			// Követelmény 15.2: Részletes hibaüzenet
			const defaultMessage = this.t('organizations.loadFailed');
			this.error = this.formatErrorMessage(err?.message ?? defaultMessage, defaultMessage);
			console.error('[OrganizationStore] Hiba a szervezetek betöltésekor:', err);

			// Toast értesítés a felhasználónak (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Váltás másik szervezetre
	 * Követelmények: 4.1, 4.2, 4.3, 4.4, 12.1, 12.2, 15.1, 15.3, 19.1, 19.3
	 */
	async switchOrganization(organizationId: number): Promise<void> {
		// Követelmény 19.3: Letiltjuk a váltást betöltés közben
		if (this.isLoading) {
			console.warn('[OrganizationStore] Szervezet váltás már folyamatban van');
			return;
		}

		this.isLoading = true;
		this.error = null;

		try {
			// Ellenőrizzük, hogy a szervezet elérhető-e (Követelmény: 4.1)
			const org = this.availableOrganizations.find((o) => o.id === organizationId);

			if (!org) {
				throw new Error(this.t('organizations.notAccessible'));
			}

			// Frissítjük az aktuális szervezetet (Követelmény: 4.1)
			this.currentOrganization = org;

			// Session storage frissítése sikeres váltás után (Követelmény: 4.2, 11.1)
			this.saveLastOrganizationId(organizationId);

			// Képességek újratöltése az új szervezet kontextusában
			await this.refreshCapabilities(organizationId);

			// Értesítjük az alkalmazást a szervezet váltásról (Követelmény: 4.3, 12.1)
			// Az event detail tartalmazza az organizationId-t és az organization objektumot (Követelmény: 4.4, 12.2)
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('organization-changed', {
						detail: {
							organizationId,
							organization: org
						}
					})
				);
			}

			// Töröljük az esetleges korábbi hibát
			this.error = null;
		} catch (err: any) {
			// Követelmény 15.1, 15.3: Részletes hibaüzenet
			const defaultMessage = this.t('organizations.switchFailed');
			this.error = this.formatErrorMessage(err?.message ?? defaultMessage, defaultMessage);
			console.error('[OrganizationStore] Hiba a szervezet váltásakor:', err);

			// Toast értesítés a felhasználónak (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Szervezet törlése
	 * Követelmény: 2.6, 2.7, 14.1, 14.2, 14.3, 15.1, 15.4
	 */
	async deleteOrganization(organizationId: number): Promise<{
		success: boolean;
		memberCount?: number;
		projectCount?: number;
	}> {
		if (!this.sdk?.remote) {
			this.error = this.t('error.sdkUnavailable');
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
			return { success: false };
		}

		this.isLoading = true;
		this.error = null;

		try {
			const result = await this.sdk.remote.call('deleteOrganization', { id: organizationId });

			// Eltávolítjuk a listából
			this.availableOrganizations = this.availableOrganizations.filter(
				(org) => org.id !== organizationId
			);

			// Ha ez volt a kiválasztott szervezet, válasszuk ki az elsőt
			if (this.currentOrganization?.id === organizationId) {
				if (this.availableOrganizations.length > 0) {
					await this.switchOrganization(this.availableOrganizations[0].id);
				} else {
					this.currentOrganization = null;
					if (typeof window !== 'undefined' && window.sessionStorage) {
						window.sessionStorage.removeItem(STORAGE_KEY);
					}
				}
			}

			// Értesítjük az alkalmazást a szervezet törléséről
			if (typeof window !== 'undefined') {
				window.dispatchEvent(
					new CustomEvent('organization-deleted', {
						detail: { organizationId }
					})
				);
			}

			// A sikeres és a sikertelen törlést a hívó (Organizations) jelzi, itt nincs toast,
			// különben két üzenet jelenne meg.
			return {
				success: true,
				memberCount: result?.memberCount,
				projectCount: result?.projectCount
			};
		} catch (err: any) {
			// Követelmény 15.4: Részletes hibaüzenet
			const defaultMessage = this.t('organizations.delete.failed');
			this.error = this.formatErrorMessage(err?.message ?? defaultMessage, defaultMessage);
			console.error('[OrganizationStore] Hiba a szervezet törlésekor:', err);
			return { success: false };
		} finally {
			this.isLoading = false;
		}
	}

	/**
	 * Szervezet frissítése a listában
	 * Követelmény: 2.5
	 */
	updateOrganization(updatedOrg: Organization): void {
		this.availableOrganizations = this.availableOrganizations.map((org) =>
			org.id === updatedOrg.id ? updatedOrg : org
		);

		// Ha ez a kiválasztott szervezet, frissítjük
		if (this.currentOrganization?.id === updatedOrg.id) {
			this.currentOrganization = updatedOrg;
		}

		// Értesítjük az alkalmazás többi részét a szervezet adatainak módosításáról
		// (pl. az OrganizationSwitcher felirata frissüljön a névváltozás után).
		if (typeof window !== 'undefined') {
			window.dispatchEvent(
				new CustomEvent('organization-updated', {
					detail: {
						organizationId: updatedOrg.id,
						organization: updatedOrg
					}
				})
			);
		}
	}

	/**
	 * Utoljára használt szervezet ID mentése session storage-ba
	 * Követelmény: 4.6
	 */
	private saveLastOrganizationId(organizationId: number): void {
		if (typeof window !== 'undefined' && window.sessionStorage) {
			try {
				window.sessionStorage.setItem(STORAGE_KEY, String(organizationId));
			} catch (err) {
				console.warn('[OrganizationStore] Session storage mentés sikertelen:', err);
			}
		}
	}

	/**
	 * Utoljára használt szervezet ID betöltése session storage-ból
	 * Követelmény: 4.7
	 */
	private getLastOrganizationId(): number | null {
		if (typeof window !== 'undefined' && window.sessionStorage) {
			try {
				const stored = window.sessionStorage.getItem(STORAGE_KEY);
				return stored ? parseInt(stored, 10) : null;
			} catch (err) {
				console.warn('[OrganizationStore] Session storage olvasás sikertelen:', err);
				return null;
			}
		}
		return null;
	}

	/**
	 * Store reset (pl. kijelentkezéskor)
	 */
	reset(): void {
		this.currentOrganization = null;
		this.availableOrganizations = [];
		this.isLoading = false;
		this.error = null;
		this.isAdmin = false;
		this.capabilities = new Set();

		if (typeof window !== 'undefined' && window.sessionStorage) {
			try {
				window.sessionStorage.removeItem(STORAGE_KEY);
			} catch (err) {
				console.warn('[OrganizationStore] Session storage törlés sikertelen:', err);
			}
		}
	}

	/** Fordítás a plugin SDK-jával (a store nem komponens, nincs saját t()-je). */
	private t(key: string): string {
		return translate(this.sdk, key);
	}

	/**
	 * Hibaüzenet formázása felhasználóbarát módon
	 * Követelmény: 15.1, 15.2, 15.3, 15.4
	 */
	private formatErrorMessage(errorMessage: string, defaultMessage: string): string {
		// Ha a hibaüzenet tartalmaz hálózati hibát
		if (errorMessage.toLowerCase().includes('network') ||
		    errorMessage.toLowerCase().includes('fetch') ||
		    errorMessage.toLowerCase().includes('connection')) {
			return this.t('error.network');
		}

		// Ha a hibaüzenet tartalmaz jogosultsági hibát
		if (errorMessage.toLowerCase().includes('unauthorized') ||
		    errorMessage.toLowerCase().includes('forbidden') ||
		    errorMessage.toLowerCase().includes('permission')) {
			return this.t('error.forbidden');
		}

		// Ha a hibaüzenet tartalmaz validációs hibát
		if (errorMessage.toLowerCase().includes('invalid') ||
		    errorMessage.toLowerCase().includes('required')) {
			return errorMessage; // Használjuk az eredeti üzenetet, mert specifikus
		}

		// Ha van értelmes hibaüzenet, használjuk azt
		if (errorMessage && errorMessage !== defaultMessage) {
			return errorMessage;
		}

		// Egyébként az alapértelmezett üzenetet
		return defaultMessage;
	}
}

function sameSet(a: Set<string>, b: Set<string>): boolean {
	if (a.size !== b.size) return false;
	for (const v of a) if (!b.has(v)) return false;
	return true;
}

/** Id és név alapján hasonlít (a váltó felirata a névből jön). */
function sameOrganizations(a: Organization[], b: Organization[]): boolean {
	if (a.length !== b.length) return false;
	return a.every((org, i) => org.id === b[i].id && org.name === b[i].name);
}

// Singleton instance - window-on tárolva, hogy minden Web Component bundle ugyanazt lássa
const STORE_WINDOW_KEY = '__racona_work_org_store__';

/**
 * OrganizationStore létrehozása
 */
export function createOrganizationStore(pluginId: string, sdk: any): OrganizationStore {
	const store = new OrganizationStore();
	store.init(pluginId, sdk);
	if (typeof window !== 'undefined') {
		(window as any)[STORE_WINDOW_KEY] = store;
	}
	return store;
}

/**
 * OrganizationStore beállítása (context-hez)
 */
export function setOrganizationStore(store: OrganizationStore): void {
	if (typeof window !== 'undefined') {
		(window as any)[STORE_WINDOW_KEY] = store;
	}
}

/**
 * OrganizationStore lekérése
 */
/**
 * A felhasználó core admin (rendszergazda)-e. Saját ügyben csak ő dönthet,
 * ezért a felület ez alapján mutatja vagy rejti el a döntés gombjait.
 */
export function isCoreAdminViewer(): boolean {
	const store = typeof window !== 'undefined' ? (window as any)[STORE_WINDOW_KEY] : null;
	return store?.isAdmin === true;
}

export function getOrganizationStore(): OrganizationStore {
	const store = typeof window !== 'undefined' ? (window as any)[STORE_WINDOW_KEY] : null;
	if (!store) {
		throw new Error('OrganizationStore nincs inicializálva. Hívd meg először a createOrganizationStore()-t.');
	}
	return store as OrganizationStore;
}
