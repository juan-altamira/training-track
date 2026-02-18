<script lang="ts">
	import type { ClientSummary, OwnerActionHistoryRow, TrainerAdminRow } from '$lib/types';
	import { goto, preloadData } from '$app/navigation';
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import { rememberLastClientRoute } from '$lib/client/sessionResumeWarmup';

	type AccountSubscriptionInfo = {
		is_owner: boolean;
		state: 'owner' | 'active' | 'expiring' | 'expired' | 'missing';
		active_until: string | null;
		now_utc: string;
		days_remaining: number | null;
	};

	type SubscriptionWarningInfo = {
		should_show: boolean;
		reason: string;
		active_until: string | null;
		days_remaining: number | null;
		warned_at: string | null;
		now_utc: string;
	};

	type OwnerActionConfirm =
		| {
				kind: 'subscription';
				formId: string;
				trainerEmail: string;
				operation: 'add' | 'remove';
				months: number;
				reason: string;
		  }
		| {
				kind: 'disable';
				formId: string;
				trainerEmail: string;
		  };

	type OwnerSubscriptionDraft = {
		operation: 'add' | 'remove';
		months: number;
	};

	type OwnerTrainerTab = 'expiring' | 'active' | 'inactive';

	type OwnerTrainerView = {
		rowKey: string;
		trainer: TrainerAdminRow;
		remainingMs: number;
		remainingLabel: string;
		daysRemaining: number;
		activeNow: boolean;
		createdAtTs: number;
	};

	let { data, form } = $props();
	const OWNER_EMAIL = 'juanpabloaltamira@protonmail.com';
	let clients = (data?.clients ?? []) as ClientSummary[];
	let trainerAdmin = $state((data?.trainerAdmin ?? null) as TrainerAdminRow[] | null);
	let ownerActionHistory = $state((data?.ownerActionHistory ?? null) as OwnerActionHistoryRow[] | null);
	let isOwner = data?.isOwner ?? false;
	const lazyAdmin = data?.lazyAdmin === true;
	const SITE_URL = (data?.siteUrl ?? '').replace(/\/?$/, '');
	const accountSubscription = (data?.accountSubscription ?? null) as AccountSubscriptionInfo | null;
	const subscriptionWarning = (data?.subscriptionWarning ?? null) as SubscriptionWarningInfo | null;
	let deleteTarget = $state<ClientSummary | null>(null);
	let deleteConfirm = $state('');
	let openingId = $state<string | null>(null);
	let copiedId = $state<string | null>(null);
	let searchTerm = $state('');
	let creating = $state(false);
	let formMessage = $state<string | null>(null);
	let showOwnerPanel = $state(isOwner && !lazyAdmin);
	let loadingOwnerPanel = $state(false);
	let ownerPanelError = $state<string | null>(null);
	let ownerActionConfirm = $state<OwnerActionConfirm | null>(null);
	let ownerTrainerSearchTerm = $state('');
	let ownerTrainerCreateUiError = $state<string | null>(null);
	let ownerTrainerTab = $state<OwnerTrainerTab>('expiring');
	let expandedOwnerTrainerRowKey = $state<string | null>(null);
	let showOwnerHistory = $state(false);
	const TRIAL_HOUR_OPTION = 0;
	const TRIAL_DURATION_SECONDS = 60 * 60;
	const MONTH_OPTIONS = Array.from({ length: 12 }, (_, idx) => idx + 1);
	const DURATION_OPTIONS = [TRIAL_HOUR_OPTION, ...MONTH_OPTIONS];
	const OWNER_HISTORY_WINDOW_HOURS = 24;
	const ONE_DAY_MS = 1000 * 60 * 60 * 24;
	const ONE_HOUR_MS = 1000 * 60 * 60;
	const ONE_MINUTE_MS = 1000 * 60;
	const COUNTDOWN_TICK_MS = 30 * 1000;
	const serverNowReferenceTs = Date.parse(
		accountSubscription?.now_utc ?? subscriptionWarning?.now_utc ?? ''
	);
	const serverClockOffsetMs = Number.isFinite(serverNowReferenceTs)
		? serverNowReferenceTs - Date.now()
		: 0;
	let ownerSubscriptionDrafts = $state<Record<string, OwnerSubscriptionDraft>>({});
	let nowTick = $state(Date.now() + serverClockOffsetMs);
	const formatDateTime = (value?: string | null) => (value ? new Date(value).toLocaleString() : 'n/a');
	const toSafeId = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, '-');
	const toDraftOperation = (value: string): OwnerSubscriptionDraft['operation'] =>
		value === 'remove' ? 'remove' : 'add';
	const parseDraftMonths = (value: string) => {
		const parsed = Number.parseInt(value, 10);
		if (!Number.isFinite(parsed)) return 1;
		if (parsed === TRIAL_HOUR_OPTION) return TRIAL_HOUR_OPTION;
		return Math.min(12, Math.max(1, parsed));
	};
	const isTrialHourDuration = (months: number) => months === TRIAL_HOUR_OPTION;
	const formatDurationLabel = (months: number) =>
		isTrialHourDuration(months) ? '1 hora' : `${months} mes${months === 1 ? '' : 'es'}`;
	const durationSecondsFromMonths = (months: number) =>
		isTrialHourDuration(months) ? TRIAL_DURATION_SECONDS : months * 30 * 24 * 60 * 60;
	const normalizeEmail = (value: string | null | undefined) => (value ?? '').trim().toLowerCase();
	const isValidEmailFormat = (value: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
	const getOwnerSubscriptionDraft = (rowKey: string): OwnerSubscriptionDraft =>
		ownerSubscriptionDrafts[rowKey] ?? { operation: 'add', months: 1 };
	const setOwnerSubscriptionDraft = (rowKey: string, patch: Partial<OwnerSubscriptionDraft>) => {
		const current = getOwnerSubscriptionDraft(rowKey);
		ownerSubscriptionDrafts = {
			...ownerSubscriptionDrafts,
			[rowKey]: {
				...current,
				...patch
			}
		};
	};
	const isRemovalAdjustment = (draft: OwnerSubscriptionDraft) => draft.operation === 'remove';
	const isHighRiskRemovalAdjustment = (draft: OwnerSubscriptionDraft) =>
		draft.operation === 'remove' && draft.months >= 3;
	const getHistoryDetails = (entry: OwnerActionHistoryRow) =>
		entry.details && typeof entry.details === 'object' ? entry.details : {};
	const getHistoryActionLabel = (entry: OwnerActionHistoryRow) => {
		const details = getHistoryDetails(entry);
		if (entry.action_type === 'add_trainer') return 'Habilitaste entrenador';
		if (entry.action_type === 'force_sign_out') return 'Cerraste sesiones activas';
		if (entry.action_type === 'toggle_trainer') {
			return details?.next_active === true ? 'Habilitaste acceso' : 'Deshabilitaste acceso';
		}
		if (entry.action_type === 'grant_subscription') {
			const operation = details?.operation === 'remove' ? 'remove' : 'add';
			const monthsRaw = Number(details?.months ?? NaN);
			const durationSecondsRaw = Number(details?.duration_seconds ?? NaN);
			const isTrialHour =
				details?.duration_unit === 'hour' ||
				(Number.isFinite(monthsRaw) && monthsRaw === TRIAL_HOUR_OPTION) ||
				(Number.isFinite(durationSecondsRaw) && Math.abs(durationSecondsRaw) === TRIAL_DURATION_SECONDS);
			if (isTrialHour) {
				return `${operation === 'remove' ? 'Quitaste' : 'Sumaste'} 1 hora`;
			}
			const safeMonths = Number.isFinite(monthsRaw) && monthsRaw > 0 ? monthsRaw : 1;
			return `${operation === 'remove' ? 'Quitaste' : 'Sumaste'} ${safeMonths} mes${safeMonths === 1 ? '' : 'es'}`;
		}
		return 'Acción administrativa';
	};
	const getHistoryActionTone = (entry: OwnerActionHistoryRow) => {
		const details = getHistoryDetails(entry);
		if (entry.action_type === 'toggle_trainer' && details?.next_active === false) {
			return 'border-red-800/70 bg-red-950/25 text-red-100';
		}
		if (entry.action_type === 'grant_subscription' && details?.operation === 'remove') {
			const monthsRaw = Number(details?.months ?? 0);
			return Number.isFinite(monthsRaw) && monthsRaw >= 3
				? 'border-red-800/70 bg-red-950/25 text-red-100'
				: 'border-amber-800/70 bg-amber-950/20 text-amber-100';
		}
		return 'border-slate-800/80 bg-[#0f1322] text-slate-100';
	};
	const getHistoryActionContext = (entry: OwnerActionHistoryRow) => {
		const details = getHistoryDetails(entry);
		const target = entry.target_email ? `en ${entry.target_email}` : 'sin email objetivo';
		if (entry.action_type === 'grant_subscription') {
			const afterValue = typeof details?.active_until_after === 'string' ? details.active_until_after : null;
			const afterText = afterValue ? ` | vence: ${formatDateTime(afterValue)}` : '';
			return `${target}${afterText}`;
		}
		return target;
	};

	const parseTimestamp = (value?: string | null) => {
		if (!value) return 0;
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : 0;
	};

	const getRemainingMs = (activeUntil?: string | null) => {
		if (!activeUntil) return null;
		const untilTs = parseTimestamp(activeUntil);
		if (untilTs <= 0) return null;
		return untilTs - nowTick;
	};

	const getDaysRemaining = (activeUntil?: string | null) => {
		const diffMs = getRemainingMs(activeUntil);
		if (diffMs == null) return 0;
		if (diffMs <= 0) return 0;
		return Math.ceil(diffMs / ONE_DAY_MS);
	};

	const formatRemainingLabel = (activeUntil?: string | null, fallbackDays?: number | null) => {
		const diffMs = getRemainingMs(activeUntil);
		if (diffMs == null) {
			if (fallbackDays != null) {
				return `${fallbackDays} día${fallbackDays === 1 ? '' : 's'}`;
			}
			return '?';
		}
		if (diffMs <= 0) return '0 minutos';
		if (diffMs < ONE_HOUR_MS) {
			const minutes = Math.max(1, Math.ceil(diffMs / ONE_MINUTE_MS));
			return `${minutes} minuto${minutes === 1 ? '' : 's'}`;
		}
		if (diffMs < ONE_DAY_MS) {
			const hours = Math.max(1, Math.ceil(diffMs / ONE_HOUR_MS));
			return `${hours} hora${hours === 1 ? '' : 's'}`;
		}
		const days = Math.ceil(diffMs / ONE_DAY_MS);
		return `${days} día${days === 1 ? '' : 's'}`;
	};

	const formatRemainingCompactLabel = (activeUntil?: string | null) => {
		const diffMs = getRemainingMs(activeUntil);
		if (diffMs == null) return 'n/a';
		if (diffMs <= 0) return 'vencida';
		if (diffMs < ONE_HOUR_MS) {
			const minutes = Math.max(1, Math.ceil(diffMs / ONE_MINUTE_MS));
			return `${minutes} min`;
		}
		if (diffMs < ONE_DAY_MS) {
			const hours = Math.max(1, Math.ceil(diffMs / ONE_HOUR_MS));
			return `${hours} h`;
		}
		const days = Math.ceil(diffMs / ONE_DAY_MS);
		return `${days} día${days === 1 ? '' : 's'}`;
	};

	const getSubscriptionVisualState = (summary: AccountSubscriptionInfo) => {
		const diffMs = getRemainingMs(summary.active_until);
		if (diffMs == null) return summary.state;
		if (diffMs <= 0) return 'expired';
		if (diffMs <= 5 * ONE_DAY_MS) return 'expiring';
		return 'active';
	};

	const getSubscriptionWarningMessage = (warning: SubscriptionWarningInfo) => {
		const diffMs = getRemainingMs(warning.active_until);
		if (diffMs != null && diffMs <= 0) {
			return 'Tu suscripción está vencida.';
		}
		return `Tu suscripción vence en ${formatRemainingLabel(
			warning.active_until,
			warning.days_remaining
		)}.`;
	};

	const isSubscriptionActiveNow = (activeUntil?: string | null) => {
		const diffMs = getRemainingMs(activeUntil);
		return diffMs != null && diffMs > 0;
	};

	const getOwnerTrainerViews = (trainers: TrainerAdminRow[]) =>
		trainers.map((trainer) => {
			const rowKey = trainer.trainer_id ?? toSafeId(trainer.email);
			const remainingMsRaw = getRemainingMs(trainer.active_until);
			const remainingMs = remainingMsRaw == null ? 0 : Math.max(remainingMsRaw, 0);
			const daysRemaining = remainingMs > 0 ? Math.ceil(remainingMs / ONE_DAY_MS) : 0;
			const activeNow = trainer.active === true && isSubscriptionActiveNow(trainer.active_until);
			return {
				rowKey,
				trainer,
				remainingMs,
				remainingLabel: formatRemainingCompactLabel(trainer.active_until),
				daysRemaining,
				activeNow,
				createdAtTs: parseTimestamp(trainer.created_at)
			} satisfies OwnerTrainerView;
		});

	const sortByCreatedDesc = (a: OwnerTrainerView, b: OwnerTrainerView) =>
		b.createdAtTs - a.createdAtTs || a.trainer.email.localeCompare(b.trainer.email);

	const sortByExpirationAsc = (a: OwnerTrainerView, b: OwnerTrainerView) =>
		a.remainingMs - b.remainingMs || sortByCreatedDesc(a, b);

	onMount(() => {
		const intervalId = window.setInterval(() => {
			nowTick = Date.now() + serverClockOffsetMs;
		}, COUNTDOWN_TICK_MS);
		return () => {
			window.clearInterval(intervalId);
		};
	});

	const getTrainersByTab = (trainers: TrainerAdminRow[]) => {
		const views = getOwnerTrainerViews(trainers);
		const activeViews = views.filter((view) => view.activeNow);
		const inactiveViews = views.filter((view) => !view.activeNow);
		return {
			expiring: [...activeViews].sort(sortByExpirationAsc),
			active: [...activeViews].sort(sortByCreatedDesc),
			inactive: [...inactiveViews].sort(sortByCreatedDesc)
		} as const;
	};

	const setOwnerTrainerTab = (tab: OwnerTrainerTab) => {
		ownerTrainerTab = tab;
		expandedOwnerTrainerRowKey = null;
	};

	const toggleOwnerTrainerRow = (rowKey: string) => {
		expandedOwnerTrainerRowKey = expandedOwnerTrainerRowKey === rowKey ? null : rowKey;
	};

	const toggleOwnerHistory = async () => {
		if (!showOwnerPanel) {
			showOwnerPanel = true;
			if (lazyAdmin) {
				await loadTrainerAdmin();
			}
			showOwnerHistory = true;
			return;
		}
		showOwnerHistory = !showOwnerHistory;
	};

	const daysRemainingTone = (days: number) => {
		if (days <= 5) return 'text-red-300';
		if (days <= 10) return 'text-amber-300';
		return 'text-emerald-300';
	};

	const daysRemainingBadgeTone = (days: number) => {
		if (days <= 5) return 'border-red-700/60 bg-red-900/30 text-red-200';
		if (days <= 10) return 'border-amber-700/60 bg-amber-900/25 text-amber-200';
		return 'border-emerald-700/50 bg-emerald-900/20 text-emerald-200';
	};

	const subscriptionStateLabel = (state?: AccountSubscriptionInfo['state']) => {
		if (state === 'owner') return 'Cuenta owner';
		if (state === 'expired') return 'Suscripción vencida';
		if (state === 'expiring') return 'Suscripción por vencer';
		if (state === 'active') return 'Suscripción activa';
		return 'Sin información de suscripción';
	};

	const ensureGrantIdempotencyKey = (event: SubmitEvent) => {
		const formEl = event.currentTarget as HTMLFormElement | null;
		if (!formEl) return;
		const input = formEl.querySelector<HTMLInputElement>('input[name="idempotency_key"]');
		if (!input) return;
		input.value = crypto.randomUUID();
	};

	const isConfirmedSubmit = (formEl: HTMLFormElement) => formEl.dataset.confirmedSubmit === '1';

	const resetConfirmedSubmit = (formEl: HTMLFormElement) => {
		delete formEl.dataset.confirmedSubmit;
	};

	const requestConfirmedSubmit = (formId: string) => {
		const formEl = document.getElementById(formId) as HTMLFormElement | null;
		if (!formEl) return;
		formEl.dataset.confirmedSubmit = '1';
		formEl.requestSubmit();
	};

	const openSubscriptionConfirm = (event: SubmitEvent, formId: string, trainerEmail: string) => {
		const formEl = event.currentTarget as HTMLFormElement | null;
		if (!formEl) return;

		if (isConfirmedSubmit(formEl)) {
			resetConfirmedSubmit(formEl);
			return;
		}

		event.preventDefault();
		ensureGrantIdempotencyKey(event);

		const formData = new FormData(formEl);
		const operation = String(formData.get('operation') || 'add').trim().toLowerCase();
		const months = parseDraftMonths(String(formData.get('months') || '1'));
		const reason = String(formData.get('reason') || '').trim();

		ownerActionConfirm = {
			kind: 'subscription',
			formId,
			trainerEmail,
			operation: operation === 'remove' ? 'remove' : 'add',
			months,
			reason
		};
	};

	const openDisableConfirm = (
		event: SubmitEvent,
		formId: string,
		trainerEmail: string,
		nextActive: boolean
	) => {
		const formEl = event.currentTarget as HTMLFormElement | null;
		if (!formEl) return;

		if (isConfirmedSubmit(formEl)) {
			resetConfirmedSubmit(formEl);
			return;
		}

		// Solo pedimos confirmación para deshabilitar.
		if (nextActive) {
			return;
		}

		event.preventDefault();
		ownerActionConfirm = {
			kind: 'disable',
			formId,
			trainerEmail
		};
	};

	const closeOwnerActionConfirm = () => {
		ownerActionConfirm = null;
	};

	const confirmOwnerAction = () => {
		const pending = ownerActionConfirm;
		if (!pending) return;
		ownerActionConfirm = null;
		requestConfirmedSubmit(pending.formId);
	};

	const copyLink = async (client: ClientSummary) => {
		const link = `${SITE_URL}/r/${client.client_code}`;
		await navigator.clipboard.writeText(link);
		copiedId = client.id;
		setTimeout(() => {
			if (copiedId === client.id) copiedId = null;
		}, 2000);
	};

	const activityLabel = (days?: number | null) => {
		if (days == null) return 'Sin actividad registrada';
		if (days === 0) return 'Hoy';
		if (days === 1) return 'Hace 1 día';
		return `Hace ${days} días`;
	};

	const activityColor = (days?: number | null) => {
		if (days == null) return 'text-slate-500';
		if (days < 3) return 'text-emerald-600';
		if (days <= 7) return 'text-amber-600';
		return 'text-red-600';
	};


	const warmClientRoute = (clientId: string) => {
		void preloadData(`/clientes/${clientId}`);
	};

	const openClient = async (client: ClientSummary) => {
		openingId = client.id;
		rememberLastClientRoute(client.id);
		await goto(`/clientes/${client.id}`);
		openingId = null;
	};

	const loadTrainerAdmin = async () => {
		if (!isOwner || trainerAdmin || loadingOwnerPanel) return;

		loadingOwnerPanel = true;
		ownerPanelError = null;
		try {
			const response = await fetch('/clientes/admin-trainers');
			if (!response.ok) {
				throw new Error('No se pudo cargar el panel administrador');
			}
				const payload = (await response.json()) as {
					trainers?: TrainerAdminRow[];
					ownerActionHistory?: OwnerActionHistoryRow[];
				};
				trainerAdmin = payload.trainers ?? [];
				ownerActionHistory = payload.ownerActionHistory ?? [];
			} catch (e) {
				console.error(e);
				ownerPanelError = 'No pudimos cargar el panel administrador. Intentá de nuevo.';
		} finally {
			loadingOwnerPanel = false;
		}
	};

	const toggleOwnerPanel = async () => {
		showOwnerPanel = !showOwnerPanel;
		if (!showOwnerPanel) {
			showOwnerHistory = false;
			expandedOwnerTrainerRowKey = null;
		}
		if (showOwnerPanel && lazyAdmin) {
			await loadTrainerAdmin();
		}
	};

	const normalizeText = (value: string | undefined | null) =>
		(value ?? '')
			.normalize('NFD')
			.replace(/\p{Diacritic}/gu, '')
			.toLowerCase();

	const filteredClients = () => {
		const term = normalizeText(searchTerm).trim();
		if (!term) return clients;
		return clients.filter((client) => normalizeText(client.name).includes(term));
	};

	const filteredOwnerTrainers = () => {
		if (!trainerAdmin) return [];
		const term = normalizeText(ownerTrainerSearchTerm).trim();
		const visibleTrainers = trainerAdmin.filter(
			(trainer) => trainer.email?.toLowerCase() !== OWNER_EMAIL && Boolean(trainer.trainer_id)
		);
		if (!term) return visibleTrainers;
		return visibleTrainers.filter((trainer) => normalizeText(trainer.email).includes(term));
	};

	const ownerEmailAlreadyExists = (rawValue: string) => {
		const email = normalizeEmail(rawValue);
		if (!email || !trainerAdmin) return false;
		return trainerAdmin.some((trainer) => normalizeEmail(trainer.email) === email);
	};

	const handleOwnerCreateInput = () => {
		ownerTrainerCreateUiError = null;
	};

	const handleOwnerCreateSubmit = (event: SubmitEvent) => {
		const formEl = event.currentTarget as HTMLFormElement | null;
		if (!formEl) return;

		const normalizedEmail = normalizeEmail(ownerTrainerSearchTerm);
		ownerTrainerSearchTerm = normalizedEmail;
		ownerTrainerCreateUiError = null;

		if (!normalizedEmail) {
			event.preventDefault();
			ownerTrainerCreateUiError = 'Escribí un email para buscar o crear.';
			return;
		}

		if (!isValidEmailFormat(normalizedEmail)) {
			event.preventDefault();
			ownerTrainerCreateUiError = 'Ingresá un email válido para crear el entrenador.';
			return;
		}

		if (ownerEmailAlreadyExists(normalizedEmail)) {
			event.preventDefault();
			ownerTrainerCreateUiError = 'Ese email ya existe. Usá la fila del entrenador para gestionarlo.';
			return;
		}

		const input = formEl.querySelector<HTMLInputElement>('input[name="email"]');
		if (input) {
			input.value = normalizedEmail;
		}
	};

	const hasOwnerTrainerSearchTerm = () => normalizeText(ownerTrainerSearchTerm).trim().length > 0;

	const getOwnerTrainerSearchRows = (trainers: TrainerAdminRow[]) =>
		getOwnerTrainerViews(trainers).sort((a, b) => {
			if (a.activeNow !== b.activeNow) return a.activeNow ? -1 : 1;
			return sortByCreatedDesc(a, b);
		});
</script>

<section class="flex flex-col gap-8 text-slate-100">
	<div class="py-5 sm:py-6 mb-4 text-center">
		<h1 class="text-2xl sm:text-3xl md:text-4xl font-semibold tracking-tight text-slate-100">
			Todos tus alumnos en un solo lugar.
		</h1>
		<p class="mt-3 text-base sm:text-lg text-slate-400">Ves actividad y abrís su rutina en un click.</p>
	</div>

	{#if accountSubscription && accountSubscription.state !== 'owner'}
		{@const accountSubscriptionVisualState = getSubscriptionVisualState(accountSubscription)}
		<div
			class={`rounded-xl border px-4 py-3 text-sm shadow-md shadow-black/20 ${
				accountSubscriptionVisualState === 'expired'
					? 'border-red-700/60 bg-red-900/20 text-red-200'
					: accountSubscriptionVisualState === 'expiring'
						? 'border-amber-700/60 bg-amber-900/20 text-amber-200'
						: 'border-emerald-700/50 bg-emerald-900/10 text-emerald-200'
			}`}
		>
			<p class="font-semibold text-base">{subscriptionStateLabel(accountSubscriptionVisualState)}</p>
			{#if accountSubscription.active_until}
				<p>
					Vence: <span class="font-semibold">{formatDateTime(accountSubscription.active_until)}</span>
				</p>
			{/if}
			{#if accountSubscription.days_remaining != null}
				<p>
					Quedan:
					<span class="font-semibold">
						{formatRemainingLabel(accountSubscription.active_until, accountSubscription.days_remaining)}
					</span>
				</p>
			{/if}
		</div>
	{/if}

	{#if subscriptionWarning}
		<div class="rounded-xl border border-amber-700/60 bg-amber-900/25 px-4 py-3 text-sm text-amber-100 shadow-md shadow-black/20">
			<p class="font-semibold text-base">
				{getSubscriptionWarningMessage(subscriptionWarning)}
			</p>
			<p>Renovala antes del vencimiento para evitar cortes de acceso.</p>
		</div>
	{/if}

	{#if isOwner}
		<section class="rounded-xl border border-emerald-900/40 bg-[#0f111b] p-7 sm:p-8 shadow-lg shadow-black/30 text-slate-100 space-y-8">
			<div class="flex flex-col gap-6">
				<div>
					<p class="text-2xl font-bold tracking-tight text-emerald-400">Panel de administrador</p>
				</div>
					<div class="flex w-full gap-4 sm:justify-end">
						<button
							type="button"
							class="h-12 flex-1 rounded-lg border border-emerald-700/60 bg-emerald-700/20 px-4 text-sm font-semibold text-emerald-200 hover:bg-emerald-700/30 sm:h-11 sm:w-auto sm:min-w-[11rem] sm:flex-none"
							on:click={toggleOwnerPanel}
							aria-expanded={showOwnerPanel}
							aria-controls="owner-admin-content"
						>
							{showOwnerPanel ? 'Ocultar panel' : 'Abrir panel'}
						</button>
						<button
							type="button"
							class="h-12 flex-1 rounded-lg border border-slate-700 bg-[#151827] px-4 text-sm font-semibold text-slate-200 hover:bg-[#1b2031] sm:h-11 sm:w-auto sm:min-w-[11rem] sm:flex-none"
							on:click={toggleOwnerHistory}
							aria-controls="owner-history-panel"
							aria-expanded={showOwnerHistory}
						>
						{showOwnerHistory ? 'Ocultar historial' : 'Ver historial'}
					</button>
				</div>
			</div>
				{#if showOwnerPanel}
					<div id="owner-admin-content" class="space-y-9">
						{#if form?.message}
							<p
								class={`rounded-lg border px-3 py-2 text-sm ${
									form?.success === true
										? 'border-emerald-700/50 bg-emerald-900/20 text-emerald-200'
										: 'border-red-700/50 bg-red-900/20 text-red-200'
								}`}
							>
								{form.message}
							</p>
						{/if}
						{#if loadingOwnerPanel}
							<p class="text-sm text-slate-300">Cargando panel administrador...</p>
						{:else if ownerPanelError}
						<div class="flex flex-wrap items-center gap-3">
							<p class="text-sm text-red-200">{ownerPanelError}</p>
							<button
								type="button"
								class="rounded-lg border border-red-600 px-3 py-1.5 text-xs font-semibold text-red-200 hover:bg-red-900/40"
								on:click={loadTrainerAdmin}
							>
								Reintentar
							</button>
						</div>
							{:else}
								{@const ownerQueryExists = ownerEmailAlreadyExists(ownerTrainerSearchTerm)}
								{@const ownerQueryNormalized = normalizeEmail(ownerTrainerSearchTerm)}
								{#if showOwnerHistory}
										<div id="owner-history-panel" class="rounded-lg border border-slate-800/80 bg-[#0f1322] p-4">
										<h4 class="text-sm font-semibold text-slate-100">Historial ({OWNER_HISTORY_WINDOW_HOURS}h)</h4>
										{#if ownerActionHistory && ownerActionHistory.length > 0}
												<div class="mt-4 max-h-72 space-y-3 overflow-auto pr-1">
												{#each ownerActionHistory as historyEntry (historyEntry.id)}
														<article class={`rounded-lg border px-3 py-3 ${getHistoryActionTone(historyEntry)}`}>
														<div class="flex flex-wrap items-center justify-between gap-2">
															<p class="text-sm font-semibold">{getHistoryActionLabel(historyEntry)}</p>
															<time class="text-xs text-slate-300">{formatDateTime(historyEntry.created_at)}</time>
														</div>
														<p class="mt-1 text-xs text-slate-300">{getHistoryActionContext(historyEntry)}</p>
													</article>
												{/each}
											</div>
										{:else}
											<p class="mt-3 text-sm text-slate-400">Sin movimientos en esta ventana.</p>
										{/if}
									</div>
								{/if}
								<form
									method="post"
									action="?/addTrainer"
									on:submit={handleOwnerCreateSubmit}
										class="grid gap-5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
							>
								<input
									name="email"
									type="text"
									placeholder="Buscá o creá por email..."
										class={`w-full rounded-lg border bg-[#151827] px-4 py-3.5 text-base text-slate-100 shadow-sm focus:outline-none focus:ring-2 ${
										ownerQueryExists
											? 'border-amber-600/80 focus:border-amber-500 focus:ring-amber-500/30'
											: 'border-slate-700 focus:border-emerald-500 focus:ring-emerald-500/40'
									}`}
									bind:value={ownerTrainerSearchTerm}
									on:input={handleOwnerCreateInput}
									required
								/>
								<button
									type="submit"
										class="rounded-lg bg-emerald-600 px-4 py-3.5 text-base font-semibold text-white hover:bg-emerald-500"
								>
									Habilitar entrenador
								</button>
							</form>
							{#if ownerQueryExists && ownerQueryNormalized}
								<p class="rounded-lg border border-amber-700/50 bg-amber-900/20 px-3 py-2 text-sm text-amber-200">
									<span class="font-semibold">{ownerQueryNormalized}</span> ya existe. No se puede crear de nuevo.
								</p>
							{/if}
								{#if ownerTrainerCreateUiError}
									<p class="rounded-lg border border-red-700/50 bg-red-900/20 px-3 py-2 text-sm text-red-200">
										{ownerTrainerCreateUiError}
									</p>
								{/if}

								{#if trainerAdmin && trainerAdmin.length > 0}
										{@const visibleOwnerTrainers = filteredOwnerTrainers()}
									{@const groupedOwnerTrainers = getTrainersByTab(visibleOwnerTrainers)}
									{@const globalSearchMode = hasOwnerTrainerSearchTerm()}
										<div class="rounded-lg border border-slate-800/80 bg-[#0f1322] p-4">
											<div class="grid grid-cols-3 gap-4">
											<button
												type="button"
													class={`rounded-lg px-3 py-3.5 text-sm font-semibold transition ${
													ownerTrainerTab === 'expiring'
														? 'bg-emerald-700/25 text-emerald-200 border border-emerald-600/60'
														: 'bg-[#111827] text-slate-300 border border-slate-700 hover:bg-[#161c2c]'
												}`}
												on:click={() => setOwnerTrainerTab('expiring')}
											>
												Vence pronto
											</button>
											<button
												type="button"
													class={`rounded-lg px-3 py-3.5 text-sm font-semibold transition ${
													ownerTrainerTab === 'active'
														? 'bg-emerald-700/25 text-emerald-200 border border-emerald-600/60'
														: 'bg-[#111827] text-slate-300 border border-slate-700 hover:bg-[#161c2c]'
												}`}
												on:click={() => setOwnerTrainerTab('active')}
											>
												Activo
											</button>
											<button
												type="button"
													class={`rounded-lg px-3 py-3.5 text-sm font-semibold transition ${
													ownerTrainerTab === 'inactive'
														? 'bg-emerald-700/25 text-emerald-200 border border-emerald-600/60'
														: 'bg-[#111827] text-slate-300 border border-slate-700 hover:bg-[#161c2c]'
												}`}
												on:click={() => setOwnerTrainerTab('inactive')}
											>
												Inactivo
											</button>
										</div>
									</div>

									{#if globalSearchMode}
										<p class="text-xs text-slate-400">
											Mostrando resultados globales (activos e inactivos).
										</p>
									{/if}
									{@const visibleOwnerRows = globalSearchMode ? getOwnerTrainerSearchRows(visibleOwnerTrainers) : groupedOwnerTrainers[ownerTrainerTab]}
									{#if visibleOwnerRows.length === 0}
										<div class="rounded-lg border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-400">
											No encontramos entrenadores para ese criterio.
										</div>
									{:else}
											<div class="space-y-4">
											{#each visibleOwnerRows as ownerRow (ownerRow.rowKey)}
												{@const trainer = ownerRow.trainer}
												{@const rowKey = ownerRow.rowKey}
												{@const rowOpen = expandedOwnerTrainerRowKey === rowKey}
												{@const subscriptionDraft = getOwnerSubscriptionDraft(rowKey)}
												{@const removalAdjustment = isRemovalAdjustment(subscriptionDraft)}
												{@const highRiskRemoval = isHighRiskRemovalAdjustment(subscriptionDraft)}
													<article class="rounded-lg border border-slate-800/90 bg-[#111526]">
														<button
															type="button"
															class="flex w-full items-center justify-between gap-3 px-4 py-5 text-left"
															on:click={() => toggleOwnerTrainerRow(rowKey)}
														>
														<span class="min-w-0 truncate text-sm font-semibold text-slate-100" title={trainer.email}>
															{trainer.email}
														</span>
														<div class="flex items-center gap-3">
															<span class={`rounded-full border px-2.5 py-1 text-xs font-semibold ${daysRemainingBadgeTone(ownerRow.daysRemaining)}`}>
																{ownerRow.remainingLabel}
															</span>
														</div>
													</button>

														{#if rowOpen}
															<div class="border-t border-slate-800/80 px-4 py-6 space-y-6">
																<p class="text-xs text-slate-400">
																	Vence: {trainer.active_until ? formatDateTime(trainer.active_until) : 'n/a'}
																</p>

															<form
																id={`grant-subscription-${rowKey}`}
																method="post"
																action="?/grantSubscription"
																class={`grid gap-6 rounded-lg border px-4 py-5 sm:grid-cols-[1fr_auto] ${
																	highRiskRemoval
																		? 'border-red-700/60 bg-red-950/20'
																		: removalAdjustment
																			? 'border-amber-700/60 bg-amber-950/20'
																			: 'border-slate-800/80 bg-[#0f1322]'
																}`}
																on:submit={(event) =>
																	openSubscriptionConfirm(event, `grant-subscription-${rowKey}`, trainer.email)}
															>
																<input type="hidden" name="trainer_id" value={trainer.trainer_id ?? ''} />
																<input type="hidden" name="trainer_email" value={trainer.email} />
																<input type="hidden" name="idempotency_key" value="" />
																<input type="hidden" name="reason" value="" />
																	<div class="grid grid-cols-2 gap-6">
																		<div class="relative">
																			<select
																				name="operation"
																				value={subscriptionDraft.operation}
																				on:change={(event) =>
																					setOwnerSubscriptionDraft(rowKey, {
																						operation: toDraftOperation(
																							(event.currentTarget as HTMLSelectElement).value
																						)
																					})}
																				class="custom-select w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2.5 pr-10 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
																			>
																				<option value="add">Sumar</option>
																				<option value="remove">Quitar</option>
																			</select>
																			<svg
																				class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
																				viewBox="0 0 20 20"
																				fill="none"
																				aria-hidden="true"
																			>
																				<path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path>
																			</svg>
																		</div>
																		<div class="relative">
																			<select
																				name="months"
																				value={subscriptionDraft.months}
																				on:change={(event) =>
																					setOwnerSubscriptionDraft(rowKey, {
																						months: parseDraftMonths(
																							(event.currentTarget as HTMLSelectElement).value
																						)
																					})}
																				class="custom-select w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2.5 pr-10 text-sm text-slate-100 focus:border-emerald-500 focus:outline-none"
																			>
																				{#each DURATION_OPTIONS as durationOption}
																					<option value={durationOption}>
																						{formatDurationLabel(durationOption)}
																					</option>
																				{/each}
																			</select>
																			<svg
																				class="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
																				viewBox="0 0 20 20"
																				fill="none"
																				aria-hidden="true"
																			>
																				<path d="M6 8l4 4 4-4" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"></path>
																			</svg>
																		</div>
																		{#if removalAdjustment}
																			<p class={`col-span-2 text-xs ${
																				highRiskRemoval ? 'text-red-200' : 'text-amber-200'
																			}`}>
																				{highRiskRemoval
																					? `Alerta de riesgo alto: vas a quitar ${subscriptionDraft.months} meses.`
																					: isTrialHourDuration(subscriptionDraft.months)
																						? 'Acción sensible: quitando 1 hora de suscripción.'
																						: 'Acción sensible: quitando meses de suscripción.'}
																			</p>
																		{/if}
																</div>
																<button
																	type="submit"
																		class={`w-full rounded-lg border px-4 py-3 text-sm font-semibold sm:w-auto ${
																		highRiskRemoval
																			? 'border-red-600 text-red-200 hover:bg-red-900/40'
																			: removalAdjustment
																				? 'border-amber-600 text-amber-200 hover:bg-amber-900/40'
																				: 'border-emerald-600 text-emerald-200 hover:bg-emerald-900/40'
																	}`}
																>
																	Aplicar ajuste
																</button>
															</form>

															<div class="grid gap-5 sm:grid-cols-2">
																<form
																	id={`toggle-trainer-${rowKey}`}
																	method="post"
																	action="?/toggleTrainer"
																	on:submit={(event) =>
																		openDisableConfirm(event, `toggle-trainer-${rowKey}`, trainer.email, !trainer.active)}
																>
																	<input type="hidden" name="email" value={trainer.email} />
																	<input type="hidden" name="next_active" value={!trainer.active} />
																	<button
																			class={`w-full rounded-lg px-3 py-3.5 text-sm font-semibold ${
																			trainer.active
																				? 'border border-red-600 text-red-200 hover:bg-red-900/50'
																				: 'border border-emerald-600 text-emerald-200 hover:bg-emerald-900/40'
																		}`}
																		type="submit"
																	>
																		{trainer.active ? 'Deshabilitar cuenta' : 'Habilitar cuenta'}
																	</button>
																</form>
																<form method="post" action="?/forceSignOut">
																	<input type="hidden" name="email" value={trainer.email} />
																	<button
																		type="submit"
																		class="w-full rounded-lg border border-slate-600 px-3 py-3.5 text-sm font-semibold text-slate-200 hover:bg-[#151827]"
																	>
																		Cerrar sesiones
																	</button>
																</form>
															</div>
														</div>
													{/if}
												</article>
											{/each}
										</div>
									{/if}
								{:else}
										<div class="rounded-lg border border-dashed border-slate-700 px-4 py-5 text-sm text-slate-400">
											No hay entrenadores registrados.
										</div>
								{/if}

							{/if}
					</div>
			{/if}
		</section>
	{/if}

		<section class="grid gap-8 sm:gap-10 lg:gap-6 lg:grid-cols-[2fr,1fr] lg:items-start">
			<form
				method="post"
				action="?/create"
				class="order-1 lg:order-3 lg:col-start-2 lg:row-span-2 space-y-5 rounded-xl border border-slate-800 bg-[#0f111b] p-7 shadow-lg shadow-black/30"
				use:enhance={() => {
					creating = true;
					formMessage = null;
					return async ({ result, update }) => {
						creating = false;
						if (result.type === 'failure' && result.data?.message) {
							formMessage = result.data.message as string;
						} else if (result.type === 'redirect') {
							formMessage = null;
						}
						await update({ reset: result.type === 'redirect' });
					};
				}}
			>
				<div class="space-y-2">
					<h2 class="text-2xl font-extrabold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-50">
						Crear alumno
					</h2>
				</div>

				<label class="block text-base font-medium text-slate-200">
					Nombre
					<input
						class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
						name="name"
						placeholder="Ej: Ana Pérez"
						required
						disabled={creating}
					/>
				</label>

				<label class="block text-base font-medium text-slate-200">
					Objetivo (opcional)
					<input
						class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
						name="objective"
						placeholder="Hipertrofia, fuerza, recomposición..."
						disabled={creating}
					/>
				</label>

				<button
					type="submit"
					class="relative w-full overflow-hidden rounded-xl bg-emerald-600 px-5 py-3 text-lg text-white transition hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
					disabled={creating}
				>
					<span class="absolute inset-0 bg-gradient-to-r from-emerald-500 via-teal-400 to-emerald-500 opacity-0 animate-pulse blur-sm"></span>
					<span class="relative">{creating ? 'Creando...' : 'Crear y generar link'}</span>
				</button>
				<p class="text-sm text-slate-400">
					Al hacer click crearás un alumno y un link para que pueda acceder a su rutina.
				</p>

				{#if formMessage}
					<p class="flex items-center gap-2 rounded-lg bg-red-900/40 px-3 py-2 text-sm text-red-200">
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
						</svg>
						{formMessage}
					</p>
				{/if}
			</form>

			<div class="order-2 px-1 pt-1 pb-0 lg:hidden">
				<div class="h-px w-full bg-gradient-to-r from-transparent via-slate-500/40 to-transparent"></div>
			</div>

			<div class="order-3 mt-8 sm:mt-10 lg:mt-0 lg:order-1 lg:col-start-1 flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-[#0f111b] px-4 py-3 shadow-md shadow-black/30">
				<form
					class="flex w-full flex-col gap-3 sm:flex-row sm:items-center"
					on:submit|preventDefault={() => (searchTerm = searchTerm.trim())}
				>
					<label class="w-full text-base text-slate-200">
						<span class="sr-only">Buscar alumno</span>
						<input
							class="w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600/50"
							type="text"
							placeholder="Buscar alumno"
							bind:value={searchTerm}
						/>
					</label>
					<button
						type="submit"
						class="rounded-lg border border-emerald-700 bg-emerald-600 px-4 py-3 text-base font-semibold text-white shadow-sm transition hover:bg-emerald-500"
					>
						Buscar
					</button>
				</form>
			</div>

			<div class="order-4 lg:order-2 lg:col-start-1 space-y-3">
				{#if clients.length === 0}
					<div class="rounded-xl border border-dashed border-slate-700 bg-[#0f111b] p-7 text-base text-slate-300">
						Aún no tenés alumnos. Creá uno y compartí el link público.
				</div>
			{:else}
				<div class="grid grid-cols-1 gap-3 md:grid-cols-2">
					{#each filteredClients() as client (client.id)}
						<article class="flex flex-col gap-3 rounded-xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
							<div class="flex items-start justify-between gap-3">
								<div class="min-w-0 flex-1">
									<p class="text-lg font-semibold text-slate-50 truncate" title={client.name}>{client.name}</p>
									<p class="text-sm text-slate-400 truncate">{client.objective ?? 'Sin objetivo'}</p>
								</div>
								<span
									class={`flex-shrink-0 rounded-full px-3 py-1 text-sm font-semibold ${
										client.status === 'active'
											? 'bg-emerald-900/50 text-emerald-300 border border-emerald-600/50'
											: 'bg-slate-800 text-slate-400 border border-slate-700'
									}`}
								>
									{client.status === 'active' ? 'Activo' : 'Inactivo'}
								</span>
							</div>
							<div class="text-base text-slate-300 mb-3">
								<p>
									Última actividad:
									<span class={`font-semibold ${activityColor(client.days_since_activity)}`}>
										{activityLabel(client.days_since_activity)}
									</span>
								</p>
							</div>
								<div class="mt-auto space-y-4">
									<button
										class={`open-btn relative w-full overflow-hidden rounded-xl border border-emerald-700/50 bg-[#111827] px-3.5 py-3 text-base font-semibold text-white shadow-sm transition hover:border-emerald-500 hover:bg-[#0f1625] disabled:cursor-wait ${
											openingId === client.id ? 'loading' : ''
										}`}
										on:pointerenter={() => warmClientRoute(client.id)}
										on:focus={() => warmClientRoute(client.id)}
										on:pointerdown={() => warmClientRoute(client.id)}
										on:click={() => openClient(client)}
										disabled={openingId === client.id}
										aria-busy={openingId === client.id}
									>
									<span class="btn-label">
										{openingId === client.id ? 'Abriendo rutina...' : 'Abrir rutina del alumno'}
									</span>
								</button>
								<div class="grid grid-cols-2 gap-4">
									<button
										class="rounded-xl border border-red-600 bg-red-900/40 px-3.5 py-3 text-sm font-medium text-red-100 hover:bg-red-900/60"
										type="button"
										on:click={() => {
											deleteTarget = client;
											deleteConfirm = '';
										}}
									>
										Eliminar alumno
									</button>
									<button
										class="rounded-xl border border-slate-700 px-3.5 py-3 text-sm font-medium text-slate-100 hover:bg-[#151827]"
										on:click={() => copyLink(client)}
										type="button"
									>
										{copiedId === client.id ? '✓ Copiado' : 'Copiar link público'}
									</button>
								</div>
							</div>
						</article>
					{/each}
					</div>
				{/if}
			</div>
		</section>

	{#if ownerActionConfirm}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
				<div class="w-full max-w-lg rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
					{#if ownerActionConfirm.kind === 'disable'}
						<div class="space-y-2">
							<h2 class="text-xl font-semibold text-red-200">Confirmar deshabilitación</h2>
						<p class="text-sm text-slate-300">
							Vas a deshabilitar al entrenador <span class="font-semibold text-slate-100">{ownerActionConfirm.trainerEmail}</span>.
							No podrá iniciar sesión hasta que lo vuelvas a habilitar.
						</p>
					</div>
					{:else}
						{@const signedMonths = ownerActionConfirm.operation === 'remove' ? -ownerActionConfirm.months : ownerActionConfirm.months}
						{@const signedDurationSeconds =
							ownerActionConfirm.operation === 'remove'
								? -durationSecondsFromMonths(ownerActionConfirm.months)
								: durationSecondsFromMonths(ownerActionConfirm.months)}
						{@const signedDays = signedMonths * 30}
						{@const confirmIsRemoval = ownerActionConfirm.operation === 'remove'}
						{@const confirmHighRiskRemoval = confirmIsRemoval && ownerActionConfirm.months >= 3}
						<div class="space-y-2">
							<h2 class={`text-xl font-semibold ${
								confirmHighRiskRemoval
									? 'text-red-200'
									: confirmIsRemoval
										? 'text-amber-200'
										: 'text-emerald-200'
							}`}>
								Confirmar ajuste de suscripción
							</h2>
							<p class="text-sm text-slate-300">
								Vas a
									<span class="font-semibold text-slate-100">
									{ownerActionConfirm.operation === 'add' ? 'sumar' : 'quitar'}&nbsp;
									{formatDurationLabel(Math.abs(ownerActionConfirm.months))}
								</span>
							a <span class="font-semibold text-slate-100">{ownerActionConfirm.trainerEmail}</span>.
						</p>
							<p class="text-sm text-slate-400">
								{#if isTrialHourDuration(ownerActionConfirm.months)}
									Equivale a <span class="font-semibold text-slate-100">{signedDurationSeconds > 0 ? '+' : ''}1 hora</span>
									exacta.
								{:else}
									Equivale a <span class="font-semibold text-slate-100">{signedDays > 0 ? '+' : ''}{signedDays} días</span>
									exactos de 24 horas.
								{/if}
							</p>
							{#if confirmIsRemoval}
								<p class={`rounded-lg border px-3 py-2 text-sm ${
									confirmHighRiskRemoval
										? 'border-red-700/60 bg-red-900/30 text-red-200'
										: 'border-amber-700/60 bg-amber-900/25 text-amber-200'
								}`}>
									{confirmHighRiskRemoval
										? 'Riesgo alto: esta quita masiva puede dejar al entrenador sin acceso.'
										: 'Revisá el ajuste antes de confirmar para evitar descuentos accidentales.'}
								</p>
							{/if}
							{#if ownerActionConfirm.reason}
								<p class="text-sm text-slate-400">
									Motivo: <span class="font-medium text-slate-200">{ownerActionConfirm.reason}</span>
							</p>
						{/if}
					</div>
				{/if}

				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						on:click={closeOwnerActionConfirm}
					>
						Cancelar
					</button>
						<button
							type="button"
							class={`rounded-lg px-4 py-2 text-white transition ${
								ownerActionConfirm.kind === 'disable'
									? 'bg-red-600 hover:bg-red-500'
									: ownerActionConfirm.operation === 'remove'
										? ownerActionConfirm.months >= 3
											? 'bg-red-600 hover:bg-red-500'
											: 'bg-amber-600 hover:bg-amber-500'
										: 'bg-emerald-600 hover:bg-emerald-500'
							}`}
							on:click={confirmOwnerAction}
						>
						{ownerActionConfirm.kind === 'disable'
							? 'Deshabilitar ahora'
							: ownerActionConfirm.operation === 'add'
								? 'Confirmar suma'
								: 'Confirmar quita'}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if deleteTarget}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-red-200">Eliminar alumno</h2>
					<p class="text-sm text-slate-300">
						Para eliminar al alumno <span class="font-semibold">{deleteTarget.name}</span> definitivamente, escribí la palabra
						<span class="font-semibold text-red-300">eliminar</span>.
					</p>
				</div>
				<form method="post" action="?/delete" class="mt-4 space-y-3">
					<input type="hidden" name="client_id" value={deleteTarget.id} />
					<label class="block text-sm font-medium text-slate-200">
						Confirmación
						<input
							class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
							placeholder="eliminar"
							bind:value={deleteConfirm}
							name="confirm_text"
						/>
					</label>
					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
							on:click={() => {
								deleteTarget = null;
								deleteConfirm = '';
							}}
						>
							Cancelar
						</button>
						<button
							type="submit"
							class="rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
							disabled={deleteConfirm.trim().toLowerCase() !== 'eliminar'}
						>
							Eliminar definitivamente
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}
</section>

<style>
	.open-btn.loading::after {
		content: '';
		position: absolute;
		inset: 0;
		background: linear-gradient(90deg, #10b981 0%, #34d399 100%);
		transform-origin: left;
		animation: fillbtn 2s ease-in-out infinite;
		opacity: 0.9;
	}
	.open-btn .btn-label {
		position: relative;
		z-index: 1;
	}
	@keyframes fillbtn {
		from {
			transform: scaleX(0);
		}
		to {
			transform: scaleX(1);
		}
	}
	.custom-select {
		appearance: none;
		-webkit-appearance: none;
		-moz-appearance: none;
		background-image: none;
		color-scheme: dark;
	}
	.custom-select::-ms-expand {
		display: none;
	}
	.custom-select option {
		background: #111827;
		color: #e2e8f0;
	}
	.sr-only {
		position: absolute;
		width: 1px;
		height: 1px;
		padding: 0;
		margin: -1px;
		overflow: hidden;
		clip: rect(0, 0, 0, 0);
		white-space: nowrap;
		border: 0;
	}
</style>
