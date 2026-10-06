/**
 * Mobil bejegyzések (manifest `mobile.entries`).
 *
 * Az értesítések `data.mobileEntry` mezője alapján a mobil keret a megfelelő
 * képernyőt nyitja meg; az e-mailek közvetlen linkje ugyanezt az azonosítót viszi
 * ({{appUrl}}/admin?app=racona-work&entry=<azonosító>).
 */

export const MOBILE_ENTRY = {
	leave: 'leave',
	month: 'month',
	worklog: 'worklog'
} as const;

export type MobileEntryId = (typeof MOBILE_ENTRY)[keyof typeof MOBILE_ENTRY];

