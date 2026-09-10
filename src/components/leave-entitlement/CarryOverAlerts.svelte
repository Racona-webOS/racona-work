<!--
	Vezetői irányítópult — lejáró (30 napon belül) és lejárt, még kiadatlan
	áthozott szabadságnapok (Mt. 123. §). A lejárt napok nem vesznek el: a
	munkáltatónak ki kell adnia őket, ezért figyelmeztetünk. Ha nincs ilyen,
	semmit nem jelenít meg.
-->
<script lang="ts">
	import type { CarryOverAlert } from '../../../server/functions.js';
	import { resolveSdk, translate } from '../../utils/sdk.js';
	import { formatDay } from './dataRequests.js';

	let { pluginId = 'racona-work', organizationId }: { pluginId?: string; organizationId: number } = $props();

	const sdk = $derived(resolveSdk(pluginId));
	const t = (key: string, vars?: Record<string, string | number>) => translate(sdk, key, vars);

	let alerts = $state<CarryOverAlert[]>([]);

	$effect(() => {
		const orgId = organizationId;
		if (!sdk?.remote || !orgId) return;
		sdk.remote
			.call('getCarryOverAlerts', { organizationId: orgId })
			.then((result: CarryOverAlert[]) => (alerts = result))
			.catch(() => (alerts = []));
	});

	function openEmployee(employeeId: number) {
		sdk?.ui?.navigateTo?.('EmployeeDetail', { employeeId });
	}
</script>

{#if alerts.length > 0}
	<div class="alerts">
		<div class="header">
			<h3>{t('carryOver.alerts.title')}</h3>
			<span class="count">{alerts.length}</span>
		</div>
		<p class="subtitle">{t('carryOver.alerts.subtitle')}</p>
		<ul class="alert-list">
			{#each alerts as alert (alert.balanceId)}
				<li class="alert">
					<button class="name" onclick={() => openEmployee(alert.employeeId)}>{alert.employeeName}</button>
					<span class="detail">
						{t('carryOver.alerts.detail', {
							remaining: alert.remainingDays,
							carried: alert.carriedDays,
							year: alert.year,
							deadline: formatDay(alert.deadline)
						})}
					</span>
					<span class="badge badge-{alert.status}">
						{t(`carryOver.status.${alert.status}`, { days: alert.daysLeft })}
					</span>
				</li>
			{/each}
		</ul>
	</div>
{/if}

<style>
	.alerts {
		border: 1px solid var(--color-border, #e2e8f0);
		border-top: 5px solid #ef4444;
		border-radius: 0.75rem;
		padding: 1.25rem;
		background: var(--color-card, #ffffff);
		display: flex;
		flex-direction: column;
		gap: 0.6rem;
	}

	.header {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.header h3 {
		font-size: 0.95rem;
		font-weight: 600;
		margin: 0;
	}

	.count {
		min-width: 1.4rem;
		padding: 0.05rem 0.45rem;
		border-radius: 9999px;
		background: #fee2e2;
		color: #991b1b;
		font-size: 0.75rem;
		font-weight: 600;
		text-align: center;
	}

	.subtitle {
		margin: 0;
		font-size: 0.8rem;
		color: var(--color-muted-foreground, #64748b);
	}

	.alert-list {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 0.35rem;
	}

	.alert {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-radius: 0.375rem;
		background: var(--color-accent, #f8fafc);
		font-size: 0.85rem;
		flex-wrap: wrap;
	}

	.name {
		border: none;
		background: transparent;
		padding: 0;
		font: inherit;
		font-weight: 600;
		cursor: pointer;
		color: var(--color-foreground, #0f172a);
	}

	.name:hover {
		color: var(--color-primary, #3730a3);
		text-decoration: underline;
	}

	.detail {
		flex: 1;
		color: var(--color-muted-foreground, #64748b);
	}

	.badge {
		display: inline-flex;
		padding: 0.15rem 0.55rem;
		border-radius: 9999px;
		font-size: 0.72rem;
		font-weight: 500;
		white-space: nowrap;
	}

	.badge-due_soon { background: #fef3c7; color: #92400e; }
	.badge-expired { background: #fee2e2; color: #991b1b; }

	:global(.dark) .alerts {
		background: var(--color-card, oklch(0.205 0 0));
		border-color: var(--color-border, oklch(1 0 0 / 10%));
		border-top-color: #ef4444;
	}

	:global(.dark) .alert {
		background: var(--color-accent, oklch(0.269 0 0));
	}

	:global(.dark) .name {
		color: var(--color-foreground, oklch(0.985 0 0));
	}

	:global(.dark) .badge-due_soon { background: oklch(0.3 0.05 60); color: #fde68a; }
	:global(.dark) .badge-expired { background: oklch(0.25 0.05 20); color: #fca5a5; }
	:global(.dark) .count { background: oklch(0.25 0.05 20); color: #fca5a5; }
</style>
