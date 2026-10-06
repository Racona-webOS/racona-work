import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import cssInjectedByJs from 'vite-plugin-css-injected-by-js';
import { copyFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * A src/styles/shared.css és mobile.css összes szelektora. A komponensek a <style> blokkjukba
 * importálják ezt a fájlt, így a Svelte minden olyan közös szabályra
 * `css_unused_selector` warningot dob, amit az adott komponens nem használ
 * (a kimenetből ettől még kidobja őket). Ezeket a warningokat elnyomjuk,
 * a komponensek saját, tényleg felesleges szelektoraira viszont továbbra is szól.
 */
function collectSharedSelectors(): Set<string> {
	const css = ['src/styles/shared.css', 'src/styles/mobile.css']
		.map((file) => readFileSync(resolve(__dirname, file), 'utf8'))
		.join('\n')
		.replace(/\/\*[\s\S]*?\*\//g, '');
	const selectors = new Set<string>();
	for (const [, prelude] of css.matchAll(/([^{};]+)\{/g)) {
		if (prelude.trim().startsWith('@')) continue;
		for (const selector of prelude.split(',')) {
			selectors.add(selector.trim().replace(/\s+/g, ' '));
		}
	}
	return selectors;
}

const sharedSelectors = collectSharedSelectors();

function isSharedUnusedSelector(message: string): boolean {
	const match = message.match(/^Unused CSS selector "(.+)"/);
	return !!match && sharedSelectors.has(match[1].replace(/\s+/g, ' '));
}

/**
 * Vite plugin: a gyökér manifest.json-t szinkronizálja a public/ mappába.
 */
function syncManifest() {
	return {
		name: 'sync-manifest',
		buildStart() {
			const src = resolve(__dirname, 'manifest.json');
			const dest = resolve(__dirname, 'public/manifest.json');
			mkdirSync(resolve(__dirname, 'public'), { recursive: true });
			copyFileSync(src, dest);
		}
	};
}

const buildMode = process.env.BUILD_MODE || 'main';
const componentsDir = resolve(__dirname, 'src/components');
const hasComponents = existsSync(componentsDir);

let entry: string;
let fileName: string;

if (buildMode === 'components' && hasComponents) {
	const componentFile = process.env.COMPONENT_FILE;
	if (componentFile) {
		entry = resolve(componentsDir, componentFile);
		fileName = `components/${componentFile.replace('.svelte', '')}`;
	} else {
		throw new Error('COMPONENT_FILE environment variable is required for components build');
	}
} else {
	entry = 'src/plugin.ts';
	fileName = 'index';
}

export default defineConfig(({ command }) => ({
	plugins: [
		syncManifest(),
		svelte({
			onwarn(warning, handler) {
				// Suppress known non-issues in plugin builds
				if (warning.code === 'options_missing_custom_element') return;
				if (warning.code === 'state_referenced_locally') return;
				if (warning.code === 'css_unused_selector' && isSharedUnusedSelector(warning.message))
					return;
				handler(warning);
			},
			compilerOptions: {
				runes: true,
				...(command === 'build'
					? {
							customElement: true,
							css: 'injected'
						}
					: {})
			}
		}),
		...(command === 'build' && buildMode === 'main' ? [cssInjectedByJs()] : [])
	],
	server: {
		port: 5174,
		cors: true
	},
	...(command === 'build'
		? {
				build: {
					lib: {
						entry,
						name: 'Plugin',
						formats: ['iife']
					},
					rollupOptions: {
						// A Svelte runtime-ot a core osztja meg minden pluginnal
						// (window.__RACONA_SVELTE__, window.__RACONA_SVELTE_INTERNAL_CLIENT__).
						// Így minden plugin ugyanazt a Svelte runtime-ot használja, mint a
						// core, és nem dobódik `effect_orphan` hiba a core-ból átadott
						// komponensek (DataTable, Input, stb.) renderelésekor.
						external: ['svelte', 'svelte/internal/client'],
						output: {
							entryFileNames: `${fileName}.iife.js`,
							inlineDynamicImports: true,
							globals: {
								svelte: '__RACONA_SVELTE__',
								'svelte/internal/client': '__RACONA_SVELTE_INTERNAL_CLIENT__'
							}
						}
					},
					outDir: 'dist',
					emptyOutDir: buildMode === 'main'
				}
			}
		: {})
}));
