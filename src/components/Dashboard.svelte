<svelte:options
  customElement={{ tag: "racona-work-dashboard", shadow: "none" }}
/>

<script module>
  if (typeof window !== "undefined") {
    (window as any).racona_work_Component_Dashboard = function () {
      return { tagName: "racona-work-dashboard" };
    };
  }
</script>

<script lang="ts">
  import { onMount, untrack } from "svelte";
  import type {} from "@racona/sdk/types";
  import type {
    DashboardStats,
    EmployeeRow,
    LeaveBalance,
    LeaveRequestRow,
    PaginatedResult,
  } from "../../server/functions.js";
  import {
    getOrganizationStore,
    createOrganizationStore,
  } from "../stores/organizationStore.svelte.js";
  import type { OrganizationStore } from "../stores/organizationStore.svelte.js";
  import AccessDenied from "./AccessDenied.svelte";
  import EntitlementBreakdown from "./leave-entitlement/EntitlementBreakdown.svelte";
  import OtherAllowances from "./leave-entitlement/OtherAllowances.svelte";
  import MyLeaveData from "./leave-entitlement/MyLeaveData.svelte";
  import DataRequestReview from "./leave-entitlement/DataRequestReview.svelte";
  import CarryOverAlerts from "./leave-entitlement/CarryOverAlerts.svelte";
  import MyMonthConfirmations from "./leave-month-confirmation/MyMonthConfirmations.svelte";
  import { LEAVE_TYPES, consumesAnnualBalance } from "../../server/leave-types.js";

  let { pluginId = "racona-work" }: { pluginId?: string } = $props();

  const sdk = $derived(
    (window as any).__webOS_instances?.get(pluginId) ?? (window as any).webOS,
  );

  // Ugyanaz a primary gomb + ⋮ menü, mint a táblázatok műveleti oszlopában.
  // Régebbi core-on (és standalone dev módban) nincs kiajánlva: ott csak a státusz látszik.
  const RowActions = $derived(sdk?.components?.DataTableRowActions ?? null);

  function t(key: string, vars?: Record<string, string | number>): string {
    let str = sdk?.i18n?.t(key) ?? key;
    if (vars) {
      for (const [k, v] of Object.entries(vars)) {
        str = str.replace(`{${k}}`, String(v));
      }
    }
    return str;
  }

  // --- Store ---
  let orgStore = $state<OrganizationStore | null>(null);
  let currentOrganization = $state<
    import("../../server/functions.js").Organization | null
  >(null);
  let hasAccess = $state(false);
  let canManagerView = $state(false);
  // A vezetői nézetet employee.manage joggal is látni lehet, elbírálni csak leave.approve-val
  let canApprove = $state(false);
  // A dolgozói adatbejelentéseket a HR bírálja el
  let canManageBalance = $state(false);
  let decidingId = $state<number | null>(null);
  let orgLoading = $derived(orgStore?.isLoading ?? false);

  // --- Vezetői nézet állapota ---
  let stats = $state<DashboardStats | null>(null);
  let statsLoading = $state(false);
  let statsError = $state<string | null>(null);

  // --- Self-service nézet állapota ---
  let myEmployee = $state<EmployeeRow | null>(null);
  /** Külsős dolgozó: az irányítópult csak a projektekhez irányít (specs/external-employees.md). */
  let isExternal = $state(false);
  let myBalance = $state<LeaveBalance | null>(null);
  /** Az idei, még el nem bírált, a keretet terhelő kérelmek napjai. */
  let myPendingDays = $state(0);
  /** A maradék a függő kérelmekkel csökkentve: ennyit lehet még kérni. */
  const myAvailableDays = $derived(
    myBalance ? myBalance.remainingDays - myPendingDays : 0,
  );
  let showBreakdown = $state(false);
  let myRequests = $state<LeaveRequestRow[]>([]);
  let selfLoading = $state(false);
  let selfError = $state<string | null>(null);
  // Vezetői nézetben a saját bejelentések és az elbírálás panel ugyanazon az
  // oldalon van: ha az egyik változik, a másikat is újratöltjük
  let dataRefreshKey = $state(0);

  let isDataLoading = $derived(statsLoading || selfLoading || orgLoading);
  const thisYear = new Date().getFullYear();

  // --- Adatbetöltés --------------------------------------------------------
  async function loadManagerStats() {
    if (!currentOrganization) {
      stats = null;
      return;
    }
    statsLoading = true;
    statsError = null;
    try {
      const result = await sdk?.remote?.call("getDashboardStats", {
        organizationId: currentOrganization.id,
      });
      stats = result as DashboardStats;
    } catch (err: any) {
      statsError = formatErrorMessage(err?.message ?? t("error.loadFailed"));
      stats = null;
    } finally {
      statsLoading = false;
    }
  }

  async function loadSelfOverview() {
    if (!currentOrganization) {
      myEmployee = null;
      myBalance = null;
      myRequests = [];
      return;
    }
    selfLoading = true;
    selfError = null;
    try {
      const me = (await sdk.remote.call("getMyEmployee", {
        organizationId: currentOrganization.id,
      })) as EmployeeRow | null;
      myEmployee = me;

      if (!me) {
        myBalance = null;
        myRequests = [];
        return;
      }

      const [balances, requests, pending] = await Promise.all([
        sdk.remote.call("getLeaveBalances", { employeeId: me.id }) as Promise<
          LeaveBalance[]
        >,
        sdk.remote.call("getLeaveRequests", {
          organizationId: currentOrganization.id,
          employeeId: me.id,
          pageSize: 5,
          sortBy: "createdAt",
          sortOrder: "desc",
        }) as Promise<PaginatedResult<LeaveRequestRow>>,
        sdk.remote.call("getLeaveRequests", {
          organizationId: currentOrganization.id,
          employeeId: me.id,
          status: "pending",
          pageSize: 200,
        }) as Promise<PaginatedResult<LeaveRequestRow>>,
      ]);

      myBalance = (balances ?? []).find((b) => b.year === thisYear) ?? null;
      myRequests = requests?.data ?? [];
      myPendingDays = (pending?.data ?? [])
        .filter(
          (r) =>
            consumesAnnualBalance(r.leaveType) &&
            String(r.startDate).slice(0, 4) === String(thisYear),
        )
        .reduce((sum, r) => sum + r.days, 0);
    } catch (err: any) {
      selfError = formatErrorMessage(err?.message ?? t("error.loadFailed"));
    } finally {
      selfLoading = false;
    }
  }

  function formatErrorMessage(errorMessage: string): string {
    const lower = errorMessage.toLowerCase();
    if (
      lower.includes("network") ||
      lower.includes("fetch") ||
      lower.includes("connection")
    ) {
      return "Hálózati hiba. Kérlek, ellenőrizd az internetkapcsolatot.";
    }
    if (
      lower.includes("unauthorized") ||
      lower.includes("forbidden") ||
      lower.includes("permission") ||
      lower.includes("jogosult")
    ) {
      return "Nincs jogosultságod ehhez az adathoz.";
    }
    return errorMessage;
  }

  function reload() {
    if (isExternal) return;
    // A vezető is lehet dolgozó: neki a saját adatai a vezetői nézet alatt jelennek meg
    if (canManagerView) loadManagerStats();
    loadSelfOverview();
  }

  function onOwnDataChanged() {
    dataRefreshKey++;
  }

  // Az elbírálás a keretet is módosíthatja, ha a vezető a saját bejelentését bírálta el
  function onDataRequestDecided() {
    dataRefreshKey++;
    if (myEmployee) loadSelfOverview();
  }

  // --- Inicializálás ------------------------------------------------------
  function syncFromStore() {
    if (!orgStore) return;
    currentOrganization = orgStore.currentOrganization;
    hasAccess = orgStore.hasAccess;
    syncCapabilities();
  }

  function syncCapabilities() {
    if (!orgStore) return;
    isExternal = orgStore.isExternal;
    canApprove = orgStore.can("leave.approve");
    canManageBalance = orgStore.can("leave.balance.manage");
    canManagerView =
      canApprove || canManageBalance || orgStore.can("employee.manage");
  }

  // --- Elbírálás ----------------------------------------------------------
  function requestActions(req: LeaveRequestRow) {
    return [
      {
        label: t("leaveRequests.approve"),
        onClick: () => decideRequest(req, "approve"),
      },
      {
        label: t("leaveRequests.reject"),
        onClick: () => decideRequest(req, "reject"),
        variant: "destructive" as const,
        separator: true,
      },
    ];
  }

  async function decideRequest(
    req: LeaveRequestRow,
    decision: "approve" | "reject",
  ) {
    // A gombcsoportnak nincs letiltott állapota, ezért itt védjük a dupla kattintást
    if (decidingId !== null) return;
    decidingId = req.id;
    try {
      // Az érintett dolgozó értesítését a szerver küldi
      await sdk?.remote?.call(
        decision === "approve" ? "approveLeaveRequest" : "rejectLeaveRequest",
        { id: req.id },
      );
      sdk?.ui?.toast(
        t(
          decision === "approve"
            ? "leaveRequests.approveSuccess"
            : "leaveRequests.rejectSuccess",
        ),
        "success",
      );
      // A számlálók és a lista is változik, ezért az egész összesítőt frissítjük
      await loadManagerStats();
      if (myEmployee && req.employeeId === myEmployee.id) await loadSelfOverview();
    } catch (err: any) {
      sdk?.ui?.toast(
        err?.message?.replace(/^[A-Z_]+:\s*/, "") ?? t("error.saveFailed"),
        "error",
      );
    } finally {
      decidingId = null;
    }
  }

  onMount(() => {
    if (sdk?.remote) {
      try {
        orgStore = getOrganizationStore();
      } catch {
        orgStore = createOrganizationStore(pluginId, sdk);
      }
      syncFromStore();

      if (orgStore!.availableOrganizations.length === 0) {
        orgStore!.loadOrganizations().then(() => {
          syncFromStore();
          if (currentOrganization) reload();
        });
      } else if (currentOrganization) {
        reload();
      }
    }
  });

  $effect(() => {
    const handleOrgChange = () => {
      syncFromStore();
      if (currentOrganization) reload();
    };
    window.addEventListener("organization-changed", handleOrgChange);
    return () =>
      window.removeEventListener("organization-changed", handleOrgChange);
  });

  // Az Irányítópult az alapoldal, így gyakran akkor mountol, amikor a sidebar
  // már betöltötte a szervezeteket, de a képességek még úton vannak. A betöltés
  // végén nincs organization-changed, csak ez az esemény — enélkül vezetőként is
  // a dolgozói nézet ragadna be. Nézetváltáskor a lenti $effect tölt újra.
  $effect(() => {
    const handleCapabilities = (e: Event) => {
      if ((e as CustomEvent).detail?.pluginId !== pluginId) return;
      syncCapabilities();
    };
    window.addEventListener("plugin-capabilities-changed", handleCapabilities);
    return () =>
      window.removeEventListener(
        "plugin-capabilities-changed",
        handleCapabilities,
      );
  });

  $effect(() => {
    currentOrganization;
    canManagerView;
    untrack(() => {
      if (currentOrganization && sdk?.remote) reload();
    });
  });

  // --- Segédfüggvények ----------------------------------------------------
  function formatDate(dateStr: string | null): string {
    if (!dateStr) return "—";
    return new Date(dateStr).toLocaleDateString();
  }

  function leaveTypeLabel(type: string): string {
    return (LEAVE_TYPES as readonly string[]).includes(type)
      ? t(`leaveRequests.type.${type}`)
      : type;
  }

  function statusLabel(status: string): string {
    const map: Record<string, string> = {
      pending: t("leaveRequests.status.pending"),
      approved: t("leaveRequests.status.approved"),
      rejected: t("leaveRequests.status.rejected"),
      withdrawn: t("leaveRequests.status.withdrawn"),
    };
    return map[status] ?? status;
  }

  function statusClass(status: string): string {
    const map: Record<string, string> = {
      pending: "badge-pending",
      approved: "badge-approved",
      rejected: "badge-rejected",
      withdrawn: "badge-withdrawn",
    };
    return map[status] ?? "badge-pending";
  }

  /** A szabadságok kezelése a nyilvántartó oldalon (naptár, kérelmek). */
  function openLeavePage() {
    sdk?.ui?.navigateTo?.("LeaveRequests", {});
  }
</script>

<div class="rw">
  <section class="page">
    {#if !hasAccess}
      <AccessDenied />
    {:else if isExternal}
      <!-- ========== Külsős dolgozó: csak a projektek ========== -->
      <div class="page-header">
        <div class="page-header_title">
          <h2>{t("dashboard.external.title")}</h2>
          <p class="subtitle">{t("dashboard.external.message")}</p>
        </div>
      </div>
      <div>
        <button
          class="btn-primary"
          onclick={() => sdk?.ui?.navigateTo?.("ProjectList", {})}
        >
          {t("dashboard.external.openProjects")}
        </button>
      </div>
    {:else if isDataLoading && !stats && !myEmployee}
      <div class="loading-state">
        <div class="spinner"></div>
        <span>{t("loading")}</span>
      </div>
    {:else if canManagerView}
      <!-- ========== Vezetői / manager nézet ========== -->
      <div class="page-header">
        <div class="page-header_title">
          <h2>{t("dashboard.title")}</h2>
          <p class="subtitle">{t("dashboard.subtitle")}</p>
        </div>
      </div>

      {#if statsError}
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <p class="error-message">{statsError}</p>
          <button class="btn-retry" onclick={reload}>
            <span class="retry-icon">🔄</span>
            Újrapróbálás
          </button>
        </div>
      {:else if stats}
        <div class="stats-grid">
          <div class="stat-card">
            <span class="stat-label">{t("dashboard.totalEmployees")}</span>
            <span class="stat-value">{stats.totalEmployees}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">{t("dashboard.activeEmployees")}</span>
            <span class="stat-value active">{stats.activeEmployees}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">{t("dashboard.pendingLeaveRequests")}</span
            >
            <span class="stat-value pending">{stats.pendingLeaveRequests}</span>
          </div>
          <div class="stat-card">
            <span class="stat-label">{t("dashboard.onLeaveThisMonth")}</span>
            <span class="stat-value on-leave">{stats.onLeaveThisMonth}</span>
          </div>
        </div>

        {#if canManageBalance && currentOrganization}
          <DataRequestReview
            {pluginId}
            organizationId={currentOrganization.id}
            refreshKey={dataRefreshKey}
            onDecided={onDataRequestDecided}
          />
          <CarryOverAlerts {pluginId} organizationId={currentOrganization.id} />
        {/if}

        <div class="recent-section">
          <h3>{t("dashboard.recentRequests")}</h3>
          {#if stats.recentPendingRequests.length === 0}
            <p class="empty-state">{t("dashboard.noRecentRequests")}</p>
          {:else}
            <div class="requests-list">
              {#each stats.recentPendingRequests as req (req.id)}
                <div class="request-row">
                  <div class="request-employee">{req.employeeName}</div>
                  <div class="request-type">
                    {leaveTypeLabel(req.leaveType)}
                  </div>
                  <div class="request-dates">
                    {formatDate(req.startDate)} – {formatDate(req.endDate)}
                  </div>
                  <div class="request-days">{req.days} nap</div>
                  {#if RowActions && canApprove && req.status === "pending"}
                    <div class="request-actions">
                      <RowActions actions={requestActions(req)} row={req} />
                    </div>
                  {:else}
                    <span class="badge {statusClass(req.status)}"
                      >{statusLabel(req.status)}</span
                    >
                  {/if}
                </div>
              {/each}
            </div>
          {/if}
        </div>
      {/if}

      <!-- A vezető is lehet dolgozó: a saját keretét, kérelmeit és bejelentéseit itt látja -->
      {#if myEmployee}
        <div class="self-section">
          <div class="page-header">
            <div class="page-header_title">
              <h2>{t("dashboard.self.sectionTitle")}</h2>
              <p class="subtitle">{t("dashboard.self.sectionSubtitle")}</p>
            </div>
          </div>
          {#if selfError}
            <p class="error-message">{selfError}</p>
          {:else}
            {@render selfOverview(myEmployee)}
          {/if}
        </div>
      {/if}
    {:else}
      <!-- ========== Self-service nézet ========== -->
      {#if selfError}
        <div class="error-state">
          <div class="error-icon">⚠️</div>
          <p class="error-message">{selfError}</p>
          <button class="btn-retry" onclick={reload}>
            <span class="retry-icon">🔄</span>
            Újrapróbálás
          </button>
        </div>
      {:else if !myEmployee}
        <div class="page-header">
          <div class="page-header_title">
            <h2>{t("dashboard.title")}</h2>
          </div>
        </div>
        <p class="empty-state">{t("dashboard.self.noEmployee")}</p>
      {:else}
        <div class="page-header self">
          <div>
            <h2>{t("dashboard.self.title", { name: myEmployee.userName })}</h2>
            <p class="subtitle">{t("dashboard.self.subtitle")}</p>
          </div>
        </div>

        {@render selfOverview(myEmployee)}
      {/if}
    {/if}
  </section>
</div>

<!-- Saját keret, adatok és kérelmek: a dolgozói nézet tartalma, és a vezetői nézet alján is megjelenik -->
{#snippet selfOverview(employee: EmployeeRow)}
  <!-- Havi szabadság-ellenőrzés: teendő, ezért a keret előtt (specs/leave-month-confirmation.md, K5) -->
  {#if currentOrganization}
    <MyMonthConfirmations
      {pluginId}
      organizationId={currentOrganization.id}
      refreshKey={dataRefreshKey}
    />
  {/if}
  <div class="balance-card">
    <div class="balance-header">
      <span class="balance-title"
        >{t("dashboard.self.balance", { year: thisYear })}</span
      >
      {#if myBalance?.calculation}
        <button
          class="btn-link"
          onclick={() => (showBreakdown = !showBreakdown)}
        >
          {showBreakdown
            ? t("dashboard.self.hideBreakdown")
            : t("dashboard.self.howCalculated")}
        </button>
      {/if}
    </div>
    {#if myBalance}
      <div class="balance-stats">
        <div class="balance-stat">
          <span class="b-label">{t("dashboard.self.totalDays")}</span>
          <span class="b-value">{myBalance.totalDays}</span>
        </div>
        <div class="balance-stat">
          <span class="b-label">{t("dashboard.self.usedDays")}</span>
          <span class="b-value used">{myBalance.usedDays}</span>
        </div>
        <div class="balance-stat">
          <span class="b-label">{t("dashboard.self.pendingDays")}</span>
          <span class="b-value pending">{myPendingDays}</span>
        </div>
        <div class="balance-stat" class:warning={myAvailableDays < 5}>
          <span class="b-label">{t("dashboard.self.remainingDays")}</span>
          <span class="b-value remaining">{myAvailableDays}</span>
        </div>
      </div>
      <div class="balance-actions">
        <button class="btn-primary" onclick={openLeavePage}>
          {t("dashboard.self.manageLeave")}
        </button>
      </div>
      <div class="balance-bar">
        <div
          class="balance-bar-fill"
          style="width: {myBalance.totalDays > 0
            ? Math.min(100, (myBalance.usedDays / myBalance.totalDays) * 100)
            : 0}%"
        ></div>
      </div>
      {#if myBalance.carryOver && myBalance.carryOver.remainingDays > 0}
        <p
          class="carry-notice"
          class:expired={myBalance.carryOver.status === "expired"}
        >
          {t(
            myBalance.carryOver.status === "expired"
              ? "carryOver.self.expired"
              : "carryOver.self.reminder",
            {
              days: myBalance.carryOver.remainingDays,
              deadline: formatDate(myBalance.carryOver.deadline),
            },
          )}
        </p>
      {/if}
      {#if showBreakdown && myBalance.calculation}
        <div class="breakdown-box">
          <EntitlementBreakdown
            {pluginId}
            result={myBalance.calculation.result}
            adjustmentDays={myBalance.adjustmentDays}
            adjustmentNote={myBalance.adjustmentNote}
            carriedOverDays={myBalance.carriedOverDays}
            carryOverDeadline={myBalance.carryOverDeadline}
            showWarnings={false}
          />
        </div>
      {/if}
    {:else}
      <p class="empty-state">{t("dashboard.self.noBalance")}</p>
    {/if}
  </div>

  <OtherAllowances
    {pluginId}
    employeeId={employee.id}
    year={thisYear}
    accent={false}
    refreshKey={dataRefreshKey}
  />

  <MyLeaveData
    {pluginId}
    employeeId={employee.id}
    refreshKey={dataRefreshKey}
    onChanged={onOwnDataChanged}
  />

  <div class="recent-section">
    <h3>{t("dashboard.self.myRequests")}</h3>
    {#if myRequests.length === 0}
      <p class="empty-state">{t("dashboard.self.noMyRequests")}</p>
    {:else}
      <div class="requests-list">
        {#each myRequests as req (req.id)}
          <div class="request-row">
            <div class="request-type">
              {leaveTypeLabel(req.leaveType)}
            </div>
            <div class="request-dates">
              {formatDate(req.startDate)} – {formatDate(req.endDate)}
            </div>
            <div class="request-days">{req.days} nap</div>
            <span class="badge {statusClass(req.status)}"
              >{statusLabel(req.status)}</span
            >
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/snippet}

<style>
  @import "../styles/shared.css";
  /* Manager nézet — kártyák */
  .stats-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(180px, 1fr));
    gap: 1rem;
  }

  .stat-card {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.75rem;
    background: var(--color-card, #ffffff);
  }

  .stat-label {
    font-size: 0.8rem;
    color: var(--color-muted-foreground, #64748b);
    font-weight: 500;
  }

  .stat-value {
    font-size: 2rem;
    font-weight: 700;
    color: var(--color-foreground, #0f172a);
    line-height: 1;
  }

  .stat-value.active {
    color: #16a34a;
  }
  .stat-value.pending {
    color: #d97706;
  }
  .stat-value.on-leave {
    color: #2563eb;
  }

  /* Vezetői nézet — saját adatok szakasz */
  .self-section {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    margin-top: 1rem;
    padding-top: 2rem;
    border-top: 1px solid var(--color-border, #e2e8f0);
  }

  :global(.dark) .self-section {
    border-color: var(--color-border, oklch(1 0 0 / 10%));
  }

  /* Self-service nézet — keret kártya */
  .balance-card {
    padding: 1.25rem 1.5rem;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.75rem;
    background: var(--color-card, #ffffff);
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
  }

  .balance-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
  }

  .balance-title {
    font-size: 0.95rem;
    font-weight: 600;
  }

  .balance-stats {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(6.5rem, 1fr));
    gap: 1rem;
  }

  .balance-stat {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }

  .b-label {
    font-size: 0.75rem;
    color: var(--color-muted-foreground, #64748b);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .b-value {
    font-size: 1.75rem;
    font-weight: 700;
    color: var(--color-foreground, #0f172a);
    line-height: 1;
  }

  .b-value.pending {
    color: #92400e;
  }
  .balance-actions {
    margin-top: 0.75rem;
    display: flex;
    justify-content: flex-end;
  }
  .b-value.used {
    color: #d97706;
  }
  .b-value.remaining {
    color: #16a34a;
  }

  .balance-stat.warning .b-value.remaining {
    color: #dc2626;
  }

  .btn-link {
    border: none;
    background: transparent;
    padding: 0;
    cursor: pointer;
    font-size: 0.8rem;
    color: var(--color-primary, #3730a3);
  }

  .btn-link:hover {
    text-decoration: underline;
  }

  .carry-notice {
    margin: 0;
    padding: 0.5rem 0.75rem;
    border-radius: 0.375rem;
    background: #fef3c7;
    color: #92400e;
    font-size: 0.85rem;
  }

  .carry-notice.expired {
    background: #fee2e2;
    color: #991b1b;
  }

  :global(.dark) .carry-notice {
    background: oklch(0.3 0.05 60);
    color: #fde68a;
  }

  :global(.dark) .carry-notice.expired {
    background: oklch(0.25 0.05 20);
    color: #fca5a5;
  }

  .breakdown-box {
    padding: 0.75rem 1rem;
    border-radius: 0.5rem;
    background: var(--color-accent, #f8fafc);
  }

  :global(.dark) .breakdown-box {
    background: var(--color-accent, oklch(0.269 0 0));
  }

  .balance-bar {
    width: 100%;
    height: 6px;
    background: var(--color-muted, #f1f5f9);
    border-radius: 999px;
    overflow: hidden;
  }

  .balance-bar-fill {
    height: 100%;
    background: linear-gradient(90deg, #3730a3, #6366f1);
    transition: width 0.3s;
  }

  /* Közös — request rows */
  .recent-section h3 {
    font-size: 1rem;
    font-weight: 600;
    margin: 0 0 0.75rem;
  }

  .requests-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  .request-row {
    display: flex;
    align-items: center;
    gap: 1rem;
    padding: 0.75rem 1rem;
    border: 1px solid var(--color-border, #e2e8f0);
    border-radius: 0.5rem;
    background: var(--color-card, #ffffff);
    font-size: 0.875rem;
  }

  .request-employee {
    font-weight: 600;
    min-width: 140px;
  }

  .request-type {
    color: var(--color-muted-foreground, #64748b);
    min-width: 120px;
  }

  .request-dates {
    color: var(--color-muted-foreground, #64748b);
    flex: 1;
  }

  .request-days {
    font-weight: 500;
    min-width: 60px;
    text-align: right;
  }

  .request-actions {
    display: flex;
    flex-shrink: 0;
  }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 0.2rem 0.6rem;
    border-radius: 9999px;
    font-size: 0.75rem;
    font-weight: 500;
  }

  .badge-pending {
    background: #fef3c7;
    color: #92400e;
  }
  .badge-approved {
    background: #dcfce7;
    color: #166534;
  }
  .badge-rejected {
    background: #fee2e2;
    color: #991b1b;
  }
  .badge-withdrawn {
    background: #e4e4e7;
    color: #3f3f46;
  }

  /* Loading / error */
  .error-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1rem;
    padding: 3rem 2rem;
    text-align: center;
  }

  .error-icon {
    font-size: 3rem;
    opacity: 0.7;
  }

  .error-message {
    color: #dc2626;
    font-size: 0.875rem;
    margin: 0;
    max-width: 400px;
    line-height: 1.5;
  }

  .btn-retry {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    border: 1px solid var(--color-border, #e2e8f0);
    background: var(--color-background, #fff);
    padding: 0.5rem 1rem;
    border-radius: 0.375rem;
    cursor: pointer;
    font-size: 0.875rem;
    font-weight: 500;
    transition: all 0.15s;
  }

  .btn-retry:hover {
    background: var(--color-accent, #f1f5f9);
    border-color: var(--color-primary, #3730a3);
  }

  .retry-icon {
    font-size: 1rem;
  }

  /* Sötét mód */
  :global(.dark) .stat-card,
  :global(.dark) .balance-card,
  :global(.dark) .request-row {
    background: var(--color-card, oklch(0.205 0 0));
    border-color: var(--color-border, oklch(1 0 0 / 10%));
  }

  :global(.dark) .stat-label,
  :global(.dark) .request-type,
  :global(.dark) .request-dates,
  :global(.dark) .b-label {
    color: var(--color-muted-foreground, oklch(0.708 0 0));
  }

  :global(.dark) .stat-value,
  :global(.dark) .b-value {
    color: var(--color-foreground, oklch(0.985 0 0));
  }

  :global(.dark) .balance-bar {
    background: oklch(0.3 0 0);
  }

  :global(.dark) .badge-pending {
    background: oklch(0.3 0.05 60);
    color: #fde68a;
  }
  :global(.dark) .badge-approved {
    background: oklch(0.25 0.05 145);
    color: #86efac;
  }
  :global(.dark) .badge-rejected {
    background: oklch(0.25 0.05 20);
    color: #fca5a5;
  }
  :global(.dark) .badge-withdrawn {
    background: oklch(0.3 0 0);
    color: #d4d4d8;
  }

  :global(.dark) .btn-retry {
    background: var(--color-card, oklch(0.205 0 0));
    border-color: var(--color-border, oklch(1 0 0 / 10%));
    color: var(--color-foreground, oklch(0.985 0 0));
  }
</style>
