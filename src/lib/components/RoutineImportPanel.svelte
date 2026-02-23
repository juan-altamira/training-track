<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		IMPORT_WEEK_DAY_KEYS,
		type ImportCommitPolicy,
		type ImportDraft,
		type ImportIssue,
		type ImportStats
	} from '$lib/import/types';
	import { importDraftSchema } from '$lib/import/schemas';
	import type { RoutinePlan, RoutineUiMeta } from '$lib/types';

	type ImportJobView = {
		id: string;
		status: string;
		source_type: string;
		progress_stage: string;
		progress_percent: number;
		error_code: string | null;
		error_message: string | null;
		updated_at: string;
	};

	const MAX_POLL_TIME_MS = 120000;
	const FILE_INPUT_ID = 'routine-import-file';
	const RAW_TEXT_ID = 'routine-import-raw-text';
	const WEEK_DAY_LABELS: Record<string, string> = {
		monday: 'Lunes',
		tuesday: 'Martes',
		wednesday: 'Miércoles',
		thursday: 'Jueves',
		friday: 'Viernes',
		saturday: 'Sábado',
		sunday: 'Domingo'
	};
	const JOB_STATUS_LABELS: Record<string, string> = {
		queued: 'En cola',
		processing: 'Procesando',
		ready: 'Listo para revisar',
		failed: 'Falló',
		committing: 'Aplicando cambios',
		committed: 'Aplicado',
		rolled_back: 'Revertido',
		expired: 'Expirado'
	};
	const JOB_STAGE_LABELS: Record<string, string> = {
		queued: 'Esperando',
		processing: 'Procesando',
		ready: 'Borrador listo',
		committing: 'Confirmando importación',
		committed: 'Importación confirmada',
		rolled_back: 'Cambios revertidos',
		failed: 'Con errores',
		expired: 'Expirado'
	};
	const COMMIT_POLICY_LABELS: Record<ImportCommitPolicy, string> = {
		overwrite_all: 'Reemplazar toda la rutina',
		overwrite_days: 'Reemplazar días seleccionados'
	};
	const COMMIT_POLICIES: ImportCommitPolicy[] = ['overwrite_all', 'overwrite_days'];
	const DAY_LABEL_MODE_LABELS = {
		weekday: 'Semanal (Lunes..Domingo)',
		sequential: 'Secuencial (Día 1..N)',
		custom: 'Personalizado'
	} as const;
	const DAY_LABEL_MODES = ['weekday', 'sequential', 'custom'] as const;
	type DayLabelMode = (typeof DAY_LABEL_MODES)[number];
	type RoutineAppliedPayload = {
		action: 'commit' | 'rollback';
		plan: RoutinePlan;
		uiMeta: RoutineUiMeta | null;
		routineVersion: number;
	};

	let { clientId, initialRoutineVersion, initialUiMeta = null, onRoutineApplied = null } = $props<{
		clientId: string;
		initialRoutineVersion: number;
		initialUiMeta?: RoutineUiMeta | null;
		onRoutineApplied?: ((payload: RoutineAppliedPayload) => void | Promise<void>) | null;
	}>();

	let sourceMode = $state<'file' | 'text'>('file');
	let selectedFile = $state<File | null>(null);
	let rawText = $state('');
	let createBusy = $state(false);
	let processingBusy = $state(false);
	let saveDraftBusy = $state(false);
	let commitBusy = $state(false);
	let rollbackBusy = $state(false);
	let panelMessage = $state<string | null>(null);
	let panelError = $state<string | null>(null);
	let jobId = $state<string | null>(null);
	let job = $state<ImportJobView | null>(null);
	let draft = $state<ImportDraft | null>(null);
	let issues = $state<ImportIssue[]>([]);
	let stats = $state<ImportStats | null>(null);
	let commitPolicy = $state<ImportCommitPolicy>('overwrite_all');
	let overwriteDays = $state<Record<string, boolean>>(
		Object.fromEntries(IMPORT_WEEK_DAY_KEYS.map((day) => [day, false]))
	);
	let routineVersionExpected = $state(1);
	let lastBackupId = $state<string | null>(null);
	let pollDelay = $state(1000);
	let pollAttempts = $state(0);
	let pollStartedAt = $state<number | null>(null);
	let pollTimer: ReturnType<typeof setTimeout> | null = null;

	$effect(() => {
		routineVersionExpected = initialRoutineVersion;
	});

	const stopPolling = () => {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	};

	const schedulePoll = () => {
		stopPolling();
		pollTimer = setTimeout(() => {
			void fetchJobStatus();
		}, pollDelay);
	};

	const shouldKeepPolling = (status: string) => ['queued', 'processing', 'committing'].includes(status);

	const formatWeekDay = (key: string) => WEEK_DAY_LABELS[key] ?? key;
	const getWeekDaySlotIndex = (key: string) =>
		IMPORT_WEEK_DAY_KEYS.indexOf(key as (typeof IMPORT_WEEK_DAY_KEYS)[number]);
	const formatDestinationDay = (key: string) => {
		const mode = getDraftMode();
		const index = getWeekDaySlotIndex(key);
		if (mode === 'weekday') {
			return formatWeekDay(key);
		}
		if (index >= 0) {
			return `Día ${index + 1}`;
		}
		return key;
	};
	const formatJobStatus = (status: string) => JOB_STATUS_LABELS[status] ?? status;
	const formatJobStage = (stage: string) => JOB_STAGE_LABELS[stage] ?? stage;
	const formatIssueSeverity = (severity: string) => {
		if (severity === 'hard_error') return 'Error crítico';
		if (severity === 'needs_review_blocking') return 'Revisión obligatoria';
		if (severity === 'needs_review') return 'Revisión sugerida';
		if (severity === 'warning') return 'Advertencia';
		return 'Corrección automática';
	};
	const parseJobStatusTone = (status: string) => {
		if (status === 'ready' || status === 'committed') {
			return 'border-emerald-600/60 bg-emerald-900/25 text-emerald-100';
		}
		if (status === 'failed' || status === 'expired') {
			return 'border-red-700/60 bg-red-950/35 text-red-100';
		}
		if (status === 'rolled_back') {
			return 'border-amber-700/60 bg-amber-900/25 text-amber-100';
		}
		return 'border-sky-700/60 bg-sky-950/25 text-sky-100';
	};

	const parseSeverityTone = (severity: string) => {
		if (severity === 'hard_error' || severity === 'needs_review_blocking') {
			return 'border-red-700/60 bg-red-950/30 text-red-100';
		}
		if (severity === 'needs_review' || severity === 'warning') {
			return 'border-amber-700/60 bg-amber-950/25 text-amber-100';
		}
		return 'border-emerald-700/60 bg-emerald-950/20 text-emerald-100';
	};

	const toUserFacingJobError = (message: string | null | undefined) => {
		const raw = (message ?? '').trim();
		if (!raw) return null;
		const normalized = raw.toLowerCase();
		if (normalized.includes('setting up fake worker failed') || normalized.includes('could not find module')) {
			return 'No pudimos leer este PDF en este intento. Probá de nuevo o usá la opción de texto pegado.';
		}
		if (normalized.includes('optimistic_lock_conflict')) {
			return 'La rutina cambió mientras revisabas el borrador. Actualizá y volvé a confirmar.';
		}
		return raw;
	};

	const shouldShowRawJobError = (message: string | null | undefined) => {
		const raw = (message ?? '').trim();
		if (!raw) return false;
		return toUserFacingJobError(raw) !== raw;
	};

	const resetTransientState = () => {
		panelError = null;
		panelMessage = null;
	};

	const normalizeDraftMode = (value: string | null | undefined): DayLabelMode => {
		if (value === 'sequential' || value === 'custom') return value;
		return 'weekday';
	};

	const normalizeDraftForUi = (incoming: ImportDraft | null): ImportDraft | null => {
		if (!incoming) return null;
		const fallbackMode = normalizeDraftMode(initialUiMeta?.day_label_mode);
		const mode = normalizeDraftMode(incoming.presentation?.day_label_mode ?? fallbackMode);
		return {
			...incoming,
			presentation: {
				day_label_mode: mode
			},
			days: incoming.days.map((day, index) => ({
				...day,
				display_label:
					typeof day.display_label === 'string' && day.display_label.trim()
						? day.display_label.trim()
						: `Día ${index + 1}`
			}))
		};
	};

	const applyStatusPayload = (payload: Record<string, any>) => {
		job = payload.job as ImportJobView;
		draft = normalizeDraftForUi(payload.draft as ImportDraft | null);
		issues = Array.isArray(payload.issues) ? payload.issues : [];
		stats = payload.stats ?? null;
	};

	const applyRoutineUpdateToParent = async (
		action: 'commit' | 'rollback',
		payload: Record<string, any> | null | undefined
	) => {
		if (!onRoutineApplied || !payload) return;
		const nextPlan = payload.plan;
		const nextVersion = payload.routine_version_after;
		if (!nextPlan || typeof nextPlan !== 'object') return;
		if (typeof nextVersion !== 'number' || !Number.isFinite(nextVersion)) return;
		await onRoutineApplied({
			action,
			plan: nextPlan as RoutinePlan,
			uiMeta: (payload.ui_meta ?? null) as RoutineUiMeta | null,
			routineVersion: nextVersion
		});
	};

	const getDraftMode = (): DayLabelMode => normalizeDraftMode(draft?.presentation?.day_label_mode);

	const setDraftMode = (mode: DayLabelMode) => {
		if (!draft) return;
		draft = {
			...draft,
			presentation: {
				day_label_mode: mode
			}
		};
	};

	const updateDayDisplayLabel = (dayId: string, value: string) => {
		if (!draft) return;
		const cleaned = value
			.replace(/[\u0000-\u001F\u007F]/g, '')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, 40);
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id === dayId
					? {
							...day,
							display_label: cleaned || null
						}
					: day
			)
		};
	};

	const autoMapSequentialDays = () => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day, index) => ({
				...day,
				mapped_day_key: IMPORT_WEEK_DAY_KEYS[index] ?? null
			}))
		};
	};

	const hasSequentialMappingWarning = () => {
		if (!draft || getDraftMode() !== 'sequential') return false;
		for (let index = 0; index < draft.days.length; index += 1) {
			const mapped = draft.days[index]?.mapped_day_key;
			if (!mapped) continue;
			const mappedIndex = IMPORT_WEEK_DAY_KEYS.indexOf(mapped as (typeof IMPORT_WEEK_DAY_KEYS)[number]);
			if (mappedIndex !== index) {
				return true;
			}
		}
		return false;
	};

	const fetchJobStatus = async () => {
		if (!jobId) return;
		processingBusy = true;
		try {
			const res = await fetch(`/api/import/jobs/${jobId}`);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				panelError = payload?.message ?? 'No pudimos consultar el estado del import.';
				stopPolling();
				return;
			}

			applyStatusPayload(payload);
			if (job && shouldKeepPolling(job.status)) {
				const elapsedMs = pollStartedAt ? Date.now() - pollStartedAt : 0;
				if (elapsedMs >= MAX_POLL_TIME_MS) {
					stopPolling();
					panelMessage =
						'El import sigue en proceso. Podés continuar trabajando y volver más tarde para revisar el resultado.';
					return;
				}
				pollAttempts += 1;
				pollDelay = Math.min(12000, pollAttempts === 0 ? 1000 : pollDelay * 2);
				schedulePoll();
			} else {
				stopPolling();
			}
		} catch (e) {
			console.error(e);
			panelError = 'No pudimos consultar el estado del import.';
			stopPolling();
		} finally {
			processingBusy = false;
		}
	};

	const startImport = async () => {
		resetTransientState();
		if (sourceMode === 'file' && !selectedFile) {
			panelError = 'Seleccioná un archivo para importar.';
			return;
		}
		if (sourceMode === 'text' && !rawText.trim()) {
			panelError = 'Pegá texto antes de iniciar el import.';
			return;
		}

		createBusy = true;
		try {
			const formData = new FormData();
			formData.set('client_id', clientId);
			formData.set('scope', 'client');
			if (sourceMode === 'file' && selectedFile) {
				formData.set('file', selectedFile);
			} else {
				formData.set('raw_text', rawText.trim());
				formData.set('source_type', 'text');
			}

			const res = await fetch('/api/import/jobs', { method: 'POST', body: formData });
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				panelError = payload?.message ?? 'No pudimos crear el job de importación.';
				return;
			}

				jobId = payload.job_id as string;
				panelMessage = payload.reused
					? 'Reutilizamos un job existente con el mismo archivo.'
					: 'Importación iniciada. Procesando...';
			pollDelay = 1000;
			pollAttempts = 0;
			pollStartedAt = Date.now();
			await fetchJobStatus();
		} catch (e) {
			console.error(e);
			panelError = 'No pudimos crear el job de importación.';
		} finally {
			createBusy = false;
		}
	};

	const updateDayMapping = (dayId: string, mappedDayKey: string) => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id === dayId
					? {
							...day,
							mapped_day_key: mappedDayKey || null
						}
					: day
			)
		};
	};

	const updateNodeField = (
		dayId: string,
		blockId: string,
		nodeId: string,
		field: 'raw_exercise_name' | 'sets' | 'reps_min' | 'reps_max' | 'note',
		value: string
	) => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) => {
				if (day.id !== dayId) return day;
				return {
					...day,
					blocks: day.blocks.map((block) => {
						if (block.id !== blockId) return block;
						return {
							...block,
							nodes: block.nodes.map((node) => {
								if (node.id !== nodeId) return node;
								if (field === 'raw_exercise_name' || field === 'note') {
									return { ...node, [field]: value };
								}
								const numeric = Number.parseInt(value, 10);
								return {
									...node,
									[field]: Number.isFinite(numeric) && numeric > 0 ? numeric : null
								};
							})
						};
					})
				};
			})
		};
	};

	const saveDraft = async () => {
		if (!jobId || !draft) return;
		resetTransientState();
		const valid = importDraftSchema.safeParse(draft);
		if (!valid.success) {
			panelError = valid.error.issues[0]?.message ?? 'Borrador inválido.';
			return;
		}

		saveDraftBusy = true;
		try {
			const res = await fetch(`/api/import/jobs/${jobId}/draft`, {
				method: 'PATCH',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ draft: valid.data })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				panelError = payload?.message ?? 'No pudimos guardar correcciones del draft.';
				return;
			}
				draft = payload.draft;
				issues = payload.issues ?? [];
				stats = payload.stats ?? null;
				panelMessage = 'Borrador actualizado.';
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos guardar correcciones del draft.';
		} finally {
			saveDraftBusy = false;
		}
	};

	const blockingIssues = () =>
		issues.filter((issue) =>
			['hard_error', 'needs_review_blocking'].includes(issue.severity)
		);

	const nonBlockingIssues = () =>
		issues.filter((issue) => !['hard_error', 'needs_review_blocking'].includes(issue.severity));

	const selectedOverwriteDays = () =>
		Object.entries(overwriteDays)
			.filter(([, selected]) => selected)
			.map(([day]) => day);

	const commitImport = async () => {
		if (!jobId || !job) return;
		resetTransientState();
		if (blockingIssues().length > 0) {
			panelError = 'No se puede confirmar mientras existan issues bloqueantes.';
			return;
		}
		if (commitPolicy === 'overwrite_days' && selectedOverwriteDays().length === 0) {
			panelError = 'Seleccioná al menos un día para reemplazar.';
			return;
		}

		commitBusy = true;
		try {
			const res = await fetch(`/api/import/jobs/${jobId}/commit`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({
					policy: commitPolicy,
					overwrite_days: commitPolicy === 'overwrite_days' ? selectedOverwriteDays() : undefined,
					ui_meta: {
						day_label_mode: getDraftMode(),
						hide_empty_days_in_sequential: true
					},
					routine_version_expected: routineVersionExpected,
					commit_idempotency_key: crypto.randomUUID()
				})
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				if (res.status === 409) {
					const expected = payload?.expected_version ?? routineVersionExpected;
					const current = payload?.current_version;
					const lastSaved =
						typeof payload?.last_saved_at === 'string'
							? new Date(payload.last_saved_at).toLocaleString()
							: null;
					routineVersionExpected = typeof current === 'number' ? current : routineVersionExpected;
					panelError = current
						? `Conflicto de versión (esperada ${expected}, actual ${current})${
								lastSaved ? ` · último guardado: ${lastSaved}` : ''
							}. Revalidá el preview y volvé a confirmar.`
						: payload?.message ?? 'Conflicto de versión. Revalidá y volvé a confirmar.';
				} else {
					panelError = payload?.message ?? 'No pudimos confirmar el commit de importación.';
				}
				return;
			}

				lastBackupId = payload.backup_id ?? null;
				routineVersionExpected = payload.routine_version_after ?? routineVersionExpected;
				await applyRoutineUpdateToParent('commit', payload);
				panelMessage = 'Importación aplicada correctamente.';
				await fetchJobStatus();
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos confirmar el commit de importación.';
		} finally {
			commitBusy = false;
		}
	};

	const rollbackImport = async () => {
		if (!jobId) return;
		resetTransientState();
		rollbackBusy = true;
		try {
			const res = await fetch(`/api/import/jobs/${jobId}/rollback`, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ backup_id: lastBackupId ?? undefined })
			});
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
				panelError = payload?.message ?? 'No pudimos revertir la importación.';
				return;
			}
				routineVersionExpected = payload.routine_version_after ?? routineVersionExpected;
				await applyRoutineUpdateToParent('rollback', payload);
				panelMessage = 'Reversión aplicada correctamente.';
				await fetchJobStatus();
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos revertir la importación.';
		} finally {
			rollbackBusy = false;
		}
	};

	onDestroy(() => {
		stopPolling();
	});
</script>

<section class="space-y-5 rounded-2xl border border-slate-800/90 bg-[radial-gradient(circle_at_top,#16213a_0%,#0f111b_45%,#0d0f18_100%)] p-5 shadow-2xl shadow-black/25 sm:p-6">
	<header class="space-y-2">
		<div class="flex flex-wrap items-center justify-between gap-2">
			<h3 class="text-xl font-semibold tracking-tight text-slate-100">Importar rutina</h3>
			<span class="rounded-full border border-cyan-500/35 bg-cyan-500/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-wide text-cyan-200">
				Flujo guiado
			</span>
		</div>
		<p class="text-sm leading-relaxed text-slate-300">
			Cargá un archivo o pegá texto. Revisás el borrador, corregís lo necesario y recién después lo confirmás.
		</p>
	</header>

	<div class="space-y-4 rounded-xl border border-slate-700/70 bg-[#101523]/90 p-4 sm:p-5">
		<div class="grid gap-2 rounded-xl border border-slate-700/70 bg-[#0f1420] p-1 sm:grid-cols-2">
			<button
				type="button"
				class={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
					sourceMode === 'file'
						? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
						: 'text-slate-300 hover:bg-[#1a2132]'
				}`}
				onclick={() => (sourceMode = 'file')}
			>
				Subir archivo
			</button>
			<button
				type="button"
				class={`rounded-lg px-3 py-2.5 text-sm font-semibold transition ${
					sourceMode === 'text'
						? 'bg-emerald-600 text-white shadow-lg shadow-emerald-900/30'
						: 'text-slate-300 hover:bg-[#1a2132]'
				}`}
				onclick={() => (sourceMode = 'text')}
			>
				Pegar texto
			</button>
		</div>

		{#if sourceMode === 'file'}
			<div class="space-y-2">
				<label for={FILE_INPUT_ID} class="text-sm font-medium text-slate-200">Archivo de rutina</label>
				<input
					id={FILE_INPUT_ID}
					type="file"
					accept=".txt,.csv,.xlsx,.docx,.pdf"
					class="w-full rounded-xl border border-slate-600/70 bg-[#151b2a] px-3 py-3 text-sm text-slate-100 file:mr-3 file:rounded-lg file:border-0 file:bg-slate-700 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-slate-100 hover:border-slate-500"
					onchange={(event) => {
						const input = event.currentTarget as HTMLInputElement;
						selectedFile = input.files?.[0] ?? null;
					}}
				/>
				<p class="text-xs text-slate-400">Formatos admitidos: TXT, CSV, XLSX, DOCX y PDF digital.</p>
				{#if selectedFile}
					<p class="text-xs text-cyan-200">
						Archivo seleccionado: {selectedFile.name} ({Math.round(selectedFile.size / 1024)} KB)
					</p>
				{/if}
			</div>
		{:else}
			<div class="space-y-2">
				<label for={RAW_TEXT_ID} class="text-sm font-medium text-slate-200">Texto de rutina</label>
				<textarea
					id={RAW_TEXT_ID}
					bind:value={rawText}
					rows="7"
					class="w-full rounded-xl border border-slate-600/70 bg-[#151b2a] px-3 py-3 text-sm text-slate-100 placeholder:text-slate-500 focus:border-cyan-500/70 focus:outline-none"
					placeholder="Pegá la rutina completa acá…"
				></textarea>
			</div>
		{/if}

		<div class="flex flex-wrap items-center gap-3">
			<button
				type="button"
				class="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-500 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
				onclick={startImport}
				disabled={createBusy || processingBusy}
			>
				{createBusy ? 'Iniciando importación...' : 'Iniciar importación'}
			</button>
			{#if job}
				<button
					type="button"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-slate-600 bg-[#151b2a] px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-[#1a2132] disabled:cursor-not-allowed disabled:opacity-60"
					onclick={() => {
						pollStartedAt = Date.now();
						pollDelay = 1000;
						pollAttempts = 0;
						void fetchJobStatus();
					}}
					disabled={processingBusy}
				>
					{processingBusy ? 'Actualizando...' : 'Ver progreso'}
				</button>
				<span class={`rounded-full border px-3 py-1.5 text-xs font-semibold ${parseJobStatusTone(job.status)}`}>
					{formatJobStage(job.progress_stage)} ({job.progress_percent}%)
				</span>
			{/if}
		</div>
	</div>

	{#if panelError}
		<p class="rounded-xl border border-red-700/60 bg-red-950/35 px-3 py-2.5 text-sm text-red-100">{panelError}</p>
	{/if}
	{#if panelMessage}
		<p class="rounded-xl border border-emerald-700/60 bg-emerald-950/25 px-3 py-2.5 text-sm text-emerald-100">{panelMessage}</p>
	{/if}
	{#if job?.error_message}
		<div class="rounded-xl border border-amber-700/60 bg-amber-950/25 px-3 py-2.5 text-sm text-amber-100">
			<p>{toUserFacingJobError(job.error_message)}</p>
			{#if shouldShowRawJobError(job.error_message)}
				<details class="mt-2 text-[10px] text-amber-200/80">
					<summary class="cursor-pointer">Ver detalle técnico</summary>
					<p class="mt-1 break-all">{job.error_message}</p>
				</details>
			{/if}
		</div>
	{/if}

	{#if stats}
		<div class="grid gap-3 sm:grid-cols-3">
			<article class="rounded-xl border border-slate-700/70 bg-[#101523] p-3">
				<p class="text-[11px] uppercase tracking-wide text-slate-400">Días detectados</p>
				<p class="mt-1 text-xl font-semibold text-slate-100">{stats.days_detected}</p>
			</article>
			<article class="rounded-xl border border-slate-700/70 bg-[#101523] p-3">
				<p class="text-[11px] uppercase tracking-wide text-slate-400">Ejercicios parseados</p>
				<p class="mt-1 text-xl font-semibold text-slate-100">{stats.exercises_parsed}</p>
			</article>
			<article class="rounded-xl border border-slate-700/70 bg-[#101523] p-3">
				<p class="text-[11px] uppercase tracking-wide text-slate-400">Pendientes de revisión</p>
				<p class="mt-1 text-xl font-semibold text-slate-100">{blockingIssues().length}</p>
			</article>
		</div>
	{/if}

	{#if issues.length > 0}
			<div class="space-y-3 rounded-xl border border-slate-700/70 bg-[#101523] p-4">
				<h4 class="text-sm font-semibold text-slate-100">
					Revisión del borrador · {issues.length} observaciones
				</h4>

				{#if blockingIssues().length > 0}
					<div class="max-h-56 space-y-2 overflow-auto pr-1">
						{#each blockingIssues() as issue, index (`blocking-${issue.path}-${index}`)}
							<article class={`rounded-lg border px-3 py-2 text-xs ${parseSeverityTone(issue.severity)}`}>
								<p class="font-semibold">{formatIssueSeverity(issue.severity)}</p>
								<p class="mt-1">{issue.message}</p>
								{#if issue.suggested_fix}
									<p class="mt-1 text-[11px] opacity-90">Sugerencia: {issue.suggested_fix}</p>
								{/if}
								{#if issue.code || issue.path}
									<details class="mt-1 text-[10px] opacity-75">
										<summary class="cursor-pointer">Detalle técnico</summary>
										{#if issue.code}
											<p class="mt-1">Código: {issue.code}</p>
										{/if}
										{#if issue.path}
											<p class="mt-1 break-all">Ruta: {issue.path}</p>
										{/if}
									</details>
								{/if}
							</article>
						{/each}
					</div>
			{/if}

			{#if nonBlockingIssues().length > 0}
				<details class="rounded-lg border border-slate-700/70 bg-[#0f1420] p-3">
					<summary class="cursor-pointer text-xs font-semibold text-slate-200">
						Ver advertencias y sugerencias ({nonBlockingIssues().length})
					</summary>
						<div class="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
							{#each nonBlockingIssues() as issue, index (`non-blocking-${issue.path}-${index}`)}
								<article class={`rounded-lg border px-3 py-2 text-xs ${parseSeverityTone(issue.severity)}`}>
									<p class="font-semibold">{formatIssueSeverity(issue.severity)}</p>
									<p class="mt-1">{issue.message}</p>
									{#if issue.suggested_fix}
										<p class="mt-1 text-[11px] opacity-90">Sugerencia: {issue.suggested_fix}</p>
									{/if}
									{#if issue.code || issue.path}
										<details class="mt-1 text-[10px] opacity-75">
											<summary class="cursor-pointer">Detalle técnico</summary>
											{#if issue.code}
												<p class="mt-1">Código: {issue.code}</p>
											{/if}
											{#if issue.path}
												<p class="mt-1 break-all">Ruta: {issue.path}</p>
											{/if}
										</details>
									{/if}
								</article>
							{/each}
						</div>
					</details>
			{/if}
		</div>
	{/if}

	{#if draft}
		<div class="space-y-4 rounded-xl border border-slate-700/70 bg-[#101523] p-4 sm:p-5">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<div>
					<h4 class="text-base font-semibold text-slate-100">Paso 1 · Revisar mapeo y ejercicios</h4>
					<p class="text-xs text-slate-400">Editá lo necesario antes de confirmar la importación.</p>
				</div>
					<button
						type="button"
						class="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-500 bg-[#1a2132] px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-[#252f47] disabled:cursor-not-allowed disabled:opacity-60"
						onclick={saveDraft}
						disabled={saveDraftBusy}
					>
						{saveDraftBusy ? 'Guardando cambios...' : 'Guardar borrador'}
					</button>
				</div>

			<div class="grid gap-3 rounded-xl border border-slate-700/70 bg-[#0f1420] p-3 sm:grid-cols-[1fr_auto] sm:items-end">
				<label class="text-xs text-slate-300">
					Modo de visualización
					<select
						class="mt-1 block w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs font-semibold text-slate-100"
						value={getDraftMode()}
						onchange={(event) =>
							setDraftMode((event.currentTarget as HTMLSelectElement).value as DayLabelMode)}
					>
						{#each DAY_LABEL_MODES as mode}
							<option value={mode}>{DAY_LABEL_MODE_LABELS[mode]}</option>
						{/each}
					</select>
				</label>
				{#if getDraftMode() === 'sequential'}
					<button
						type="button"
						class="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-500 bg-[#1a2132] px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-[#252f47]"
						onclick={autoMapSequentialDays}
					>
						Auto-map secuencial
					</button>
				{/if}
			</div>
			{#if getDraftMode() === 'sequential' && hasSequentialMappingWarning()}
				<p class="rounded-xl border border-amber-700/60 bg-amber-950/25 px-3 py-2 text-xs text-amber-100">
					El mapeo actual no respeta la secuencia Día 1..N. Se puede confirmar igual, pero puede resultar confuso.
				</p>
			{/if}

			<div class="space-y-3">
				{#each draft.days as day (day.id)}
					<article class="space-y-3 rounded-xl border border-slate-700/70 bg-[#0f1420] p-3 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold text-slate-100">{day.source_label}</p>
								<p class="text-[11px] uppercase tracking-wide text-slate-500">Bloques: {day.blocks.length}</p>
							</div>
							<label class="text-xs text-slate-300">
								{getDraftMode() === 'weekday' ? 'Día destino (semanal)' : 'Día destino'}
								<select
									class="mt-1 block min-w-40 rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs font-semibold text-slate-100"
									value={day.mapped_day_key ?? ''}
									onchange={(event) =>
										updateDayMapping(day.id, (event.currentTarget as HTMLSelectElement).value)}
								>
									<option value="">Sin asignar</option>
									{#each IMPORT_WEEK_DAY_KEYS as weekDay}
										<option value={weekDay}>{formatDestinationDay(weekDay)}</option>
									{/each}
								</select>
							</label>
						</div>
						{#if getDraftMode() === 'custom'}
							<label class="block text-xs text-slate-300">
								Etiqueta visible para este día
								<input
									class="mt-1 w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
									value={day.display_label ?? ''}
									maxlength="40"
									placeholder="Ej: Día de empuje"
									oninput={(event) =>
										updateDayDisplayLabel(
											day.id,
											(event.currentTarget as HTMLInputElement).value
										)}
								/>
							</label>
						{/if}

						{#each day.blocks as block (block.id)}
							<div class="space-y-2 rounded-lg border border-slate-800 bg-[#0d1220] p-3">
								<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
									Bloque {block.block_type === 'single' ? 'simple' : block.block_type}
								</p>
								{#each block.nodes as node (node.id)}
									<div class="space-y-2 rounded-lg border border-slate-700/70 bg-[#111827] p-3">
										<div class="grid gap-2 md:grid-cols-7">
											<input
												class="md:col-span-4 rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												placeholder="Nombre del ejercicio"
												value={node.raw_exercise_name}
												oninput={(event) =>
													updateNodeField(
														day.id,
														block.id,
														node.id,
														'raw_exercise_name',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
											<input
												class="rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												type="number"
												min="1"
												placeholder="Series"
												value={node.sets ?? ''}
												oninput={(event) =>
													updateNodeField(
														day.id,
														block.id,
														node.id,
														'sets',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
											<input
												class="rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												type="number"
												min="1"
												placeholder="Reps mín."
												value={node.reps_min ?? ''}
												oninput={(event) =>
													updateNodeField(
														day.id,
														block.id,
														node.id,
														'reps_min',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
											<input
												class="rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												type="number"
												min="1"
												placeholder="Reps máx."
												value={node.reps_max ?? ''}
												oninput={(event) =>
													updateNodeField(
														day.id,
														block.id,
														node.id,
														'reps_max',
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</div>
										<input
											class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
											placeholder="Nota opcional"
											value={node.note ?? ''}
											oninput={(event) =>
												updateNodeField(
													day.id,
													block.id,
													node.id,
													'note',
													(event.currentTarget as HTMLInputElement).value
												)}
										/>
									</div>
								{/each}
							</div>
						{/each}
					</article>
				{/each}
			</div>
		</div>
	{/if}

	{#if stats}
		<details class="rounded-xl border border-slate-800/80 bg-[#101523] p-3">
			<summary class="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-300">
				Ver datos técnicos (opcional)
			</summary>
			<div class="mt-3 grid gap-2 text-[11px] text-slate-400 sm:grid-cols-2 lg:grid-cols-3">
				<p>Ratio de parseo: <span class="font-semibold text-slate-100">{Math.round(stats.parseable_ratio * 100)}%</span></p>
				<p>Confianza baja: <span class="font-semibold text-slate-100">{stats.low_confidence_fields}</span></p>
				<p>Campos obligatorios: <span class="font-semibold text-slate-100">{Math.round(stats.required_fields_ratio * 100)}%</span></p>
				<p>Líneas originales: <span class="font-semibold text-slate-100">{draft?.coverage?.lines_in ?? 0}</span></p>
				<p>Líneas procesadas: <span class="font-semibold text-slate-100">{draft?.coverage?.lines_after_split ?? 0}</span></p>
				<p>Nodos generados: <span class="font-semibold text-slate-100">{draft?.coverage?.exercise_nodes_out ?? 0}</span></p>
			</div>
		</details>
	{/if}

	{#if job && ['ready', 'committed', 'rolled_back'].includes(job.status)}
		<div class="space-y-4 rounded-xl border border-slate-700/70 bg-[#101523] p-4 sm:p-5">
			<div class="space-y-1">
				<h4 class="text-base font-semibold text-slate-100">Paso 2 · Confirmar importación</h4>
				<p class="text-xs text-slate-400">Elegí cómo aplicar el borrador sobre la rutina actual.</p>
			</div>

			<div class="grid gap-2 sm:grid-cols-2">
				{#each COMMIT_POLICIES as policy}
					<button
						type="button"
						class={`rounded-xl border px-3 py-2.5 text-left text-sm font-semibold transition ${
							commitPolicy === policy
								? 'border-cyan-500 bg-cyan-900/25 text-cyan-100'
								: 'border-slate-600 bg-[#151b2a] text-slate-200 hover:bg-[#1a2132]'
						}`}
						onclick={() => (commitPolicy = policy)}
					>
						{COMMIT_POLICY_LABELS[policy]}
					</button>
				{/each}
			</div>

			{#if commitPolicy === 'overwrite_days'}
				<div class="space-y-2">
					<p class="text-xs font-semibold text-slate-300">Seleccioná los días a reemplazar</p>
					<div class="flex flex-wrap gap-2">
						{#each IMPORT_WEEK_DAY_KEYS as day}
							<button
								type="button"
								class={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
									overwriteDays[day]
										? 'border-cyan-500 bg-cyan-900/25 text-cyan-100'
										: 'border-slate-600 bg-[#151b2a] text-slate-300 hover:bg-[#1a2132]'
								}`}
								onclick={() => {
									overwriteDays = { ...overwriteDays, [day]: !overwriteDays[day] };
								}}
							>
								{formatDestinationDay(day)}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			<details class="rounded-lg border border-slate-800/80 bg-[#0f1420] p-3">
				<summary class="cursor-pointer text-[11px] font-medium text-slate-400 hover:text-slate-300">
					Opciones avanzadas
				</summary>
				<label class="mt-3 block text-xs text-slate-300">
					Versión esperada de rutina
					<input
						type="number"
						min="1"
						class="mt-1 w-full rounded-lg border border-slate-600 bg-[#151b2a] px-3 py-2 text-sm text-slate-100"
						bind:value={routineVersionExpected}
					/>
					<span class="mt-1 block text-[11px] text-slate-500">
						Se usa para evitar pisar cambios hechos en paralelo.
					</span>
				</label>
			</details>

			<div class="flex flex-wrap gap-2">
				<button
					type="button"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-500 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={commitImport}
					disabled={commitBusy}
				>
					{commitBusy ? 'Aplicando rutina...' : 'Aplicar rutina'}
				</button>
				<button
					type="button"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-600 bg-amber-950/20 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/35 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={rollbackImport}
					disabled={rollbackBusy || !lastBackupId}
				>
					{rollbackBusy ? 'Deshaciendo cambios...' : 'Deshacer último cambio'}
				</button>
			</div>
		</div>
	{/if}
</section>
