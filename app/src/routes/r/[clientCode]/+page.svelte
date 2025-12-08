<script lang="ts">
	import { WEEK_DAYS, getTargetSets } from '$lib/routines';
	import type { ProgressState, RoutinePlan } from '$lib/types';

	let { data } = $props();

	let plan: RoutinePlan = data.status === 'ok' ? data.plan : ({} as RoutinePlan);
	let progress: ProgressState = $state(
		data.status === 'ok' ? structuredClone(data.progress) : ({} as ProgressState)
	);
	let expanded = $state<Record<string, boolean>>({});
	let saving = $state(false);
	let message = $state('');
	let showResetConfirm = $state(false);

	const adjustSets = (dayKey: string, exerciseId: string, delta: number) => {
		const dayPlan = plan[dayKey];
		const exercise = dayPlan.exercises.find((ex) => ex.id === exerciseId);
		if (!exercise) return;

		const target = Math.max(1, getTargetSets(exercise) || 0);
		const current = progress[dayKey]?.exercises?.[exerciseId] ?? 0;
		const nextValue = Math.min(Math.max(current + delta, 0), target);

		progress[dayKey] = {
			...(progress[dayKey] ?? { completed: false, exercises: {} }),
			exercises: { ...(progress[dayKey]?.exercises ?? {}), [exerciseId]: nextValue }
		};

		const allDone = dayPlan.exercises.every((ex) => {
			const t = Math.max(1, getTargetSets(ex) || 0);
			const done = progress[dayKey].exercises?.[ex.id] ?? 0;
			return done >= t;
		});

		progress[dayKey].completed = allDone;
		saveProgress();
	};

	const toggleDayComplete = (dayKey: string) => {
		progress[dayKey] = {
			...(progress[dayKey] ?? { exercises: {} }),
			completed: !progress[dayKey]?.completed
		};
		saveProgress();
	};

	const toggleExpanded = (dayKey: string) => {
		expanded = { ...expanded, [dayKey]: !expanded[dayKey] };
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

	const resetProgress = async () => {
		saving = true;
		message = '';
		const formData = new FormData();
		formData.set('reset', 'true');
		const res = await fetch('?/resetProgress', { method: 'POST', body: formData });
		if (res.ok) {
			const data = await res.json();
			if (data?.progress) {
				progress = data.progress as ProgressState;
			} else {
				const cleared: ProgressState = {} as ProgressState;
				for (const day of WEEK_DAYS) {
					cleared[day.key] = { completed: false, exercises: {} };
				}
				progress = cleared;
			}
			message = 'Contadores reiniciados';
		} else {
			message = 'No se pudo reiniciar. Intentá de nuevo.';
		}
		saving = false;
		showResetConfirm = false;
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
	<section class="client-shell">
		<header class="hero">
			<h1>Rutina de Entrenamiento</h1>
			<p>{data.clientName}</p>
			{#if data.objective}
				<p class="objective">{data.objective}</p>
			{/if}
		</header>

		<div class="days">
			{#each WEEK_DAYS as day}
				{#if plan[day.key]}
					<article class={`day-card ${expanded[day.key] ? 'is-open' : ''} ${progress[day.key]?.completed ? 'is-done' : ''}`}>
						<button class="day-header" type="button" onclick={() => toggleExpanded(day.key)}>
							<div class="day-left">
								<span class="day-name">{day.label}</span>
								{#if progress[day.key]?.completed}
									<span class="badge success">Día completado</span>
								{/if}
							</div>
							<span class="arrow">{expanded[day.key] ? '▾' : '▸'}</span>
						</button>

						{#if expanded[day.key]}
							<div class="day-body">
								{#if plan[day.key].exercises.length === 0}
									<div class="exercise-card empty">No hay ejercicios configurados para este día.</div>
								{:else}
									{#each plan[day.key].exercises as exercise (exercise.id)}
										<div class="exercise-card">
											<div class="exercise-head">
												<div>
													<p class="exercise-name">{exercise.name}</p>
													<p class="exercise-scheme">{exercise.scheme}</p>
												</div>
												{#if (progress[day.key]?.exercises?.[exercise.id] ?? 0) >= Math.max(1, getTargetSets(exercise) || 0)}
													<span class="badge success">Completado</span>
												{/if}
											</div>
											{#if exercise.note}
												<p class="exercise-note">{exercise.note}</p>
											{/if}
											<div class="exercise-controls">
												<button class="pill-btn" type="button" onclick={() => adjustSets(day.key, exercise.id, -1)}>−</button>
												<div class="sets">
													<span class="sets-done">{progress[day.key]?.exercises?.[exercise.id] ?? 0}</span>
													<span class="sets-separator">/</span>
													<span class="sets-total">{Math.max(1, getTargetSets(exercise) || 0)}</span>
												</div>
												<button class="pill-btn" type="button" onclick={() => adjustSets(day.key, exercise.id, 1)}>+</button>
											</div>
										</div>
									{/each}
								{/if}
								<div class="day-footer">
									<button class={`day-toggle ${progress[day.key]?.completed ? 'secondary' : ''}`} type="button" onclick={() => toggleDayComplete(day.key)}>
										{progress[day.key]?.completed ? 'Marcar como pendiente' : 'Marcar día completo'}
									</button>
								</div>
							</div>
						{/if}
					</article>
				{/if}
			{/each}
		</div>

		{#if message}
			<p class="feedback success">{message}</p>
		{:else if saving}
			<p class="feedback muted">Guardando...</p>
		{/if}

		<button class="reset-btn" type="button" onclick={() => (showResetConfirm = true)}>
			Reiniciar contadores
		</button>

		{#if showResetConfirm}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<div class="modal">
					<h2>Reiniciar contadores</h2>
					<p>Al confirmar, reiniciarás todas las series y días completados. ¿Querés continuar?</p>
					<div class="modal-actions">
						<button class="btn ghost" type="button" onclick={() => (showResetConfirm = false)}>
							Cancelar
						</button>
						<button class="btn danger" type="button" onclick={resetProgress}>
							Confirmar
						</button>
					</div>
				</div>
			</div>
		{/if}
	</section>
{/if}

<style>
	:global(body) {
		background: #0d0f14;
		color: #e4e7ec;
	}
	.client-shell {
		max-width: 960px;
		margin: 0 auto;
		padding: 1.5rem 1.25rem 2rem;
	}
	.hero {
		background: #121420;
		border: 1px solid #1f2333;
		border-radius: 16px;
		padding: 1.25rem;
		box-shadow: 0 15px 45px rgba(0, 0, 0, 0.35);
		text-align: center;
		margin-bottom: 1rem;
	}
	.hero h1 {
		margin: 0;
		font-size: 1.6rem;
		font-weight: 700;
		color: #f7f8fb;
	}
	.hero p {
		margin: 0.15rem 0;
		color: #c4c8d4;
	}
	.hero .objective {
		font-size: 0.95rem;
		color: #9aa0b6;
	}
	.days {
		display: grid;
		gap: 0.75rem;
	}
	.day-card {
		border: 1px solid #1f2333;
		background: #0f111b;
		border-radius: 14px;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
		overflow: hidden;
	}
	.day-card.is-done {
		border-color: #1f3224;
	}
	.day-header {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
		background: transparent;
		color: #e4e7ec;
		padding: 0.9rem 1rem;
		border: none;
		cursor: pointer;
	}
	.day-header:focus-visible {
		outline: 2px solid #22c55e;
	}
	.day-left {
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}
	.day-name {
		font-weight: 700;
	}
	.arrow {
		color: #7a8197;
		font-size: 1.1rem;
	}
	.badge {
		border-radius: 999px;
		padding: 0.2rem 0.65rem;
		font-size: 0.75rem;
		font-weight: 700;
	}
	.badge.success {
		background: #163820;
		color: #3fdd77;
		border: 1px solid #1f7c42;
	}
	.day-body {
		padding: 0.75rem 1rem 1rem;
		background: #0b0d14;
		border-top: 1px solid #1f2333;
		display: grid;
		gap: 0.75rem;
	}
	.exercise-card {
		background: #111423;
		border: 1px solid #1f2333;
		border-radius: 12px;
		padding: 0.75rem;
		box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.01);
	}
	.exercise-card.empty {
		text-align: center;
		color: #9aa0b6;
	}
	.exercise-head {
		display: flex;
		justify-content: space-between;
		align-items: flex-start;
		gap: 0.5rem;
	}
	.exercise-name {
		margin: 0;
		font-weight: 700;
		color: #f7f8fb;
	}
	.exercise-scheme {
		margin: 0.1rem 0 0;
		color: #c4c8d4;
		font-size: 0.95rem;
	}
	.exercise-note {
		margin: 0.35rem 0 0;
		color: #9aa0b6;
		font-size: 0.85rem;
		font-style: italic;
	}
	.exercise-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 0.65rem;
	}
	.pill-btn {
		width: 46px;
		height: 46px;
		border-radius: 12px;
		border: 1px solid #27304a;
		background: linear-gradient(180deg, #12172c 0%, #0f1425 100%);
		color: #dce3ff;
		font-size: 1.3rem;
		font-weight: 800;
		cursor: pointer;
		box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
		transition: transform 0.08s ease, box-shadow 0.1s ease;
	}
	.pill-btn:hover {
		transform: translateY(-1px);
		box-shadow: 0 8px 16px rgba(0, 0, 0, 0.3);
	}
	.pill-btn:active {
		transform: translateY(0);
	}
	.sets {
		display: flex;
		align-items: baseline;
		gap: 0.3rem;
		font-weight: 800;
		color: #38e37c;
	}
	.sets-total {
		color: #c4c8d4;
	}
	.sets-separator {
		color: #5b647a;
		font-weight: 600;
	}
	.day-footer {
		display: flex;
		justify-content: flex-end;
	}
	.day-toggle {
		border: none;
		border-radius: 12px;
		padding: 0.65rem 1rem;
		font-weight: 700;
		background: #22c55e;
		color: #0c141d;
		cursor: pointer;
	}
	.day-toggle.secondary {
		background: #1e293b;
		color: #dce3ff;
	}
	.feedback {
		margin-top: 1rem;
		padding: 0.75rem 1rem;
		border-radius: 12px;
		text-align: center;
	}
	.feedback.success {
		background: #163820;
		color: #3fdd77;
		border: 1px solid #1f7c42;
	}
	.feedback.muted {
		background: #0f111b;
		color: #9aa0b6;
		border: 1px solid #1f2333;
	}
	.reset-btn {
		width: 100%;
		margin-top: 0.75rem;
		background: #111423;
		color: #e4e7ec;
		border: 1px solid #1f2333;
		border-radius: 12px;
		padding: 0.75rem 1rem;
		font-weight: 700;
		cursor: pointer;
		box-shadow: 0 10px 30px rgba(0, 0, 0, 0.25);
	}
	.reset-btn:hover {
		background: #15192a;
	}
	.modal-backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.55);
		display: grid;
		place-items: center;
		padding: 1rem;
		z-index: 50;
		backdrop-filter: blur(3px);
	}
	.modal {
		background: #0f111b;
		border: 1px solid #1f2333;
		color: #e4e7ec;
		padding: 1.25rem;
		border-radius: 16px;
		max-width: 420px;
		width: 100%;
		box-shadow: 0 20px 45px rgba(0, 0, 0, 0.4);
	}
	.modal h2 {
		margin: 0 0 0.35rem 0;
		font-size: 1.2rem;
	}
	.modal p {
		margin: 0;
		color: #c4c8d4;
	}
	.modal-actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.75rem;
		margin-top: 1rem;
	}
	.btn {
		border: 1px solid transparent;
		border-radius: 10px;
		padding: 0.6rem 0.9rem;
		font-weight: 700;
		cursor: pointer;
	}
	.btn.ghost {
		background: #111423;
		color: #c4c8d4;
		border-color: #1f2333;
	}
	.btn.danger {
		background: #b4231b;
		color: #fff;
		border-color: #e54848;
	}

	@media (min-width: 768px) {
		.client-shell {
			padding: 2rem 1.5rem 2.5rem;
		}
	}
</style>
