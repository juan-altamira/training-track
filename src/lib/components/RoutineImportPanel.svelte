<script lang="ts">
	import { onDestroy } from 'svelte';
	import {
		IMPORT_WEEK_DAY_KEYS,
		type ImportCommitPolicy,
		type ImportDraft,
		type ImportDraftBlock,
		type ImportDraftNode,
		type ImportIssue,
		type ImportStats
	} from '$lib/import/types';
	import { importDraftSchema } from '$lib/import/schemas';
	import { formatPrescriptionLong, parseRoutineRepsInput } from '$lib/routines';
	import type { RoutineExercise, RoutinePlan, RoutineUiMeta } from '$lib/types';

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
	const JOB_STAGE_LABELS: Record<string, string> = {
		queued: 'Esperando',
		processing: 'Procesando',
		ready: 'Listo para revisar',
		committing: 'Aplicando cambios',
		committed: 'Cambios aplicados',
		rolled_back: 'Cambios deshechos',
		failed: 'No se pudo completar',
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
		if (
			normalized.includes('payload') ||
			normalized.includes('json') ||
			normalized.includes('schema') ||
			normalized.includes('module') ||
			normalized.includes('function') ||
			normalized.includes('rpc') ||
			normalized.includes('worker') ||
			normalized.includes('undefined') ||
			normalized.includes('not found') ||
			normalized.includes('internal')
		) {
			return 'No pudimos completar la carga con ese archivo. Probá de nuevo o usá la opción de texto pegado.';
		}
		return 'No pudimos completar la importación en este intento. Probá de nuevo en unos segundos.';
	};

	const resetTransientState = () => {
		panelError = null;
		panelMessage = null;
	};

	const canStartImport = () =>
		sourceMode === 'file' ? Boolean(selectedFile) : Boolean(rawText.trim());

	const normalizeDraftMode = (value: string | null | undefined): DayLabelMode => {
		if (value === 'sequential' || value === 'custom') return value;
		return 'weekday';
	};

	const normalizeDraftForUi = (incoming: ImportDraft | null): ImportDraft | null => {
		if (!incoming) return null;
		const fallbackMode = normalizeDraftMode(initialUiMeta?.day_label_mode);
		const mode = normalizeDraftMode(incoming.presentation?.day_label_mode ?? fallbackMode);
			const normalizedDays = incoming.days.map((day, index) => ({
				...day,
				mapped_day_key:
					day.mapped_day_key &&
					IMPORT_WEEK_DAY_KEYS.includes(
					day.mapped_day_key as (typeof IMPORT_WEEK_DAY_KEYS)[number]
				)
					? (day.mapped_day_key as (typeof IMPORT_WEEK_DAY_KEYS)[number])
					: IMPORT_WEEK_DAY_KEYS[index] ?? null,
				display_label:
					typeof day.display_label === 'string' && day.display_label.trim()
						? day.display_label.trim()
						: (day.source_label?.trim() || `Día ${index + 1}`)
			}));
		const modeAdjustedDays =
			mode === 'sequential'
				? normalizedDays.map((day, index) => ({
						...day,
						mapped_day_key: IMPORT_WEEK_DAY_KEYS[index] ?? null
					}))
				: normalizedDays;
		return {
			...incoming,
			presentation: {
				day_label_mode: mode
			},
			days: modeAdjustedDays
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
		const nextDays =
			mode === 'sequential'
				? draft.days.map((day, index) => ({
						...day,
						mapped_day_key: IMPORT_WEEK_DAY_KEYS[index] ?? null
					}))
				: draft.days;
		draft = {
			...draft,
			presentation: {
				day_label_mode: mode
			},
			days: nextDays
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

	const fetchJobStatus = async () => {
		if (!jobId) return;
		processingBusy = true;
		try {
			const res = await fetch(`/api/import/jobs/${jobId}`);
			const payload = await res.json().catch(() => ({}));
			if (!res.ok) {
					panelError = payload?.message ?? 'No pudimos actualizar el estado de la carga.';
				stopPolling();
				return;
			}

			applyStatusPayload(payload);
			if (job && shouldKeepPolling(job.status)) {
				const elapsedMs = pollStartedAt ? Date.now() - pollStartedAt : 0;
				if (elapsedMs >= MAX_POLL_TIME_MS) {
					stopPolling();
					panelMessage =
							'La carga sigue en proceso. Podés seguir trabajando y volver más tarde.';
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
			panelError = 'No pudimos actualizar el estado de la carga.';
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
					panelError = payload?.message ?? 'No pudimos iniciar la carga.';
				return;
			}

				jobId = payload.job_id as string;
				pollDelay = 1000;
				pollAttempts = 0;
				pollStartedAt = Date.now();
			await fetchJobStatus();
		} catch (e) {
			console.error(e);
			panelError = 'No pudimos iniciar la carga.';
		} finally {
			createBusy = false;
		}
	};

	const isCircuitBlock = (block: ImportDraftBlock) => block.block_type === 'circuit';

	const updateBlockNodes = (
		dayId: string,
		blockId: string,
		mapNode: (node: ImportDraftNode) => ImportDraftNode
	) => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id !== dayId
					? day
					: {
							...day,
							blocks: day.blocks.map((block) =>
								block.id !== blockId
									? block
									: {
											...block,
											nodes: block.nodes.map(mapNode)
										}
							)
						}
			)
		};
	};

	const updateSingleNode = (
		dayId: string,
		blockId: string,
		nodeId: string,
		mapNode: (node: ImportDraftNode) => ImportDraftNode
	) => {
		updateBlockNodes(dayId, blockId, (node) => (node.id === nodeId ? mapNode(node) : node));
	};

	const toPositiveInt = (value: string | number | null | undefined, fallback = 0) => {
		const parsed = Number(value ?? fallback);
		if (!Number.isFinite(parsed)) return fallback;
		return Math.max(0, Math.floor(parsed));
	};

	const getNodeRepsInputValue = (node: ImportDraftNode) => {
		if (node.reps_mode === 'special') {
			return (node.reps_special ?? node.reps_text ?? '').trim();
		}
		const repsMin = toPositiveInt(node.reps_min, 0);
		const repsMax = toPositiveInt(node.reps_max, 0);
		if (repsMin > 0 && repsMax > repsMin) return `${repsMin}-${repsMax}`;
		if (repsMin > 0) return `${repsMin}`;
		return (node.reps_text ?? '').trim();
	};

	const updateNodeName = (dayId: string, blockId: string, nodeId: string, value: string) => {
		updateSingleNode(dayId, blockId, nodeId, (node) => ({ ...node, raw_exercise_name: value }));
	};

	const updateNodeSets = (dayId: string, blockId: string, nodeId: string, value: string) => {
		const sets = toPositiveInt(value, 0);
		updateSingleNode(dayId, blockId, nodeId, (node) => {
			const parsedShape = node.parsed_shape
				? node.parsed_shape.kind === 'fixed' ||
					node.parsed_shape.kind === 'range' ||
					node.parsed_shape.kind === 'scheme' ||
					node.parsed_shape.kind === 'amrap'
					? { ...node.parsed_shape, sets: Math.max(1, sets || 1) }
					: node.parsed_shape
				: node.parsed_shape;
			return {
				...node,
				sets: sets > 0 ? sets : null,
				parsed_shape: parsedShape
			};
		});
	};

	const updateNodeRepsInput = (dayId: string, blockId: string, nodeId: string, value: string) => {
		const parsed = parseRoutineRepsInput(value);
		updateSingleNode(dayId, blockId, nodeId, (node) => {
			const nextRepsText =
				parsed.repsMode === 'special'
					? parsed.repsSpecial
					: parsed.repsMin > 0
						? parsed.showRange && parsed.repsMax
							? `${parsed.repsMin}-${parsed.repsMax}`
							: `${parsed.repsMin}`
						: null;
			return {
				...node,
				reps_mode: parsed.repsMode,
				reps_min: parsed.repsMode === 'number' && parsed.repsMin > 0 ? parsed.repsMin : null,
				reps_max:
					parsed.repsMode === 'number' && parsed.showRange && parsed.repsMax ? parsed.repsMax : null,
				reps_special: parsed.repsMode === 'special' ? parsed.repsSpecial : null,
				reps_text: nextRepsText
			};
		});
	};

	const updateNodeNote = (dayId: string, blockId: string, nodeId: string, value: string) => {
		updateSingleNode(dayId, blockId, nodeId, (node) => ({ ...node, note: value }));
	};

	const getCircuitBlockRounds = (block: ImportDraftBlock) => {
		const firstNode = block.nodes[0];
		if (!firstNode) return 3;
		const fromNode = toPositiveInt(firstNode.sets, 0);
		if (fromNode > 0) return fromNode;
		const fromShape =
			firstNode.parsed_shape?.block?.kind === 'circuit'
				? toPositiveInt(firstNode.parsed_shape.block.rounds ?? 0, 0)
				: 0;
		return fromShape > 0 ? fromShape : 3;
	};

	const updateCircuitBlockRounds = (dayId: string, blockId: string, value: string) => {
		const rounds = Math.max(1, Math.min(99, toPositiveInt(value, 1)));
		updateBlockNodes(dayId, blockId, (node) => {
			let parsedShape = node.parsed_shape;
			if (parsedShape?.block?.kind === 'circuit') {
				parsedShape = {
					...parsedShape,
					block: {
						...parsedShape.block,
						rounds
					}
				};
			}
			if (
				parsedShape &&
				(parsedShape.kind === 'fixed' ||
					parsedShape.kind === 'range' ||
					parsedShape.kind === 'scheme' ||
					parsedShape.kind === 'amrap')
			) {
				parsedShape = { ...parsedShape, sets: rounds };
			}
			return {
				...node,
				sets: rounds,
				parsed_shape: parsedShape
			};
		});
	};

	const getCircuitBlockNote = (block: ImportDraftBlock) =>
		(block.nodes.find((node) => (node.note ?? '').trim().length > 0)?.note ?? '').trim();

	const updateCircuitBlockNote = (dayId: string, blockId: string, value: string) => {
		updateBlockNodes(dayId, blockId, (node) => ({ ...node, note: value }));
	};

	const getNodePreview = (block: ImportDraftBlock, node: ImportDraftNode) => {
		const isCircuit = isCircuitBlock(block);
		const sets = isCircuit ? getCircuitBlockRounds(block) : toPositiveInt(node.sets, 0);
		const previewExercise: RoutineExercise = {
			id: node.id,
			name: node.raw_exercise_name,
			scheme: '',
			order: 0,
			totalSets: sets > 0 ? sets : undefined,
			repsMode: node.reps_mode,
			repsSpecial: node.reps_special ?? node.reps_text ?? null,
			repsMin: node.reps_mode === 'number' ? toPositiveInt(node.reps_min, 0) || undefined : undefined,
			repsMax:
				node.reps_mode === 'number' && toPositiveInt(node.reps_max, 0) > 0
					? toPositiveInt(node.reps_max, 0)
					: null,
			showRange:
				node.reps_mode === 'number' &&
				toPositiveInt(node.reps_min, 0) > 0 &&
				toPositiveInt(node.reps_max, 0) > toPositiveInt(node.reps_min, 0),
			blockType: isCircuit ? 'circuit' : 'normal',
			circuitRounds: isCircuit ? sets : null
		};
		return formatPrescriptionLong(previewExercise);
	};

	const saveDraft = async () => {
		if (!jobId || !draft) return;
		resetTransientState();
		const valid = importDraftSchema.safeParse(draft);
		if (!valid.success) {
			panelError = 'No pudimos guardar los cambios.';
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
					panelError = payload?.message ?? 'No pudimos guardar los cambios.';
				return;
			}
				draft = normalizeDraftForUi(payload.draft as ImportDraft | null);
				issues = payload.issues ?? [];
				stats = payload.stats ?? null;
				panelMessage = 'Cambios guardados.';
			} catch (e) {
			console.error(e);
				panelError = 'No pudimos guardar los cambios.';
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
			panelError = 'Todavía hay correcciones obligatorias antes de confirmar.';
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
						const current = payload?.current_version;
						const lastSaved =
							typeof payload?.last_saved_at === 'string'
								? new Date(payload.last_saved_at).toLocaleString()
								: null;
					routineVersionExpected = typeof current === 'number' ? current : routineVersionExpected;
					panelError = current
							? `La rutina cambió mientras revisabas. Actualizá y confirmá de nuevo${
									lastSaved ? ` (último guardado: ${lastSaved})` : ''
								}.`
							: payload?.message ?? 'La rutina cambió mientras revisabas. Actualizá y confirmá de nuevo.';
					} else {
						panelError = payload?.message ?? 'No pudimos confirmar los cambios.';
					}
				return;
			}

				lastBackupId = payload.backup_id ?? null;
				routineVersionExpected = payload.routine_version_after ?? routineVersionExpected;
				await applyRoutineUpdateToParent('commit', payload);
				panelMessage = 'Cambios aplicados correctamente.';
				await fetchJobStatus();
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos confirmar los cambios.';
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
				panelError = payload?.message ?? 'No pudimos deshacer los cambios.';
				return;
			}
				routineVersionExpected = payload.routine_version_after ?? routineVersionExpected;
				await applyRoutineUpdateToParent('rollback', payload);
				panelMessage = 'Se deshicieron los cambios correctamente.';
				await fetchJobStatus();
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos deshacer los cambios.';
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
		</div>
		<p class="text-sm leading-relaxed text-slate-300">
			Cargá un archivo o pegá texto, revisá lo detectado y confirmá cuando esté todo bien.
		</p>
	</header>

		<div class="space-y-4 rounded-xl border border-slate-700/70 bg-[#101523]/90 p-4 sm:p-5">
			<div class="space-y-2">
				<p class="text-[11px] font-semibold uppercase tracking-wide text-slate-400">Paso 1 · Elegí cómo cargar</p>
				<div class="grid gap-2 rounded-xl border border-slate-700/70 bg-[#0f1420] p-1 sm:grid-cols-2">
				<button
					type="button"
					class={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
						sourceMode === 'file'
							? 'border-slate-500/80 bg-slate-700/40 text-slate-50'
							: 'border-transparent text-slate-400 hover:bg-[#1a2132] hover:text-slate-200'
					}`}
					onclick={() => (sourceMode = 'file')}
				>
					Desde archivo
				</button>
				<button
					type="button"
					class={`rounded-lg border px-3 py-2.5 text-sm font-semibold transition ${
						sourceMode === 'text'
							? 'border-slate-500/80 bg-slate-700/40 text-slate-50'
							: 'border-transparent text-slate-400 hover:bg-[#1a2132] hover:text-slate-200'
					}`}
					onclick={() => (sourceMode = 'text')}
				>
					Desde texto pegado
				</button>
			</div>
			</div>

		{#if sourceMode === 'file'}
			<div class="space-y-2">
				<label for={FILE_INPUT_ID} class="text-sm font-medium text-slate-200">Archivo de rutina</label>
						<input
							id={FILE_INPUT_ID}
							type="file"
							accept=".txt,.csv,.xlsx,.docx,.pdf"
							class="w-full cursor-pointer rounded-xl border border-slate-600/70 bg-[#151b2a] px-3 py-3 text-sm text-slate-100 transition-colors hover:border-slate-500 file:mr-3 file:cursor-pointer file:rounded-lg file:border-0 file:bg-emerald-600 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white file:transition-colors file:hover:bg-emerald-500"
							onchange={(event) => {
								const input = event.currentTarget as HTMLInputElement;
								selectedFile = input.files?.[0] ?? null;
							}}
						/>
				<p class="text-xs text-slate-400">Formatos admitidos: TXT, CSV, XLSX, DOCX y PDF digital.</p>
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
					disabled={createBusy || processingBusy || !canStartImport()}
				>
					{createBusy
						? 'Iniciando importación...'
						: sourceMode === 'file'
							? 'Importar archivo'
							: 'Importar texto'}
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
					{processingBusy ? 'Actualizando...' : 'Actualizar estado'}
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
		</div>
	{/if}

	{#if stats}
		<div class="grid gap-3 sm:grid-cols-3">
			<article class="rounded-xl border border-slate-700/70 bg-[#101523] p-3">
				<p class="text-[11px] uppercase tracking-wide text-slate-400">Días detectados</p>
				<p class="mt-1 text-xl font-semibold text-slate-100">{stats.days_detected}</p>
			</article>
			<article class="rounded-xl border border-slate-700/70 bg-[#101523] p-3">
				<p class="text-[11px] uppercase tracking-wide text-slate-400">Ejercicios detectados</p>
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
					Revisión de la rutina · {issues.length} punto(s) para revisar
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
							</article>
						{/each}
					</div>
			{/if}

				{#if nonBlockingIssues().length > 0}
					<details class="rounded-lg border border-slate-700/70 bg-[#0f1420] p-3">
						<summary class="cursor-pointer text-xs font-semibold text-slate-200">
							Ver recomendaciones ({nonBlockingIssues().length})
						</summary>
						<div class="mt-3 max-h-48 space-y-2 overflow-auto pr-1">
							{#each nonBlockingIssues() as issue, index (`non-blocking-${issue.path}-${index}`)}
								<article class={`rounded-lg border px-3 py-2 text-xs ${parseSeverityTone(issue.severity)}`}>
									<p class="font-semibold">{formatIssueSeverity(issue.severity)}</p>
									<p class="mt-1">{issue.message}</p>
										{#if issue.suggested_fix}
											<p class="mt-1 text-[11px] opacity-90">Sugerencia: {issue.suggested_fix}</p>
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
					<h4 class="text-base font-semibold text-slate-100">Paso 2 · Revisá y corregí</h4>
					<p class="text-xs text-slate-400">Corregí lo que haga falta antes de confirmar.</p>
				</div>
					<button
						type="button"
						class="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-500 bg-[#1a2132] px-4 py-2 text-xs font-semibold text-slate-100 transition hover:bg-[#252f47] disabled:cursor-not-allowed disabled:opacity-60"
						onclick={saveDraft}
						disabled={saveDraftBusy}
					>
						{saveDraftBusy ? 'Guardando cambios...' : 'Guardar cambios'}
					</button>
				</div>

			<div class="grid gap-3 rounded-xl border border-slate-700/70 bg-[#0f1420] p-3">
				<label class="text-xs text-slate-300">
					Cómo querés ver los días
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
			</div>

			<div class="space-y-3">
				{#each draft.days as day (day.id)}
					<article class="space-y-3 rounded-xl border border-slate-700/70 bg-[#0f1420] p-3 sm:p-4">
						<div class="flex flex-wrap items-center justify-between gap-3">
							<div>
								<p class="text-sm font-semibold text-slate-100">{day.source_label}</p>
							</div>
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
							<div class="space-y-3 rounded-lg border border-slate-700/70 bg-[#111827] p-3">
								{#if isCircuitBlock(block)}
									<div class="space-y-4">
										<label class="block max-w-[12rem] text-[11px] font-medium text-slate-300">
											<span class="flex h-7 items-center">Vueltas</span>
											<input
												class="input-no-spin mt-1 w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												type="number"
												min="1"
												max="99"
												placeholder="Ej: 3"
												value={getCircuitBlockRounds(block)}
												oninput={(event) =>
													updateCircuitBlockRounds(
														day.id,
														block.id,
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
										<label class="block text-[11px] font-medium text-slate-300">
											<span class="flex h-7 items-center">Notas del circuito (opcional)</span>
											<input
												class="mt-1 w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												type="text"
												maxlength="140"
												placeholder="Ej. 30s de descanso entre vueltas"
												value={getCircuitBlockNote(block)}
												oninput={(event) =>
													updateCircuitBlockNote(
														day.id,
														block.id,
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
									</div>
									<div class="mt-5 border-t border-slate-700/70 pt-4">
										<div class="mb-2 hidden grid-cols-[minmax(0,1fr)_minmax(0,13rem)] gap-3 text-[11px] font-medium text-slate-300 md:grid">
											<span>Nombre</span>
											<span>Repeticiones</span>
										</div>
										<div class="space-y-2.5">
											{#each block.nodes as node (node.id)}
												<div class="rounded-lg border border-slate-700/60 bg-[#0f1728] p-3">
													<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_minmax(0,13rem)]">
														<label class="block text-[11px] font-medium text-slate-300">
															<span class="mb-1 block md:hidden">Nombre</span>
															<input
																class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
																placeholder="Nombre del ejercicio"
																value={node.raw_exercise_name}
																oninput={(event) =>
																	updateNodeName(
																		day.id,
																		block.id,
																		node.id,
																		(event.currentTarget as HTMLInputElement).value
																	)}
															/>
														</label>
														<label class="block text-[11px] font-medium text-slate-300">
															<span class="mb-1 block md:hidden">Repeticiones</span>
															<input
																class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
																type="text"
																maxlength="80"
																placeholder="Ej: 10, 8-10, 30 segundos, AMRAP, al fallo"
																value={getNodeRepsInputValue(node)}
																oninput={(event) =>
																	updateNodeRepsInput(
																		day.id,
																		block.id,
																		node.id,
																		(event.currentTarget as HTMLInputElement).value
																	)}
															/>
														</label>
													</div>
													<p class="mt-2 text-[10px] text-slate-400">
														Se verá así: {getNodePreview(block, node) || '...'}
													</p>
												</div>
											{/each}
										</div>
									</div>
								{:else}
									{#each block.nodes as node (node.id)}
										<div class="space-y-2 rounded-lg border border-slate-700/70 bg-[#111827] p-3">
											<div class="grid gap-3 md:grid-cols-[minmax(0,1fr)_8rem_minmax(0,13rem)] md:items-start">
												<label class="block text-[11px] font-medium text-slate-300">
													<span class="mb-1 block">Ejercicio</span>
													<input
														class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
														placeholder="Nombre del ejercicio"
														value={node.raw_exercise_name}
														oninput={(event) =>
															updateNodeName(
																day.id,
																block.id,
																node.id,
																(event.currentTarget as HTMLInputElement).value
															)}
													/>
												</label>
												<label class="block text-[11px] font-medium text-slate-300">
													<span class="mb-1 block">Series</span>
													<input
														class="input-no-spin w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
														type="number"
														min="1"
														placeholder="Ej: 3"
														value={node.sets ?? ''}
														oninput={(event) =>
															updateNodeSets(
																day.id,
																block.id,
																node.id,
																(event.currentTarget as HTMLInputElement).value
															)}
													/>
												</label>
												<label class="block text-[11px] font-medium text-slate-300">
													<span class="mb-1 block">Repeticiones</span>
													<input
														class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
														type="text"
														maxlength="80"
														placeholder="Ej: 10, 8-10, 30 segundos, AMRAP, al fallo"
														value={getNodeRepsInputValue(node)}
														oninput={(event) =>
															updateNodeRepsInput(
																day.id,
																block.id,
																node.id,
																(event.currentTarget as HTMLInputElement).value
															)}
													/>
													<p class="mt-1 text-[10px] text-slate-400">
														Se verá así: {getNodePreview(block, node) || '...'}
													</p>
												</label>
											</div>
											<input
												class="w-full rounded-lg border border-slate-600 bg-[#1a2132] px-3 py-2 text-xs text-slate-100 placeholder:text-slate-500"
												placeholder="Nota opcional"
												value={node.note ?? ''}
												oninput={(event) =>
													updateNodeNote(
														day.id,
														block.id,
														node.id,
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</div>
									{/each}
								{/if}
							</div>
						{/each}
					</article>
				{/each}
			</div>
		</div>
	{/if}

		{#if job && ['ready', 'committed', 'rolled_back'].includes(job.status)}
			<div class="space-y-5 rounded-xl border border-slate-700/70 bg-[#101523] p-5 sm:space-y-6 sm:p-6">
				<div class="space-y-1.5">
					<h4 class="text-base font-semibold text-slate-100">Paso 3 · Confirmar cambios</h4>
					<p class="text-xs text-slate-400">Elegí cómo aplicar estos cambios en la rutina actual.</p>
				</div>

				<div class="grid gap-3 sm:grid-cols-2">
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
					<div class="space-y-2.5">
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

				<div class="flex flex-wrap gap-2.5 pt-1">
				<button
					type="button"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-500 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={commitImport}
					disabled={commitBusy}
				>
					{commitBusy ? 'Aplicando cambios...' : 'Aplicar cambios'}
				</button>
				<button
					type="button"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-amber-600 bg-amber-950/20 px-4 py-2.5 text-sm font-semibold text-amber-100 transition hover:bg-amber-900/35 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={rollbackImport}
					disabled={rollbackBusy || !lastBackupId}
				>
					{rollbackBusy ? 'Deshaciendo cambios...' : 'Deshacer último cambio aplicado'}
				</button>
			</div>
		</div>
	{/if}
</section>

<style>
	.input-no-spin::-webkit-outer-spin-button,
	.input-no-spin::-webkit-inner-spin-button {
		-webkit-appearance: none;
		margin: 0;
	}
	.input-no-spin[type='number'] {
		-moz-appearance: textfield;
		appearance: textfield;
	}
</style>
