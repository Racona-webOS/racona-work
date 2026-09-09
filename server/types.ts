/**
 * Szerver oldali közös típusok.
 *
 * Ide csak olyan típus kerül, amit több domain modul is használ. A domain
 * specifikus típusok a saját moduljukban élnek (pl. `EmployeeRow` az
 * employees.ts-ben, `ProjectRow` a projects.ts-ben).
 */

export interface PaginatedResult<T> {
	data: T[];
	pagination: {
		page: number;
		pageSize: number;
		totalCount: number;
		totalPages: number;
	};
}
