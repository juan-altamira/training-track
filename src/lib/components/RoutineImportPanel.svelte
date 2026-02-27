<script lang="ts">
	import { onDestroy, onMount } from 'svelte';
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
	import { parseRoutineRepsInput } from '$lib/routines';
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
	type AutosaveStatus = 'idle' | 'local' | 'syncing' | 'synced' | 'error';
	type AutosaveReason = 'debounce' | 'blur' | 'visibility' | 'beforeunload' | 'commit';
	type LocalAutosaveSnapshot = {
		hash: string;
		updatedAt: number;
		draft: ImportDraft;
	};
	const AUTOSAVE_DEBOUNCE_MS = 2500;
	const AUTOSAVE_STORAGE_PREFIX = 'training-track:import-draft:v1';
	type ImportReadyPayload = {
		jobId: string;
		plan: RoutinePlan;
		uiMeta: RoutineUiMeta;
		draft: ImportDraft;
		issues: ImportIssue[];
		stats: ImportStats | null;
	};

	let { clientId, initialRoutineVersion, initialUiMeta = null, onImportReady = null } = $props<{
		clientId: string;
		initialRoutineVersion: number;
		initialUiMeta?: RoutineUiMeta | null;
		onImportReady?: ((payload: ImportReadyPayload) => void | Promise<void>) | null;
	}>();

	let sourceMode = $state<'file' | 'text'>('file');
	let selectedFile = $state<File | null>(null);
	let rawText = $state('');
	let createBusy = $state(false);
	let processingBusy = $state(false);
	let commitBusy = $state(false);
	let rollbackBusy = $state(false);
	let panelMessage = $state<string | null>(null);
	let panelError = $state<string | null>(null);
	let jobId = $state<string | null>(null);
	let job = $state<ImportJobView | null>(null);
	let draft = $state<ImportDraft | null>(null);
	let issues = $state<ImportIssue[]>([]);
	let stats = $state<ImportStats | null>(null);
	let derivedPlan = $state<RoutinePlan | null>(null);
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
	let autosaveStatus = $state<AutosaveStatus>('idle');
	let autosaveLastLocalAt = $state<number | null>(null);
	let autosaveLastSyncedAt = $state<number | null>(null);
	let autosaveLastLocalHash = $state<string | null>(null);
	let autosaveLastSyncedHash = $state<string | null>(null);
	let autosaveSyncQueued = false;
	let autosaveSyncTimer: ReturnType<typeof setTimeout> | null = null;
	let autosaveSyncPromise: Promise<boolean> | null = null;
	const restoredAutosaveJobs = new Set<string>();
	const deliveredImportJobs = new Set<string>();

	$effect(() => {
		routineVersionExpected = initialRoutineVersion;
	});

	const stopPolling = () => {
		if (pollTimer) {
			clearTimeout(pollTimer);
			pollTimer = null;
		}
	};

	const hashText = (input: string) => {
		let hash = 2166136261;
		for (let index = 0; index < input.length; index += 1) {
			hash ^= input.charCodeAt(index);
			hash +=
				(hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
		}
		return (hash >>> 0).toString(16);
	};

	const toPlainData = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

	const getAutosaveStorageKey = (nextJobId: string | null = jobId) =>
		nextJobId ? `${AUTOSAVE_STORAGE_PREFIX}:${clientId}:${nextJobId}` : null;

	const clearAutosaveTimer = () => {
		if (autosaveSyncTimer) {
			clearTimeout(autosaveSyncTimer);
			autosaveSyncTimer = null;
		}
	};

	const readLocalAutosaveSnapshot = (
		nextJobId: string | null = jobId
	): LocalAutosaveSnapshot | null => {
		if (typeof window === 'undefined') return null;
		const key = getAutosaveStorageKey(nextJobId);
		if (!key) return null;
		try {
			const raw = window.localStorage.getItem(key);
			if (!raw) return null;
			const parsed = JSON.parse(raw) as LocalAutosaveSnapshot;
			if (!parsed || typeof parsed !== 'object') return null;
			if (typeof parsed.hash !== 'string' || typeof parsed.updatedAt !== 'number') return null;
			const valid = importDraftSchema.safeParse(parsed.draft);
			if (!valid.success) return null;
			return {
				hash: parsed.hash,
				updatedAt: parsed.updatedAt,
				draft: normalizeDraftForUi(valid.data) as ImportDraft
			};
		} catch {
			return null;
		}
	};

	const writeLocalAutosaveSnapshot = (nextDraft: ImportDraft, hash: string) => {
		if (typeof window === 'undefined') return;
		const key = getAutosaveStorageKey();
		if (!key) return;
		try {
			const snapshot: LocalAutosaveSnapshot = {
				hash,
				updatedAt: Date.now(),
				draft: structuredClone(nextDraft)
			};
			window.localStorage.setItem(key, JSON.stringify(snapshot));
			autosaveLastLocalAt = snapshot.updatedAt;
			autosaveLastLocalHash = hash;
		} catch (error) {
			console.error(error);
		}
	};

	const clearLocalAutosaveSnapshot = (nextJobId: string | null = jobId) => {
		if (typeof window === 'undefined') return;
		const key = getAutosaveStorageKey(nextJobId);
		if (!key) return;
		try {
			window.localStorage.removeItem(key);
		} catch (error) {
			console.error(error);
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

	const isImportInProgress = () => {
		if (createBusy) return true;
		return Boolean(job && shouldKeepPolling(job.status));
	};

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
		derivedPlan = (payload.derived_plan as RoutinePlan | null) ?? null;
		if (draft) {
			const hash = hashText(JSON.stringify(draft));
			autosaveLastSyncedHash = hash;
			autosaveLastSyncedAt = Date.now();
			if (!autosaveLastLocalHash) {
				autosaveLastLocalHash = hash;
			}
			if (autosaveStatus === 'idle') {
				autosaveStatus = 'synced';
			}
		}
		issues = Array.isArray(payload.issues) ? payload.issues : [];
		stats = payload.stats ?? null;
	};

	const scheduleAutosaveSync = (delay = AUTOSAVE_DEBOUNCE_MS) => {
		clearAutosaveTimer();
		autosaveSyncTimer = setTimeout(() => {
			void syncDraftToServer('debounce');
		}, delay);
	};

	const syncDraftToServer = async (
		reason: AutosaveReason,
		options?: { keepalive?: boolean; silent?: boolean }
	): Promise<boolean> => {
		if (!jobId || !draft) return true;
		const valid = importDraftSchema.safeParse(draft);
		if (!valid.success) {
			autosaveStatus = 'error';
			return false;
		}
		const nextDraft = valid.data;
		const serialized = JSON.stringify(nextDraft);
		const hash = hashText(serialized);
		if (hash === autosaveLastSyncedHash) {
			autosaveStatus = 'synced';
			return true;
		}

		if (autosaveSyncPromise) {
			if (reason === 'commit') {
				const result = await autosaveSyncPromise;
				if (!result) return false;
				if (hash === autosaveLastSyncedHash) return true;
			} else {
				autosaveSyncQueued = true;
				return true;
			}
		}

		autosaveStatus = 'syncing';
		const request = (async () => {
			try {
				const res = await fetch(`/api/import/jobs/${jobId}/draft`, {
					method: 'PATCH',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ draft: nextDraft }),
					keepalive: options?.keepalive === true
				});
				const payload = await res.json().catch(() => ({}));
				if (!res.ok) {
					if (!options?.silent) {
						panelError = payload?.message ?? 'No pudimos sincronizar los cambios.';
					}
					autosaveStatus = 'error';
					return false;
				}
				issues = payload.issues ?? [];
				stats = payload.stats ?? null;
				autosaveLastSyncedHash = hash;
				autosaveLastSyncedAt = Date.now();
				autosaveStatus = 'synced';
				writeLocalAutosaveSnapshot(nextDraft, hash);
				return true;
			} catch (error) {
				console.error(error);
				if (!options?.silent) {
					panelError = 'No pudimos sincronizar los cambios.';
				}
				autosaveStatus = 'error';
				return false;
			}
		})();

		autosaveSyncPromise = request;
		const result = await request;
		autosaveSyncPromise = null;

		if (autosaveSyncQueued) {
			autosaveSyncQueued = false;
			scheduleAutosaveSync(250);
		}
		return result;
	};

	const restoreLocalDraftIfNeeded = (status: string) => {
		if (!jobId || !draft) return;
		if (!['queued', 'processing', 'ready', 'committing'].includes(status)) return;
		if (restoredAutosaveJobs.has(jobId)) return;
		restoredAutosaveJobs.add(jobId);
		const snapshot = readLocalAutosaveSnapshot(jobId);
		if (!snapshot) return;
		if (snapshot.hash === autosaveLastSyncedHash) {
			autosaveLastLocalHash = snapshot.hash;
			autosaveStatus = 'synced';
			return;
		}
		draft = snapshot.draft;
		autosaveLastLocalHash = snapshot.hash;
		autosaveLastLocalAt = snapshot.updatedAt;
		autosaveStatus = 'local';
		scheduleAutosaveSync(300);
	};

	const emitImportReady = async () => {
		if (!onImportReady || !jobId || !draft || !derivedPlan || !job) return;
		if (job.status !== 'ready') return;
		if (deliveredImportJobs.has(jobId)) return;
		const totalExercises = Object.values(derivedPlan).reduce(
			(total, day) => total + (day?.exercises?.length ?? 0),
			0
		);
		if (totalExercises <= 0) return;
		await onImportReady({
			jobId,
			plan: toPlainData(derivedPlan),
			uiMeta: {
				day_label_mode: getDraftMode(),
				hide_empty_days_in_sequential: true
			},
			draft: toPlainData(draft),
			issues: toPlainData(issues),
			stats: stats ? toPlainData(stats) : null
		});
		deliveredImportJobs.add(jobId);
		panelError = null;
	};

	const applyRoutineUpdateToParent = async (
		_action: 'commit' | 'rollback',
		_payload: Record<string, any> | null | undefined
	) => {};

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
				if (job) {
					restoreLocalDraftIfNeeded(job.status);
				}
				try {
					await emitImportReady();
				} catch (error) {
					console.error(error);
					panelError = 'No pudimos abrir la rutina importada en el editor.';
					stopPolling();
					return;
				}
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

					clearAutosaveTimer();
					const nextJobId = payload.job_id as string;
					jobId = nextJobId;
					autosaveStatus = 'idle';
					autosaveLastLocalAt = null;
					autosaveLastSyncedAt = null;
					autosaveLastLocalHash = null;
					autosaveLastSyncedHash = null;
					restoredAutosaveJobs.delete(nextJobId);
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

	const isCircuitBlock = (block: ImportDraftBlock) =>
		block.block_type === 'circuit' || block.block_type === 'superset';

	const getBlockMode = (block: ImportDraftBlock): 'normal' | 'circuit' =>
		isCircuitBlock(block) ? 'circuit' : 'normal';

	const makeDefaultFieldMeta = (rawSnippet = '') => ({
		confidence: { score: 0.6 as const, label: 'medium' as const },
		provenance: { raw_snippet: rawSnippet }
	});

	const buildEmptyNodeForBlock = (block: ImportDraftBlock): ImportDraftNode => {
		const blockNote = isCircuitBlock(block) ? getCircuitBlockNote(block) : '';
		const rounds = isCircuitBlock(block) ? getCircuitBlockRounds(block) : 3;
		const fieldMeta = makeDefaultFieldMeta('');
		return {
			id: crypto.randomUUID(),
			source_raw_name: '',
			raw_exercise_name: '',
			sets: rounds,
			reps_mode: 'number',
			reps_text: null,
			reps_min: null,
			reps_max: null,
			reps_special: null,
			note: blockNote || null,
			parsed_shape: null,
			split_meta: null,
			field_meta: {
				day: fieldMeta,
				name: fieldMeta,
				sets: fieldMeta,
				reps: fieldMeta,
				note: null
			},
			debug: {
				path: 'legacy',
				struct_tokens_used_count: 0
			}
		};
	};

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

	const addNodeToBlock = (dayId: string, blockId: string) => {
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
											nodes: [...block.nodes, buildEmptyNodeForBlock(block)]
										}
							)
						}
			)
		};
	};

	const removeNodeFromBlock = (dayId: string, blockId: string, nodeId: string) => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id !== dayId
					? day
					: {
							...day,
							blocks: day.blocks.map((block) => {
								if (block.id !== blockId) return block;
								let nodes = block.nodes.filter((node) => node.id !== nodeId);
								if (nodes.length === 0) {
									nodes = [buildEmptyNodeForBlock(block)];
								}
								if (isCircuitBlock(block)) {
									const note = getCircuitBlockNote(block);
									if (note) {
										nodes = nodes.map((node) => ({ ...node, note: note }));
									}
								}
								return { ...block, nodes };
							})
						}
			)
		};
	};

	const buildEmptyBlock = (mode: 'normal' | 'circuit' = 'normal'): ImportDraftBlock => {
		const block: ImportDraftBlock = {
			id: crypto.randomUUID(),
			block_type: mode === 'circuit' ? 'circuit' : 'single',
			nodes: []
		};
		block.nodes = [buildEmptyNodeForBlock(block)];
		return block;
	};

	const addBlockToDay = (dayId: string, mode: 'normal' | 'circuit' = 'normal') => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id !== dayId
					? day
					: {
							...day,
							blocks: [...day.blocks, buildEmptyBlock(mode)]
						}
			)
		};
	};

	const addDay = () => {
		if (!draft) return;
		const nextIndex = draft.days.length;
		const mode = getDraftMode();
		const mappedDayKey = IMPORT_WEEK_DAY_KEYS[nextIndex] ?? null;
		const baseLabel =
			mode === 'weekday' && mappedDayKey
				? formatWeekDay(mappedDayKey)
				: `Día ${nextIndex + 1}`;
		const nextDay = {
			id: crypto.randomUUID(),
			source_label: baseLabel,
			display_label: mode === 'custom' ? baseLabel : null,
			mapped_day_key: mappedDayKey,
			blocks: [buildEmptyBlock('normal')]
		};
		draft = {
			...draft,
			days: [...draft.days, nextDay]
		};
	};

	const updateBlockMode = (dayId: string, blockId: string, mode: 'normal' | 'circuit') => {
		if (!draft) return;
		draft = {
			...draft,
			days: draft.days.map((day) =>
				day.id !== dayId
					? day
					: {
							...day,
							blocks: day.blocks.map((block) => {
								if (block.id !== blockId) return block;
								const nextType: ImportDraftBlock['block_type'] =
									mode === 'circuit' ? 'circuit' : 'single';
								const rounds = mode === 'circuit' ? getCircuitBlockRounds(block) : null;
								const nodes = block.nodes.map((node) => {
									let nextShape = node.parsed_shape ? { ...node.parsed_shape } : node.parsed_shape;
									if (nextShape?.block) {
										if (mode === 'circuit') {
											nextShape.block = {
												kind: 'circuit',
												rounds: rounds ?? 1,
												header_text: nextShape.block.header_text || 'Circuito',
												header_unit_id: block.id
											};
										} else {
											delete (nextShape as { block?: unknown }).block;
										}
									}
									if (
										nextShape &&
										(nextShape.kind === 'fixed' ||
											nextShape.kind === 'range' ||
											nextShape.kind === 'scheme' ||
											nextShape.kind === 'amrap')
									) {
										nextShape = {
											...nextShape,
											sets: mode === 'circuit' ? Math.max(1, rounds ?? 1) : Math.max(1, toPositiveInt(node.sets, 1))
										};
									}
									return {
										...node,
										sets:
											mode === 'circuit'
												? Math.max(1, rounds ?? 1)
												: Math.max(1, toPositiveInt(node.sets, 1)),
										note:
											mode === 'circuit'
												? node.note || getCircuitBlockNote(block) || null
												: node.note,
										parsed_shape: nextShape
									};
								});
								return {
									...block,
									block_type: nextType,
									nodes
								};
							})
						}
			)
		};
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

	const forceAutosaveSync = async (
		reason: AutosaveReason,
		options?: { keepalive?: boolean; silent?: boolean }
	) => {
		clearAutosaveTimer();
		return await syncDraftToServer(reason, options);
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
		const synced = await forceAutosaveSync('commit');
		if (!synced) {
			panelError = 'No pudimos sincronizar los cambios antes de aplicar. Revisá tu conexión.';
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
					clearLocalAutosaveSnapshot(jobId);
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
					clearLocalAutosaveSnapshot(jobId);
					panelMessage = 'Se deshicieron los cambios correctamente.';
					await fetchJobStatus();
			} catch (e) {
			console.error(e);
			panelError = 'No pudimos deshacer los cambios.';
		} finally {
			rollbackBusy = false;
		}
	};

	const handleEditorFocusOut = (event: FocusEvent) => {
		const target = event.target;
		if (
			!(target instanceof HTMLInputElement) &&
			!(target instanceof HTMLTextAreaElement) &&
			!(target instanceof HTMLSelectElement)
		) {
			return;
		}
		if (!draft || !jobId) return;
		if (autosaveLastLocalHash && autosaveLastLocalHash === autosaveLastSyncedHash) return;
		void forceAutosaveSync('blur', { silent: true });
	};

	$effect(() => {
		if (!draft || !jobId) return;
		const serialized = JSON.stringify(draft);
		const hash = hashText(serialized);
		if (hash === autosaveLastLocalHash) return;
		writeLocalAutosaveSnapshot(draft, hash);
		if (hash === autosaveLastSyncedHash) {
			autosaveStatus = 'synced';
			return;
		}
		autosaveStatus = 'local';
		scheduleAutosaveSync();
	});

	onMount(() => {
		const onWindowBlur = () => {
			if (!draft || !jobId) return;
			if (autosaveLastLocalHash && autosaveLastLocalHash === autosaveLastSyncedHash) return;
			void forceAutosaveSync('blur', { silent: true });
		};
		const onVisibilityChange = () => {
			if (document.visibilityState !== 'hidden') return;
			if (!draft || !jobId) return;
			if (autosaveLastLocalHash && autosaveLastLocalHash === autosaveLastSyncedHash) return;
			void forceAutosaveSync('visibility', { keepalive: true, silent: true });
		};
		const onBeforeUnload = () => {
			if (!draft || !jobId) return;
			if (autosaveLastLocalHash && autosaveLastLocalHash === autosaveLastSyncedHash) return;
			void forceAutosaveSync('beforeunload', { keepalive: true, silent: true });
		};

		window.addEventListener('blur', onWindowBlur);
		document.addEventListener('visibilitychange', onVisibilityChange);
		window.addEventListener('beforeunload', onBeforeUnload);

		return () => {
			window.removeEventListener('blur', onWindowBlur);
			document.removeEventListener('visibilitychange', onVisibilityChange);
			window.removeEventListener('beforeunload', onBeforeUnload);
		};
	});

	onDestroy(() => {
		stopPolling();
		clearAutosaveTimer();
	});
</script>

<section
	class="space-y-5 rounded-2xl border border-slate-800/90 bg-[radial-gradient(circle_at_top,#16213a_0%,#0f111b_45%,#0d0f18_100%)] p-5 shadow-2xl shadow-black/25 sm:p-6"
	onfocusout={handleEditorFocusOut}
>
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
					data-testid="import-textarea"
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
					data-testid="import-submit"
					class="inline-flex min-h-11 items-center justify-center rounded-xl border border-emerald-500 bg-emerald-600 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-emerald-500 disabled:cursor-not-allowed disabled:opacity-60"
					onclick={startImport}
					disabled={createBusy || processingBusy || !canStartImport()}
				>
					{isImportInProgress()
						? sourceMode === 'file'
							? 'Importando archivo...'
							: 'Importando texto...'
						: sourceMode === 'file'
							? 'Importar archivo'
							: 'Importar texto'}
				</button>
				{#if sourceMode === 'file' && isImportInProgress()}
					<span class="import-inline-spinner" aria-hidden="true"></span>
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

	{#if stats && !onImportReady}
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

	{#if issues.length > 0 && !onImportReady}
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

	{#if draft && !onImportReady}
		<div class="space-y-5 rounded-2xl border border-slate-600/70 bg-[#0f1525] p-4 shadow-lg shadow-black/25 sm:p-6">
			<div class="flex flex-wrap items-center justify-between gap-3">
				<h4 class="text-xl font-bold tracking-tight text-slate-50 sm:text-2xl">Paso 2 · Revisá y corregí</h4>
				<button
					type="button"
					class="inline-flex min-h-10 items-center justify-center rounded-xl border border-cyan-700/70 bg-cyan-950/25 px-3.5 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/35"
					onclick={addDay}
				>
					+ Agregar día
				</button>
			</div>

			<section class="rounded-2xl border border-slate-800/80 bg-[#0d1320] px-4 py-4">
				<label class="block text-xs font-semibold uppercase tracking-[0.14em] text-slate-300">
					Vista de los días
					<select
						class="import-select mt-2 block w-full rounded-xl border border-slate-500 bg-[#1b253b] px-3 py-2.5 text-sm font-semibold text-slate-100"
						value={getDraftMode()}
						onchange={(event) =>
							setDraftMode((event.currentTarget as HTMLSelectElement).value as DayLabelMode)}
					>
						{#each DAY_LABEL_MODES as mode}
							<option value={mode}>{DAY_LABEL_MODE_LABELS[mode]}</option>
						{/each}
					</select>
				</label>
			</section>

			<div class="space-y-6">
				{#each draft.days as day (day.id)}
					<section class="rounded-3xl border border-cyan-950/80 bg-[linear-gradient(180deg,rgba(10,17,30,0.98),rgba(13,20,34,0.98))] p-4 shadow-[inset_0_1px_0_rgba(103,232,249,0.05)] ring-1 ring-cyan-950/50 sm:p-5">
						<div class="flex flex-wrap items-end justify-between gap-4 border-b border-cyan-950/70 pb-4">
							<div class="space-y-2">
								<p class="text-xl font-bold tracking-tight text-cyan-50 sm:text-2xl">{day.source_label}</p>
								{#if getDraftMode() === 'custom'}
									<label class="block max-w-xl text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
										Nombre visible
										<input
											class="import-edit-input mt-2 w-full rounded-xl px-3 py-2.5 text-sm"
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
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<button
									type="button"
									class="inline-flex min-h-10 items-center justify-center rounded-xl border border-slate-600/80 bg-[#141c2d] px-3.5 py-2 text-xs font-semibold text-slate-200 transition hover:border-slate-500 hover:bg-[#1a2438]"
									onclick={() => addBlockToDay(day.id, 'normal')}
								>
									+ Bloque normal
								</button>
								<button
									type="button"
									class="inline-flex min-h-10 items-center justify-center rounded-xl border border-cyan-700/70 bg-cyan-950/20 px-3.5 py-2 text-xs font-semibold text-cyan-100 transition hover:bg-cyan-900/30"
									onclick={() => addBlockToDay(day.id, 'circuit')}
								>
									+ Circuito
								</button>
							</div>
						</div>

						<div class="mt-5 space-y-4">
							{#each day.blocks as block (block.id)}
								<section
									class={`rounded-2xl border p-4 sm:p-5 ${
										isCircuitBlock(block)
											? 'border-cyan-900/70 bg-[#111b2d]'
											: 'border-slate-700/80 bg-[#111827]'
									}`}
								>
									<div class="flex flex-wrap items-center justify-between gap-3">
										<div class="space-y-1">
											<p class={`text-sm font-bold uppercase tracking-[0.18em] ${
												isCircuitBlock(block) ? 'text-cyan-100' : 'text-slate-100'
											}`}>
												{isCircuitBlock(block) ? 'Circuito' : 'Ejercicios'}
											</p>
										</div>
										<div class="inline-flex rounded-xl border border-slate-500 bg-[#101a30] p-0.5">
											<button
												type="button"
												class={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
													getBlockMode(block) === 'normal'
														? 'bg-cyan-300 text-slate-950'
														: 'text-slate-200 hover:bg-[#1b2740]'
												}`}
												onclick={() => updateBlockMode(day.id, block.id, 'normal')}
											>
												Normal
											</button>
											<button
												type="button"
												class={`rounded-lg px-3.5 py-2 text-xs font-semibold transition ${
													getBlockMode(block) === 'circuit'
														? 'bg-cyan-300 text-slate-950'
														: 'text-slate-200 hover:bg-[#1b2740]'
												}`}
												onclick={() => updateBlockMode(day.id, block.id, 'circuit')}
											>
												Circuito
											</button>
										</div>
									</div>

									{#if isCircuitBlock(block)}
										<div class="mt-5 grid gap-5 lg:grid-cols-[11rem_minmax(0,1fr)]">
											<div class="space-y-2">
												<label class="block text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-300">
													Vueltas
													<input
														class="import-edit-input input-no-spin mt-2 w-full rounded-xl px-3 py-2.5 text-sm"
														type="number"
														min="1"
														max="99"
														aria-label="Vueltas del circuito"
														placeholder="Vueltas"
														value={getCircuitBlockRounds(block)}
														oninput={(event) =>
															updateCircuitBlockRounds(
																day.id,
																block.id,
																(event.currentTarget as HTMLInputElement).value
															)}
													/>
												</label>
											</div>

											<div class="space-y-3">
												<div class="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_2.5rem] sm:gap-3">
													<span class="import-edit-col-label">Nombre</span>
													<span class="import-edit-col-label">Repeticiones</span>
													<span></span>
												</div>
												{#each block.nodes as node (node.id)}
													<div class="grid gap-3 rounded-xl bg-[#0d1423] p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,14rem)_2.5rem] sm:items-end">
														<div class="space-y-1.5">
															<p class="import-edit-label sm:hidden">Nombre</p>
															<input
																class="import-edit-input w-full rounded-xl px-3 py-2.5 text-sm"
																aria-label="Nombre del ejercicio"
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
														</div>
														<div class="space-y-1.5">
															<p class="import-edit-label sm:hidden">Repeticiones</p>
															<input
																class="import-edit-input w-full rounded-xl px-3 py-2.5 text-sm"
																type="text"
																maxlength="80"
																aria-label="Repeticiones del ejercicio"
																placeholder="Ej: 10, 8-10, AMRAP"
																value={getNodeRepsInputValue(node)}
																oninput={(event) =>
																	updateNodeRepsInput(
																		day.id,
																		block.id,
																		node.id,
																		(event.currentTarget as HTMLInputElement).value
																	)}
															/>
														</div>
														<button
															type="button"
															class="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl border border-red-700/70 bg-red-950/20 text-sm font-semibold text-red-300 transition hover:bg-red-900/35"
															aria-label="Quitar ejercicio"
															onclick={() => removeNodeFromBlock(day.id, block.id, node.id)}
														>
															×
														</button>
													</div>
												{/each}
												<button
													type="button"
													class="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-cyan-800/70 bg-transparent px-4 py-2.5 text-sm font-semibold text-cyan-100 transition hover:bg-cyan-950/20"
													onclick={() => addNodeToBlock(day.id, block.id)}
												>
													+ Agregar ejercicio
												</button>
											</div>
										</div>
									{:else}
										<div class="mt-5 space-y-3">
											<div class="hidden sm:grid sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,16rem)_2.5rem] sm:gap-3">
												<span class="import-edit-col-label">Nombre</span>
												<span class="import-edit-col-label">Series</span>
												<span class="import-edit-col-label">Repeticiones</span>
												<span></span>
											</div>
											{#each block.nodes as node (node.id)}
												<div class="grid gap-3 rounded-xl bg-[#0d1423] p-3 sm:grid-cols-[minmax(0,1fr)_8rem_minmax(0,16rem)_2.5rem] sm:items-end">
													<div class="space-y-1.5">
														<p class="import-edit-label sm:hidden">Nombre</p>
														<input
															class="import-edit-input w-full rounded-xl px-3 py-2.5 text-sm"
															aria-label="Nombre del ejercicio"
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
													</div>
													<div class="space-y-1.5">
														<p class="import-edit-label sm:hidden">Series</p>
														<input
															class="import-edit-input input-no-spin w-full rounded-xl px-3 py-2.5 text-sm"
															type="number"
															min="1"
															aria-label="Series del ejercicio"
															placeholder="Series"
															value={node.sets ?? ''}
															oninput={(event) =>
																updateNodeSets(
																	day.id,
																	block.id,
																	node.id,
																	(event.currentTarget as HTMLInputElement).value
																)}
														/>
													</div>
													<div class="space-y-1.5">
														<p class="import-edit-label sm:hidden">Repeticiones</p>
														<input
															class="import-edit-input w-full rounded-xl px-3 py-2.5 text-sm"
															type="text"
															maxlength="80"
															aria-label="Repeticiones del ejercicio"
															placeholder="Ej: 10, 8-10, 30 segundos, AMRAP"
															value={getNodeRepsInputValue(node)}
															oninput={(event) =>
																updateNodeRepsInput(
																	day.id,
																	block.id,
																	node.id,
																	(event.currentTarget as HTMLInputElement).value
																)}
														/>
													</div>
													<button
														type="button"
														class="inline-flex h-10 w-10 items-center justify-center self-end rounded-xl border border-red-700/70 bg-red-950/20 text-sm font-semibold text-red-300 transition hover:bg-red-900/35"
														aria-label="Quitar ejercicio"
														onclick={() => removeNodeFromBlock(day.id, block.id, node.id)}
													>
														×
													</button>
												</div>
											{/each}
											<button
												type="button"
												class="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-slate-700 bg-transparent px-4 py-2.5 text-sm font-semibold text-slate-100 transition hover:bg-[#151d2f]"
												onclick={() => addNodeToBlock(day.id, block.id)}
											>
												+ Agregar ejercicio
											</button>
										</div>
									{/if}
								</section>
							{/each}
						</div>
					</section>
				{/each}
			</div>
		</div>
	{/if}

		{#if onImportReady && jobId && deliveredImportJobs.has(jobId) && job?.status === 'ready' && draft && derivedPlan}
			<div class="rounded-xl border border-emerald-700/60 bg-emerald-950/25 px-4 py-3 text-sm text-emerald-100">
				<p class="font-semibold">Rutina cargada en el editor.</p>
				<p class="mt-1 text-emerald-200/90">
					{issues.length > 0
						? `Revisá los ${issues.length} punto(s) marcados antes de publicar.`
						: 'Podés revisar la rutina directamente en el editor real y publicar cuando esté lista.'}
				</p>
			</div>
		{/if}

		{#if job && ['ready', 'committed', 'rolled_back'].includes(job.status) && !onImportReady}
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
		.import-select {
			appearance: none;
			padding-right: 2.35rem;
			background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 20 20' fill='none'%3E%3Cpath d='M5 7.5L10 12.5L15 7.5' stroke='%23cbd5e1' stroke-width='1.8' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");
			background-repeat: no-repeat;
			background-position: right 0.75rem center;
			background-size: 0.9rem 0.9rem;
		}
		.import-inline-spinner {
			width: 1.75rem;
			height: 1.75rem;
			border-radius: 999px;
			background: conic-gradient(
				from 165deg,
				rgb(224 231 255 / 0.22) 0deg,
				rgb(199 210 254 / 0.55) 205deg,
				rgb(59 130 246 / 0.98) 300deg,
				rgb(30 64 175 / 0.98) 360deg
			);
			-webkit-mask: radial-gradient(
				farthest-side,
				transparent calc(100% - 4px),
				#000 calc(100% - 3px)
			);
			mask: radial-gradient(
				farthest-side,
				transparent calc(100% - 4px),
				#000 calc(100% - 3px)
			);
			animation: import-spinner-rotate 900ms linear infinite;
			filter: drop-shadow(0 0 8px rgb(56 189 248 / 0.35));
		}
		@keyframes import-spinner-rotate {
			to {
				transform: rotate(360deg);
			}
		}
		.import-edit-input {
			border: 1px solid rgb(100 116 139 / 0.65);
			background: linear-gradient(180deg, rgb(28 38 60 / 0.96), rgb(24 33 52 / 0.96));
			color: rgb(241 245 249);
			transition:
				border-color 140ms ease,
				box-shadow 140ms ease,
				background-color 140ms ease;
		}
		.import-edit-input::placeholder {
			color: rgb(148 163 184 / 0.95);
		}
		.import-edit-input:hover {
			border-color: rgb(125 145 184 / 0.82);
		}
		.import-edit-input:focus {
			outline: none;
			border-color: rgb(56 189 248 / 0.85);
			box-shadow: 0 0 0 3px rgb(56 189 248 / 0.16);
		}
		.import-edit-label {
			font-size: 10px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: rgb(203 213 225 / 0.95);
		}
		.import-edit-col-label {
			font-size: 10px;
			font-weight: 700;
			text-transform: uppercase;
			letter-spacing: 0.06em;
			color: rgb(226 232 240 / 0.92);
		}
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
