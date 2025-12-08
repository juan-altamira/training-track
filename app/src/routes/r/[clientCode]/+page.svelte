<script lang="ts">
	import { WEEK_DAYS, getTargetSets } from '$lib/routines';
	import type { ProgressState, RoutinePlan } from '$lib/types';

let { data } = $props();

let plan: RoutinePlan = data.status === 'ok' ? data.plan : ({} as RoutinePlan);
let progress: ProgressState = $state(
	data.status === 'ok' ? structuredClone(data.progress) : ({} as ProgressState)
);

let saving = $state(false);
let message = $state('');

	const adjustSets = (dayKey: string, exerciseId: string, delta: number) => {
		const dayPlan = plan[dayKey];
		const exercise = dayPlan.exercises.find((ex) => ex.id === exerciseId);
		if (!exercise) return;

		const target = Math.max(1, getTargetSets(exercise) || 0);
		const current = progress[dayKey]?.exercises?.[exerciseId] ?? 0;
		const nextValue = Math.min(Math.max(current + delta, 0), target);

		progress = {
			...progress,
			[dayKey]: {
				...(progress[dayKey] ?? { completed: false, exercises: {} }),
				exercises: { ...(progress[dayKey]?.exercises ?? {}), [exerciseId]: nextValue }
			}
		};

		const allDone = dayPlan.exercises.every((ex) => {
			const t = Math.max(1, getTargetSets(ex) || 0);
			const done = progress[dayKey].exercises?.[ex.id] ?? 0;
			return done >= t;
		});

		progress[dayKey].completed = allDone;
		saveProgress();
	};

	const toggleDay = (dayKey: string, completed: boolean) => {
		progress = {
			...progress,
			[dayKey]: { ...(progress[dayKey] ?? { exercises: {} }), completed }
		};
		saveProgress();
	};

	const saveProgress = async () => {
		saving = true;
		message = '';
		const formData = new FormData();
		formData.set('progress', JSON.stringify(progress));
		const res = await fetch('?/saveProgress', {
			method: 'POST',
			body: formData
		});
		if (!res.ok) {
			message = 'No se pudo guardar. Revisá tu conexión.';
		} else {
			message = 'Progreso guardado';
		}
		saving = false;
	};
</script>

{#if data.status === 'invalid'}
	<section class="mx-auto max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
		<h1 class="text-xl font-semibold text-slate-900">Link inválido</h1>
		<p class="text-sm text-slate-600">Pedile a tu entrenador que te envíe un link nuevo.</p>
	</section>
{:else if data.status === 'disabled'}
	<section class="mx-auto max-w-xl space-y-3 rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-sm">
		<h1 class="text-xl font-semibold text-slate-900">Acceso desactivado</h1>
		<p class="text-sm text-slate-600">
			{data.clientName ? `${data.clientName}, ` : ''}consultá a tu entrenador para reactivar tu acceso.
		</p>
	</section>
{:else}
	<section class="space-y-5">
		<div class="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
			<p class="text-sm font-semibold uppercase tracking-wide text-slate-500">Rutina de</p>
			<h1 class="text-2xl font-semibold text-slate-900">{data.clientName}</h1>
			<p class="text-sm text-slate-600">{data.objective ?? 'Entrenamiento semanal'}</p>
			{#if data.last_completed_at}
				<p class="mt-1 text-xs text-slate-500">
					Última actualización: {new Date(data.last_completed_at).toLocaleString()}
				</p>
			{/if}
		</div>

		<div class="space-y-3">
			{#each WEEK_DAYS as day}
				{#if plan[day.key]}
					<div class="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
						<div class="flex items-center justify-between">
							<div>
								<p class="text-lg font-semibold text-slate-900">{day.label}</p>
								<p class="text-xs text-slate-600">
									{progress[day.key]?.completed ? 'Día completado' : 'Marcá tus series para completar el día'}
								</p>
							</div>
							<label class="flex items-center gap-2 text-sm text-slate-700">
								<input
									type="checkbox"
									checked={progress[day.key]?.completed}
									on:change={(e) => toggleDay(day.key, (e.target as HTMLInputElement).checked)}
								/>
								Día completo
							</label>
						</div>
						<div class="mt-3 space-y-3">
							{#if plan[day.key].exercises.length === 0}
								<p class="text-sm text-slate-600">No hay ejercicios asignados.</p>
							{:else}
								{#each plan[day.key].exercises as exercise (exercise.id)}
									<div class="rounded-lg border border-slate-100 bg-slate-50 p-3">
										<div class="flex flex-wrap items-center justify-between gap-2">
											<div>
												<p class="text-sm font-semibold text-slate-900">{exercise.name}</p>
												<p class="text-xs text-slate-600">{exercise.scheme}</p>
												{#if exercise.note}
													<p class="text-xs text-slate-500 mt-1">{exercise.note}</p>
												{/if}
											</div>
											<div class="flex items-center gap-2">
												<button
													class="h-9 w-9 rounded-full border border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-100"
													type="button"
													on:click={() => adjustSets(day.key, exercise.id, -1)}
												>
													-
												</button>
												<div class="min-w-[90px] text-center">
													<p class="text-sm font-semibold text-slate-900">
														{progress[day.key]?.exercises?.[exercise.id] ?? 0}
														/ {Math.max(1, getTargetSets(exercise) || 0)} series
													</p>
													<p class="text-xs text-slate-500">Hechas</p>
												</div>
												<button
													class="h-9 w-9 rounded-full border border-slate-200 bg-white text-lg font-bold text-slate-700 hover:bg-slate-100"
													type="button"
													on:click={() => adjustSets(day.key, exercise.id, 1)}
												>
													+
												</button>
											</div>
										</div>
									</div>
								{/each}
							{/if}
						</div>
					</div>
				{/if}
			{/each}
		</div>

		{#if message}
			<p class="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{message}</p>
		{:else if saving}
			<p class="text-sm text-slate-500">Guardando...</p>
		{/if}
	</section>
{/if}
