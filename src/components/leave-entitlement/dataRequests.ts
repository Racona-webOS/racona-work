/**
 * Adatbejelentések megjelenítése — a dolgozó saját listája és a HR elbíráló
 * listája ugyanígy írja le, mit kértek.
 */

import type { ChildData, LeaveDataRequest } from '../../../server/functions.js';
import { formatDate } from '../../utils/format.js';

type Translate = (key: string, vars?: Record<string, string | number>) => string;

/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
export function formatDay(day: string | null | undefined): string {
	return formatDate(day);
}

function childText(child: ChildData | undefined, t: Translate): string {
	if (!child) return '—';
	const parts = [child.label || t('leaveEntitlement.children.unnamed'), formatDay(child.birthDate)];
	if (child.isDisabled) parts.push(t('leaveEntitlement.children.disabledBadge'));
	if (child.paternityEligible) parts.push(t('leaveEntitlement.children.paternityBadge'));
	if (child.adoptionDate) {
		parts.push(`${t('leaveEntitlement.children.adoptedBadge')}: ${formatDay(child.adoptionDate)}`);
	}
	return parts.join(', ');
}

/** A bejelentés címe és a részletei (mi változik mire). */
export function describeDataRequest(
	request: LeaveDataRequest,
	t: Translate
): { title: string; details: string[] } {
	const { payload } = request;
	const title = t(`dataRequest.kind.${request.kind}`);

	switch (request.kind) {
		case 'birth_date':
			return {
				title,
				details: [`${formatDay(payload.previous?.birthDate)} → ${formatDay(payload.birthDate)}`]
			};
		case 'child_add':
			return { title, details: [childText(payload.child, t)] };
		case 'child_remove':
			return { title, details: [childText(payload.previous?.child, t)] };
		case 'child_update': {
			const before = payload.previous?.child;
			const after = payload.child;
			const details: string[] = [];
			if (before && after) {
				if ((before.label ?? '') !== (after.label ?? '')) {
					details.push(`${t('dataRequest.field.label')}: ${before.label || '—'} → ${after.label || '—'}`);
				}
				if (before.birthDate !== after.birthDate) {
					details.push(
						`${t('dataRequest.field.birthDate')}: ${formatDay(before.birthDate)} → ${formatDay(after.birthDate)}`
					);
				}
				if (before.isDisabled !== after.isDisabled) {
					details.push(
						`${t('leaveEntitlement.children.isDisabled')}: ${t(before.isDisabled ? 'dataRequest.yes' : 'dataRequest.no')} → ${t(after.isDisabled ? 'dataRequest.yes' : 'dataRequest.no')}`
					);
				}
				if ((before.adoptionDate ?? null) !== (after.adoptionDate ?? null)) {
					details.push(
						`${t('dataRequest.field.adoptionDate')}: ${formatDay(before.adoptionDate)} → ${formatDay(after.adoptionDate)}`
					);
				}
				if (before.paternityEligible !== after.paternityEligible) {
					details.push(
						`${t('dataRequest.field.paternity')}: ${t(before.paternityEligible ? 'dataRequest.yes' : 'dataRequest.no')} → ${t(after.paternityEligible ? 'dataRequest.yes' : 'dataRequest.no')}`
					);
				}
			}
			return { title: `${title}: ${childText(before, t)}`, details: details.length ? details : [t('dataRequest.noChange')] };
		}
		case 'extra_add': {
			const extra = payload.extra;
			const validity =
				extra?.validFrom || extra?.validTo
					? `${extra?.validFrom ? formatDay(extra.validFrom) : '…'} – ${extra?.validTo ? formatDay(extra.validTo) : '…'}`
					: t('leaveEntitlement.extras.openEnded');
			return {
				title,
				details: [`${t(`leaveEntitlement.extras.kind.${extra?.kind ?? 'health_impaired'}`)} · ${validity}`]
			};
		}
	}
}
