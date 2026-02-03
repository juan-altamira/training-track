<script lang="ts">
	import { WEEK_DAYS, getTargetSets } from '$lib/routines';
	import type { ProgressState, RoutineExercise, RoutinePlan } from '$lib/types';

	let { data } = $props();

	let plan: RoutinePlan = $state(structuredClone(data.plan));
	let progress: ProgressState = $state(structuredClone(data.progress));
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
	const MAX_EXERCISES_PER_DAY = 50;
	const otherClients = data.otherClients ?? [];
	const hasSuspicious = WEEK_DAYS.some((d) => progress[d.key]?.suspicious && progress[d.key]?.completed);

	const SITE_URL = (data.siteUrl ?? '').replace(/\/?$/, '');
	const link = `${SITE_URL}/r/${data.client.client_code}`;

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

	const saveRoutine = async () => {
		saving = true;
		feedback = '';
		showValidationErrors = true;
		
		// Validar todos los días antes de guardar
		for (const day of WEEK_DAYS) {
			const exercises = plan[day.key].exercises;
			if (exercises.length === 0) continue;
			
			for (const ex of exercises) {
				if (!ex.name || ex.name.trim() === '') {
					feedback = `${day.label}: Hay ejercicios sin nombre. Completá el nombre antes de guardar.`;
					feedbackType = 'warning';
					saving = false;
					return;
				}
				if (ex.name.length > MAX_EXERCISE_NAME_LENGTH) {
					feedback = `${day.label}: El nombre "${ex.name.slice(0, 20)}..." es demasiado largo.`;
					feedbackType = 'warning';
					saving = false;
					return;
				}
				const sets = getTargetSets(ex);
				if (sets === 0) {
					feedback = `${day.label}: "${ex.name}" no tiene series. Completá el campo Series.`;
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
		const res = await fetch('?/saveRoutine', {
			method: 'POST',
			body: formData
		});
		if (res.ok) {
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
			statusMessage = status === 'active' ? 'Cliente reactivado' : 'Cliente archivado (verá acceso desactivado)';
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
		
		// Detectar si la rutina fue modificada después del progreso
		const hasInconsistency = deletedExercises.length > 0 || 
			currentExercises.some(ex => ex.done > ex.target);
		
		return { exercises: allExercises, totalSeries, doneSeries, hasInconsistency };
	};

	const toggleDayDetail = (dayKey: string) => {
		expandedDay = expandedDay === dayKey ? null : dayKey;
	};
</script>

<section class="space-y-6 text-slate-100">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<h1 class="text-3xl font-extrabold tracking-wide text-slate-50">{data.client.name}</h1>
		</div>
		<div class="flex w-full flex-col gap-4">
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
					onclick={() => {
						selectedSource = '';
						showCopyModal = true;
					}}
				>
					Copiar rutina de otro cliente
				</button>
			</div>
			<div class="flex flex-col md:flex-row items-stretch md:items-center gap-3 justify-between">
				{#if clientStatus === 'active'}
					<button
						class="w-full md:w-1/2 rounded-2xl border border-amber-500/60 bg-gradient-to-r from-amber-700 to-orange-600 px-5 py-3 text-base font-semibold text-amber-50 shadow-lg shadow-amber-900/30 transition hover:-translate-y-0.5 hover:shadow-amber-900/50 hover:brightness-110"
						type="button"
						onclick={() => (showArchiveConfirm = true)}
					>
						Desactivar cliente
					</button>
				{:else}
					<button
						class="w-full md:w-1/2 rounded-2xl border border-emerald-500/60 bg-gradient-to-r from-emerald-700 to-green-600 px-5 py-3 text-base font-semibold text-emerald-50 shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:shadow-emerald-900/50 hover:brightness-110"
						type="button"
						onclick={() => setStatus('active')}
					>
						Reactivar cliente
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
					Eliminar cliente
				</button>
			</div>
		</div>
	</div>

		<div class="flex items-center gap-3">
		<a
			href="/clientes"
			class="inline-flex items-center gap-2 rounded-2xl border border-slate-700 bg-gradient-to-r from-[#151827] to-[#0f162b] px-4 py-2.5 text-base text-slate-100 shadow-md shadow-black/30 transition hover:-translate-y-0.5 hover:border-emerald-600 hover:shadow-emerald-900/30"
		>
			<span aria-hidden="true" class="text-lg leading-none">↩︎</span>
			<span>Volver al panel</span>
		</a>
	</div>

	{#if statusMessage}
		<p class="rounded-lg bg-[#151827] px-3 py-2 text-sm text-emerald-200 border border-emerald-700/40">{statusMessage}</p>
	{/if}

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-5 rounded-2xl border border-slate-800 bg-[#0f111b] p-4 md:p-6 shadow-lg shadow-black/30">
			<div class="flex items-center justify-between">
				<h2 class="text-3xl font-extrabold uppercase tracking-wide text-slate-50">Rutina</h2>
				<button
					class="save-cta rounded-lg bg-[#1c2338] px-4 py-2.5 text-base font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
					onclick={saveRoutine}
					disabled={saving}
				>
					<span>{saving ? 'Guardando...' : 'Guardar cambios'}</span>
				</button>
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

			<div class="flex flex-wrap gap-2">
				{#each WEEK_DAYS as day}
					<button
						type="button"
						class={`rounded-full px-4 py-2 text-base border ${
							selectedDay === day.key
								? 'bg-[#16223d] text-white border-slate-600'
								: 'bg-[#070c1d] text-slate-300 border-[#0f162b] hover:bg-[#0d152b]'
						}`}
						onclick={() => (selectedDay = day.key)}
					>
						{day.label}
					</button>
				{/each}
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
										oninput={(e) =>
											updateExercise(selectedDay, exercise.id, 'name', (e.target as HTMLInputElement).value)}
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

				<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
					<button
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base font-medium text-slate-100 hover:bg-[#1b1f30] disabled:opacity-50 disabled:cursor-not-allowed"
						onclick={() => addExercise(selectedDay)}
						type="button"
						disabled={plan[selectedDay].exercises.length >= MAX_EXERCISES_PER_DAY}
					>
						+ Agregar ejercicio
					</button>
					<button
						class="save-cta rounded-lg bg-[#1c2338] px-4 py-3 text-base font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
						onclick={saveRoutine}
						disabled={saving || plan[selectedDay].exercises.length === 0}
					>
						<span>{saving ? 'Guardando...' : 'Guardar cambios'}</span>
					</button>
					<button
						class="rounded-lg border border-amber-600/50 bg-amber-900/40 px-4 py-3 text-base font-medium text-amber-200 hover:bg-amber-900/60"
						onclick={() => (showResetConfirm = true)}
						type="button"
					>
						Resetear progreso
					</button>
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

		<div class="space-y-3">
			<div class="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0f172a] to-[#0b1224] p-4 md:p-6 shadow-lg shadow-black/30 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">Link de la rutina</p>
						<p class="mt-1 text-base font-semibold text-emerald-200 break-all">{link}</p>
						<p class="mt-2 text-xs text-white">El cliente accede sin login; si está archivado verá “acceso desactivado”.</p>
					</div>
				</div>
			</div>

			<div class="rounded-2xl border border-slate-800 bg-[#0f111b] p-4 md:p-6 shadow-lg shadow-black/30">
				<div class="flex items-center justify-between">
					<div class="flex flex-col gap-1">
						<h3 class="text-xl font-semibold uppercase tracking-wide text-slate-50">Semana actual</h3>
					</div>
				</div>
				<ul class="mt-3 space-y-3 text-base text-slate-200">
					{#each WEEK_DAYS as day}
						{#if plan[day.key] && plan[day.key].exercises.length > 0}
							{@const completion = dayCompletion(day.key)}
							<li class="rounded-lg border border-slate-800 bg-[#111423] overflow-hidden">
								<div class="flex flex-wrap items-center gap-4 justify-between px-4 py-3">
									<div class="mr-auto">
										<p class="font-semibold">{day.label}</p>
										<p class="text-sm text-slate-400 mb-1">
											{completion.done}/{completion.total} ejercicios completos
										</p>
									</div>
									<span
										class={`rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap ${
											progress[day.key]?.suspicious && completion.completed
												? 'bg-amber-900/50 text-amber-200'
												: completion.completed
													? 'bg-emerald-900/50 text-emerald-300'
													: 'bg-slate-800 text-slate-300'
										}`}
									>
										{progress[day.key]?.suspicious && completion.completed
											? 'Posible engaño'
											: completion.completed
												? 'Completado'
												: 'En progreso'}
									</span>
									<button
										type="button"
										class="flex items-center gap-1 text-sm text-slate-400 hover:text-slate-200 transition-colors"
										onclick={() => toggleDayDetail(day.key)}
									>
										<span>{expandedDay === day.key ? 'Ocultar' : 'Ver detalle'}</span>
										<svg class="w-4 h-4 transition-transform {expandedDay === day.key ? 'rotate-180' : ''}" fill="none" stroke="currentColor" viewBox="0 0 24 24">
											<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
										</svg>
									</button>
								</div>
								{#if expandedDay === day.key}
									{@const details = getExerciseDetails(day.key)}
									<div class="border-t border-slate-800 bg-[#0d1019] px-4 py-3 space-y-1">
										<p class="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Detalle</p>
										<div class="divide-y divide-slate-800/60">
											{#each details.exercises as ex}
												<div class="grid grid-cols-[1fr_auto] gap-3 items-center py-2 hover:bg-slate-800/30 -mx-2 px-2 rounded transition-colors">
													<span class="text-sm {ex.exists ? 'text-slate-200' : 'text-slate-500 italic'} line-clamp-2">{ex.name}</span>
													<span class="inline-flex items-center gap-1 text-sm font-medium px-2 py-0.5 rounded {ex.complete ? 'bg-emerald-900/40 text-emerald-300' : 'bg-slate-800/60 text-slate-400'}">
														{ex.done}/{ex.target}
														{#if ex.complete}
															<svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
																<path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7" />
															</svg>
														{/if}
													</span>
												</div>
											{/each}
										</div>
										<div class="grid grid-cols-[1fr_auto] gap-3 items-center pt-3 mt-2 border-t border-slate-700">
											<span class="text-sm font-medium text-slate-400">Total</span>
											<span class="text-sm font-semibold text-slate-200">{details.doneSeries}/{details.totalSeries} series</span>
										</div>
										{#if details.hasInconsistency}
											<p class="text-xs text-amber-400/80 mt-2">
												La rutina fue modificada después del progreso registrado.
											</p>
										{/if}
									</div>
								{/if}
							</li>
						{/if}
					{/each}
				</ul>
				{#if hasSuspicious}
					<p class="mt-3 text-sm text-amber-200">
						Posible engaño significa que el cliente marcó todas las series del día en menos de 60 segundos. Es posible que las haya marcado sin haber entrenado.
					</p>
				{/if}
			</div>

			<div class="rounded-2xl border border-slate-800 bg-[#0f111b] p-4 shadow-lg shadow-black/30 text-sm text-slate-300">
				<p class="font-semibold text-slate-100">Última actualización</p>
				<p class="mt-1 text-slate-400">
					{#if data.last_completed_at}
						{new Date(data.last_completed_at).toLocaleString()}
					{:else}
						—
					{/if}
				</p>
			</div>
		</div>
	</section>

	{#if showDeleteConfirm}
		<div class="fixed inset-0 z-50 grid place-items-center bg-black/60 backdrop-blur-sm px-4">
			<div class="w-full max-w-md rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-2xl shadow-black/40 text-slate-100">
				<div class="space-y-2">
					<h2 class="text-xl font-semibold text-red-200">Eliminar cliente</h2>
					<p class="text-sm text-slate-300">
						Para eliminar al cliente <span class="font-semibold">{data.client.name}</span> definitivamente,
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
					<h2 class="text-xl font-semibold text-amber-200">Desactivar cliente</h2>
					<p class="text-sm text-slate-300">¿Estás seguro que deseas desactivar el acceso a este cliente?</p>
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
							Copiar rutina desde otro cliente
						</span>
					</h2>
					<p class="mt-6 mb-8 text-sm text-amber-200 flex items-center justify-center gap-2">
						⚠️ Esto reemplaza la rutina actual. El progreso se reiniciará para este cliente. ⚠️
					</p>
				</div>
				{#if otherClients.length > 0}
					<label class="block text-sm font-medium text-slate-200 mt-6">
						Seleccioná desde qué cliente querés copiar
						<select
							class="mt-3 w-full rounded-xl border border-slate-600 bg-[#0f1322] px-4 py-3 pr-12 text-base text-slate-100 shadow-inner focus:border-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-600 appearance-none"
							bind:value={selectedSource}
							style="background-image: linear-gradient(45deg, transparent 50%, #94a3b8 50%), linear-gradient(135deg, #94a3b8 50%, transparent 50%); background-position: calc(100% - 18px) 50%, calc(100% - 12px) 50%; background-size: 6px 6px, 6px 6px; background-repeat: no-repeat;"
						>
							<option value="">Elegí un cliente</option>
							{#each otherClients as c}
								<option value={c.id}>{c.name}</option>
							{/each}
						</select>
					</label>
				{:else}
					<p class="text-sm text-slate-400">No tenés otros clientes para copiar.</p>
				{/if}
				<div class="flex justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						onclick={() => {
							showCopyModal = false;
							selectedSource = '';
						}}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="rounded-lg bg-emerald-600 px-4 py-2 text-white shadow-md shadow-emerald-900/40 transition hover:bg-emerald-500 disabled:opacity-60 disabled:cursor-not-allowed"
						disabled={!selectedSource}
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
