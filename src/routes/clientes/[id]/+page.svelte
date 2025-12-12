<script lang="ts">
import { WEEK_DAYS, getTargetSets } from '$lib/routines';
import type { ProgressState, RoutineExercise, RoutinePlan } from '$lib/types';

let { data } = $props();

let plan: RoutinePlan = $state(structuredClone(data.plan));
let progress: ProgressState = $state(structuredClone(data.progress));
let selectedDay = $state(WEEK_DAYS[0].key);
let saving = $state(false);
let feedback = $state('');
let statusMessage = $state('');
let clientStatus = $state(data.client.status as 'active' | 'archived');
let showDeleteConfirm = $state(false);
let deleteConfirmText = $state('');
let showArchiveConfirm = $state(false);
let linkFeedback = $state('');
let showCopyModal = $state(false);
let selectedSource = $state('');
const MAX_EXERCISES_PER_DAY = 50;
const otherClients = data.otherClients ?? [];
const hasSuspicious = WEEK_DAYS.some((d) => progress[d.key]?.suspicious);

	const SITE_URL = (data.siteUrl ?? 'https://training-track.vercel.app').replace(/\/?$/, '');
	const link = `${SITE_URL}/r/${data.client.client_code}`;

	const freshProgress = (): ProgressState =>
		WEEK_DAYS.reduce((acc, day) => {
			acc[day.key] = { completed: false, exercises: {} };
			return acc;
		}, {} as ProgressState);

	const addExercise = (dayKey: string) => {
		const exercises = plan[dayKey].exercises;
		if (exercises.length >= MAX_EXERCISES_PER_DAY) {
			feedback = 'Límite de 50 ejercicios para este día.';
			setTimeout(() => (feedback = ''), 2500);
			return;
		}
		const newExercise: RoutineExercise = {
			id: crypto.randomUUID(),
			name: '',
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

	const copyLink = async () => {
		await navigator.clipboard.writeText(link);
		linkFeedback = 'Link copiado';
		setTimeout(() => (linkFeedback = ''), 2000);
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
			return target === 0 ? false : doneSets >= target;
		}).length;
		return { total, done, completed: state.completed };
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
					on:click={copyLink}
				>
					Copiar link de la rutina
				</button>
				<button
					class="w-full md:w-1/2 rounded-2xl border border-cyan-700/40 bg-gradient-to-r from-cyan-700 to-sky-600 px-5 py-3 text-base font-semibold text-white shadow-lg shadow-cyan-900/30 transition hover:-translate-y-0.5 hover:shadow-cyan-900/50 hover:brightness-110"
					type="button"
					on:click={() => {
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
						on:click={() => (showArchiveConfirm = true)}
					>
						Archivar cliente
					</button>
				{:else}
					<button
						class="w-full md:w-1/2 rounded-2xl border border-emerald-500/60 bg-gradient-to-r from-emerald-700 to-green-600 px-5 py-3 text-base font-semibold text-emerald-50 shadow-lg shadow-emerald-900/30 transition hover:-translate-y-0.5 hover:shadow-emerald-900/50 hover:brightness-110"
						type="button"
						on:click={() => setStatus('active')}
					>
						Reactivar cliente
					</button>
				{/if}
				<button
					class="w-full md:w-1/2 rounded-2xl border border-red-700/70 bg-gradient-to-r from-red-800 to-rose-700 px-5 py-3 text-base font-semibold text-red-50 shadow-lg shadow-red-900/30 transition hover:-translate-y-0.5 hover:shadow-red-900/50 hover:brightness-110"
					type="button"
					on:click={() => {
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

	{#if linkFeedback}
		<div class="fixed top-6 right-6 z-40 rounded-lg border border-emerald-700/40 bg-emerald-900/70 px-4 py-3 text-sm font-semibold text-emerald-100 shadow-lg shadow-black/40">
			{linkFeedback}
		</div>
	{/if}

	<section class="grid gap-6 lg:grid-cols-[2fr,1fr]">
		<div class="space-y-5 rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-lg shadow-black/30">
			<div class="flex items-center justify-between">
				<h2 class="text-3xl font-extrabold uppercase tracking-wide text-slate-50">Rutina</h2>
				<button
					class="save-cta rounded-lg bg-[#1c2338] px-4 py-2.5 text-base font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
					on:click={saveRoutine}
					disabled={saving}
				>
					<span>{saving ? 'Guardando...' : 'Guardar cambios'}</span>
				</button>
			</div>

			<div class="flex flex-wrap gap-2">
				{#each WEEK_DAYS as day}
					<button
						type="button"
						class={`rounded-full px-4 py-2 text-base border ${
							selectedDay === day.key
								? 'bg-[#16223d] text-white border-slate-600'
								: 'bg-[#070c1d] text-slate-300 border-[#0f162b] hover:bg-[#0d152b]'
						}`}
						on:click={() => (selectedDay = day.key)}
					>
						{day.label}
					</button>
				{/each}
			</div>

			<div class="space-y-3 rounded-xl border border-slate-800 bg-[#0b0d14] p-5">
				{#if plan[selectedDay].exercises.length === 0}
					<p class="text-base text-slate-400">Sin ejercicios. Agregá uno.</p>
				{:else}
					{#each plan[selectedDay].exercises as exercise, index (exercise.id)}
						<div class="rounded-lg border border-slate-800 bg-[#111423] p-4 shadow-sm">
							<div class="flex flex-wrap items-center justify-between gap-2">
								<p class="text-base font-semibold text-slate-100">Ejercicio {index + 1}</p>
								<button
									class="rounded border border-red-700 bg-red-900/40 px-2.5 py-1.5 text-sm text-red-200 hover:bg-red-900/60"
									on:click={() => removeExercise(selectedDay, exercise.id)}
								>
									Quitar
								</button>
							</div>
							<div class="mt-3 grid gap-3 md:grid-cols-2">
								<label class="block text-sm font-medium text-slate-300">
									Nombre
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
										value={exercise.name}
										placeholder="Nuevo ejercicio"
										on:input={(e) =>
											updateExercise(selectedDay, exercise.id, 'name', (e.target as HTMLInputElement).value)}
									/>
								</label>
								<label class="block text-sm font-medium text-slate-300">
									Series/reps (texto)
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
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
								<label class="block text-sm font-medium text-slate-300">
									Series totales (para progreso)
									<input
										type="number"
										min="0"
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
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
								<label class="block text-sm font-medium text-slate-300">
									Nota (opcional)
									<input
										class="mt-1 w-full rounded-lg border border-slate-700 bg-[#151827] px-4 py-3 text-base text-slate-100 shadow-sm focus:border-slate-500 focus:outline-none focus:ring-2 focus:ring-slate-700"
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

				<div class="flex flex-wrap gap-3">
					<button
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2.5 text-base font-medium text-slate-100 hover:bg-[#1b1f30]"
						on:click={() => addExercise(selectedDay)}
						type="button"
						disabled={plan[selectedDay].exercises.length >= MAX_EXERCISES_PER_DAY}
					>
						+ Agregar ejercicio
					</button>
					{#if plan[selectedDay].exercises.length > 0}
						<button
							class="save-cta rounded-lg bg-[#1c2338] px-4 py-2.5 text-base font-medium text-slate-100 hover:bg-[#222b43] disabled:cursor-not-allowed disabled:opacity-70"
							on:click={saveRoutine}
							disabled={saving}
						>
							<span>{saving ? 'Guardando...' : 'Guardar cambios'}</span>
						</button>
					{/if}
				</div>
			</div>

			{#if feedback}
				<p class="rounded-lg bg-emerald-900/40 px-4 py-2.5 text-base text-emerald-200 border border-emerald-700/50">{feedback}</p>
			{/if}
		</div>

		<div class="space-y-3">
			<div class="rounded-2xl border border-slate-800 bg-gradient-to-br from-[#0f172a] to-[#0b1224] p-6 shadow-lg shadow-black/30 space-y-3">
				<div class="flex items-center justify-between">
					<div>
						<p class="text-sm font-semibold uppercase tracking-[0.12em] text-slate-400">Link de la rutina</p>
						<p class="mt-1 text-base font-semibold text-emerald-200 break-all">{link}</p>
						<p class="mt-2 text-xs text-white">El cliente accede sin login; si está archivado verá “acceso desactivado”.</p>
					</div>
				</div>
			</div>

			<div class="rounded-2xl border border-slate-800 bg-[#0f111b] p-6 shadow-lg shadow-black/30">
				<div class="flex items-center justify-between">
					<div class="flex flex-col gap-1">
						<h3 class="text-xl font-semibold uppercase tracking-wide text-slate-50">Semana actual</h3>
					</div>
				</div>
				<ul class="mt-3 space-y-3 text-base text-slate-200">
					{#each WEEK_DAYS as day}
						{#if plan[day.key] && plan[day.key].exercises.length > 0}
							{@const completion = dayCompletion(day.key)}
							<li class="flex flex-wrap items-center gap-4 justify-between rounded-lg border border-slate-800 bg-[#111423] px-4 py-3">
								<div class="mr-auto">
									<p class="font-semibold">{day.label}</p>
									<p class="text-sm text-slate-400 mb-1">
										{completion.done}/{completion.total} ejercicios completos
									</p>
								</div>
								<span
									class={`rounded-full px-3.5 py-1.5 text-sm font-semibold whitespace-nowrap ${
										progress[day.key]?.suspicious
											? 'bg-amber-900/50 text-amber-200'
											: completion.completed
												? 'bg-emerald-900/50 text-emerald-300'
												: 'bg-slate-800 text-slate-300'
									}`}
								>
									{progress[day.key]?.suspicious
										? 'Posible engaño'
										: completion.completed
											? 'Completado'
											: 'En progreso'}
								</span>
							</li>
						{/if}
					{/each}
				</ul>
				{#if hasSuspicious}
					<p class="mt-3 text-sm text-amber-200">
						El cliente marcó todas las series del día en menos de 60 segundos. Es posible que las haya marcado sin haber entrenado.
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
							on:click={() => {
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
					<h2 class="text-xl font-semibold text-amber-200">Archivar cliente</h2>
					<p class="text-sm text-slate-300">¿Estás seguro que deseas archivar a este cliente?</p>
				</div>
				<div class="mt-5 flex items-center justify-end gap-3">
					<button
						type="button"
						class="rounded-lg border border-slate-700 bg-[#151827] px-4 py-2 text-slate-200 hover:bg-[#1b1f30]"
						on:click={() => (showArchiveConfirm = false)}
					>
						Cancelar
					</button>
					<button
						type="button"
						class="rounded-lg border border-amber-500/50 bg-amber-900/60 px-4 py-2 text-amber-100 hover:bg-amber-900/80"
						on:click={() => {
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
						on:click={() => {
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
						on:click={copyRoutine}
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
