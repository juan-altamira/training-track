<script lang="ts">
	import { PUBLIC_SITE_URL } from '$env/static/public';
	import { WEEK_DAYS, getTargetSets } from '$lib/routines';
	import type { ProgressState, RoutineExercise, RoutinePlan } from '$lib/types';

let { data } = $props();

let plan: RoutinePlan = $state(structuredClone(data.plan));
let progress: ProgressState = $state(structuredClone(data.progress));
let selectedDay = $state(WEEK_DAYS[0].key);
let saving = $state(false);
let feedback = $state('');
let statusMessage = $state('');

	const link = `${PUBLIC_SITE_URL.replace(/\/?$/, '')}/r/${data.client.client_code}`;

	const freshProgress = (): ProgressState =>
		WEEK_DAYS.reduce((acc, day) => {
			acc[day.key] = { completed: false, exercises: {} };
			return acc;
		}, {} as ProgressState);

	const addExercise = (dayKey: string) => {
		const exercises = plan[dayKey].exercises;
		const newExercise: RoutineExercise = {
			id: crypto.randomUUID(),
			name: 'Nuevo ejercicio',
			scheme: '3x10',
			order: exercises.length,
			totalSets: 3
		};
		plan = {
			...plan,
			[dayKey]: { ...plan[dayKey], exercises: [...exercises, newExercise] }
		};
	};

	const updateExercise = (dayKey: string, id: string, field: keyof RoutineExercise, value: string | number) => {
		const exercises = plan[dayKey].exercises.map((ex) =>
			ex.id === id ? { ...ex, [field]: value } : ex
		);
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises } };
	};

	const removeExercise = (dayKey: string, id: string) => {
		const exercises = plan[dayKey].exercises.filter((ex) => ex.id !== id);
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises } };
	};

	const moveExercise = (dayKey: string, id: string, direction: 'up' | 'down') => {
		const exercises = [...plan[dayKey].exercises];
		const index = exercises.findIndex((ex) => ex.id === id);
		if (index < 0) return;
		const targetIndex = direction === 'up' ? index - 1 : index + 1;
		if (targetIndex < 0 || targetIndex >= exercises.length) return;
		[exercises[index], exercises[targetIndex]] = [exercises[targetIndex], exercises[index]];
		const reordered = exercises.map((ex, idx) => ({ ...ex, order: idx }));
		plan = { ...plan, [dayKey]: { ...plan[dayKey], exercises: reordered } };
	};

	const copyLink = async () => {
		await navigator.clipboard.writeText(link);
		feedback = 'Link copiado';
		setTimeout(() => (feedback = ''), 2000);
	};

	const saveRoutine = async () => {
		saving = true;
		feedback = '';
		const formData = new FormData();
		formData.set('plan', JSON.stringify(plan));
		const res = await fetch('?/saveRoutine', {
			method: 'POST',
			body: formData
		});
		if (res.ok) {
			progress = freshProgress();
			feedback = 'Rutina guardada y progreso reseteado';
		} else {
			feedback = 'No pudimos guardar la rutina';
		}
		saving = false;
	};

	const resetProgress = async () => {
		const res = await fetch('?/resetProgress', { method: 'POST' });
		if (res.ok) {
			progress = freshProgress();
			feedback = 'Progreso reiniciado';
		}
	};

	const setStatus = async (status: 'active' | 'archived') => {
		const formData = new FormData();
		formData.set('status', status);
		const res = await fetch('?/setStatus', { method: 'POST', body: formData });
		if (res.ok) {
			data.client.status = status;
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
			return target === 0 ? false : doneSets >= target;
		}).length;
		return { total, done, completed: state.completed };
	};
</script>

<section class="space-y-6 text-slate-100">
	<div class="flex flex-wrap items-start justify-between gap-4">
		<div>
			<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Cliente</p>
			<h1 class="text-2xl font-semibold text-slate-50">{data.client.name}</h1>
			<p class="text-sm text-slate-400">{data.client.objective ?? 'Sin objetivo definido'}</p>
		</div>
		<div class="flex flex-wrap items-center gap-2">
			<button
				class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 hover:bg-[#1b1f30]"
				type="button"
				on:click={copyLink}
			>
				Copiar link público
			</button>
			{#if data.client.status === 'active'}
				<button
					class="rounded-lg border border-amber-500/50 bg-amber-900/40 px-3 py-2 text-sm text-amber-200 hover:bg-amber-900/60"
					type="button"
					on:click={() => setStatus('archived')}
				>
					Archivar (cliente verá acceso desactivado)
				</button>
			{:else}
				<button
					class="rounded-lg border border-emerald-500/50 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200 hover:bg-emerald-900/60"
					type="button"
					on:click={() => setStatus('active')}
				>
					Reactivar cliente
				</button>
			{/if}
		</div>
	</div>

	{#if statusMessage}
		<p class="rounded-lg bg-[#151827] px-3 py-2 text-sm text-emerald-200 border border-emerald-700/40">{statusMessage}</p>
	{/if}

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-4 rounded-2xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
			<div class="flex items-center justify-between">
				<div>
					<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Rutina</p>
					<h2 class="text-xl font-semibold text-slate-50">Edición rápida</h2>
				</div>
				<button
					class="rounded-lg bg-[#1c2338] px-4 py-2 text-sm font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
					on:click={saveRoutine}
					disabled={saving}
				>
					{saving ? 'Guardando...' : 'Guardar cambios'}
				</button>
			</div>

			<div class="flex flex-wrap gap-2">
				{#each WEEK_DAYS as day}
					<button
						type="button"
						class={`rounded-full px-3 py-1 text-sm border ${
							selectedDay === day.key
								? 'bg-[#1c2338] text-white border-slate-600'
								: 'bg-[#151827] text-slate-300 border-slate-800 hover:bg-[#1b1f30]'
						}`}
						on:click={() => (selectedDay = day.key)}
					>
						{day.label}
					</button>
				{/each}
			</div>

			<div class="space-y-3 rounded-xl border border-slate-800 bg-[#0b0d14] p-4">
				{#if plan[selectedDay].exercises.length === 0}
					<p class="text-sm text-slate-400">Sin ejercicios. Agregá uno.</p>
				{:else}
					{#each plan[selectedDay].exercises as exercise, index (exercise.id)}
						<div class="rounded-lg border border-slate-800 bg-[#111423] p-3 shadow-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="text-sm font-semibold text-slate-100">Ejercicio {index + 1}</p>
								<div class="flex items-center gap-1">
									<button
										class="rounded border border-slate-700 bg-[#151827] px-2 py-1 text-xs text-slate-200 hover:bg-[#1b1f30]"
										on:click={() => moveExercise(selectedDay, exercise.id, 'up')}
									>
										↑
									</button>
									<button
										class="rounded border border-slate-700 bg-[#151827] px-2 py-1 text-xs text-slate-200 hover:bg-[#1b1f30]"
										on:click={() => moveExercise(selectedDay, exercise.id, 'down')}
									>
										↓
									</button>
									<button
										class="rounded border border-red-700 bg-red-900/40 px-2 py-1 text-xs text-red-200 hover:bg-red-900/60"
										on:click={() => removeExercise(selectedDay, exercise.id)}
									>
										Quitar
									</button>
								</div>
							</div>
							<div class="mt-2 grid gap-3 md:grid-cols-2">
								<label class="block text-xs font-medium text-slate-300">
									Nombre
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.name}
										on:input={(e) =>
											updateExercise(selectedDay, exercise.id, 'name', (e.target as HTMLInputElement).value)}
									/>
								</label>
								<label class="block text-xs font-medium text-slate-300">
									Series/reps (texto)
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.scheme}
										on:input={(e) =>
											updateExercise(
												selectedDay,
												exercise.id,
												'scheme',
												(e.target as HTMLInputElement).value
											)}
									/>
								</label>
								<label class="block text-xs font-medium text-slate-300">
									Series totales (para progreso)
									<input
										type="number"
										min="0"
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.totalSets ?? getTargetSets(exercise)}
										on:input={(e) =>
											updateExercise(
												selectedDay,
												exercise.id,
												'totalSets',
												Number((e.target as HTMLInputElement).value)
											)}
									/>
								</label>
								<label class="block text-xs font-medium text-slate-300">
									Nota (opcional)
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.note ?? ''}
										on:input={(e) =>
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

				<button
					class="rounded-lg border border-slate-700 bg-[#151827] px-3 py-2 text-sm font-medium text-slate-100 hover:bg-[#1b1f30]"
					on:click={() => addExercise(selectedDay)}
					type="button"
				>
					+ Agregar ejercicio
				</button>
			</div>

			{#if feedback}
				<p class="rounded-lg bg-emerald-900/40 px-3 py-2 text-sm text-emerald-200 border border-emerald-700/50">{feedback}</p>
			{/if}
		</div>

		<div class="space-y-3">
			<div class="rounded-2xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
				<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Link público</p>
				<p class="text-sm text-slate-200 break-all">{link}</p>
				<p class="mt-2 text-xs text-slate-500">
					El cliente no necesita login. Si está archivado verá “acceso desactivado”.
				</p>
			</div>

			<div class="rounded-2xl border border-slate-800 bg-[#0f111b] p-5 shadow-lg shadow-black/30">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-semibold uppercase tracking-wide text-slate-400">Progreso</p>
						<h3 class="text-lg font-semibold text-slate-50">Semana actual</h3>
					</div>
				</div>
				<ul class="mt-3 space-y-2 text-sm text-slate-200">
					{#each WEEK_DAYS as day}
						{#if plan[day.key]}
							{@const completion = dayCompletion(day.key)}
							<li class="flex items-center justify-between rounded-lg border border-slate-800 bg-[#111423] px-3 py-2">
								<div>
									<p class="font-semibold">{day.label}</p>
									<p class="text-xs text-slate-400">
										{completion.done}/{completion.total} ejercicios completos
									</p>
								</div>
								<span
									class={`rounded-full px-3 py-1 text-xs font-semibold ${
										completion.completed ? 'bg-emerald-900/50 text-emerald-300' : 'bg-slate-800 text-slate-300'
									}`}
								>
									{completion.completed ? 'Completado' : 'En progreso'}
								</span>
							</li>
						{/if}
					{/each}
				</ul>
				{#if data.last_completed_at}
					<p class="mt-3 text-xs text-slate-500">
						Última actualización: {new Date(data.last_completed_at).toLocaleString()}
					</p>
				{/if}
			</div>
		</div>
	</section>
</section>
