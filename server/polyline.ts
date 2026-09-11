/**
 * Encoded polyline (precision 6) — a Valhalla útvonal-alakja.
 *
 * Tiszta modul, a kliens is importálja (a térkép a tárolt alakot rajzolja ki).
 * A koordináták [lng, lat] sorrendben vannak, ahogy a GeoJSON várja.
 */

const FACTOR = 1e6;

export function decodePolyline(encoded: string): [number, number][] {
	const coords: [number, number][] = [];
	let index = 0;
	let lat = 0;
	let lng = 0;

	while (index < encoded.length) {
		for (const axis of ['lat', 'lng'] as const) {
			let result = 0;
			let shift = 0;
			let byte: number;
			do {
				byte = encoded.charCodeAt(index++) - 63;
				result |= (byte & 0x1f) << shift;
				shift += 5;
			} while (byte >= 0x20 && index < encoded.length);
			const delta = result & 1 ? ~(result >> 1) : result >> 1;
			if (axis === 'lat') lat += delta;
			else lng += delta;
		}
		coords.push([lng / FACTOR, lat / FACTOR]);
	}
	return coords;
}

export function encodePolyline(coords: [number, number][]): string {
	let out = '';
	let prevLat = 0;
	let prevLng = 0;
	for (const [lngValue, latValue] of coords) {
		const lat = Math.round(latValue * FACTOR);
		const lng = Math.round(lngValue * FACTOR);
		out += encodeValue(lat - prevLat) + encodeValue(lng - prevLng);
		prevLat = lat;
		prevLng = lng;
	}
	return out;
}

function encodeValue(value: number): string {
	let v = value < 0 ? ~(value << 1) : value << 1;
	let out = '';
	while (v >= 0x20) {
		out += String.fromCharCode((0x20 | (v & 0x1f)) + 63);
		v >>= 5;
	}
	return out + String.fromCharCode(v + 63);
}
