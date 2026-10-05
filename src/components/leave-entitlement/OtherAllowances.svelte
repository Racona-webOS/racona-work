<!--
	Az éves szabadságon kívüli keretek: betegszabadság (az adott évre), apasági
	és szülői szabadság (gyerekenként, amíg kivehető). A dolgozó adatlapja és a
	saját irányítópult is ezt használja. Csak tájékoztat — a kérelmek szabályait
	a szerver ellenőrzi.
-->
<script lang="ts">
	import type { ChildLeaveStatus, LeaveAllowances } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDate } from '../../utils/format.js';

	let {
		pluginId = 'racona-work',
		employeeId,
		year = new Date().getFullYear(),
		accent = true,
		refreshKey = 0
	}: {
		pluginId?: string;
		employeeId: number;
		year?: number;
		/** A szülő növeli, ha a dolgozó adatai változtak. */
		refreshKey?: number;
		/** Színes felső csík (az adatlap kártyáihoz igazodva). */
		accent?: boolean;
	} = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let allowances = $state<LeaveAllowances | null>(null);
	let loading = $state(false);

	$effect(() => {
		const id = employeeId;
		const y = year;
		refreshKey;
		if (!sdk?.remote || !id) return;
		loading = true;
		sdk.remote
			.call('getLeaveAllowances', { employeeId: id, year: y })
			.then((result: LeaveAllowances) => (allowances = result))
			.catch(() => (allowances = null))
			.finally(() => (loading = false));
	});

	/** YYYY-MM-DD → helyi dátum, időzóna-csúszás nélkül. */
	function formatDay(day: string): string {
		return formatDate(day);
	}

	function childName(child: ChildLeaveStatus): string {
		return child.label || formatDay(child.birthDate);
	}

	const today = new Date().toISOString().slice(0, 10);
	const activePaternity = $derived(allowances?.paternity.filter((c) => c.active) ?? []);
	const sickTaken = $derived(allowances ? allowances.sick.usedDays + allowances.sick.pendingDays : 0);
</script>

{#if allowances || loading}
	<div class="card" class:accent>
		<div class="card-header">
			<h3>{t('leaveEntitlement.other.title', { year })}</h3>
		</div>

		{#if loading && !allowances}
			<div class="loading-state"><div class="spinner"></div></div>
		{:else if allowances}
			<ul class="allowance-list">
				<li class="allowance">
					<div class="allowance-main">
						<span class="allowance-title">{t('leaveRequests.type.sick')}</span>
						<span class="allowance-meta">
							{t('leaveEntitlement.other.sickMeta', { total: allowances.sick.totalDays })}
						</span>
					</div>
					<span class="allowance-value" class:over={sickTaken > allowances.sick.totalDays}>
						{t('leaveEntitlement.other.usedOf', { used: sickTaken, total: allowances.sick.totalDays })}
					</span>
				</li>
				{#if sickTaken > allowances.sick.totalDays}
					<li class="note warn">
						{t('leaveEntitlement.other.sickOver', { days: sickTaken - allowances.sick.totalDays })}
					</li>
				{/if}

				{#each activePaternity as child (child.childId)}
					<li class="allowance">
						<div class="allowance-main">
							<span class="allowance-title">
								{t('leaveRequests.type.paternity')} — {childName(child)}
							</span>
							<span class="allowance-meta">
								{#if child.adoptionDate}
									{t('leaveEntitlement.other.adopted', { date: formatDay(child.adoptionDate) })} ·
								{/if}
								{t('leaveEntitlement.other.deadline', { date: formatDay(child.deadline) })}
								· {t('leaveEntitlement.other.parts', { parts: child.parts ?? 0 })}
							</span>
						</div>
						<span class="allowance-value">
							{t('leaveEntitlement.other.remainingOf', { remaining: child.remainingDays, total: child.totalDays })}
						</span>
					</li>
				{/each}

				{#each allowances.parental as child (child.childId)}
					<li class="allowance">
						<div class="allowance-main">
							<span class="allowance-title">
								{t('leaveRequests.type.parental')} — {childName(child)}
							</span>
							<span class="allowance-meta">
								{t('leaveEntitlement.other.deadline', { date: formatDay(child.deadline) })}
								{#if child.eligibleFrom && child.eligibleFrom > today}
									· {t('leaveEntitlement.other.eligibleFrom', { date: formatDay(child.eligibleFrom) })}
								{/if}
							</span>
						</div>
						<span class="allowance-value">
							{t('leaveEntitlement.other.remainingOf', { remaining: child.remainingDays, total: child.totalDays })}
						</span>
					</li>
				{/each}
			</ul>
			<p class="note">{t('leaveEntitlement.other.pendingIncluded')}</p>
		{/if}
	</div>
{/if}

<style>
	@import '../../styles/shared.css';

	.card {
		border: 1px solid var(--color-border, #e2e8f0);
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.75rem;
	}

	.card.accent {
		border-top: 5px solid #22c55e;
	}

	.card-header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.allowance-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.25rem;
	}

	.allowance {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
		padding: 0.45rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
	}

	.allowance-main {
		display: flex;
		flex-direction: column;
		min-width: 0;
	}

	.allowance-title {
		font-weight: 500;
	}

	.allowance-meta {
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.allowance-value {
		font-weight: 600;
		white-space: nowrap;
	}

	.allowance-value.over {
		color: #b45309;
	}

	.note {
		margin: 0;
		font-size: 0.75rem;
		color: var(--color-muted-foreground, #94a3b8);
	}

	.note.warn {
		padding: 0 0.75rem;
		color: #b45309;
	}

	:global(.dark) .card {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
	}

	:global(.dark) .allowance {
		background: var(--color-accent, oklch(0.269 0 0));
	}
</style>
