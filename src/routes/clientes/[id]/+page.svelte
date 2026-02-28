<script lang="ts">
	import { DAY_FEEDBACK_MOOD_LABEL, DAY_FEEDBACK_PAIN_LABEL, type DayFeedbackByDay, type DayFeedbackMood, type DayFeedbackPain } from '$lib/dayFeedback';
	import {
		WEEK_DAYS,
		type RoutineEditorBlock,
		buildRoutineEditorBlocks,
		formatPrescriptionLong,
		getDisplayDays,
		getRoutineExerciseBlockId,
		getRoutineExerciseBlockType,
		getRoutineExerciseRepsMode,
		getTargetSets,
		parseRoutineRepsInput,
		normalizePlan,
		normalizeRoutineUiMeta,
		sanitizeCustomLabel
	} from '$lib/routines';
	import RoutineImportPanel from '$lib/components/RoutineImportPanel.svelte';
	import { buildImportedRoutineUiMeta, indexImportIssuesForEditor, type ImportEditorFieldKey, type ImportEditorIssueIndex } from '$lib/import/editor-session';
	import type { ImportDraft, ImportIssue, ImportStats } from '$lib/import/types';
	import type {
		OtherClientRow,
		ProgressState,
		RoutineBlockType,
		RoutineDayLabelMode,
		RoutineExercise,
		RoutinePlan,
		RoutineUiMeta
	} from '$lib/types';
import { onMount, tick } from 'svelte';
	import { rememberLastClientRoute } from '$lib/client/sessionResumeWarmup';

	let { data } = $props();

	let plan: RoutinePlan = $state(normalizePlan(structuredClone(data.plan)));
	let progress: ProgressState = $state(structuredClone(data.progress));
	let uiMeta: Required<RoutineUiMeta> = $state(normalizeRoutineUiMeta(data.uiMeta ?? null));
	let routineVersion = $state(data.routineVersion ?? 1);
	let selectedDay = $state(WEEK_DAYS[0].key);
	let saving = $state(false);
	let feedback = $state('');
	let feedbackType = $state<'success' | 'warning' | 'error'>('success');
	let showValidationErrors = $state(false);
	let blockInlineWarnings = $state<Record<string, string>>({});
	let dayInlineWarnings = $state<Record<string, string>>({});
	let blockModeDrafts = $state<Record<string, RoutineExercise[]>>({});
	let importReviewSession = $state<ImportReviewSession | null>(null);
	let statusMessage = $state('');
	let clientStatus = $state(data.client.status as 'active' | 'archived');
	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let showArchiveConfirm = $state(false);
	let showResetConfirm = $state(false);
	let showDiscardImportConfirm = $state(false);
	let discardImportPending = $state(false);
	let showImportPublishConfirm = $state(false);
	let copiedLink = $state(false);
	let showCopyModal = $state(false);
	let selectedSource = $state('');
	let expandedDay = $state<string | null>(null);
	let showDayModeMenu = $state(false);
	let showCopySourceMenu = $state(false);
	const MAX_EXERCISES_PER_DAY = 50;
	const UNDO_DELETE_TIMEOUT_MS = 6000;
	let otherClients = $state((data.otherClients ?? []) as OtherClientRow[]);
	let lazyOtherClients = $state(data.lazyOtherClients === true);
	let loadingOtherClients = $state(false);
	let otherClientsError = $state<string | null>(null);
	let dayFeedback = $state((data.dayFeedback ?? {}) as DayFeedbackByDay);
	let feedbackExpanded = $state<Record<string, boolean>>({});
	const hasSuspicious = () =>
		displayDays(expandedDay)
			.filter((entry) => entry.hasExercises || entry.dayKey === expandedDay)
			.some((day) => {
				const completion = dayCompletion(day.dayKey);
				return Boolean(progress[day.dayKey]?.suspicious && completion.completed);
			});
	let showImportPanel = $state(false);
	let dayModeMenuEl: HTMLDivElement | null = null;
	let copySourceMenuEl = $state<HTMLDivElement | null>(null);

	const DAY_MODE_OPTIONS: Array<{
		value: RoutineDayLabelMode;
		label: string;
		description: string;
	}> = [
		{
			value: 'weekday',
			label: 'Semanal (Lunes..Domingo)',
			description: 'Mantiene la vista clásica por semana.'
		},
		{
			value: 'sequential',
			label: 'Secuencial (Día 1..N)',
			description: 'Ideal para planes tipo Día 1, Día 2 y Día 3.'
		},
		{
			value: 'custom',
			label: 'Personalizado',
			description: 'Permite definir etiquetas propias para cada día.'
		}
	];

	const SITE_URL = (data.siteUrl ?? '').replace(/\/?$/, '');
	const link = `${SITE_URL}/r/${data.client.client_code}`;
	const SHOW_SEQUENTIAL_HIDE_EMPTY_TOGGLE = false;
	const FORCE_SHOW_EMPTY_DAYS = true;

	const defaultDayLabelByKey = Object.fromEntries(WEEK_DAYS.map((day) => [day.key, day.label])) as Record<
		string,
		string
	>;

	const displayDays = (
		activeDayKey: string | null,
		includeEmptyOverride = false
	) => getDisplayDays(plan, uiMeta, {
		activeDayKey,
		includeEmptyOverride: includeEmptyOverride || FORCE_SHOW_EMPTY_DAYS
	});

	const dayDisplayLabel = (dayKey: string) =>
		displayDays(dayKey, true).find((day) => day.dayKey === dayKey)?.displayLabel ??
		defaultDayLabelByKey[dayKey] ??
		dayKey;

	const totalExercisesInPlan = () =>
		WEEK_DAYS.reduce((total, day) => total + (plan[day.key]?.exercises?.length ?? 0), 0);

	const hasAnyExercise = () => totalExercisesInPlan() > 0;

	const setDayLabelMode = (mode: RoutineDayLabelMode) => {
		uiMeta = normalizeRoutineUiMeta({
			...uiMeta,
			day_label_mode: mode
		});
	};

	const chooseDayLabelMode = (mode: RoutineDayLabelMode) => {
		setDayLabelMode(mode);
		showDayModeMenu = false;
	};

	const selectedSourceClient = () => otherClients.find((client) => client.id === selectedSource) ?? null;
	const selectedSourceLabel = () => selectedSourceClient()?.name ?? 'Elegí un alumno';
	const selectSourceClient = (clientId: string) => {
		selectedSource = clientId;
		showCopySourceMenu = false;
	};

	const updateCustomDayLabel = (dayKey: string, value: string) => {
		const nextLabel = sanitizeCustomLabel(value, '');
		plan = {
			...plan,
			[dayKey]: { ...plan[dayKey], label: nextLabel }
		};
	};

	$effect(() => {
		const visible = displayDays(null);
		if (!visible.some((day) => day.dayKey === selectedDay)) {
			selectedDay = visible[0]?.dayKey ?? WEEK_DAYS[0].key;
		}
	});

	onMount(() => {
		rememberLastClientRoute(data.client.id);

		const handleGlobalPointerDown = (event: PointerEvent) => {
			const target = event.target as Node | null;
			if (!target) return;
			if (showDayModeMenu && dayModeMenuEl && !dayModeMenuEl.contains(target)) {
				showDayModeMenu = false;
			}
			if (showCopySourceMenu && copySourceMenuEl && !copySourceMenuEl.contains(target)) {
				showCopySourceMenu = false;
			}
		};

		const handleGlobalKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				showDayModeMenu = false;
				showCopySourceMenu = false;
			}
		};

		document.addEventListener('pointerdown', handleGlobalPointerDown);
		document.addEventListener('keydown', handleGlobalKeyDown);

		return () => {
			document.removeEventListener('pointerdown', handleGlobalPointerDown);
			document.removeEventListener('keydown', handleGlobalKeyDown);
			clearDeleteUndoTimer();
			clearDeleteUndoTicker();
		};
	});

	const freshProgress = (): ProgressState =>
		WEEK_DAYS.reduce((acc, day) => {
			acc[day.key] = { completed: false, exercises: {} };
			return acc;
		}, {} as ProgressState);

	const MAX_EXERCISE_NAME_LENGTH = 100;
	const MAX_SPECIAL_REPS_LENGTH = 80;
	const MAX_BLOCK_LABEL_LENGTH = 40;
	type DeletedExerciseBatchItem = {
		dayKey: string;
		exercise: RoutineExercise;
		deletedIndex: number;
	};

	type ImportReviewSession = {
		jobId: string;
		snapshot: {
			plan: RoutinePlan;
			uiMeta: Required<RoutineUiMeta>;
			routineVersion: number;
		};
		draft: ImportDraft;
		issues: ImportIssue[];
		stats: ImportStats | null;
		issueIndex: ImportEditorIssueIndex;
	};

	type ExerciseFieldKey = 'name' | 'sets' | 'reps';
	type BlockFieldKey = 'rounds';
	type BlockValidationIssue =
		| { kind: 'exercise'; exerciseId: string; field: ExerciseFieldKey; message: string }
		| { kind: 'block'; field: BlockFieldKey; message: string };

	const getBlockScopeKey = (dayKey: string, blockKey: string) => `${dayKey}::${blockKey}`;
	const getExerciseFieldErrorKey = (dayKey: string, exerciseId: string, field: ExerciseFieldKey) =>
		`${dayKey}::${exerciseId}::${field}`;
	const getBlockFieldErrorKey = (dayKey: string, blockKey: string, field: BlockFieldKey) =>
		`${dayKey}::${blockKey}::${field}`;

	const setBlockInlineWarning = (dayKey: string, blockKey: string, message: string) => {
		blockInlineWarnings = {
			...blockInlineWarnings,
			[getBlockScopeKey(dayKey, blockKey)]: message
		};
	};

	const clearBlockInlineWarning = (dayKey: string, blockKey: string) => {
		const key = getBlockScopeKey(dayKey, blockKey);
		if (!(key in blockInlineWarnings)) return;
		const next = { ...blockInlineWarnings };
		delete next[key];
		blockInlineWarnings = next;
	};

	const setDayInlineWarning = (dayKey: string, message: string) => {
		dayInlineWarnings = { ...dayInlineWarnings, [dayKey]: message };
	};

	const clearDayInlineWarning = (dayKey: string) => {
		if (!(dayKey in dayInlineWarnings)) return;
		const next = { ...dayInlineWarnings };
		delete next[dayKey];
		dayInlineWarnings = next;
	};

	let exerciseInlineErrors = $state<Record<string, string>>({});
	let blockFieldInlineErrors = $state<Record<string, string>>({});

	const setExerciseInlineError = (
		dayKey: string,
		exerciseId: string,
		field: ExerciseFieldKey,
		message: string
	) => {
		exerciseInlineErrors = {
			...exerciseInlineErrors,
			[getExerciseFieldErrorKey(dayKey, exerciseId, field)]: message
		};
	};

	const setBlockFieldInlineError = (
		dayKey: string,
		blockKey: string,
		field: BlockFieldKey,
		message: string
	) => {
		blockFieldInlineErrors = {
			...blockFieldInlineErrors,
			[getBlockFieldErrorKey(dayKey, blockKey, field)]: message
		};
	};

	const clearInlineErrorsForBlock = (
		dayKey: string,
		blockKey: string,
		exercises: RoutineExercise[]
	) => {
		const blockExerciseIds = exercises
			.filter((exercise) => getExerciseBlockKey(exercise) === blockKey)
			.map((exercise) => exercise.id);

		if (blockExerciseIds.length > 0) {
			const nextExerciseErrors = { ...exerciseInlineErrors };
			for (const exerciseId of blockExerciseIds) {
				delete nextExerciseErrors[getExerciseFieldErrorKey(dayKey, exerciseId, 'name')];
				delete nextExerciseErrors[getExerciseFieldErrorKey(dayKey, exerciseId, 'sets')];
				delete nextExerciseErrors[getExerciseFieldErrorKey(dayKey, exerciseId, 'reps')];
			}
			exerciseInlineErrors = nextExerciseErrors;
		}

		const blockFieldKey = getBlockFieldErrorKey(dayKey, blockKey, 'rounds');
		if (blockFieldKey in blockFieldInlineErrors) {
			const nextBlockFieldErrors = { ...blockFieldInlineErrors };
			delete nextBlockFieldErrors[blockFieldKey];
			blockFieldInlineErrors = nextBlockFieldErrors;
		}
	};

	const getExerciseInlineError = (
		dayKey: string,
		exerciseId: string,
		field: ExerciseFieldKey
	): string | null => exerciseInlineErrors[getExerciseFieldErrorKey(dayKey, exerciseId, field)] ?? null;

	const getBlockFieldInlineError = (
		dayKey: string,
		blockKey: string,
		field: BlockFieldKey
	): string | null => blockFieldInlineErrors[getBlockFieldErrorKey(dayKey, blockKey, field)] ?? null;

	let deletedExercisesBatch = $state<DeletedExerciseBatchItem[]>([]);
	let showDeleteUndoSnackbar = $state(false);
	let deletedBatchSnapshotsByDay: Record<string, RoutineExercise[]> = {};
	let deleteUndoTimer: ReturnType<typeof setTimeout> | null = null;
	let deleteUndoTicker: ReturnType<typeof setInterval> | null = null;
	let deleteUndoDeadlineTs = 0;
	let deleteUndoSecondsLeft = $state(0);

	const getExerciseRepsMode = (exercise: RoutineExercise) => getRoutineExerciseRepsMode(exercise);
	const getExerciseBlockType = (exercise: RoutineExercise): RoutineBlockType =>
		getRoutineExerciseBlockType(exercise);
	const getExerciseBlockId = (exercise: RoutineExercise) => getRoutineExerciseBlockId(exercise);
	const getExerciseBlockKey = (exercise: RoutineExercise) =>
		`${getExerciseBlockType(exercise)}:${getExerciseBlockId(exercise)}`;
	const getBlockModeDraftKey = (
		dayKey: string,
		blockId: string,
		mode: RoutineBlockType
	) => `${dayKey}::${blockId}::${mode}`;

	const cloneExercises = (exercises: RoutineExercise[]) =>
		exercises.map((exercise) => ({ ...exercise }));

	const setBlockModeDraft = (
		dayKey: string,
		blockId: string,
		mode: RoutineBlockType,
		exercises: RoutineExercise[]
	) => {
		blockModeDrafts = {
			...blockModeDrafts,
			[getBlockModeDraftKey(dayKey, blockId, mode)]: cloneExercises(exercises)
		};
	};

	const getBlockModeDraft = (
		dayKey: string,
		blockId: string,
		mode: RoutineBlockType
	): RoutineExercise[] | null => {
		const cached = blockModeDrafts[getBlockModeDraftKey(dayKey, blockId, mode)];
		if (!cached || cached.length === 0) return null;
		return cloneExercises(cached);
	};

	const clearBlockModeDraftsForAnchor = (dayKey: string, blockId: string) => {
		const normalKey = getBlockModeDraftKey(dayKey, blockId, 'normal');
		const circuitKey = getBlockModeDraftKey(dayKey, blockId, 'circuit');
		if (!(normalKey in blockModeDrafts) && !(circuitKey in blockModeDrafts)) return;
		const next = { ...blockModeDrafts };
		delete next[normalKey];
		delete next[circuitKey];
		blockModeDrafts = next;
	};

	const createEmptyExerciseForMode = (
		dayKey: string,
		blockId: string,
		mode: RoutineBlockType,
		blockOrder = 0
	): RoutineExercise => ({
		id: crypto.randomUUID(),
		name: '',
		scheme: '',
		order: 0,
		totalSets: undefined,
		repsMin: undefined,
		repsMax: null,
		repsMode: 'number',
		repsSpecial: null,
		showRange: false,
		blockType: mode,
		blockId: blockId || `block-${dayKey}-${crypto.randomUUID()}`,
		blockLabel: '',
		blockOrder,
		circuitRounds: mode === 'circuit' ? 3 : null,
		note: ''
	});

	const sanitizeBlockLabelLocal = (value: string | null | undefined, fallback: string) => {
		const cleaned = (value ?? '')
			.replace(/[\u0000-\u001F\u007F]/g, '')
			.trim()
			.replace(/\s+/g, ' ')
			.slice(0, MAX_BLOCK_LABEL_LENGTH);
		return cleaned || fallback;
	};

	const normalizeDayExercisesForUi = (dayKey: string, exercises: RoutineExercise[]): RoutineExercise[] => {
		const blockOrderByKey = new Map<string, number>();
		return exercises.map((exercise, index) => {
			const blockType = getExerciseBlockType(exercise);
			const baseBlockId = (exercise.blockId ?? '').trim() || `block-${dayKey}-${exercise.id}`;
			const blockKey = `${blockType}:${baseBlockId}`;
			const blockOrder = blockOrderByKey.has(blockKey)
				? (blockOrderByKey.get(blockKey) ?? 0)
				: blockOrderByKey.size;
			if (!blockOrderByKey.has(blockKey)) {
				blockOrderByKey.set(blockKey, blockOrder);
			}
			const blockLabel = sanitizeBlockLabelLocal(exercise.blockLabel, `Bloque ${blockOrder + 1}`);
			const circuitRounds =
				blockType === 'circuit'
					? Math.max(
							1,
							Math.min(
								99,
								Math.floor(
									Number(
										typeof exercise.circuitRounds === 'number' && Number.isFinite(exercise.circuitRounds)
											? exercise.circuitRounds
											: exercise.totalSets ?? 3
									) || 3
								)
							)
						)
					: null;
			return {
				...exercise,
				order: index,
				blockType,
				blockId: baseBlockId,
				blockOrder,
				blockLabel,
				circuitRounds
			};
		});
	};

	const getExerciseSpecialReps = (exercise: RoutineExercise) =>
		(exercise.repsSpecial ?? '').trim().slice(0, MAX_SPECIAL_REPS_LENGTH);

	const getExercisePreview = (exercise: RoutineExercise) => formatPrescriptionLong(exercise);

	const clearEditorValidationState = () => {
		feedback = '';
		showValidationErrors = false;
		blockInlineWarnings = {};
		dayInlineWarnings = {};
		exerciseInlineErrors = {};
		blockFieldInlineErrors = {};
	};

	const startImportReviewSession = (payload: {
		jobId: string;
		plan: RoutinePlan;
		uiMeta: RoutineUiMeta;
		draft: ImportDraft;
		issues: ImportIssue[];
		stats: ImportStats | null;
	}) => {
		const plainPlan = JSON.parse(JSON.stringify(payload.plan)) as RoutinePlan;
		const plainDraft = JSON.parse(JSON.stringify(payload.draft)) as ImportDraft;
		const plainIssues = JSON.parse(JSON.stringify(payload.issues)) as ImportIssue[];
		const plainStats = payload.stats
			? (JSON.parse(JSON.stringify(payload.stats)) as ImportStats)
			: null;
		const currentPlanSnapshot = normalizePlan(JSON.parse(JSON.stringify(plan)) as RoutinePlan);
		const currentUiMetaSnapshot = normalizeRoutineUiMeta(
			JSON.parse(JSON.stringify(uiMeta)) as RoutineUiMeta
		);
		const nextPlan = normalizePlan(plainPlan);
		const nextUiMeta = normalizeRoutineUiMeta(payload.uiMeta ?? null);
		const nextIssueIndex = indexImportIssuesForEditor(plainDraft, nextPlan, plainIssues);
		importReviewSession = {
			jobId: payload.jobId,
			snapshot: {
				plan: currentPlanSnapshot,
				uiMeta: currentUiMetaSnapshot,
				routineVersion
			},
			draft: plainDraft,
			issues: plainIssues,
			stats: plainStats,
			issueIndex: nextIssueIndex
		};
		plan = nextPlan;
		uiMeta = buildImportedRoutineUiMeta(payload.draft, nextUiMeta);
		blockModeDrafts = {};
		resetDeleteUndoBatch();
		clearEditorValidationState();
		showImportPanel = false;
		const firstDayWithExercises = WEEK_DAYS.find((day) => (plan[day.key]?.exercises?.length ?? 0) > 0)?.key;
		if (firstDayWithExercises) {
			selectedDay = firstDayWithExercises;
		}
		statusMessage = 'Importación cargada en el editor. Revisá los puntos marcados antes de publicar.';
		setTimeout(() => {
			statusMessage = '';
		}, 3500);
	};

	const discardImportReviewSession = () => {
		if (!importReviewSession) return;
		const snapshot = importReviewSession.snapshot;
		if (!snapshot) {
			importReviewSession = null;
			statusMessage = 'No pudimos descartar la importación. Reintentá.';
			setTimeout(() => {
				statusMessage = '';
			}, 3000);
			return;
		}
		const safeClone = <T,>(value: T) => {
			try {
				return structuredClone(value);
			} catch {
				return JSON.parse(JSON.stringify(value)) as T;
			}
		};
		plan = normalizePlan(safeClone(snapshot.plan));
		uiMeta = normalizeRoutineUiMeta(safeClone(snapshot.uiMeta));
		routineVersion = snapshot.routineVersion;
		importReviewSession = null;
		blockModeDrafts = {};
		resetDeleteUndoBatch();
		clearEditorValidationState();
		statusMessage = 'Se descartó la importación y se restauró el estado anterior.';
		setTimeout(() => {
			statusMessage = '';
		}, 3000);
	};

	const openDiscardImportConfirm = () => {
		discardImportPending = false;
		showDiscardImportConfirm = true;
	};

	const confirmDiscardImport = async () => {
		if (discardImportPending) return;
		discardImportPending = true;
		statusMessage = 'Descartando importación...';
		await tick();
		try {
			discardImportReviewSession();
			showDiscardImportConfirm = false;
		} catch (error) {
			console.error(error);
			statusMessage = 'No pudimos descartar la importación. Reintentá.';
			setTimeout(() => {
				statusMessage = '';
			}, 3000);
		} finally {
			discardImportPending = false;
		}
	};

	const isImportFieldResolved = (
		exercise: RoutineExercise | undefined,
		field: ImportEditorFieldKey
	) => {
		if (!exercise) return false;
		if (field === 'name') {
			return Boolean(exercise.name?.trim()) && exercise.name.length <= MAX_EXERCISE_NAME_LENGTH;
		}
		if (field === 'sets') {
			return getTargetSets(exercise) > 0;
		}
		if (getExerciseRepsMode(exercise) === 'special') {
			return field !== 'reps' || Boolean(getExerciseSpecialReps(exercise));
		}
		if (field === 'reps') {
			if (!exercise.repsMin || exercise.repsMin <= 0) return false;
			if (
				exercise.showRange &&
				(exercise.repsMax ?? 0) > 0 &&
				(exercise.repsMax ?? 0) < (exercise.repsMin ?? 0)
			) {
				return false;
			}
		}
		return true;
	};

	const isImportBlockFieldResolved = (
		field: 'rounds',
		rounds: number | null
	) => {
		if (field === 'rounds') return Boolean(rounds && rounds > 0);
		return true;
	};

	const getImportedExerciseIssue = (
		dayKey: string,
		exercise: RoutineExercise,
		field: ImportEditorFieldKey
	): ImportIssue | null => {
		if (!importReviewSession) return null;
		const issues = importReviewSession.issueIndex.fieldIssues[`${dayKey}::${exercise.id}::${field}`] ?? [];
		if (issues.length === 0) return null;
		return isImportFieldResolved(exercise, field) ? null : issues[0];
	};

	const getImportedBlockFieldIssue = (
		dayKey: string,
		blockKey: string,
		field: 'rounds',
		rounds: number | null
	): ImportIssue | null => {
		if (!importReviewSession) return null;
		const issues =
			importReviewSession.issueIndex.blockFieldIssues[`${dayKey}::${blockKey}::${field}`] ?? [];
		if (issues.length === 0) return null;
		return isImportBlockFieldResolved(field, rounds) ? null : issues[0];
	};

	const getImportedBlockIssues = (dayKey: string, blockKey: string) =>
		importReviewSession?.issueIndex.blockIssues[`${dayKey}::${blockKey}`] ?? [];

	const getImportedBlockIssue = (dayKey: string, blockKey: string): ImportIssue | null =>
		getImportedBlockIssues(dayKey, blockKey)[0] ?? null;

	const getImportedDayIssues = (dayKey: string) =>
		importReviewSession?.issueIndex.dayIssues[dayKey] ?? [];

	const getImportedGlobalIssues = () => importReviewSession?.issueIndex.globalIssues ?? [];

	const getImportedDayIssueCount = (dayKey: string) => {
		if (!importReviewSession) return 0;
		let total = getImportedDayIssues(dayKey).length;
		for (const exercise of plan[dayKey]?.exercises ?? []) {
			if (getImportedExerciseIssue(dayKey, exercise, 'name')) total += 1;
			if (getImportedExerciseIssue(dayKey, exercise, 'sets')) total += 1;
			if (getImportedExerciseIssue(dayKey, exercise, 'reps')) total += 1;
		}
		for (const block of getEditorBlocks(dayKey)) {
			if (getImportedBlockFieldIssue(dayKey, block.key, 'rounds', block.rounds)) total += 1;
			total += getImportedBlockIssues(dayKey, block.key).length;
		}
		return total;
	};

	const getImportReviewCount = () => {
		if (!importReviewSession) return 0;
		return (
			getImportedGlobalIssues().length +
			WEEK_DAYS.reduce((total, day) => total + getImportedDayIssueCount(day.key), 0)
		);
	};

	const getEditorBlocks = (dayKey: string) =>
		buildRoutineEditorBlocks(dayKey, plan[dayKey]?.exercises ?? []);

	const getCircuitBlockNote = (block: RoutineEditorBlock) => {
		if (block.type !== 'circuit') return '';
		const firstWithNote = block.exercises.find((exercise) => (exercise.note ?? '').trim().length > 0);
		return firstWithNote?.note ?? '';
	};

	const updateCircuitBlockNote = (dayKey: string, blockKey: string, value: string) => {
		const exercises = plan[dayKey].exercises.map((exercise) =>
			getExerciseBlockKey(exercise) === blockKey ? { ...exercise, note: value } : exercise
		);
		plan = {
			...plan,
			[dayKey]: {
				...plan[dayKey],
				exercises: normalizeDayExercisesForUi(dayKey, exercises)
			}
		};
	};

	const getExerciseRepsInputValue = (exercise: RoutineExercise) => {
		if (getExerciseRepsMode(exercise) === 'special') {
			return exercise.repsSpecial ?? '';
		}
		const repsMin = exercise.repsMin ?? 0;
		if (exercise.showRange && (exercise.repsMax ?? 0) > 0) {
			return `${Math.max(0, repsMin)}-${Math.max(0, exercise.repsMax ?? 0)}`;
		}
		return repsMin > 0 ? String(repsMin) : '';
	};

	const clearDeleteUndoTimer = () => {
		if (deleteUndoTimer) {
			clearTimeout(deleteUndoTimer);
			deleteUndoTimer = null;
		}
	};

	const clearDeleteUndoTicker = () => {
		if (deleteUndoTicker) {
			clearInterval(deleteUndoTicker);
			deleteUndoTicker = null;
		}
	};

	const updateDeleteUndoSecondsLeft = () => {
		if (!deleteUndoDeadlineTs) {
			deleteUndoSecondsLeft = 0;
			return;
		}
		const msLeft = Math.max(0, deleteUndoDeadlineTs - Date.now());
		deleteUndoSecondsLeft = Math.ceil(msLeft / 1000);
	};

	const resetDeleteUndoBatch = () => {
		clearDeleteUndoTimer();
		clearDeleteUndoTicker();
		deleteUndoDeadlineTs = 0;
		deleteUndoSecondsLeft = 0;
		deletedExercisesBatch = [];
		deletedBatchSnapshotsByDay = {};
		showDeleteUndoSnackbar = false;
	};

	const scheduleDeleteUndoBatchReset = () => {
		clearDeleteUndoTimer();
		clearDeleteUndoTicker();
		deleteUndoDeadlineTs = Date.now() + UNDO_DELETE_TIMEOUT_MS;
		updateDeleteUndoSecondsLeft();
		deleteUndoTicker = setInterval(updateDeleteUndoSecondsLeft, 200);
		deleteUndoTimer = setTimeout(() => {
			resetDeleteUndoBatch();
		}, UNDO_DELETE_TIMEOUT_MS);
	};

	const undoDeletedExercises = () => {
		if (deletedExercisesBatch.length === 0) return;

		const deletedByDay = new Map<string, Map<string, DeletedExerciseBatchItem>>();
		for (const item of deletedExercisesBatch) {
			if (!deletedByDay.has(item.dayKey)) {
				deletedByDay.set(item.dayKey, new Map());
			}
			deletedByDay.get(item.dayKey)?.set(item.exercise.id, {
				...item,
				exercise: { ...item.exercise }
			});
		}

		const nextPlan: RoutinePlan = { ...plan };
		for (const [dayKey, snapshot] of Object.entries(deletedBatchSnapshotsByDay)) {
			const currentExercises = nextPlan[dayKey]?.exercises ?? [];
			const currentById = new Map(currentExercises.map((exercise) => [exercise.id, exercise]));
			const deletedExercisesMap = deletedByDay.get(dayKey) ?? new Map<string, DeletedExerciseBatchItem>();
			const restored: RoutineExercise[] = [];
			const usedIds = new Set<string>();

			for (const baseExercise of snapshot) {
				const currentExercise = currentById.get(baseExercise.id);
				if (currentExercise) {
					restored.push(currentExercise);
					usedIds.add(baseExercise.id);
					continue;
				}
				const deletedExerciseItem = deletedExercisesMap.get(baseExercise.id);
				if (deletedExerciseItem) {
					restored.push({ ...deletedExerciseItem.exercise });
					usedIds.add(baseExercise.id);
				}
			}

			for (const currentExercise of currentExercises) {
				if (!usedIds.has(currentExercise.id)) {
					restored.push(currentExercise);
					usedIds.add(currentExercise.id);
				}
			}

			const remainingDeletedItems = [...deletedExercisesMap.values()]
				.filter((item) => !usedIds.has(item.exercise.id))
				.sort((a, b) => a.deletedIndex - b.deletedIndex);
			for (const item of remainingDeletedItems) {
				if (!usedIds.has(item.exercise.id)) {
					restored.push({ ...item.exercise });
					usedIds.add(item.exercise.id);
				}
			}

			nextPlan[dayKey] = {
				...nextPlan[dayKey],
				exercises: normalizeDayExercisesForUi(
					dayKey,
					restored.map((exercise, index) => ({ ...exercise, order: index }))
				)
			};
		}

		plan = nextPlan;
		resetDeleteUndoBatch();
	};

	const collectBlockValidationIssues = (
		exercises: RoutineExercise[],
		blockKey: string
	): BlockValidationIssue[] => {
		const targetExercises = exercises.filter(
			(exercise) => getExerciseBlockKey(exercise) === blockKey
		);
		const issues: BlockValidationIssue[] = [];
		let hasCircuitRoundsIssue = false;
		for (const exercise of targetExercises) {
			if (!exercise.name || exercise.name.trim() === '') {
				issues.push({
					kind: 'exercise',
					exerciseId: exercise.id,
					field: 'name',
					message: 'El nombre es obligatorio.'
				});
			} else if (exercise.name.length > MAX_EXERCISE_NAME_LENGTH) {
				issues.push({
					kind: 'exercise',
					exerciseId: exercise.id,
					field: 'name',
					message: `Máximo ${MAX_EXERCISE_NAME_LENGTH} caracteres.`
				});
			}

			const sets = getTargetSets(exercise);
			if (sets <= 0) {
				if (getExerciseBlockType(exercise) === 'circuit') {
					if (!hasCircuitRoundsIssue) {
						issues.push({
							kind: 'block',
							field: 'rounds',
							message: 'Las vueltas son obligatorias.'
						});
						hasCircuitRoundsIssue = true;
					}
				} else {
					issues.push({
						kind: 'exercise',
						exerciseId: exercise.id,
						field: 'sets',
						message: 'Las series son obligatorias.'
					});
				}
			}

			if (getExerciseRepsMode(exercise) === 'special') {
				if (!getExerciseSpecialReps(exercise)) {
					issues.push({
						kind: 'exercise',
						exerciseId: exercise.id,
						field: 'reps',
						message: 'Completá repeticiones especiales.'
					});
				}
			} else {
				if (!exercise.repsMin || exercise.repsMin <= 0) {
					issues.push({
						kind: 'exercise',
						exerciseId: exercise.id,
						field: 'reps',
						message: 'Las repeticiones son obligatorias.'
					});
				} else if (
					exercise.showRange &&
					(exercise.repsMax ?? 0) > 0 &&
					(exercise.repsMax ?? 0) < (exercise.repsMin ?? 0)
				) {
					issues.push({
						kind: 'exercise',
						exerciseId: exercise.id,
						field: 'reps',
						message: 'El rango de repeticiones no es válido.'
					});
				}
			}
		}
		return issues;
	};

	const applyBlockInlineValidation = (
		dayKey: string,
		blockKey: string,
		exercises: RoutineExercise[]
	): string | null => {
		clearInlineErrorsForBlock(dayKey, blockKey, exercises);
		const issues = collectBlockValidationIssues(exercises, blockKey);
		if (issues.length === 0) {
			clearBlockInlineWarning(dayKey, blockKey);
			return null;
		}
		for (const issue of issues) {
			if (issue.kind === 'block') {
				setBlockFieldInlineError(dayKey, blockKey, issue.field, issue.message);
			} else {
				setExerciseInlineError(dayKey, issue.exerciseId, issue.field, issue.message);
			}
		}
		setBlockInlineWarning(dayKey, blockKey, issues[0]?.message ?? 'Completá los datos obligatorios.');
		return issues[0]?.message ?? null;
	};

	const hasInlineStateForBlock = (
		dayKey: string,
		blockKey: string,
		exercises: RoutineExercise[]
	) => {
		if (getBlockScopeKey(dayKey, blockKey) in blockInlineWarnings) return true;
		if (getBlockFieldErrorKey(dayKey, blockKey, 'rounds') in blockFieldInlineErrors) return true;
		const blockExercises = exercises.filter((exercise) => getExerciseBlockKey(exercise) === blockKey);
		for (const exercise of blockExercises) {
			if (getExerciseFieldErrorKey(dayKey, exercise.id, 'name') in exerciseInlineErrors) return true;
			if (getExerciseFieldErrorKey(dayKey, exercise.id, 'sets') in exerciseInlineErrors) return true;
			if (getExerciseFieldErrorKey(dayKey, exercise.id, 'reps') in exerciseInlineErrors) return true;
		}
		return false;
	};

	const getExerciseFieldUiError = (
		dayKey: string,
		exercise: RoutineExercise,
		field: ExerciseFieldKey
	): string | null => {
		const local = getExerciseInlineError(dayKey, exercise.id, field);
		if (local) return local;
		if (!showValidationErrors) return null;

		if (field === 'name') {
			if (!exercise.name || exercise.name.trim() === '') return 'El nombre es obligatorio.';
			if (exercise.name.length > MAX_EXERCISE_NAME_LENGTH) {
				return `Máximo ${MAX_EXERCISE_NAME_LENGTH} caracteres.`;
			}
			return null;
		}

		if (field === 'sets') {
			if (getTargetSets(exercise) <= 0) {
				return getExerciseBlockType(exercise) === 'circuit'
					? 'Las vueltas son obligatorias.'
					: 'Las series son obligatorias.';
			}
			return null;
		}

		if (getExerciseRepsMode(exercise) === 'special') {
			return getExerciseSpecialReps(exercise) ? null : 'Completá repeticiones especiales.';
		}
		if (!exercise.repsMin || exercise.repsMin <= 0) return 'Las repeticiones son obligatorias.';
		if (
			exercise.showRange &&
			(exercise.repsMax ?? 0) > 0 &&
			(exercise.repsMax ?? 0) < (exercise.repsMin ?? 0)
		) {
			return 'El rango de repeticiones no es válido.';
		}
		return null;
	};

	const getBlockRoundsUiError = (dayKey: string, blockKey: string, rounds: number | null): string | null => {
		const local = getBlockFieldInlineError(dayKey, blockKey, 'rounds');
		if (local) return local;
		if (!showValidationErrors) return null;
		if (!rounds || rounds <= 0) return 'Las vueltas son obligatorias.';
		return null;
	};

	const addExercise = (dayKey: string) => {
		const exercises = plan[dayKey].exercises;

		if (exercises.length >= MAX_EXERCISES_PER_DAY) {
			setDayInlineWarning(dayKey, 'Límite de 50 ejercicios para este día.');
			return;
		}
		clearDayInlineWarning(dayKey);
		const newExercise: RoutineExercise = {
			id: crypto.randomUUID(),
			name: '',
			scheme: '',
			order: exercises.length,
			totalSets: undefined,
			repsMin: undefined,
			repsMax: null,
			repsMode: 'number',
			repsSpecial: null,
			showRange: false,
			blockType: 'normal',
			blockId: crypto.randomUUID(),
			blockLabel: '',
			blockOrder: 0,
			circuitRounds: null
		};
		const nextExercises = normalizeDayExercisesForUi(dayKey, [...exercises, newExercise]);
		plan = {
			...plan,
			[dayKey]: { ...plan[dayKey], exercises: nextExercises }
		};
	};

	const addExerciseToBlock = (dayKey: string, sourceExerciseId: string) => {
		const exercises = plan[dayKey].exercises;
		const sourceExercise = exercises.find((exercise) => exercise.id === sourceExerciseId);
		if (!sourceExercise) return;
		if (getExerciseBlockType(sourceExercise) !== 'circuit') return;

		const sourceBlockKey = getExerciseBlockKey(sourceExercise);
		const validationError = applyBlockInlineValidation(dayKey, sourceBlockKey, exercises);
		if (validationError) {
			return;
		}
		clearDayInlineWarning(dayKey);

		if (exercises.length >= MAX_EXERCISES_PER_DAY) {
			setDayInlineWarning(dayKey, 'Límite de 50 ejercicios para este día.');
			return;
		}

		const sourceBlockId = getExerciseBlockId(sourceExercise);
		const sourceBlockLabel = sanitizeBlockLabelLocal(
			sourceExercise.blockLabel,
			`Bloque ${(sourceExercise.blockOrder ?? 0) + 1}`
		);
		const sourceRounds = Math.max(
			1,
			Math.min(
				99,
				Math.floor(
					Number(
						typeof sourceExercise.circuitRounds === 'number' && Number.isFinite(sourceExercise.circuitRounds)
							? sourceExercise.circuitRounds
							: getTargetSets(sourceExercise) || 3
					) || 3
				)
			)
		);

		let insertIndex = exercises.length;
		for (let index = 0; index < exercises.length; index += 1) {
			const candidate = exercises[index];
			if (getExerciseBlockType(candidate) !== 'circuit') continue;
			if (getExerciseBlockId(candidate) === sourceBlockId) {
				insertIndex = index + 1;
			}
		}

		const newExercise: RoutineExercise = {
			id: crypto.randomUUID(),
			name: '',
			scheme: '',
			order: insertIndex,
			totalSets: undefined,
			repsMin: undefined,
			repsMax: null,
			repsMode: 'number',
			repsSpecial: null,
			showRange: false,
			blockType: 'circuit',
			blockId: sourceBlockId,
			blockLabel: sourceBlockLabel,
			blockOrder: sourceExercise.blockOrder ?? 0,
			circuitRounds: sourceRounds,
			note: sourceExercise.note ?? ''
		};

		const nextExercises = normalizeDayExercisesForUi(dayKey, [
			...exercises.slice(0, insertIndex),
			newExercise,
			...exercises.slice(insertIndex)
		]);
		plan = {
			...plan,
			[dayKey]: { ...plan[dayKey], exercises: nextExercises }
		};
	};

	const updateExercise = (dayKey: string, id: string, field: keyof RoutineExercise, value: string | number | boolean | null) => {
		const currentExercises = plan[dayKey].exercises;
		const targetExercise = currentExercises.find((exercise) => exercise.id === id);
		let exercises: RoutineExercise[];

		if (
			field === 'circuitRounds' &&
			targetExercise &&
			getExerciseBlockType(targetExercise) === 'circuit'
		) {
			const rounds = Math.max(
				1,
				Math.min(99, Math.floor(Number(value) || 0))
			);
			const targetBlockId = getExerciseBlockId(targetExercise);
			exercises = currentExercises.map((exercise) =>
				getExerciseBlockType(exercise) === 'circuit' && getExerciseBlockId(exercise) === targetBlockId
					? { ...exercise, circuitRounds: rounds }
					: exercise
			);
		} else {
			exercises = currentExercises.map((ex) => (ex.id === id ? { ...ex, [field]: value } : ex));
		}

		plan = {
			...plan,
			[dayKey]: {
				...plan[dayKey],
				exercises: normalizeDayExercisesForUi(dayKey, exercises)
			}
		};

		const updatedExercise = plan[dayKey].exercises.find((exercise) => exercise.id === id);
		if (updatedExercise) {
			const updatedBlockKey = getExerciseBlockKey(updatedExercise);
			if (hasInlineStateForBlock(dayKey, updatedBlockKey, plan[dayKey].exercises)) {
				applyBlockInlineValidation(dayKey, updatedBlockKey, plan[dayKey].exercises);
			}
		}
		
		// Limpiar advertencia si el usuario corrigió el error
		if (
			showValidationErrors &&
			feedbackType === 'warning' &&
				(field === 'name' ||
					field === 'totalSets' ||
					field === 'circuitRounds' ||
					field === 'repsMode' ||
				field === 'repsMin' ||
				field === 'repsMax' ||
				field === 'repsSpecial')
		) {
			const updatedExercises = plan[dayKey].exercises;
			const hasErrors = updatedExercises.some(ex => 
				!ex.name ||
				ex.name.trim() === '' ||
				getTargetSets(ex) <= 0 ||
				(getExerciseRepsMode(ex) === 'number'
					? !ex.repsMin || ex.repsMin <= 0
					: !getExerciseSpecialReps(ex))
			);
			if (!hasErrors) {
				feedback = '';
				showValidationErrors = false;
			}
		}
	};

	const updateExerciseBlockType = (dayKey: string, id: string, blockType: RoutineBlockType) => {
		const currentExercises = plan[dayKey].exercises;
		const sourceExercise = currentExercises.find((exercise) => exercise.id === id);
		if (!sourceExercise) return;
		const sourceMode = getExerciseBlockType(sourceExercise);
		if (sourceMode === blockType) return;

		const blockId = getExerciseBlockId(sourceExercise);
		const sourceBlockKey = `${sourceMode}:${blockId}`;
		const targetBlockKey = `${blockType}:${blockId}`;
		const sourceBlockExercises = currentExercises.filter(
			(exercise) => getExerciseBlockType(exercise) === sourceMode && getExerciseBlockId(exercise) === blockId
		);
		if (sourceBlockExercises.length === 0) return;

		setBlockModeDraft(dayKey, blockId, sourceMode, sourceBlockExercises);
		const targetBlockExercisesInPlan = currentExercises.filter(
			(exercise) => getExerciseBlockType(exercise) === blockType && getExerciseBlockId(exercise) === blockId
		);
		if (targetBlockExercisesInPlan.length > 0) {
			setBlockModeDraft(dayKey, blockId, blockType, targetBlockExercisesInPlan);
		}

		const sourceFirstIndex = currentExercises.findIndex(
			(exercise) => getExerciseBlockType(exercise) === sourceMode && getExerciseBlockId(exercise) === blockId
		);
		const remainingExercises = currentExercises.filter(
			(exercise) =>
				!(
					(getExerciseBlockType(exercise) === sourceMode ||
						getExerciseBlockType(exercise) === blockType) &&
					getExerciseBlockId(exercise) === blockId
				)
		);
		const cachedTargetExercises = getBlockModeDraft(dayKey, blockId, blockType);
		const fallbackBlockOrder = sourceExercise.blockOrder ?? 0;
		const targetBlockExercises =
			cachedTargetExercises && cachedTargetExercises.length > 0
				? cachedTargetExercises
				: [createEmptyExerciseForMode(dayKey, blockId, blockType, fallbackBlockOrder)];
		const insertAt =
			sourceFirstIndex >= 0 ? Math.min(sourceFirstIndex, remainingExercises.length) : remainingExercises.length;

		const exercises = [
			...remainingExercises.slice(0, insertAt),
			...targetBlockExercises,
			...remainingExercises.slice(insertAt)
		];

		plan = {
			...plan,
			[dayKey]: {
				...plan[dayKey],
				exercises: normalizeDayExercisesForUi(dayKey, exercises)
			}
		};
		clearInlineErrorsForBlock(dayKey, sourceBlockKey, currentExercises);
		clearInlineErrorsForBlock(dayKey, targetBlockKey, currentExercises);
		clearBlockInlineWarning(dayKey, sourceBlockKey);
		clearBlockInlineWarning(dayKey, targetBlockKey);
	};

	const setExerciseRepsValue = (dayKey: string, exerciseId: string, rawValue: string) => {
		const parsed = parseRoutineRepsInput(rawValue);
		updateExercise(dayKey, exerciseId, 'repsMode', parsed.repsMode);
		updateExercise(dayKey, exerciseId, 'showRange', parsed.showRange);
		updateExercise(dayKey, exerciseId, 'repsMin', parsed.repsMin);
		updateExercise(dayKey, exerciseId, 'repsMax', parsed.repsMax);
		updateExercise(dayKey, exerciseId, 'repsSpecial', parsed.repsSpecial);
	};

	const removeExercise = (dayKey: string, id: string) => {
		const currentExercises = plan[dayKey].exercises;
		const deletedIndex = currentExercises.findIndex((ex) => ex.id === id);
		if (deletedIndex < 0) return;
		const deletedExerciseRef = currentExercises[deletedIndex];
		const deletedBlockKey = getExerciseBlockKey(deletedExerciseRef);
		const deletedBlockId = getExerciseBlockId(deletedExerciseRef);
		const hadInlineState = hasInlineStateForBlock(dayKey, deletedBlockKey, currentExercises);

		if (!deletedBatchSnapshotsByDay[dayKey]) {
			deletedBatchSnapshotsByDay = {
				...deletedBatchSnapshotsByDay,
				[dayKey]: currentExercises.map((exercise) => ({ ...exercise }))
			};
		}

		const deletedExercise = { ...currentExercises[deletedIndex] };
		const exercises = normalizeDayExercisesForUi(
			dayKey,
			currentExercises.filter((ex) => ex.id !== id)
		);
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises } };
		if (exercises.length < MAX_EXERCISES_PER_DAY) {
			clearDayInlineWarning(dayKey);
		}
		if (hadInlineState) {
			const blockStillExists = plan[dayKey].exercises.some(
				(exercise) => getExerciseBlockKey(exercise) === deletedBlockKey
			);
			if (blockStillExists) {
				applyBlockInlineValidation(dayKey, deletedBlockKey, plan[dayKey].exercises);
			} else {
				clearInlineErrorsForBlock(dayKey, deletedBlockKey, currentExercises);
				clearBlockInlineWarning(dayKey, deletedBlockKey);
				clearBlockModeDraftsForAnchor(dayKey, deletedBlockId);
			}
		}

		deletedExercisesBatch = [
			...deletedExercisesBatch,
			{
				dayKey,
				exercise: deletedExercise,
				deletedIndex
			}
		];
		showDeleteUndoSnackbar = true;
		scheduleDeleteUndoBatchReset();
	};

	const removeBlock = (dayKey: string, sourceExerciseId: string) => {
		const sourceExercise = (plan[dayKey]?.exercises ?? []).find(
			(exercise) => exercise.id === sourceExerciseId
		);
		if (!sourceExercise) return;
		const sourceBlockId = getExerciseBlockId(sourceExercise);
		const targetKey = getExerciseBlockKey(sourceExercise);
		const blockExerciseIds = (plan[dayKey]?.exercises ?? [])
			.filter((exercise) => getExerciseBlockKey(exercise) === targetKey)
			.map((exercise) => exercise.id);
		for (const exerciseId of blockExerciseIds.reverse()) {
			removeExercise(dayKey, exerciseId);
		}
		clearBlockModeDraftsForAnchor(dayKey, sourceBlockId);
	};

	const copyLink = async () => {
		await navigator.clipboard.writeText(link);
		copiedLink = true;
		setTimeout(() => (copiedLink = false), 2000);
	};

	const applyImportedRoutineUpdate = (payload: {
		jobId: string;
		plan: RoutinePlan;
		uiMeta: RoutineUiMeta;
		draft: ImportDraft;
		issues: ImportIssue[];
		stats: ImportStats | null;
	}) => {
		startImportReviewSession(payload);
	};

	const copyRoutine = async () => {
		if (!selectedSource) return;
		const formData = new FormData();
		formData.set('source_client_id', selectedSource);
		const res = await fetch('?/copyRoutine', { method: 'POST', body: formData });
		if (res.ok) {
			statusMessage = 'Rutina copiada correctamente';
			showCopyModal = false;
			showCopySourceMenu = false;
			setTimeout(() => (statusMessage = ''), 2500);
			location.reload();
		} else {
			const msg = await res.text();
			statusMessage = msg || 'No pudimos copiar la rutina';
		}
	};

	const loadOtherClients = async () => {
		if (!lazyOtherClients || loadingOtherClients) return;

		loadingOtherClients = true;
		otherClientsError = null;
		try {
			const response = await fetch(`/clientes/${data.client.id}/other-clients`);
			if (!response.ok) {
				throw new Error('No se pudo cargar la lista de alumnos');
			}
			const payload = (await response.json()) as { otherClients?: OtherClientRow[] };
			otherClients = payload.otherClients ?? [];
			lazyOtherClients = false;
		} catch (e) {
			console.error(e);
			otherClientsError = 'No pudimos cargar la lista de alumnos. Intentá nuevamente.';
		} finally {
			loadingOtherClients = false;
		}
	};

	const openCopyModal = async () => {
		selectedSource = '';
		showCopySourceMenu = false;
		showCopyModal = true;
		if (lazyOtherClients) {
			await loadOtherClients();
		}
	};

	const validateRoutineBeforeSave = () => {
		feedback = '';
		showValidationErrors = true;

		for (const day of WEEK_DAYS) {
			const exercises = plan[day.key].exercises;
			if (exercises.length === 0) continue;
			const displayLabel = dayDisplayLabel(day.key);
			
			for (const ex of exercises) {
				if (!ex.name || ex.name.trim() === '') {
					feedback = `${displayLabel}: Hay ejercicios sin nombre. Completá el nombre antes de guardar.`;
					feedbackType = 'warning';
					return false;
				}
				if (ex.name.length > MAX_EXERCISE_NAME_LENGTH) {
					feedback = `${displayLabel}: El nombre "${ex.name.slice(0, 20)}..." es demasiado largo.`;
					feedbackType = 'warning';
					return false;
				}
					const sets = getTargetSets(ex);
					if (sets === 0) {
						feedback = `${displayLabel}: "${ex.name}" no tiene series o vueltas válidas.`;
						feedbackType = 'warning';
						return false;
				}
				if (getExerciseRepsMode(ex) === 'special') {
					if (!getExerciseSpecialReps(ex)) {
						feedback = `${displayLabel}: "${ex.name}" necesita una indicación en repeticiones especiales.`;
						feedbackType = 'warning';
						return false;
					}
				} else if (!ex.repsMin || ex.repsMin <= 0) {
					feedback = `${displayLabel}: "${ex.name}" no tiene repeticiones válidas.`;
					feedbackType = 'warning';
					return false;
				}
				if (
					getExerciseRepsMode(ex) === 'number' &&
					ex.showRange &&
					(ex.repsMax ?? 0) > 0 &&
					(ex.repsMax ?? 0) < (ex.repsMin ?? 0)
				) {
					return false;
				}
			}
		}
		return true;
	};

	const performSaveRoutine = async () => {
		saving = true;
		if (!validateRoutineBeforeSave()) {
			saving = false;
			return;
		}

		const formData = new FormData();
		formData.set('plan', JSON.stringify(plan));
		formData.set('ui_meta', JSON.stringify(uiMeta));
		const res = await fetch('?/saveRoutine', {
			method: 'POST',
			body: formData
		});
		if (res.ok) {
			const payload = await res.json().catch(() => null);
			const nextVersion = payload?.data?.routineVersion;
			if (typeof nextVersion === 'number') {
				routineVersion = nextVersion;
			}
			feedback = 'Rutina guardada';
			feedbackType = 'success';
			showValidationErrors = false;
			blockInlineWarnings = {};
			dayInlineWarnings = {};
			exerciseInlineErrors = {};
			blockFieldInlineErrors = {};
			importReviewSession = null;
		} else {
			feedback = 'No pudimos guardar la rutina';
			feedbackType = 'error';
		}
		saving = false;
	};

	const saveRoutine = async () => {
		if (!validateRoutineBeforeSave()) return;
		if (importReviewSession) {
			showImportPublishConfirm = true;
			return;
		}
		await performSaveRoutine();
	};

	const resetProgress = async () => {
		const formData = new FormData();
		formData.set('reset', 'true');
		const res = await fetch('?/resetProgress', { method: 'POST', body: formData });
		if (res.ok) {
			const data = await res.json();
			if (data?.data?.progress) {
				progress = data.data.progress as ProgressState;
			} else {
				progress = freshProgress();
			}
			feedback = 'Progreso reiniciado';
			feedbackType = 'success';
		} else {
			feedback = 'No se pudo reiniciar. Intentá de nuevo.';
			feedbackType = 'error';
		}
	};

	const setStatus = async (status: 'active' | 'archived') => {
		const formData = new FormData();
		formData.set('status', status);
		const res = await fetch('?/setStatus', { method: 'POST', body: formData });
		if (res.ok) {
			clientStatus = status;
			statusMessage = status === 'active' ? 'Alumno reactivado' : 'Alumno archivado (verá acceso desactivado)';
			setTimeout(() => (statusMessage = ''), 2500);
		}
	};

	const dayCompletion = (dayKey: string) => {
		const dayPlan = plan[dayKey];
		const state = progress[dayKey] ?? { completed: false, exercises: {} };
		const total = dayPlan.exercises.length;
		const done = dayPlan.exercises.filter((ex) => {
			const target = getTargetSets(ex);
			const doneSets = state.exercises?.[ex.id] ?? 0;
			return target > 0 && doneSets >= target;
		}).length;
		// Completado solo si hay ejercicios Y todos están completos
		const isCompleted = total > 0 && done === total;
		return { total, done, completed: isCompleted };
	};

	const getExerciseDetails = (dayKey: string) => {
		const dayPlan = plan[dayKey];
		const state = progress[dayKey] ?? { completed: false, exercises: {} };
		const progressExerciseIds = Object.keys(state.exercises ?? {});
		
		// Ejercicios actuales en la rutina
		const currentExercises = dayPlan.exercises.map((ex) => {
			const target = getTargetSets(ex);
			const done = state.exercises?.[ex.id] ?? 0;
			return {
				id: ex.id,
				name: ex.name || 'Sin nombre',
				done,
				target,
				complete: target > 0 && done >= target,
				exists: true
			};
		});
		
		// Ejercicios en progreso que ya no están en la rutina (fueron eliminados)
		const currentIds = new Set(dayPlan.exercises.map(ex => ex.id));
		const deletedExercises = progressExerciseIds
			.filter(id => !currentIds.has(id) && (state.exercises?.[id] ?? 0) > 0)
			.map(id => ({
				id,
				name: 'Ejercicio eliminado',
				done: state.exercises?.[id] ?? 0,
				target: state.exercises?.[id] ?? 0,
				complete: true,
				exists: false
			}));
		
		const allExercises = [...currentExercises, ...deletedExercises];
		const totalSeries = allExercises.reduce((sum, ex) => sum + ex.target, 0);
		const doneSeries = allExercises.reduce((sum, ex) => sum + Math.min(ex.done, ex.target), 0);
		const totalExercises = allExercises.length;
		const doneExercises = allExercises.filter((ex) => ex.complete).length;
		
		// Detectar si la rutina fue modificada después del progreso
		const hasInconsistency = deletedExercises.length > 0 || 
			currentExercises.some(ex => ex.done > ex.target);
		
		return { exercises: allExercises, totalSeries, doneSeries, totalExercises, doneExercises, hasInconsistency };
	};

	const toggleFeedbackDetail = (dayKey: string) => {
		feedbackExpanded = { ...feedbackExpanded, [dayKey]: !feedbackExpanded[dayKey] };
	};

	const hasDayFeedback = (dayKey: string) => Boolean(dayFeedback[dayKey]);

	const getDayFeedbackBadgeState = (dayKey: string): 'registered' | 'partial' | 'none' => {
		const row = dayFeedback[dayKey];
		if (!row) return 'none';
		const mainAnswered =
			(row.mood ? 1 : 0) + (typeof row.difficulty === 'number' ? 1 : 0) + (row.pain ? 1 : 0);
		if (mainAnswered === 3) return 'registered';
		return 'partial';
	};

	const getDayFeedbackBadgeLabel = (dayKey: string): string => {
		const state = getDayFeedbackBadgeState(dayKey);
		if (state === 'registered') return 'Registrado';
		if (state === 'partial') return 'Parcial';
		return 'No registrado';
	};

	const formatFeedbackMood = (value: DayFeedbackMood | null | undefined) =>
		value ? DAY_FEEDBACK_MOOD_LABEL[value] : '— (Sin respuesta)';

	const formatFeedbackPain = (value: DayFeedbackPain | null | undefined) =>
		value ? DAY_FEEDBACK_PAIN_LABEL[value] : '— (Sin respuesta)';

	const formatFeedbackDifficulty = (value: number | null | undefined) =>
		typeof value === 'number' ? `${value} / 10` : '— (Sin respuesta)';

	const formatFeedbackComment = (value: string | null | undefined) =>
		value && value.trim() ? value : '— (Sin comentario)';

	const feedbackMoodIcon = (value: DayFeedbackMood | null | undefined) => {
		if (value === 'excellent') return '🔵';
		if (value === 'good') return '🟢';
		if (value === 'normal') return '🟡';
		if (value === 'tired') return '🟠';
		if (value === 'very_fatigued') return '🔴';
		return '⚪';
	};

	const feedbackMoodBadgeTone = (value: DayFeedbackMood | null | undefined) => {
		if (value === 'excellent') return 'border-blue-500/40 bg-blue-900/30 text-blue-200';
		if (value === 'good') return 'border-emerald-500/40 bg-emerald-900/30 text-emerald-200';
		if (value === 'normal') return 'border-amber-500/40 bg-amber-900/30 text-amber-200';
		if (value === 'tired') return 'border-orange-500/40 bg-orange-900/30 text-orange-200';
		if (value === 'very_fatigued') return 'border-red-500/40 bg-red-900/30 text-red-200';
		return 'border-slate-600/60 bg-slate-800/40 text-slate-300';
	};

	const feedbackDifficultyTone = (value: number | null | undefined) => {
		if (typeof value !== 'number') return 'text-slate-500 text-xs font-medium';
		if (value <= 4) return 'text-emerald-300 text-lg font-extrabold';
		if (value <= 7) return 'text-amber-200 text-lg font-extrabold';
		return 'text-red-300 text-lg font-extrabold';
	};

	const toggleDayDetail = (dayKey: string) => {
		expandedDay = expandedDay === dayKey ? null : dayKey;
	};
</script>

<section class="text-slate-100">
		<div>
			<div class="mt-6 mb-12 flex justify-center md:hidden">
				<h1 class="text-center text-3xl font-extrabold tracking-wide text-slate-50">{data.client.name}</h1>
			</div>
				<div class="mt-0 flex w-full flex-col gap-4 md:mt-14">
				<div class="flex flex-col md:flex-row items-stretch md:items-center gap-3 justify-between">
				<button
					class="w-full md:w-1/2 rounded-2xl border border-emerald-700/40 bg-gradient-to-r from-emerald-700 to-teal-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:shadow-emerald-900/50 hover:brightness-110"
					type="button"
					onclick={copyLink}
				>
					{copiedLink ? '✓ Copiado' : 'Copiar link de la rutina'}
				</button>
					<button
						class="w-full md:w-1/2 rounded-2xl border border-cyan-700/40 bg-gradient-to-r from-cyan-700 to-sky-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:-translate-y-0.5 hover:shadow-cyan-900/50 hover:brightness-110"
						type="button"
						onclick={openCopyModal}
					>
						Copiar rutina de otro alumno
					</button>
			</div>
			<div class="flex flex-col md:flex-row items-stretch md:items-center gap-3 justify-between">
				{#if clientStatus === 'active'}
					<button
						class="w-full md:w-1/2 rounded-2xl border border-amber-500/60 bg-gradient-to-r from-amber-700 to-orange-600 px-5 py-3 text-base font-semibold text-amber-50 shadow-lg shadow-amber-900/30 transition hover:-translate-y-0.5 hover:shadow-amber-900/50 hover:brightness-110"
						type="button"
						onclick={() => (showArchiveConfirm = true)}
					>
						Desactivar alumno
					</button>
				{:else}
					<button
						class="w-full md:w-1/2 rounded-2xl border border-emerald-500/60 bg-gradient-to-r from-emerald-700 to-green-600 px-5 py-3 text-base font-semibold text-emerald-50 shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:shadow-emerald-900/50 hover:brightness-110"
						type="button"
						onclick={() => setStatus('active')}
					>
						Reactivar alumno
					</button>
				{/if}
				<button
					class="w-full md:w-1/2 rounded-2xl border border-red-700/70 bg-gradient-to-r from-red-800 to-rose-700 px-5 py-3 text-base font-semibold text-red-50 shadow-lg shadow-red-900/30 transition hover:-translate-y-0.5 hover:shadow-red-900/50 hover:brightness-110"
					type="button"
					onclick={() => {
						showDeleteConfirm = true;
						deleteConfirmText = '';
					}}
					>
						Eliminar alumno
					</button>
				</div>
				<div class="space-y-3">
					<div class="flex">
						<button
							type="button"
							data-testid="import-panel-toggle"
							class="w-full rounded-2xl border border-cyan-700/40 bg-gradient-to-r from-[#1a2747] to-[#173861] px-5 py-3 text-left text-base font-semibold text-cyan-50 shadow-lg shadow-cyan-900/30 transition hover:-translate-y-0.5 hover:shadow-cyan-900/50 hover:brightness-110"
							aria-expanded={showImportPanel}
							onclick={() => (showImportPanel = !showImportPanel)}
						>
							<span class="flex items-center justify-between gap-3">
								<span>Crea la rutina a partir de un archivo (PDF, Excel, CSV o texto)</span>
								<svg
									class={`h-4 w-4 flex-shrink-0 transition-transform ${showImportPanel ? 'rotate-180' : ''}`}
									fill="none"
									stroke="currentColor"
									viewBox="0 0 24 24"
								>
									<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
								</svg>
							</span>
						</button>
					</div>
					{#if showImportPanel}
						<RoutineImportPanel
							clientId={data.client.id}
							initialRoutineVersion={routineVersion}
							initialUiMeta={uiMeta}
							onImportReady={applyImportedRoutineUpdate}
						/>
					{/if}
				</div>
			</div>
		</div>

	{#if statusMessage}
		<p class="mt-6 rounded-lg border border-emerald-700/40 bg-[#151827] px-3 py-2 text-sm text-emerald-200">{statusMessage}</p>
	{/if}

			<section class="mt-16 md:mt-[5.5rem] grid gap-6 lg:grid-cols-[2fr,1fr]">
				<div class="order-3 min-w-0 lg:order-1 space-y-6 rounded-2xl border border-slate-800 bg-[#0f111b] p-4 md:p-6 shadow-lg shadow-black/30">
				{#if importReviewSession}
					<div class="rounded-2xl border border-cyan-700/45 bg-gradient-to-r from-cyan-950/45 to-[#14243a] px-4 py-3 text-slate-100">
						<div class="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
							<div class="space-y-1">
								<p class="text-sm font-semibold text-cyan-100">
									Rutina generada automáticamente. Revisá los puntos marcados antes de publicar.
								</p>
								<p class="text-xs text-slate-300">
									{getImportReviewCount() > 0
										? `${getImportReviewCount()} punto(s) para revisar en la rutina.`
										: 'No se detectaron problemas bloqueantes, pero conviene revisar antes de publicar.'}
								</p>
								{#if getImportedGlobalIssues().length > 0}
									<p class="text-xs text-amber-200">{getImportedGlobalIssues()[0]?.message}</p>
								{/if}
							</div>
							<div class="flex flex-wrap items-center gap-2">
								<button
									type="button"
									class="rounded-xl border border-amber-600/60 bg-amber-950/25 px-3 py-2 text-xs font-semibold text-amber-100 transition hover:bg-amber-900/35"
									onclick={openDiscardImportConfirm}
								>
									Descartar importación
								</button>
							</div>
						</div>
					</div>
				{/if}
				<div class="flex justify-center pt-5 pb-6 md:pt-6 md:pb-7">
					<h2 class="text-center text-4xl font-serif font-semibold uppercase tracking-[0.18em] text-slate-50">RUTINA</h2>
				</div>

			{#if feedback && feedbackType !== 'success'}
				<div class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-base border {feedbackType === 'warning' ? 'bg-amber-900/40 text-amber-200 border-amber-700/50' : 'bg-red-900/40 text-red-200 border-red-700/50'}">
					{#if feedbackType === 'warning'}
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					{:else}
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{/if}
					<span>{feedback}</span>
				</div>
			{/if}

					<div class="space-y-5 rounded-xl border border-slate-800 bg-[#0b0d14] p-4">
						<div class="flex items-center justify-between gap-3">
							<div class="relative" bind:this={dayModeMenuEl}>
								<button
									type="button"
									class="group inline-flex w-auto items-center justify-between gap-2 rounded-xl border border-slate-600/80 bg-gradient-to-b from-[#1a2235] to-[#121a2b] px-4 py-2.5 text-sm font-semibold text-slate-100 shadow-[0_8px_24px_rgba(2,6,23,0.35)] transition hover:border-cyan-500/50 hover:text-cyan-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/40"
									aria-haspopup="menu"
									aria-expanded={showDayModeMenu}
									onclick={() => (showDayModeMenu = !showDayModeMenu)}
								>
									<span>Modo de días</span>
									<svg
										class={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform group-hover:text-cyan-200 ${showDayModeMenu ? 'rotate-180' : ''}`}
										fill="none"
										stroke="currentColor"
										viewBox="0 0 24 24"
									>
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
									</svg>
								</button>
								{#if showDayModeMenu}
									<div
										role="menu"
										class="absolute left-0 z-30 mt-2 w-[22rem] max-w-[calc(100vw-4rem)] overflow-hidden rounded-xl border border-slate-700 bg-[#111827] shadow-xl shadow-black/45"
									>
										{#each DAY_MODE_OPTIONS as option}
											<button
												type="button"
												role="menuitemradio"
												aria-checked={uiMeta.day_label_mode === option.value}
												class={`flex w-full flex-col items-start gap-1 px-4 py-3 text-left transition ${
													uiMeta.day_label_mode === option.value
														? 'bg-slate-700/50 text-slate-50'
														: 'text-slate-200 hover:bg-[#1a2338]'
												}`}
												onclick={() => chooseDayLabelMode(option.value)}
											>
												<span class="text-sm font-semibold">{option.label}</span>
												<span class="text-xs text-slate-400">{option.description}</span>
											</button>
										{/each}
									</div>
								{/if}
							</div>
							{#if hasAnyExercise()}
								<button
									class="save-cta shrink-0 rounded-lg bg-[#1c2338] px-4 py-2.5 text-sm font-semibold text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70 sm:text-base sm:font-medium"
									onclick={saveRoutine}
									disabled={saving}
								>
									<span>{saving ? 'Publicando...' : 'Publicar cambios'}</span>
								</button>
							{/if}
						</div>
				{#if SHOW_SEQUENTIAL_HIDE_EMPTY_TOGGLE}
					<label class="flex items-center gap-2 rounded-lg border border-slate-800 bg-[#101523] px-3 py-2 text-xs text-slate-300">
						<input
							type="checkbox"
							checked={uiMeta.hide_empty_days_in_sequential}
							onchange={(event) =>
								(uiMeta = normalizeRoutineUiMeta({
									...uiMeta,
									hide_empty_days_in_sequential: (event.currentTarget as HTMLInputElement).checked
								}))}
						/>
						Ocultar días vacíos en modo secuencial
					</label>
				{/if}

					<div class="pt-8 md:pt-0">
						<div class="flex flex-wrap gap-2">
								{#each displayDays(selectedDay) as day}
									{@const importDayIssueCount = getImportedDayIssueCount(day.dayKey)}
									<button
										type="button"
										data-testid={`routine-day-tab-${day.dayKey}`}
										class={`whitespace-nowrap rounded-full px-4 py-2 text-base border ${
											selectedDay === day.dayKey
												? 'bg-[#16223d] text-white border-cyan-300/90 shadow-[0_0_0_1px_rgba(103,232,249,0.6)]'
												: day.hasExercises
													? 'bg-[#122139] text-slate-100 border-cyan-800/70 shadow-[0_0_0_1px_rgba(34,211,238,0.15)] hover:bg-[#173051]'
													: 'bg-[#070c1d] text-slate-300 border-[#0f162b] hover:bg-[#0d152b]'
										}`}
									onclick={() => (selectedDay = day.dayKey)}
								>
									<span class="inline-flex items-center gap-2">
										<span>{day.displayLabel}</span>
										{#if importDayIssueCount > 0}
											<span class="rounded-full border border-amber-500/50 bg-amber-900/35 px-2 py-0.5 text-[11px] font-semibold text-amber-200">
												{importDayIssueCount}
											</span>
										{/if}
									</span>
								</button>
						{/each}
						</div>
					</div>

				{#if uiMeta.day_label_mode === 'custom'}
					<label class="block text-sm font-medium text-slate-300">
						Etiqueta visible del día seleccionado
						<input
							class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
							value={plan[selectedDay]?.label ?? ''}
							maxlength="40"
							placeholder="Ej: Día de empuje"
							oninput={(event) =>
								updateCustomDayLabel(
									selectedDay,
									(event.currentTarget as HTMLInputElement).value
								)}
						/>
					</label>
				{/if}

				{#if importReviewSession && getImportedDayIssues(selectedDay).length > 0}
					<p class="mt-3 rounded-lg border border-amber-700/50 bg-amber-900/25 px-3 py-2 text-sm text-amber-100">
						{getImportedDayIssues(selectedDay)[0]?.message}
					</p>
				{/if}
			</div>

			<div class="space-y-3 rounded-xl border border-slate-800 bg-[#0b0d14] p-3 md:p-5">
				{#if plan[selectedDay].exercises.length === 0}
					<p class="text-base text-slate-400">Sin ejercicios. Agregá uno.</p>
				{:else}
					{#each getEditorBlocks(selectedDay) as block (block.key)}
						{#if block.type === 'circuit'}
							{@const blockWarning = blockInlineWarnings[`${selectedDay}::${block.key}`]}
							{@const roundsError = getBlockRoundsUiError(selectedDay, block.key, block.rounds)}
							{@const importedBlockIssue = getImportedBlockIssue(selectedDay, block.key)}
							{@const importedRoundsIssue = getImportedBlockFieldIssue(selectedDay, block.key, 'rounds', block.rounds)}
							<div class="rounded-xl border {(blockWarning || roundsError) ? 'border-amber-500/50' : (importedBlockIssue || importedRoundsIssue) ? 'border-amber-700/40' : 'border-cyan-900/40'} bg-gradient-to-b from-[#101a2d] to-[#0f1626] p-3 md:p-4 shadow-sm">
								<div class="mb-5 flex items-start justify-between gap-3">
									<div class="inline-flex shrink-0 rounded-lg border border-slate-700 bg-[#101423] p-1">
										<button
											type="button"
											class="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-[#1c2336]"
											onclick={() => updateExerciseBlockType(selectedDay, block.exercises[0].id, 'normal')}
										>
											Normal
										</button>
										<button
											type="button"
											class="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900"
											onclick={() => updateExerciseBlockType(selectedDay, block.exercises[0].id, 'circuit')}
										>
											Circuito
										</button>
									</div>
									<button
										type="button"
										title="Eliminar bloque"
										aria-label="Eliminar bloque"
										class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-700/70 bg-transparent text-red-300 transition-colors hover:bg-red-900/30 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
										onclick={() => removeBlock(selectedDay, block.exercises[0].id)}
									>
										<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16m-6 0V5.5a1.5 1.5 0 0 0-3 0V7m-4 0 .7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7M10 10.5v6M14 10.5v6" />
										</svg>
									</button>
								</div>

										<div>
											<label class="block w-full max-w-full text-sm font-medium text-slate-300 md:max-w-[12rem]">
												Vueltas
											<input
												type="number"
												min="1"
											max="99"
											class="mt-2 w-full rounded-lg border {roundsError ? 'border-red-500/80' : importedRoundsIssue ? 'border-amber-500/60' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
											value={block.rounds ?? 3}
											placeholder="Ej: 3"
											oninput={(event) =>
												updateExercise(
													selectedDay,
													block.exercises[0].id,
													'circuitRounds',
													Number((event.currentTarget as HTMLInputElement).value) || 0
												)}
										/>
											{#if roundsError}
												<p class="mt-1 text-xs text-red-400">{roundsError}</p>
											{:else if importedRoundsIssue}
												<p class="mt-1 text-xs text-amber-300">{importedRoundsIssue.message}</p>
											{/if}
										</label>
											<label class="mt-7 block w-full max-w-full text-sm font-medium text-slate-300 md:max-w-xl">
												Notas del circuito (opcional)
												<input
													type="text"
												maxlength="140"
												class="mt-2 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
												value={getCircuitBlockNote(block)}
												placeholder="Ej. 30s de descanso entre vueltas"
												oninput={(event) =>
													updateCircuitBlockNote(
														selectedDay,
														block.key,
														(event.currentTarget as HTMLInputElement).value
													)}
											/>
										</label>
									</div>

									<div class="mt-7 border-t border-slate-700/60 pt-5">
										<div class="mb-3 hidden grid-cols-[minmax(0,1fr)_minmax(0,12rem)_2.25rem] gap-3 text-xs font-semibold uppercase tracking-[0.08em] text-slate-400 md:grid">
											<span>Nombre</span>
											<span>Repeticiones</span>
											<span></span>
										</div>
										<div class="space-y-3">
											{#each block.exercises as exercise (exercise.id)}
												{@const nameError = getExerciseFieldUiError(selectedDay, exercise, 'name')}
												{@const repsError = getExerciseFieldUiError(selectedDay, exercise, 'reps')}
												{@const importedNameIssue = getImportedExerciseIssue(selectedDay, exercise, 'name')}
												{@const importedRepsIssue = getImportedExerciseIssue(selectedDay, exercise, 'reps')}
												<div class="relative rounded-lg border border-slate-800/70 bg-[#0e1423] px-3 py-3">
													<div class="grid gap-3 pr-12 md:grid-cols-[minmax(0,1fr)_minmax(0,12rem)_2.25rem] md:items-start md:pr-0">
														<div>
															<p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 md:hidden">
																Nombre
															</p>
															<input
																class="w-full rounded-lg border {nameError ? 'border-red-500/80' : importedNameIssue ? 'border-amber-500/60' : 'border-slate-600/90'} bg-[#16203a] px-3 py-2.5 text-[1.05rem] font-semibold tracking-tight text-slate-50 placeholder:text-slate-500 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
															value={exercise.name}
															placeholder="Ej: Flexiones"
															oninput={(event) => {
																const input = event.currentTarget as HTMLInputElement;
																const value = input.value;
																const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
																updateExercise(selectedDay, exercise.id, 'name', capitalized);
															}}
														/>
														{#if nameError}
															<p class="mt-1 text-xs text-red-400">{nameError}</p>
														{:else if importedNameIssue}
															<p class="mt-1 text-xs text-amber-300">{importedNameIssue.message}</p>
															{/if}
														</div>
														<div>
															<p class="mb-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-slate-400 md:hidden">
																Repeticiones
															</p>
															<input
																type="text"
																maxlength={MAX_SPECIAL_REPS_LENGTH}
															class="w-full rounded-lg border {repsError ? 'border-red-500/80' : importedRepsIssue ? 'border-amber-500/60' : 'border-slate-700'} bg-[#151827] px-3 py-2.5 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
															value={getExerciseRepsInputValue(exercise)}
															placeholder="Ej: 10, 8-10, 30 segundos, AMRAP, al fallo"
															oninput={(event) => setExerciseRepsValue(selectedDay, exercise.id, (event.currentTarget as HTMLInputElement).value)}
														/>
														{#if repsError}
															<p class="mt-1 text-xs text-red-400">{repsError}</p>
														{:else if importedRepsIssue}
															<p class="mt-1 text-xs text-amber-300">{importedRepsIssue.message}</p>
														{/if}
													</div>
														<button
															type="button"
															title="Eliminar ejercicio"
															aria-label="Eliminar ejercicio"
															class="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-700/70 bg-transparent text-red-300 transition-colors hover:bg-red-900/30 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50 md:static md:right-auto md:top-auto md:self-start"
															onclick={() => removeExercise(selectedDay, exercise.id)}
														>
														<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16m-6 0V5.5a1.5 1.5 0 0 0-3 0V7m-4 0 .7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7M10 10.5v6M14 10.5v6" />
														</svg>
													</button>
												</div>
												</div>
											{/each}
										</div>
								</div>
								{#if blockWarning}
									<p class="mt-4 rounded-lg border border-amber-700/50 bg-amber-900/35 px-3 py-2 text-sm text-amber-200">
										{blockWarning}
									</p>
								{:else if importedBlockIssue}
									<p class="mt-4 rounded-lg border border-amber-700/50 bg-amber-900/25 px-3 py-2 text-sm text-amber-100">
										{importedBlockIssue.message}
									</p>
								{/if}

								<button
									type="button"
									class="mt-5 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-cyan-800/70 bg-transparent px-4 py-3 text-sm font-semibold text-cyan-200 transition hover:bg-cyan-950/30 hover:border-cyan-600"
									onclick={() => addExerciseToBlock(selectedDay, block.exercises[0].id)}
								>
									<svg class="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
										<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 5v14m-7-7h14" />
									</svg>
									Agregar ejercicio
								</button>
							</div>
						{:else}
							{@const exercise = block.exercises[0]}
							{@const blockWarning = blockInlineWarnings[`${selectedDay}::${block.key}`]}
							{@const nameError = getExerciseFieldUiError(selectedDay, exercise, 'name')}
							{@const setsError = getExerciseFieldUiError(selectedDay, exercise, 'sets')}
							{@const repsError = getExerciseFieldUiError(selectedDay, exercise, 'reps')}
							{@const importedBlockIssue = getImportedBlockIssue(selectedDay, block.key)}
							{@const importedNameIssue = getImportedExerciseIssue(selectedDay, exercise, 'name')}
							{@const importedSetsIssue = getImportedExerciseIssue(selectedDay, exercise, 'sets')}
							{@const importedRepsIssue = getImportedExerciseIssue(selectedDay, exercise, 'reps')}
							<div class="rounded-lg border {(blockWarning || nameError || setsError || repsError) ? 'border-amber-500/50' : (importedBlockIssue || importedNameIssue || importedSetsIssue || importedRepsIssue) ? 'border-amber-700/40' : 'border-slate-800'} bg-[#111423] p-3 md:p-4 shadow-sm">
								<div>
									<div class="mb-7 flex items-start justify-between gap-3">
										<div class="mt-1 inline-flex shrink-0 rounded-lg border border-slate-700 bg-[#101423] p-1">
											<button
												type="button"
												class="rounded-md bg-slate-100 px-3 py-1.5 text-xs font-semibold text-slate-900"
												onclick={() => updateExerciseBlockType(selectedDay, exercise.id, 'normal')}
											>
												Normal
											</button>
											<button
												type="button"
												class="rounded-md px-3 py-1.5 text-xs font-semibold text-slate-300 hover:bg-[#1c2336]"
												onclick={() => updateExerciseBlockType(selectedDay, exercise.id, 'circuit')}
											>
												Circuito
											</button>
										</div>
										<button
											type="button"
											title="Eliminar ejercicio"
											aria-label="Eliminar ejercicio"
											class="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-red-700/70 bg-transparent text-red-300 transition-colors hover:bg-red-900/30 hover:text-red-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/50"
											onclick={() => removeExercise(selectedDay, exercise.id)}
										>
											<svg class="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
												<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16m-6 0V5.5a1.5 1.5 0 0 0-3 0V7m-4 0 .7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7M10 10.5v6M14 10.5v6" />
											</svg>
										</button>
									</div>
										<label class="block">
											<span class="sr-only">Nombre del ejercicio</span>
											<input
												data-testid="exercise-name-input"
												class="w-full rounded-lg border {nameError ? 'border-red-500/80' : importedNameIssue ? 'border-amber-500/60' : 'border-slate-500/95'} bg-[#1a243a] px-4 py-[1.1rem] text-[1.2rem] font-semibold tracking-tight text-slate-50 placeholder:text-slate-500 shadow-sm focus:border-cyan-400 focus:outline-none focus:ring-2 focus:ring-cyan-500/30"
												value={exercise.name}
												placeholder="Ej: Sentadilla"
											oninput={(event) => {
												const input = event.currentTarget as HTMLInputElement;
												const value = input.value;
												const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
													updateExercise(selectedDay, exercise.id, 'name', capitalized);
												}}
											/>
											{#if nameError}
												<p class="mt-1 text-xs text-red-400">{nameError}</p>
											{:else if importedNameIssue}
												<p class="mt-1 text-xs text-amber-300">{importedNameIssue.message}</p>
											{/if}
										</label>

									<div class="mt-6 grid gap-6 md:mt-10 md:gap-5 md:grid-cols-[minmax(0,0.82fr)_minmax(0,1.18fr)] md:items-start">
											<label class="block text-sm font-medium text-slate-300">
												<span class="flex items-center md:h-11">Series</span>
												<input
													type="number"
													min="1"
													max="99"
													class="mt-3 w-full rounded-lg border {setsError ? 'border-red-500/80' : importedSetsIssue ? 'border-amber-500/60' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700 md:mt-2"
													value={exercise.totalSets ?? ''}
													placeholder="Ej: 4"
												oninput={(event) =>
													updateExercise(
														selectedDay,
														exercise.id,
														'totalSets',
															Number((event.currentTarget as HTMLInputElement).value) || 0
														)}
												/>
												{#if setsError}
													<p class="mt-1 text-xs text-red-400">{setsError}</p>
												{:else if importedSetsIssue}
													<p class="mt-1 text-xs text-amber-300">{importedSetsIssue.message}</p>
												{/if}
											</label>

											<div class="block text-sm font-medium text-slate-300">
												<div class="flex items-center justify-between gap-3 md:h-11 md:flex-nowrap">
													<span>Repeticiones</span>
												</div>
												<div class="mt-3 space-y-2 md:mt-2">
													<input
														type="text"
														maxlength={MAX_SPECIAL_REPS_LENGTH}
														class="w-full rounded-lg border {repsError ? 'border-red-500/80' : importedRepsIssue ? 'border-amber-500/60' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
														value={getExerciseRepsInputValue(exercise)}
														placeholder="Ej: 10, 8-10, 30 segundos, AMRAP, al fallo"
														oninput={(event) =>
															setExerciseRepsValue(
																selectedDay,
																exercise.id,
																(event.currentTarget as HTMLInputElement).value
															)}
													/>
													{#if repsError}
														<p class="text-xs text-red-400">{repsError}</p>
													{:else if importedRepsIssue}
														<p class="text-xs text-amber-300">{importedRepsIssue.message}</p>
													{/if}
												</div>
											</div>
									</div>

									<label class="mt-6 block text-sm font-medium text-slate-300">
										Nota (opcional)
										<input
											class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
											value={exercise.note ?? ''}
											placeholder="Ej: RPE, RIR, dropset, etc."
											oninput={(event) =>
												updateExercise(
													selectedDay,
													exercise.id,
													'note',
													(event.currentTarget as HTMLInputElement).value
												)}
										/>
									</label>
									{#if blockWarning}
										<p class="mt-4 rounded-lg border border-amber-700/50 bg-amber-900/35 px-3 py-2 text-sm text-amber-200">
											{blockWarning}
										</p>
									{:else if importedBlockIssue}
										<p class="mt-4 rounded-lg border border-amber-700/50 bg-amber-900/25 px-3 py-2 text-sm text-amber-100">
											{importedBlockIssue.message}
										</p>
									{/if}
								</div>
							</div>
						{/if}
					{/each}
				{/if}

				{#if dayInlineWarnings[selectedDay]}
					<p class="rounded-lg border border-amber-700/50 bg-amber-900/35 px-3 py-2 text-sm text-amber-200">
						{dayInlineWarnings[selectedDay]}
					</p>
				{/if}

				<div class={`grid grid-cols-1 gap-3 ${hasAnyExercise() ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
					<button
						data-testid="add-exercise-button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base font-medium text-slate-100 hover:bg-[#1b1f30] disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={() => addExercise(selectedDay)}
						type="button"
						disabled={plan[selectedDay].exercises.length >= MAX_EXERCISES_PER_DAY}
					>
						+ Agregar ejercicio
					</button>
					{#if hasAnyExercise()}
						<button
							class="save-cta rounded-lg bg-[#1c2338] px-4 py-3 text-base font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
							onclick={saveRoutine}
							disabled={saving}
						>
							<span>{saving ? 'Publicando...' : 'Publicar cambios'}</span>
						</button>
						<button
							class="rounded-lg border border-amber-600/50 bg-amber-900/40 px-4 py-3 text-base font-medium text-amber-200 hover:bg-amber-900/60"
							onclick={() => (showResetConfirm = true)}
							type="button"
						>
							Resetear progreso
						</button>
					{/if}
				</div>
			</div>

			{#if feedback}
				<div class="flex items-center gap-2 rounded-lg px-4 py-2.5 text-base border {feedbackType === 'success' ? 'bg-emerald-900/40 text-emerald-200 border-emerald-700/50' : feedbackType === 'warning' ? 'bg-amber-900/40 text-amber-200 border-amber-700/50' : 'bg-red-900/40 text-red-200 border-red-700/50'}">
					{#if feedbackType === 'warning'}
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
						</svg>
					{:else if feedbackType === 'error'}
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
						</svg>
					{:else}
						<svg class="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
						</svg>
					{/if}
					<span>{feedback}</span>
				</div>
			{/if}
		</div>

		<div class="contents lg:order-2 lg:flex lg:flex-col lg:gap-3">
		<div class="order-1 min-w-0 lg:order-2 rounded-2xl border border-slate-800 bg-[#0f111b] p-4 md:p-6 shadow-lg shadow-black/30">
			<div class="flex items-center justify-between">
				<div class="flex flex-col gap-1">
					<h3 class="text-xl font-semibold uppercase tracking-wide text-slate-50">
						{uiMeta.day_label_mode === 'sequential' ? 'Ciclo actual' : 'Semana actual'}
					</h3>
				</div>
			</div>
			<ul class="mt-4 space-y-5 text-base text-slate-200">
				{#each displayDays(expandedDay).filter((entry) => entry.hasExercises || entry.dayKey === expandedDay) as day}
					{@const completion = dayCompletion(day.dayKey)}
						<li class="rounded-lg border border-slate-700/90 bg-gradient-to-b from-[#1a223a] to-[#131b2f] overflow-hidden hover:from-[#1e2947] hover:to-[#16223a] transition-colors cursor-pointer shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
							<button type="button" class="w-full text-left px-4 py-4 sm:py-5" onclick={() => toggleDayDetail(day.dayKey)}>
								<div class="grid grid-cols-[auto_1fr_auto] items-center gap-3 sm:gap-4">
									<p class="font-semibold text-slate-100">{day.displayLabel}</p>
									<div class="flex justify-center">
										<span
											class={`rounded-full px-3 py-1 text-sm font-semibold whitespace-nowrap ${
												progress[day.dayKey]?.suspicious && completion.completed
													? 'bg-amber-900/50 text-amber-200'
													: completion.completed
														? 'bg-emerald-900/50 text-emerald-300'
														: 'bg-slate-800 text-slate-300'
											}`}
										>
											{progress[day.dayKey]?.suspicious && completion.completed
												? 'Posible engaño'
												: completion.completed
													? 'Completado'
													: 'En progreso'}
										</span>
									</div>
									<div class="flex items-center gap-1.5 text-sm text-slate-300">
										<span class="hidden sm:inline">Detalle</span>
										<svg class="w-4 h-4 transition-transform {expandedDay === day.dayKey ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
									</div>
								</div>
								<p class="text-[13px] sm:text-sm text-slate-400 mt-1.5">
									{completion.done}/{completion.total} ejercicios
								</p>
							</button>
							{#if expandedDay === day.dayKey}
								{@const details = getExerciseDetails(day.dayKey)}
										<div class="border-t border-slate-700/70 bg-[#0b1222] px-4 py-3 space-y-1">
										<div class="divide-y divide-slate-800/60">
												{#each details.exercises as ex}
													<div class="grid grid-cols-[1fr_auto] gap-3 items-center py-3.5 hover:bg-slate-800/20 -mx-2 px-2 rounded transition-colors">
														<span class="text-sm {ex.exists ? 'text-slate-400' : 'text-slate-500 italic'} line-clamp-2">{ex.name}</span>
														<span class="inline-flex items-center gap-1 text-sm font-semibold px-2.5 py-1 rounded border {ex.complete ? 'border-teal-800/50 bg-teal-950/40 text-teal-200' : 'border-slate-700/70 bg-slate-900/50 text-slate-400'}">
															{ex.done}/{ex.target}
															{#if ex.complete}
																<svg class="w-3.5 h-3.5 text-teal-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																	<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
																</svg>
															{/if}
														</span>
													</div>
												{/each}
											</div>
											<div class="mt-11 border-t border-slate-700/70 pt-7">
												<button
													type="button"
													class="w-full flex items-center justify-between gap-3 rounded-lg bg-[#0e1526] px-3 py-4 text-left transition-colors hover:bg-[#111b31]"
													onclick={() => toggleFeedbackDetail(day.dayKey)}
												>
													<span class="text-sm font-semibold text-slate-200">🧠 Ver sensaciones del día</span>
													<span class={`inline-flex min-h-[1.75rem] min-w-[7rem] items-center justify-center whitespace-nowrap rounded-full px-3 py-1 text-xs font-semibold text-center ${
														getDayFeedbackBadgeState(day.dayKey) === 'registered'
															? 'bg-slate-800/80 text-slate-200'
															: getDayFeedbackBadgeState(day.dayKey) === 'partial'
																? 'bg-amber-900/25 text-amber-200'
															: 'bg-slate-900/70 text-slate-400'
												}`}>
													{getDayFeedbackBadgeLabel(day.dayKey)}
												</span>
											</button>
											{#if feedbackExpanded[day.dayKey]}
												<div class="mt-4 rounded-lg border border-slate-800 bg-[#0b1120] px-3 py-3 text-xs text-slate-300">
													{#if hasDayFeedback(day.dayKey)}
														{@const row = dayFeedback[day.dayKey]}
														<div class="space-y-0">
															<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-700/40 py-2.5">
																<span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">🧠 Sensación</span>
																{#if row?.mood}
																	<span class={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold ${feedbackMoodBadgeTone(row?.mood)}`}>
																		<span>{feedbackMoodIcon(row?.mood)}</span>
																		<span>{formatFeedbackMood(row?.mood)}</span>
																	</span>
																{:else}
																	<span class="text-xs text-slate-500">— (Sin respuesta)</span>
																{/if}
															</div>
															<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 border-b border-slate-700/40 py-2.5">
																<span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">📊 Dificultad</span>
																<span class={feedbackDifficultyTone(row?.difficulty)}>{formatFeedbackDifficulty(row?.difficulty)}</span>
															</div>
															<div class="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-4 py-2.5">
																<span class="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">⚠️ Dolor / molestias</span>
																<span class={row?.pain ? 'text-sm font-semibold text-slate-200' : 'text-xs text-slate-500'}>
																	{formatFeedbackPain(row?.pain)}
																</span>
															</div>
														</div>
														<div class="mt-3 rounded-md border border-slate-800/80 bg-[#0a101d] px-3 py-2.5">
															<p class="text-[11px] font-semibold uppercase tracking-[0.1em] text-slate-400">📝 Comentario</p>
															<p class={`mt-2 border-t border-slate-700/40 pt-2 text-xs leading-relaxed ${row?.comment ? 'text-slate-200' : 'text-slate-500'}`}>
																{formatFeedbackComment(row?.comment)}
															</p>
														</div>
														{#if row?.submitted_at}
															<p class="pt-2 text-[11px] text-slate-500">Registrado: {new Date(row.submitted_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</p>
														{/if}
													{:else}
														<p class="text-slate-400">El alumno no completó la encuesta este día.</p>
													{/if}
												</div>
											{/if}
										</div>
										{#if details.hasInconsistency}
											<p class="text-xs text-amber-400/80 mt-3">
												La rutina fue modificada después del progreso registrado.
											</p>
										{/if}
									</div>
								{/if}
							</li>
				{/each}
			</ul>
				{#if hasSuspicious()}
					<p class="mt-3 text-sm text-amber-200">
						Posible engaño significa que el alumno marcó todas las series del día en menos de 60 segundos. Es posible que las haya marcado sin haber entrenado.
					</p>
				{/if}
		</div>

		<div class="order-2 min-w-0 lg:order-3 rounded-2xl border border-slate-800 bg-[#0f111b] p-4 shadow-lg shadow-black/30 text-sm text-slate-300">
			<p class="font-semibold text-slate-100">Última actualización</p>
			<p class="mt-1 text-slate-400">
				{#if data.last_completed_at}
					{new Date(data.last_completed_at).toLocaleString()}
				{:else}
					—
				{/if}
			</p>
		</div>

			<div class="order-4 min-w-0 lg:order-1 self-start rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0f172a] to-[#0b1224] p-4 md:p-6 shadow-lg shadow-black/30 space-y-2">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">Link de la rutina</p>
						<p class="mt-1 text-base font-semibold text-emerald-200 break-all">{link}</p>
					</div>
				</div>
			</div>
		</div>
	</section>

	{#if showDeleteUndoSnackbar && deletedExercisesBatch.length > 0}
		<div class="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
			<div class="pointer-events-auto flex w-full max-w-xl items-center justify-between gap-3 rounded-2xl border border-slate-700/80 bg-[#0f1728]/95 px-4 py-3 text-slate-100 shadow-[0_16px_40px_rgba(0,0,0,0.45)] backdrop-blur">
					<div class="flex items-center gap-2 text-sm font-semibold">
						<svg class="h-5 w-5 text-slate-300" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
							<path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.8" d="M4 7h16m-6 0V5.5a1.5 1.5 0 0 0-3 0V7m-4 0 .7 11.2A2 2 0 0 0 9.7 20h4.6a2 2 0 0 0 2-1.8L17 7M10 10.5v6M14 10.5v6" />
						</svg>
						<span>{deletedExercisesBatch.length === 1 ? 'Ejercicio eliminado' : `${deletedExercisesBatch.length} ejercicios eliminados`}</span>
						<span class="rounded-full border border-slate-600/80 bg-[#151f33] px-2 py-0.5 text-xs font-semibold text-slate-300 tabular-nums">
							{deleteUndoSecondsLeft}s
						</span>
					</div>
				<button
					type="button"
					class="rounded-lg border border-cyan-500/45 bg-[#13213d] px-3.5 py-2 text-sm font-semibold text-cyan-100 transition hover:bg-[#173056] hover:border-cyan-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-500/45"
					onclick={undoDeletedExercises}
				>
					Deshacer
				</button>
			</div>
		</div>
	{/if}

	{#if showDeleteConfirm}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-red-200">Eliminar alumno</h2>
					<p class="text-sm text-slate-300">
						Para eliminar al alumno <span class="font-semibold">{data.client.name}</span> definitivamente,
						escribí la palabra <span class="font-semibold text-red-300">eliminar</span>.
					</p>
				</div>
				<form method="post" action="?/delete" class="mt-4 space-y-3">
					<label class="block text-sm font-medium text-slate-200">
						Confirmación
						<input
							class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-base text-slate-100 focus:border-red-400 focus:outline-none focus:ring-2 focus:ring-red-500/40"
							placeholder="eliminar"
							bind:value={deleteConfirmText}
							name="confirm_text"
						/>
					</label>
					<div class="flex items-center justify-end gap-3 pt-2">
						<button
							type="button"
							class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
							onclick={() => {
								showDeleteConfirm = false;
								deleteConfirmText = '';
							}}
						>
							Cancelar
						</button>
						<button
							type="submit"
							class="rounded-lg bg-red-600 px-4 py-2 text-white transition hover:bg-red-500 disabled:opacity-60 disabled:cursor-not-allowed"
							disabled={deleteConfirmText.trim().toLowerCase() !== 'eliminar'}
						>
							Eliminar definitivamente
						</button>
					</div>
				</form>
			</div>
		</div>
	{/if}

	{#if showArchiveConfirm}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-3">
					<h2 class="text-xl font-semibold text-amber-200">Desactivar alumno</h2>
					<p class="text-sm text-slate-300">¿Estás seguro que deseas desactivar el acceso a este alumno?</p>
				</div>
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						onclick={() => (showArchiveConfirm = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="rounded-lg border border-amber-500/50 bg-amber-900/60 px-4 py-2 text-amber-100 hover:bg-amber-900/80"
						onclick={() => {
							showArchiveConfirm = false;
							setStatus('archived');
						}}
					>
						Confirmar
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showResetConfirm}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-3">
					<h2 class="text-xl font-semibold text-amber-200">Resetear progreso</h2>
					<p class="text-sm text-slate-300">
						¿Estás seguro que deseas reiniciar el progreso de <span class="font-semibold">{data.client.name}</span>?
						Esto borrará todas las series completadas de esta semana.
					</p>
				</div>
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						onclick={() => (showResetConfirm = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="rounded-lg border border-amber-500/50 bg-amber-900/60 px-4 py-2 text-amber-100 hover:bg-amber-900/80"
						onclick={async () => {
							showResetConfirm = false;
							await resetProgress();
						}}
					>
						Resetear progreso
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showDiscardImportConfirm && importReviewSession}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-3">
					<h2 class="text-xl font-semibold text-amber-200">Descartar importación</h2>
					<p class="text-sm text-slate-300">
						Se van a eliminar todos los cambios generados por la importación y vas a volver al estado anterior.
					</p>
				</div>
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30] disabled:cursor-not-allowed disabled:opacity-60"
						disabled={discardImportPending}
						onclick={() => (showDiscardImportConfirm = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="inline-flex items-center gap-2 rounded-lg border border-amber-500/50 bg-amber-900/60 px-4 py-2 text-amber-100 hover:bg-amber-900/80 disabled:cursor-not-allowed disabled:opacity-70"
						disabled={discardImportPending}
						aria-busy={discardImportPending}
						onclick={confirmDiscardImport}
					>
						{#if discardImportPending}
							<span class="h-4 w-4 animate-spin rounded-full border-2 border-amber-200 border-t-transparent" aria-hidden="true"></span>
							Descartando...
						{:else}
							Descartar importación
						{/if}
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showImportPublishConfirm && importReviewSession}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-3">
					<h2 class="text-xl font-semibold text-cyan-100">Publicar cambios importados</h2>
					<p class="text-sm text-slate-300">
						Vas a publicar la rutina generada desde la importación. Confirmá que ya revisaste los puntos marcados.
					</p>
					{#if getImportReviewCount() > 0}
						<p class="text-xs text-amber-200">
							Quedan {getImportReviewCount()} punto(s) marcados para revisar.
						</p>
					{/if}
				</div>
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						onclick={() => (showImportPublishConfirm = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="rounded-lg border border-cyan-500/50 bg-cyan-900/60 px-4 py-2 text-cyan-50 hover:bg-cyan-900/80"
						onclick={async () => {
							showImportPublishConfirm = false;
							await performSaveRoutine();
						}}
					>
						Publicar igual
					</button>
				</div>
			</div>
		</div>
	{/if}

	{#if showCopyModal}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-emerald-700/40 bg-gradient-to-br from-[#0f111b] via-[#0b1020] to-[#11172a] p-6 shadow-2xl shadow-black/50 text-slate-100 space-y-5">
				<div class="text-center">
					<h2 class="text-2xl font-extrabold">
						<span class="bg-gradient-to-r from-emerald-300 via-cyan-300 to-slate-100 bg-clip-text text-transparent">
							Copiar rutina desde otro alumno
						</span>
					</h2>
					<p class="mt-6 mb-8 text-sm text-amber-200 flex items-center justify-center gap-2">
						⚠️ Esto reemplaza la rutina actual. El progreso se reiniciará para este alumno. ⚠️
					</p>
				</div>
					{#if loadingOtherClients}
						<p class="text-sm text-slate-300">Cargando alumnos...</p>
					{:else if otherClientsError}
						<div class="space-y-3">
							<p class="text-sm text-red-200">{otherClientsError}</p>
							<button
								type="button"
								class="rounded-lg border border-red-600 px-3 py-2 text-xs font-semibold text-red-200 hover:bg-red-900/40"
								onclick={loadOtherClients}
							>
								Reintentar
							</button>
						</div>
						{:else if otherClients.length > 0}
							<label class="block text-sm font-medium text-slate-200 mt-6">
								Seleccioná desde qué alumno querés copiar
								<div class="relative mt-3" bind:this={copySourceMenuEl}>
									<button
										type="button"
										class={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left text-base shadow-inner transition ${
											showCopySourceMenu
												? 'border-emerald-500/80 bg-[#0f1d29] text-slate-100 ring-2 ring-emerald-600/40'
												: 'border-slate-600 bg-[#0f1322] text-slate-100 hover:border-slate-500'
										}`}
										aria-haspopup="listbox"
										aria-expanded={showCopySourceMenu}
										onclick={() => {
											showCopySourceMenu = !showCopySourceMenu;
										}}
									>
										<span class={selectedSource ? 'text-slate-100' : 'text-slate-400'}>
											{selectedSourceLabel()}
										</span>
										<svg
											class={`h-4 w-4 flex-shrink-0 text-slate-400 transition-transform ${showCopySourceMenu ? 'rotate-180' : ''}`}
											fill="none"
											stroke="currentColor"
											viewBox="0 0 24 24"
										>
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
									</button>
									{#if showCopySourceMenu}
										<div
											class="copy-source-scrollbar absolute z-30 mt-2 max-h-64 w-full overflow-auto rounded-xl border border-slate-600 bg-[#121a2d] p-1 shadow-2xl shadow-black/50"
											role="listbox"
											aria-label="Alumnos disponibles"
										>
											{#each otherClients as c}
												<button
													type="button"
													class={`flex w-full items-center justify-between rounded-lg px-3 py-2.5 text-left text-sm transition ${
														selectedSource === c.id
															? 'bg-emerald-600/20 text-emerald-200'
															: 'text-slate-200 hover:bg-slate-700/40'
													}`}
													role="option"
													aria-selected={selectedSource === c.id}
													onclick={() => selectSourceClient(c.id)}
												>
													<span class="truncate">{c.name}</span>
													{#if selectedSource === c.id}
														<svg class="h-4 w-4 flex-shrink-0 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
															<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
														</svg>
													{/if}
												</button>
											{/each}
										</div>
									{/if}
								</div>
						</label>
						{:else}
							<p class="text-sm text-slate-400">No tenés otros alumnos para copiar.</p>
					{/if}
				<div class="flex justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
							onclick={() => {
								showCopyModal = false;
								showCopySourceMenu = false;
								selectedSource = '';
								otherClientsError = null;
							}}
					>
						Cancelar
					</button>
						<button
							type="button"
							class="rounded-lg bg-emerald-600 px-4 py-2 text-white shadow-md shadow-emerald-900/40 transition hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
							disabled={!selectedSource || loadingOtherClients || !!otherClientsError}
							onclick={copyRoutine}
						>
						Confirmar
					</button>
				</div>
			</div>
		</div>
	{/if}
</section>

	<style>
		.copy-source-scrollbar {
			scrollbar-width: thin;
			scrollbar-color: rgba(52, 211, 153, 0.65) rgba(15, 19, 34, 0.9);
		}
		.copy-source-scrollbar::-webkit-scrollbar {
			width: 10px;
		}
		.copy-source-scrollbar::-webkit-scrollbar-track {
			background: rgba(15, 19, 34, 0.95);
			border-left: 1px solid rgba(148, 163, 184, 0.18);
			border-radius: 999px;
		}
		.copy-source-scrollbar::-webkit-scrollbar-thumb {
			background: linear-gradient(180deg, rgba(45, 212, 191, 0.9), rgba(16, 185, 129, 0.9));
			border-radius: 999px;
			border: 2px solid rgba(15, 19, 34, 0.95);
			box-shadow: 0 0 0 1px rgba(45, 212, 191, 0.25);
		}
		.copy-source-scrollbar::-webkit-scrollbar-thumb:hover {
			background: linear-gradient(180deg, rgba(94, 234, 212, 0.95), rgba(34, 197, 94, 0.95));
		}

		.save-cta {
			position: relative;
			overflow: hidden;
		}
	.save-cta:not(:disabled)::after {
		content: '';
		position: absolute;
		inset: -2px;
		background: linear-gradient(120deg, rgba(34, 197, 94, 0.5), rgba(16, 185, 129, 0.4), rgba(56, 189, 248, 0.35));
		opacity: 0.4;
		filter: blur(10px);
		transform: translateX(-120%);
		animation: sweep 2.6s ease-in-out infinite;
	}
	.save-cta span {
		position: relative;
		z-index: 1;
	}
	@keyframes sweep {
		0% {
			transform: translateX(-120%);
		}
		50% {
			transform: translateX(10%);
		}
		100% {
			transform: translateX(120%);
		}
	}
</style>
