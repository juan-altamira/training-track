<script lang="ts">
	import { DAY_FEEDBACK_MOOD_LABEL, DAY_FEEDBACK_PAIN_LABEL, type DayFeedbackByDay, type DayFeedbackMood, type DayFeedbackPain } from '$lib/dayFeedback';
	import {
		WEEK_DAYS,
		getDisplayDays,
		getTargetSets,
		normalizeRoutineUiMeta,
		sanitizeCustomLabel
	} from '$lib/routines';
	import RoutineImportPanel from '$lib/components/RoutineImportPanel.svelte';
	import type {
		OtherClientRow,
		ProgressState,
		RoutineDayLabelMode,
		RoutineExercise,
		RoutinePlan,
		RoutineUiMeta
	} from '$lib/types';
	import { onMount } from 'svelte';
	import { rememberLastClientRoute } from '$lib/client/sessionResumeWarmup';

	let { data } = $props();

	let plan: RoutinePlan = $state(structuredClone(data.plan));
	let progress: ProgressState = $state(structuredClone(data.progress));
	let uiMeta: Required<RoutineUiMeta> = $state(normalizeRoutineUiMeta(data.uiMeta ?? null));
	let routineVersion = $state(data.routineVersion ?? 1);
	let selectedDay = $state(WEEK_DAYS[0].key);
	let saving = $state(false);
	let feedback = $state('');
	let feedbackType = $state<'success' | 'warning' | 'error'>('success');
	let showValidationErrors = $state(false);
	let statusMessage = $state('');
	let clientStatus = $state(data.client.status as 'active' | 'archived');
	let showDeleteConfirm = $state(false);
	let deleteConfirmText = $state('');
	let showArchiveConfirm = $state(false);
	let showResetConfirm = $state(false);
	let copiedLink = $state(false);
	let showCopyModal = $state(false);
	let selectedSource = $state('');
	let expandedDay = $state<string | null>(null);
	let showDayModeMenu = $state(false);
	const MAX_EXERCISES_PER_DAY = 50;
	let otherClients = $state((data.otherClients ?? []) as OtherClientRow[]);
	let lazyOtherClients = $state(data.lazyOtherClients === true);
	let loadingOtherClients = $state(false);
	let otherClientsError = $state<string | null>(null);
	let dayFeedback = $state((data.dayFeedback ?? {}) as DayFeedbackByDay);
	let feedbackExpanded = $state<Record<string, boolean>>({});
	const hasSuspicious = WEEK_DAYS.some((d) => progress[d.key]?.suspicious && progress[d.key]?.completed);
	let showImportPanel = $state(false);
	let dayModeMenuEl: HTMLDivElement | null = null;

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
			if (!showDayModeMenu || !dayModeMenuEl) return;
			const target = event.target as Node | null;
			if (!target || dayModeMenuEl.contains(target)) return;
			showDayModeMenu = false;
		};

		const handleGlobalKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				showDayModeMenu = false;
			}
		};

		document.addEventListener('pointerdown', handleGlobalPointerDown);
		document.addEventListener('keydown', handleGlobalKeyDown);

		return () => {
			document.removeEventListener('pointerdown', handleGlobalPointerDown);
			document.removeEventListener('keydown', handleGlobalKeyDown);
		};
	});

	const freshProgress = (): ProgressState =>
		WEEK_DAYS.reduce((acc, day) => {
			acc[day.key] = { completed: false, exercises: {} };
			return acc;
		}, {} as ProgressState);

	const MAX_EXERCISE_NAME_LENGTH = 100;

	const validateExercises = (dayKey: string): string | null => {
		const exercises = plan[dayKey].exercises;
		for (const ex of exercises) {
			if (!ex.name || ex.name.trim() === '') {
				return 'Hay ejercicios sin nombre. Completá el nombre antes de continuar.';
			}
			if (ex.name.length > MAX_EXERCISE_NAME_LENGTH) {
				return `El nombre del ejercicio "${ex.name.slice(0, 20)}..." es demasiado largo (máx ${MAX_EXERCISE_NAME_LENGTH} caracteres).`;
			}
			const sets = getTargetSets(ex);
			if (sets === 0) {
				return `El ejercicio "${ex.name}" no tiene series. Completá el campo Series.`;
			}
		}
		return null;
	};

	const addExercise = (dayKey: string) => {
		const exercises = plan[dayKey].exercises;
		
		// Validar ejercicios existentes antes de agregar uno nuevo
		const validationError = validateExercises(dayKey);
		if (validationError) {
			feedback = validationError;
			feedbackType = 'warning';
			setTimeout(() => (feedback = ''), 4000);
			return;
		}
		
		if (exercises.length >= MAX_EXERCISES_PER_DAY) {
			feedback = 'Límite de 50 ejercicios para este día.';
			feedbackType = 'warning';
			setTimeout(() => (feedback = ''), 2500);
			return;
		}
		const newExercise: RoutineExercise = {
			id: crypto.randomUUID(),
			name: '',
			scheme: '',
			order: exercises.length,
			totalSets: undefined,
			repsMin: undefined,
			repsMax: null,
			showRange: false
		};
		plan = {
			...plan,
			[dayKey]: { ...plan[dayKey], exercises: [...exercises, newExercise] }
		};
	};

	const updateExercise = (dayKey: string, id: string, field: keyof RoutineExercise, value: string | number | boolean | null) => {
		const exercises = plan[dayKey].exercises.map((ex) =>
			ex.id === id ? { ...ex, [field]: value } : ex
		);
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises } };
		
		// Limpiar advertencia si el usuario corrigió el error
		if (showValidationErrors && feedbackType === 'warning' && (field === 'name' || field === 'totalSets')) {
			const updatedExercises = plan[dayKey].exercises;
			const hasErrors = updatedExercises.some(ex => 
				!ex.name || ex.name.trim() === '' || !ex.totalSets || ex.totalSets === 0
			);
			if (!hasErrors) {
				feedback = '';
				showValidationErrors = false;
			}
		}
	};

	const removeExercise = (dayKey: string, id: string) => {
		const exercises = plan[dayKey].exercises.filter((ex) => ex.id !== id);
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises } };
	};

	const copyLink = async () => {
		await navigator.clipboard.writeText(link);
		copiedLink = true;
		setTimeout(() => (copiedLink = false), 2000);
	};

	const applyImportedRoutineUpdate = (payload: {
		action: 'commit' | 'rollback';
		plan: RoutinePlan;
		uiMeta: RoutineUiMeta | null;
		routineVersion: number;
	}) => {
		plan = structuredClone(payload.plan);
		uiMeta = normalizeRoutineUiMeta(payload.uiMeta ?? null);
		routineVersion = payload.routineVersion;
		statusMessage =
			payload.action === 'rollback'
				? 'Importación revertida. Vista actualizada.'
				: 'Importación aplicada. Vista actualizada.';
		setTimeout(() => {
			statusMessage = '';
		}, 2500);
	};

	const copyRoutine = async () => {
		if (!selectedSource) return;
		const formData = new FormData();
		formData.set('source_client_id', selectedSource);
		const res = await fetch('?/copyRoutine', { method: 'POST', body: formData });
		if (res.ok) {
			statusMessage = 'Rutina copiada correctamente';
			showCopyModal = false;
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
		showCopyModal = true;
		if (lazyOtherClients) {
			await loadOtherClients();
		}
	};

	const saveRoutine = async () => {
		saving = true;
		feedback = '';
		showValidationErrors = true;
		
		// Validar todos los días antes de guardar
		for (const day of WEEK_DAYS) {
			const exercises = plan[day.key].exercises;
			if (exercises.length === 0) continue;
			const displayLabel = dayDisplayLabel(day.key);
			
			for (const ex of exercises) {
				if (!ex.name || ex.name.trim() === '') {
					feedback = `${displayLabel}: Hay ejercicios sin nombre. Completá el nombre antes de guardar.`;
					feedbackType = 'warning';
					saving = false;
					return;
				}
				if (ex.name.length > MAX_EXERCISE_NAME_LENGTH) {
					feedback = `${displayLabel}: El nombre "${ex.name.slice(0, 20)}..." es demasiado largo.`;
					feedbackType = 'warning';
					saving = false;
					return;
				}
				const sets = getTargetSets(ex);
				if (sets === 0) {
					feedback = `${displayLabel}: "${ex.name}" no tiene series. Completá el campo Series.`;
					feedbackType = 'warning';
					saving = false;
					return;
				}
				if (ex.showRange && (ex.repsMax ?? 0) > 0 && (ex.repsMax ?? 0) < (ex.repsMin ?? 0)) {
					saving = false;
					return;
				}
			}
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
		} else {
			feedback = 'No pudimos guardar la rutina';
			feedbackType = 'error';
		}
		saving = false;
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
							onRoutineApplied={applyImportedRoutineUpdate}
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
								<button
									type="button"
									class={`whitespace-nowrap rounded-full px-4 py-2 text-base border ${
										selectedDay === day.dayKey
											? 'bg-[#16223d] text-white border-slate-600'
											: 'bg-[#070c1d] text-slate-300 border-[#0f162b] hover:bg-[#0d152b]'
									}`}
								onclick={() => (selectedDay = day.dayKey)}
							>
								{day.displayLabel}
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
			</div>

			<div class="space-y-3 rounded-xl border border-slate-800 bg-[#0b0d14] p-3 md:p-5">
				{#if plan[selectedDay].exercises.length === 0}
					<p class="text-base text-slate-400">Sin ejercicios. Agregá uno.</p>
				{:else}
					{#each plan[selectedDay].exercises as exercise, index (exercise.id)}
						<div class="rounded-lg border border-slate-800 bg-[#111423] p-3 md:p-4 shadow-sm">
							<div class="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-2">
								<p class="text-base font-semibold text-slate-100">Ejercicio {index + 1}</p>
								<button
									class="rounded border border-red-700 bg-red-900/40 px-2.5 py-1.5 text-sm text-red-200 hover:bg-red-900/60 w-full md:w-auto"
									onclick={() => removeExercise(selectedDay, exercise.id)}
								>
									Quitar
								</button>
							</div>
							<div class="mt-3 space-y-3">
								<label class="block text-sm font-medium text-slate-300">
									Nombre
									<input
										class="mt-1 w-full rounded-lg border {showValidationErrors && (!exercise.name || exercise.name.trim() === '') ? 'border-red-500' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.name}
										placeholder="Nuevo ejercicio"
										oninput={(e) => {
											const input = e.target as HTMLInputElement;
											const value = input.value;
											const capitalized = value.charAt(0).toUpperCase() + value.slice(1);
											updateExercise(selectedDay, exercise.id, 'name', capitalized);
										}}
									/>
								</label>
								
								<div class="grid gap-3 md:grid-cols-2">
									<label class="block text-sm font-medium text-slate-300">
										Series
										<input
											type="number"
											min="1"
											max="99"
											class="mt-1 w-full rounded-lg border {showValidationErrors && (!exercise.totalSets || exercise.totalSets === 0) ? 'border-red-500' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
											value={exercise.totalSets ?? ''}
											placeholder="Ej: 4"
											oninput={(e) =>
												updateExercise(
													selectedDay,
													exercise.id,
													'totalSets',
													Number((e.target as HTMLInputElement).value) || 0
												)}
										/>
									</label>
									
									<div class="block text-sm font-medium text-slate-300">
										Repeticiones
										<div class="mt-1 flex items-center gap-2">
											<input
												type="number"
												min="1"
												max="999"
												class="w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
												value={exercise.repsMin ?? ''}
												placeholder="Ej: 8"
												oninput={(e) =>
													updateExercise(
														selectedDay,
														exercise.id,
														'repsMin',
														Number((e.target as HTMLInputElement).value) || 0
													)}
											/>
											{#if exercise.showRange}
												<span class="text-slate-400">–</span>
												<input
													type="number"
													min="1"
													max="999"
													class="w-full rounded-lg border {(exercise.repsMax ?? 0) > 0 && (exercise.repsMax ?? 0) < (exercise.repsMin ?? 0) ? 'border-red-500' : 'border-slate-700'} bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
													value={exercise.repsMax ?? ''}
													placeholder="máx"
													oninput={(e) =>
														updateExercise(
															selectedDay,
															exercise.id,
															'repsMax',
															Number((e.target as HTMLInputElement).value) || null
														)}
												/>
												<button
													type="button"
													class="flex-shrink-0 rounded p-1.5 text-slate-400 hover:bg-slate-700 hover:text-slate-200"
													title="Quitar rango"
													onclick={() => {
														updateExercise(selectedDay, exercise.id, 'showRange', false);
														updateExercise(selectedDay, exercise.id, 'repsMax', null);
													}}
												>
													<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
														<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12" />
													</svg>
												</button>
											{:else}
												<button
													type="button"
													class="flex-shrink-0 whitespace-nowrap rounded-lg border border-slate-600 px-4 py-3 text-sm text-slate-300 hover:bg-slate-700"
													onclick={() => updateExercise(selectedDay, exercise.id, 'showRange', true)}
												>
													agregar rango
												</button>
											{/if}
										</div>
										{#if exercise.showRange && (exercise.repsMax ?? 0) > 0 && (exercise.repsMax ?? 0) < (exercise.repsMin ?? 0)}
											<p class="mt-1 text-xs text-red-400">El máximo debe ser igual o mayor que el mínimo</p>
										{/if}
									</div>
								</div>
								
								<label class="block text-sm font-medium text-slate-300">
									Nota (opcional)
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.note ?? ''}
										placeholder="Ej: RPE, RIR, dropset, etc."
										oninput={(e) =>
											updateExercise(
												selectedDay,
												exercise.id,
												'note',
												(e.target as HTMLInputElement).value
											)}
									/>
								</label>
							</div>
						</div>
					{/each}
				{/if}

				<div class={`grid grid-cols-1 gap-3 ${hasAnyExercise() ? 'sm:grid-cols-3' : 'sm:grid-cols-1'}`}>
					<button
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
			{#if hasSuspicious}
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
							<select
							class="mt-3 w-full rounded-xl border border-slate-600 bg-[#0f1322] px-4 py-3 pr-12 text-base text-slate-100 shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 appearance-none"
							bind:value={selectedSource}
							style="background-image: linear-gradient(45deg, transparent 50%, #94a3b8 50%), linear-gradient(135deg, #94a3b8 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 12px) 50%; background-size: 6px 6px, 6px 6px; background-repeat: no-repeat;"
						>
							<option value="">Elegí un alumno</option>
							{#each otherClients as c}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
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
