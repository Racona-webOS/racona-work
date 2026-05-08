/**
 * Plugin IIFE build entry point.
 * Racona tölti be ezt a bundle-t Web Component-ként.
 */
import { mount } from 'svelte';
import App from './App.svelte';

function racona_work_Plugin() {
	const tagName = 'racona-work-plugin';
	if (!customElements.get(tagName)) {
		class PluginElement extends HTMLElement {
			connectedCallback() {
				mount(App, { target: this });
			}
		}
		customElements.define(tagName, PluginElement);
	}
	return { tagName };
}

(window as any).racona_work_Plugin = racona_work_Plugin;
export default racona_work_Plugin;
