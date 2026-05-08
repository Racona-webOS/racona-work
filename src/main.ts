import { mount } from 'svelte';
import App from './App.svelte';
import SimpleDataTable from '@racona/sdk/dev/components/SimpleDataTable.svelte';

async function initDevSDK() {
	if (typeof window !== 'undefined' && !(window as any).webOS) {
		const { MockWebOSSDK } = await import('@racona/sdk/dev');

		const localeModules = import.meta.glob<Record<string, string>>('../locales/*.json', {
			eager: true,
			import: 'default'
		});
		const translations: Record<string, Record<string, string>> = {};
		for (const [path, data] of Object.entries(localeModules)) {
			const locale = path.replace('../locales/', '').replace('.json', '');
			translations[locale] = data;
		}
		const defaultLocale = 'hu' in translations ? 'hu' : (Object.keys(translations)[0] ?? 'en');

		MockWebOSSDK.initialize({ i18n: { locale: defaultLocale, translations } }, { DataTable: SimpleDataTable });

		const DEV_SERVER_URL = 'http://localhost:5175';
		if ((window as any).webOS?.remote) {
			(window as any).webOS.remote.call = async (functionName: string, params: unknown) => {
				try {
					const response = await fetch(`${DEV_SERVER_URL}/api/remote/${functionName}`, {
						method: 'POST',
						headers: { 'Content-Type': 'application/json' },
						body: JSON.stringify({ params })
					});
					const data = await response.json();
					if (data.success) return data.result;
					throw new Error(data.error);
				} catch (err: unknown) {
					if (err instanceof Error && err.message && !err.message.startsWith('[DevMode]')) {
						throw new Error(`[DevMode] Remote call failed: ${functionName} — ${err.message}`);
					}
					throw err;
				}
			};
		}
	}
}

async function init() {
	await initDevSDK();
	const target = document.getElementById('app');
	if (target) mount(App, { target });
}

init();
export default App;
