/**
 * OrganizationStore - Szervezet kontextus kezelése Svelte 5 runes-szal
 * Követelmények: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7
 */

import type { Organization } from '../../server/functions.js';

const STORAGE_KEY = 'racona-work:last-organization-id';

export class OrganizationStore {
	currentOrganization = $state<Organization | null>(null);
	availableOrganizations = $state<Organization[]>([]);
	isLoading = $state(false);
	error = $state<string | null>(null);
	isAdmin = $state(false); // Admin jogosultság

	// Szervezet-szintű képességek (getMyCapabilities). Szervezet váltáskor frissül.
	capabilities = $state<Set<string>>(new Set());

	// Derived state
	hasMultipleOrganizations = $derived(this.availableOrganizations.length > 1);
	// Admin userek mindig hozzáférnek, függetlenül a szervezetek számától
	hasAccess = $derived(this.isAdmin || this.availableOrganizations.length > 0);

	private sdk: any = null;
	private pluginId: string = '';

	/**
	 * Store inicializálása az SDK-val
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
			const result = await this.sdk.remote.call('getMyCapabilities', { organizationId });
			const list: string[] = Array.isArray(result?.capabilities) ? result.capabilities : [];
			this.capabilities = new Set(list);
		} catch (err) {
			console.warn('[OrganizationStore] Képességek lekérése sikertelen:', err);
			this.capabilities = new Set();
		}
		this.publishCapabilities();
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
			this.error = 'SDK nem elérhető. Kérlek, frissítsd az oldalt.';
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
			const errorMessage = err?.message ?? 'Szervezetek betöltése sikertelen';
			this.error = this.formatErrorMessage(errorMessage, 'Szervezetek betöltése sikertelen');
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
				throw new Error('A megadott szervezet nem található vagy nincs hozzáférésed');
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
			const errorMessage = err?.message ?? 'Szervezet váltás sikertelen';
			this.error = this.formatErrorMessage(errorMessage, 'Szervezet váltás sikertelen');
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
	 * Új szervezet létrehozása
	 * Követelmény: 2.1, 2.2, 2.3, 15.1, 15.3
	 */
	async createOrganization(data: { name: string }): Promise<Organization | null> {
		if (!this.sdk?.remote) {
			this.error = 'SDK nem elérhető. Kérlek, frissítsd az oldalt.';
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
			return null;
		}

		this.isLoading = true;
		this.error = null;

		try {
			const result = await this.sdk.remote.call('createOrganization', data);
			const newOrg = result as Organization;

			// Hozzáadjuk az elérhető szervezetekhez
			this.availableOrganizations = [...this.availableOrganizations, newOrg];

			// Automatikusan váltunk az új szervezetre
			await this.switchOrganization(newOrg.id);

			// Sikeres toast (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(`${newOrg.name} sikeresen létrehozva`, 'success');
			}

			return newOrg;
		} catch (err: any) {
			// Követelmény 15.3: Részletes hibaüzenet
			const errorMessage = err?.message ?? 'Szervezet létrehozása sikertelen';
			this.error = this.formatErrorMessage(errorMessage, 'Szervezet létrehozása sikertelen');
			console.error('[OrganizationStore] Hiba a szervezet létrehozásakor:', err);

			// Toast értesítés a felhasználónak (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
			return null;
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
			this.error = 'SDK nem elérhető. Kérlek, frissítsd az oldalt.';
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

			// Sikeres toast (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast('Szervezet sikeresen törölve', 'success');
			}

			return {
				success: true,
				memberCount: result?.memberCount,
				projectCount: result?.projectCount
			};
		} catch (err: any) {
			// Követelmény 15.4: Részletes hibaüzenet
			const errorMessage = err?.message ?? 'Szervezet törlése sikertelen';
			this.error = this.formatErrorMessage(errorMessage, 'Szervezet törlése sikertelen');
			console.error('[OrganizationStore] Hiba a szervezet törlésekor:', err);

			// Toast értesítés a felhasználónak (Követelmény 15.5)
			if (this.sdk?.ui?.toast) {
				this.sdk.ui.toast(this.error, 'error');
			}
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

	/**
	 * Hibaüzenet formázása felhasználóbarát módon
	 * Követelmény: 15.1, 15.2, 15.3, 15.4
	 */
	private formatErrorMessage(errorMessage: string, defaultMessage: string): string {
		// Ha a hibaüzenet tartalmaz hálózati hibát
		if (errorMessage.toLowerCase().includes('network') ||
		    errorMessage.toLowerCase().includes('fetch') ||
		    errorMessage.toLowerCase().includes('connection')) {
			return 'Hálózati hiba. Kérlek, ellenőrizd az internetkapcsolatot és próbáld újra.';
		}

		// Ha a hibaüzenet tartalmaz jogosultsági hibát
		if (errorMessage.toLowerCase().includes('unauthorized') ||
		    errorMessage.toLowerCase().includes('forbidden') ||
		    errorMessage.toLowerCase().includes('permission')) {
			return 'Nincs jogosultságod ehhez a művelethez. Kérj hozzáférést egy rendszergazdától.';
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
export function getOrganizationStore(): OrganizationStore {
	const store = typeof window !== 'undefined' ? (window as any)[STORE_WINDOW_KEY] : null;
	if (!store) {
		throw new Error('OrganizationStore nincs inicializálva. Hívd meg először a createOrganizationStore()-t.');
	}
	return store as OrganizationStore;
}
