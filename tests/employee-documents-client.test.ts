/**
 * A dokumentumfájlok böngészős segédei (src/components/employee-documents/files.ts).
 *
 * Futtatás: bun test
 */

import { describe, expect, test } from 'bun:test';
import { addMonths, checkDocumentFile } from '../src/components/employee-documents/files.ts';

const t = (key: string, vars?: Record<string, string | number>) => `${key}${vars ? JSON.stringify(vars) : ''}`;
const limits = { maxFilesPerDocument: 5, maxFileBytes: 1000, mimeTypes: ['application/pdf', 'image/png'] };

function file(name: string, size: number, type: string): File {
	return new File([new Uint8Array(size)], name, { type });
}

describe('addMonths', () => {
	test('azonos nap a célhónapban', () => {
		expect(addMonths('2026-10-06', 12)).toBe('2027-10-06');
		expect(addMonths('2026-10-06', 3)).toBe('2027-01-06');
	});

	test('a hónap végéhez igazít', () => {
		expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
		expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
		expect(addMonths('2026-08-31', 1)).toBe('2026-09-30');
	});
});

describe('checkDocumentFile', () => {
	test('elfogadja az engedett típust a méreten belül', () => {
		expect(checkDocumentFile(file('a.pdf', 10, 'application/pdf'), limits, t)).toBeNull();
	});

	test('üres, túl nagy, vagy nem engedett típus', () => {
		expect(checkDocumentFile(file('a.pdf', 0, 'application/pdf'), limits, t)).toContain('empty');
		expect(checkDocumentFile(file('a.pdf', 2000, 'application/pdf'), limits, t)).toContain('tooLarge');
		expect(checkDocumentFile(file('a.html', 10, 'text/html'), limits, t)).toContain('error.type');
	});

	test('típus nélkül a kiterjesztés dönt', () => {
		expect(checkDocumentFile(file('a.docx', 10, ''), limits, t)).toBeNull();
		expect(checkDocumentFile(file('a.exe', 10, ''), limits, t)).toContain('error.type');
	});
});
