/**
 * Valibot validation schemas for organization operations
 * Racona Work Plugin - Organization Management
 */

import * as v from 'valibot';

/**
 * Schema for creating a new organization
 * Requirements: 2.1, 3.1
 */
export const CreateOrganizationSchema = v.object({
	name: v.pipe(
		v.string('A szervezet neve kötelező'),
		v.minLength(2, 'A szervezet nevének legalább 2 karakter hosszúnak kell lennie'),
		v.maxLength(100, 'A szervezet neve maximum 100 karakter hosszú lehet')
	),
	address: v.optional(v.string()),
	phone: v.optional(
		v.pipe(
			v.string(),
			v.maxLength(50, 'A telefonszám maximum 50 karakter hosszú lehet')
		)
	),
	email: v.optional(
		v.pipe(
			v.string(),
			v.email('Érvénytelen email cím formátum'),
			v.maxLength(255, 'Az email cím maximum 255 karakter hosszú lehet')
		)
	),
	website: v.optional(
		v.pipe(
			v.string(),
			v.url('Érvénytelen weboldal URL formátum'),
			v.maxLength(255, 'A weboldal URL maximum 255 karakter hosszú lehet')
		)
	),
	notes: v.optional(v.string())
});

export type CreateOrganizationInput = v.InferInput<typeof CreateOrganizationSchema>;
export type CreateOrganizationOutput = v.InferOutput<typeof CreateOrganizationSchema>;

/**
 * Schema for updating an existing organization
 * Requirements: 2.1, 3.1
 */
export const UpdateOrganizationSchema = v.object({
	id: v.pipe(
		v.number('A szervezet azonosítója kötelező'),
		v.integer('A szervezet azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A szervezet azonosítójának pozitív számnak kell lennie')
	),
	name: v.pipe(
		v.string('A szervezet neve kötelező'),
		v.minLength(2, 'A szervezet nevének legalább 2 karakter hosszúnak kell lennie'),
		v.maxLength(100, 'A szervezet neve maximum 100 karakter hosszú lehet')
	),
	address: v.optional(v.nullable(v.string())),
	phone: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.maxLength(50, 'A telefonszám maximum 50 karakter hosszú lehet')
			)
		)
	),
	email: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.email('Érvénytelen email cím formátum'),
				v.maxLength(255, 'Az email cím maximum 255 karakter hosszú lehet')
			)
		)
	),
	website: v.optional(
		v.nullable(
			v.pipe(
				v.string(),
				v.url('Érvénytelen weboldal URL formátum'),
				v.maxLength(255, 'A weboldal URL maximum 255 karakter hosszú lehet')
			)
		)
	),
	notes: v.optional(v.nullable(v.string()))
});

export type UpdateOrganizationInput = v.InferInput<typeof UpdateOrganizationSchema>;
export type UpdateOrganizationOutput = v.InferOutput<typeof UpdateOrganizationSchema>;

/**
 * Schema for adding an employee to an organization
 * Requirements: 3.1
 */
export const AddEmployeeToOrganizationSchema = v.object({
	organizationId: v.pipe(
		v.number('A szervezet azonosítója kötelező'),
		v.integer('A szervezet azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A szervezet azonosítójának pozitív számnak kell lennie')
	),
	userId: v.pipe(
		v.number('A felhasználó azonosítója kötelező'),
		v.integer('A felhasználó azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A felhasználó azonosítójának pozitív számnak kell lennie')
	),
	role: v.optional(
		v.pipe(
			v.string(),
			v.union([v.literal('admin'), v.literal('member')], 'A szerepkör csak "admin" vagy "member" lehet')
		),
		'member'
	)
});

export type AddEmployeeToOrganizationInput = v.InferInput<typeof AddEmployeeToOrganizationSchema>;
export type AddEmployeeToOrganizationOutput = v.InferOutput<typeof AddEmployeeToOrganizationSchema>;

/**
 * Schema for removing an employee from an organization
 */
export const RemoveEmployeeFromOrganizationSchema = v.object({
	organizationId: v.pipe(
		v.number('A szervezet azonosítója kötelező'),
		v.integer('A szervezet azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A szervezet azonosítójának pozitív számnak kell lennie')
	),
	userId: v.pipe(
		v.number('A felhasználó azonosítója kötelező'),
		v.integer('A felhasználó azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A felhasználó azonosítójának pozitív számnak kell lennie')
	)
});

export type RemoveEmployeeFromOrganizationInput = v.InferInput<typeof RemoveEmployeeFromOrganizationSchema>;
export type RemoveEmployeeFromOrganizationOutput = v.InferOutput<typeof RemoveEmployeeFromOrganizationSchema>;

/**
 * Schema for deleting an organization
 */
export const DeleteOrganizationSchema = v.object({
	id: v.pipe(
		v.number('A szervezet azonosítója kötelező'),
		v.integer('A szervezet azonosítójának egész számnak kell lennie'),
		v.minValue(1, 'A szervezet azonosítójának pozitív számnak kell lennie')
	)
});

export type DeleteOrganizationInput = v.InferInput<typeof DeleteOrganizationSchema>;
export type DeleteOrganizationOutput = v.InferOutput<typeof DeleteOrganizationSchema>;
