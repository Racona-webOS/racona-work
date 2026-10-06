import type { EmployeeRow, Organization } from '../../../server/functions.js';

/** A MobileScreen által a tartalomnak átadott környezet */
export interface MobileContext {
	sdk: any;
	organization: Organization;
	employee: EmployeeRow;
	/** Képesség a jelenlegi szervezetben */
	can: (capability: string) => boolean;
	t: (key: string, vars?: Record<string, string | number>) => string;
}
