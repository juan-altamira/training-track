<script lang="ts">
import {
	DAY_FEEDBACK_MOOD_LABEL,
	DAY_FEEDBACK_PAIN_LABEL,
	type DayFeedbackByDay,
	type DayFeedbackMood,
	type DayFeedbackPain,
	type DayFeedbackRow
} from '$lib/dayFeedback';
import { WEEK_DAYS, getTargetSets, formatPrescriptionLong } from '$lib/routines';
import type { ProgressState, RoutinePlan } from '$lib/types';

	let { data } = $props();

	let plan: RoutinePlan = data.status === 'ok' ? data.plan : ({} as RoutinePlan);
	let progress: ProgressState = $state(
		data.status === 'ok' ? structuredClone(data.progress) : ({} as ProgressState)
	);
	let dayFeedback: DayFeedbackByDay = $state(
		data.status === 'ok' ? structuredClone(data.dayFeedback) : ({} as DayFeedbackByDay)
	);
	let expanded = $state<Record<string, boolean>>({});
	let saving = $state(false);
	let message = $state('');
	let showResetConfirm = $state(false);
	let sessionStarts = $state<Record<string, string>>({});
	let firstSeriesTs = $state<Record<string, string>>({});
	let lastSeriesTs = $state<Record<string, string>>({});
	let baselineProgress = $state<Record<string, boolean>>({});
	let feedbackCardModeByDay = $state<Record<string, 'prompt' | 'form' | 'reminder' | 'saved'>>({});
	let feedbackSavingByDay = $state<Record<string, boolean>>({});
	let feedbackErrorByDay = $state<Record<string, string>>({});
	let feedbackDraftByDay = $state<Record<string, {
		mood: DayFeedbackMood | '';
		difficulty: string;
		pain: DayFeedbackPain | '';
		comment: string;
	}>>({});
	let saveTimeout: ReturnType<typeof setTimeout> | null = null;
	let pendingSaveDay: string | null = null;
	let saveInFlight = false;

	const emptyDayFeedbackByDay = (): DayFeedbackByDay =>
		WEEK_DAYS.reduce((acc, day) => {
			acc[day.key] = null;
			return acc;
		}, {} as DayFeedbackByDay);

	const emptyFeedbackDraft = () => ({
		mood: '' as DayFeedbackMood | '',
		difficulty: '',
		pain: '' as DayFeedbackPain | '',
		comment: ''
	});

	const feedbackDraftFromSaved = (
		dayKey: string
	): {
		mood: DayFeedbackMood | '';
		difficulty: string;
		pain: DayFeedbackPain | '';
		comment: string;
	} => {
		const row = dayFeedback[dayKey];
		if (!row) return emptyFeedbackDraft();
		return {
			mood: row.mood ?? '',
			difficulty: typeof row.difficulty === 'number' ? String(row.difficulty) : '',
			pain: row.pain ?? '',
			comment: row.comment ?? ''
		};
	};

	const moodOptions: Array<{ value: DayFeedbackMood; icon: string; label: string }> = [
		{ value: 'excellent', icon: '🔵', label: DAY_FEEDBACK_MOOD_LABEL.excellent },
		{ value: 'good', icon: '🟢', label: DAY_FEEDBACK_MOOD_LABEL.good },
		{ value: 'normal', icon: '🟡', label: DAY_FEEDBACK_MOOD_LABEL.normal },
		{ value: 'tired', icon: '🟠', label: DAY_FEEDBACK_MOOD_LABEL.tired },
		{ value: 'very_fatigued', icon: '🔴', label: DAY_FEEDBACK_MOOD_LABEL.very_fatigued }
	];

	const painOptions: Array<{ value: DayFeedbackPain; label: string }> = [
		{ value: 'none', label: 'No' },
		{ value: 'mild', label: 'Leve (soportable)' },
		{ value: 'moderate', label: 'Moderado (interfiere)' },
		{ value: 'severe', label: 'Fuerte (me limita)' }
	];

	const ensureFeedbackDraft = (dayKey: string) => {
		if (feedbackDraftByDay[dayKey]) return;
		feedbackDraftByDay = { ...feedbackDraftByDay, [dayKey]: emptyFeedbackDraft() };
	};

	const feedbackAnsweredCount = (dayKey: string) => {
		const draft = feedbackDraftByDay[dayKey] ?? emptyFeedbackDraft();
		let answered = 0;
		if (draft.mood) answered += 1;
		if (draft.difficulty) answered += 1;
		if (draft.pain) answered += 1;
		if (draft.comment.trim()) answered += 1;
		return answered;
	};

	const hasRealProgressForDay = (dayKey: string): boolean => {
		const dayPlan = plan[dayKey];
		if (!dayPlan || dayPlan.exercises.length === 0) return false;
		const dayExercises = progress[dayKey]?.exercises ?? {};
		return dayPlan.exercises.some((exercise) => (dayExercises[exercise.id] ?? 0) > 0);
	};

	const getFeedbackCardMode = (dayKey: string): 'prompt' | 'form' | 'reminder' | 'saved' | null => {
		if (feedbackCardModeByDay[dayKey] === 'form') return 'form';
		if (dayFeedback[dayKey]) return 'saved';
		if (!hasRealProgressForDay(dayKey)) return null;
		return feedbackCardModeByDay[dayKey] ?? 'prompt';
	};

	const openFeedbackForm = (dayKey: string) => {
		feedbackDraftByDay = { ...feedbackDraftByDay, [dayKey]: feedbackDraftFromSaved(dayKey) };
		feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: '' };
		feedbackCardModeByDay = { ...feedbackCardModeByDay, [dayKey]: 'form' };
	};

	const skipFeedbackForNow = (dayKey: string) => {
		feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: '' };
		feedbackCardModeByDay = { ...feedbackCardModeByDay, [dayKey]: 'reminder' };
	};

	const cancelFeedbackForm = (dayKey: string) => {
		feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: '' };
		feedbackCardModeByDay = {
			...feedbackCardModeByDay,
			[dayKey]: dayFeedback[dayKey] ? 'saved' : 'reminder'
		};
	};

	const difficultyLabel = (difficultyRaw: string): string | null => {
		const value = Number(difficultyRaw);
		if (!Number.isInteger(value) || value < 1 || value > 10) return null;
		if (value <= 2) return 'Muy fácil';
		if (value <= 4) return 'Fácil';
		if (value <= 6) return 'Intermedia';
		if (value <= 8) return 'Difícil';
		return 'Muy difícil';
	};

	const feedbackCounterTone = (length: number) => {
		if (length >= 300) return 'is-danger';
		if (length >= 280) return 'is-warning';
		return '';
	};

	const updateFeedbackDraft = (
		dayKey: string,
		patch: Partial<{
			mood: DayFeedbackMood | '';
			difficulty: string;
			pain: DayFeedbackPain | '';
			comment: string;
		}>
	) => {
		const current = feedbackDraftByDay[dayKey] ?? emptyFeedbackDraft();
		const next = { ...current, ...patch };
		next.comment = (next.comment ?? '').slice(0, 300);
		feedbackDraftByDay = { ...feedbackDraftByDay, [dayKey]: next };
	};

	const extractActionPayload = async (response: Response): Promise<Record<string, any>> => {
		const raw = await response.text();
		if (!raw) return {};
		try {
			return JSON.parse(raw) as Record<string, any>;
		} catch {
			return {};
		}
	};

	const extractSavedDayFeedback = (payload: Record<string, any>) =>
		payload?.dayFeedback ?? payload?.data?.dayFeedback ?? null;

	const parseFeedbackDifficulty = (raw: string): number | null => {
		const value = Number(raw);
		if (!Number.isInteger(value) || value < 1 || value > 10) return null;
		return value;
	};

	const buildOptimisticDayFeedbackRow = (
		dayKey: string,
		draft: {
			mood: DayFeedbackMood | '';
			difficulty: string;
			pain: DayFeedbackPain | '';
			comment: string;
		},
		previous: DayFeedbackRow | null
	): DayFeedbackRow => {
		const nowIso = new Date().toISOString();
		const trimmedComment = draft.comment.trim();
		return {
			day_key: dayKey,
			day_local: previous?.day_local ?? null,
			submitted_at: nowIso,
			mood: draft.mood || null,
			difficulty: parseFeedbackDifficulty(draft.difficulty),
			pain: draft.pain || null,
			comment: trimmedComment ? trimmedComment : null,
			created_at: previous?.created_at ?? nowIso,
			updated_at: nowIso
		};
	};

	const saveDayFeedback = async (dayKey: string) => {
		ensureFeedbackDraft(dayKey);
		const draft = feedbackDraftByDay[dayKey];
		const optimisticRow = buildOptimisticDayFeedbackRow(dayKey, draft, dayFeedback[dayKey]);

		if (feedbackAnsweredCount(dayKey) === 0) {
			feedbackErrorByDay = {
				...feedbackErrorByDay,
				[dayKey]: 'Completá al menos una respuesta antes de guardar.'
			};
			return;
		}

		feedbackSavingByDay = { ...feedbackSavingByDay, [dayKey]: true };
		feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: '' };

		const formData = new FormData();
		formData.set('day_key', dayKey);
		if (draft.mood) formData.set('mood', draft.mood);
		if (draft.difficulty) formData.set('difficulty', draft.difficulty);
		if (draft.pain) formData.set('pain', draft.pain);
		if (draft.comment.trim()) formData.set('comment', draft.comment.trim());

			try {
				const res = await fetch('?/saveDayFeedback', {
					method: 'POST',
					body: formData
				});
				const payload = await extractActionPayload(res);

				if (!res.ok) {
					const serverMessage = payload?.data?.message ?? payload?.message ?? 'No pudimos guardar tu respuesta.';
					feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: serverMessage };
					return;
				}

				// Update inmediato en UI para que "Editar respuestas" use los datos nuevos sin F5.
				const saved = extractSavedDayFeedback(payload);
				dayFeedback = {
					...dayFeedback,
					[dayKey]: saved ? { ...optimisticRow, ...saved, day_key: dayKey } : optimisticRow
				};
				feedbackCardModeByDay = { ...feedbackCardModeByDay, [dayKey]: 'saved' };
				feedbackDraftByDay = { ...feedbackDraftByDay, [dayKey]: emptyFeedbackDraft() };
				feedbackErrorByDay = { ...feedbackErrorByDay, [dayKey]: '' };
		} catch (e) {
			console.error(e);
			feedbackErrorByDay = {
				...feedbackErrorByDay,
				[dayKey]: 'No pudimos guardar tu respuesta. Intentá de nuevo.'
			};
		} finally {
			feedbackSavingByDay = { ...feedbackSavingByDay, [dayKey]: false };
		}
	};

	const adjustSets = (dayKey: string, exerciseId: string, delta: number) => {
		const dayPlan = plan[dayKey];
		const exercise = dayPlan.exercises.find((ex) => ex.id === exerciseId);
		if (!exercise) return;
		const hadRealProgress = hasRealProgressForDay(dayKey);

		const target = Math.max(1, getTargetSets(exercise) || 0);
		const current = progress[dayKey]?.exercises?.[exerciseId] ?? 0;
		const nextValue = Math.min(Math.max(current + delta, 0), target);

		if (baselineProgress[dayKey] === undefined) {
			// Contar solo series de ejercicios que ACTUALMENTE existen en la rutina
			const currentExerciseIds = new Set(dayPlan.exercises.map(ex => ex.id));
			const existingExercises = progress[dayKey]?.exercises ?? {};
			const relevantSets = Object.entries(existingExercises)
				.filter(([id]) => currentExerciseIds.has(id))
				.reduce((sum, [, val]) => sum + (val ?? 0), 0);
			baselineProgress = { ...baselineProgress, [dayKey]: relevantSets > 0 };
		}

		if (!sessionStarts[dayKey]) {
			sessionStarts = { ...sessionStarts, [dayKey]: new Date().toISOString() };
		}
		if (!firstSeriesTs[dayKey] && delta > 0) {
			firstSeriesTs = { ...firstSeriesTs, [dayKey]: new Date().toISOString() };
		}

		progress[dayKey] = {
			...(progress[dayKey] ?? { completed: false, exercises: {} }),
			exercises: { ...(progress[dayKey]?.exercises ?? {}), [exerciseId]: nextValue }
		};

		progress[dayKey].completed = dayPlan.exercises.every((ex) => {
			const t = Math.max(1, getTargetSets(ex) || 0);
			const done = progress[dayKey].exercises?.[ex.id] ?? 0;
			return done >= t;
		});
		const nowHasRealProgress = hasRealProgressForDay(dayKey);
		if (!hadRealProgress && nowHasRealProgress && !dayFeedback[dayKey]) {
			feedbackCardModeByDay = {
				...feedbackCardModeByDay,
				[dayKey]: feedbackCardModeByDay[dayKey] ?? 'prompt'
			};
		}
		lastSeriesTs = { ...lastSeriesTs, [dayKey]: new Date().toISOString() };
		saveProgress(dayKey);
	};

	const toggleExpanded = (dayKey: string) => {
		expanded = { ...expanded, [dayKey]: !expanded[dayKey] };
	};

	// Calcula si el día está realmente completado basado en el estado actual
	const isDayCompleted = (dayKey: string): boolean => {
		const dayPlan = plan[dayKey];
		if (!dayPlan || dayPlan.exercises.length === 0) return false;
		return dayPlan.exercises.every((ex) => {
			const target = Math.max(1, getTargetSets(ex) || 0);
			const done = progress[dayKey]?.exercises?.[ex.id] ?? 0;
			return done >= target;
		});
	};

	const doSaveProgress = async (dayKey?: string) => {
		if (saveInFlight) return;
		saveInFlight = true;
		saving = true;
		message = '';
		const formData = new FormData();
		formData.set('progress', JSON.stringify(progress));
		if (dayKey) {
			formData.set('session_day', dayKey);
			formData.set('session_start', sessionStarts[dayKey] ?? '');
			formData.set('session_end', new Date().toISOString());
			formData.set('had_progress_before', baselineProgress[dayKey] ? '1' : '0');
			if (firstSeriesTs[dayKey]) {
				formData.set('ts_primera_serie', firstSeriesTs[dayKey]);
			}
			if (lastSeriesTs[dayKey]) {
				formData.set('ts_ultima_serie', lastSeriesTs[dayKey]);
			}
		}
		try {
			await fetch('?/saveProgress', {
				method: 'POST',
				body: formData
			});
		} catch (e) {
			console.error('Error saving progress:', e);
		} finally {
			saveInFlight = false;
			saving = false;
			// Si hay un guardado pendiente, ejecutarlo
			if (pendingSaveDay !== null) {
				const nextDay = pendingSaveDay;
				pendingSaveDay = null;
				doSaveProgress(nextDay);
			}
		}
	};

	const saveProgress = (dayKey?: string) => {
		// Debounce: esperar 300ms antes de guardar para agrupar clics rápidos
		if (saveTimeout) {
			clearTimeout(saveTimeout);
		}
		pendingSaveDay = dayKey ?? null;
		saveTimeout = setTimeout(() => {
			saveTimeout = null;
			if (saveInFlight) {
				// Ya hay un guardado en progreso, se ejecutará después
				return;
			}
			const day = pendingSaveDay;
			pendingSaveDay = null;
			doSaveProgress(day ?? undefined);
		}, 300);
	};

	const autoResizeTextarea = (node: HTMLTextAreaElement, _value?: string) => {
		const resize = () => {
			node.style.height = 'auto';
			node.style.height = `${node.scrollHeight}px`;
		};

		resize();
		requestAnimationFrame(resize);
		node.addEventListener('input', resize);

		return {
			update(_nextValue?: string) {
				resize();
				requestAnimationFrame(resize);
			},
			destroy() {
				node.removeEventListener('input', resize);
			}
		};
	};

	const handleFeedbackCommentInput = (dayKey: string, event: Event) => {
		const node = event.currentTarget as HTMLTextAreaElement;
		const limited = node.value.slice(0, 300);
		if (node.value !== limited) {
			node.value = limited;
		}
		updateFeedbackDraft(dayKey, { comment: limited });
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
			// limpiar estado de sesión
			sessionStarts = {};
			firstSeriesTs = {};
			lastSeriesTs = {};
			baselineProgress = {};
			dayFeedback = emptyDayFeedbackByDay();
			feedbackCardModeByDay = {};
			feedbackDraftByDay = {};
			feedbackErrorByDay = {};
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
				{#if data.objective}
					<p class="objective">{data.objective}</p>
				{/if}
			</header>

		<div class="days">
			{#each WEEK_DAYS as day}
				{#if plan[day.key] && plan[day.key].exercises.length > 0}
					<article class={`day-card ${expanded[day.key] ? 'is-open' : ''} ${isDayCompleted(day.key) ? 'is-done' : ''}`}>
						<button class="day-header" type="button" onclick={() => toggleExpanded(day.key)}>
							<div class="day-left">
								<span class="day-name">{day.label}</span>
								{#if isDayCompleted(day.key)}
									<span class="badge success">Día completado</span>
								{/if}
							</div>
							<span class="arrow">{expanded[day.key] ? '▾' : '▸'}</span>
						</button>

							{#if expanded[day.key]}
								<div class="day-body">
									{#each plan[day.key].exercises as exercise (exercise.id)}
										<div class="exercise-card">
										<div class="exercise-head">
											<div>
												<p class="exercise-name">{exercise.name}</p>
												<p class="exercise-scheme">{formatPrescriptionLong(exercise) || exercise.scheme}</p>
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

										{#if getFeedbackCardMode(day.key)}
											<div class="feedback-zone">
												{#if getFeedbackCardMode(day.key) === 'prompt'}
													<div class="feedback-card">
														<h3>¿Cómo te fue hoy?</h3>
														<p class="feedback-subtitle">10 segundos. Me ayuda a ajustar tu rutina.</p>
														<div class="feedback-actions">
															<button class="btn primary" type="button" onclick={() => openFeedbackForm(day.key)}>Responder</button>
															<button class="btn ghost" type="button" onclick={() => skipFeedbackForNow(day.key)}>Ahora no</button>
														</div>
													</div>
												{:else if getFeedbackCardMode(day.key) === 'reminder'}
													<div class="feedback-reminder">
														<p>¿Cómo te fue hoy?</p>
														<button class="btn ghost" type="button" onclick={() => openFeedbackForm(day.key)}>Responder</button>
													</div>
												{:else if getFeedbackCardMode(day.key) === 'saved'}
													<div class="feedback-card feedback-card-saved">
														<h3>¿Como te fue hoy?</h3>
														<p class="feedback-saved-status">
															<span aria-hidden="true">✅</span>
															<span>Registro guardado</span>
														</p>
														<button class="btn ghost feedback-edit-btn" type="button" onclick={() => openFeedbackForm(day.key)}>
															Editar respuestas.
														</button>
													</div>
												{:else if getFeedbackCardMode(day.key) === 'form'}
													{@const draft = feedbackDraftByDay[day.key] ?? emptyFeedbackDraft()}
													<div class="feedback-card">
														<h3>¿Cómo te fue hoy?</h3>
														<p class="feedback-subtitle">10 segundos. Me ayuda a ajustar tu rutina.</p>

														<div class="feedback-field">
															<p class="feedback-label">1) ¿Cómo te sentiste hoy?</p>
															<div class="chip-grid">
																{#each moodOptions as item}
																	<button
																		type="button"
																		class={`chip-btn mood-chip mood-${item.value} ${draft.mood === item.value ? 'is-selected' : ''}`}
																		onclick={() => updateFeedbackDraft(day.key, { mood: draft.mood === item.value ? '' : item.value })}
																	>
																		<span>{item.icon}</span>
																		<span>{item.label}</span>
																	</button>
																{/each}
															</div>
														</div>

														<div class="feedback-field">
															<p class="feedback-label">2) ¿Qué tan difícil fue el entrenamiento de hoy?</p>
															<p class="feedback-help">(1 = muy fácil / 10 = extremadamente difícil)</p>
															<div class="scale-grid">
																{#each Array.from({ length: 10 }, (_, i) => String(i + 1)) as level}
																	<button
																		type="button"
																		class={`scale-btn ${draft.difficulty === level ? 'is-selected' : ''}`}
																		onclick={() =>
																			updateFeedbackDraft(day.key, {
																				difficulty: draft.difficulty === level ? '' : level
																			})}
																	>
																		{level}
																	</button>
																{/each}
															</div>
															{#if draft.difficulty}
																{@const difficultyText = difficultyLabel(draft.difficulty)}
																{#if difficultyText}
																	<p class="difficulty-selection">Seleccionaste: {draft.difficulty} ({difficultyText})</p>
																{/if}
															{/if}
														</div>

														<div class="feedback-field">
															<p class="feedback-label">3) ¿Tuviste dolor o molestias?</p>
															<div class="chip-grid">
																{#each painOptions as item}
																	<button
																		type="button"
																		class={`chip-btn ${draft.pain === item.value ? 'is-selected' : ''}`}
																		onclick={() => updateFeedbackDraft(day.key, { pain: draft.pain === item.value ? '' : item.value })}
																	>
																		{item.label}
																	</button>
																{/each}
															</div>
														</div>

														<div class="feedback-field">
															<p class="feedback-label">4) Comentario opcional (máx. 300 caracteres)</p>
															<textarea
																class="feedback-textarea"
																rows="3"
																maxlength="300"
																value={draft.comment}
																use:autoResizeTextarea={draft.comment}
																oninput={(event) =>
																	handleFeedbackCommentInput(day.key, event)}
																placeholder="Si querés, contame en una línea cómo te sentiste."
															></textarea>
															<p class={`feedback-counter ${feedbackCounterTone(draft.comment.length)}`}>{draft.comment.length}/300</p>
															{#if draft.comment.length >= 300}
																<p class="feedback-limit-note">Alcanzaste el maximo de 300 caracteres.</p>
															{/if}
														</div>

														{#if feedbackErrorByDay[day.key]}
															<p class="feedback-error">{feedbackErrorByDay[day.key]}</p>
														{/if}

														<div class="feedback-actions">
															<button
																class="btn primary"
																type="button"
																onclick={() => saveDayFeedback(day.key)}
																disabled={feedbackSavingByDay[day.key]}
															>
																{feedbackSavingByDay[day.key] ? 'Guardando...' : 'Guardar'}
															</button>
															<button class="btn ghost" type="button" onclick={() => cancelFeedbackForm(day.key)}>Cancelar</button>
														</div>
													</div>
												{/if}
											</div>
										{/if}
								</div>
							{/if}
						</article>
				{/if}
			{/each}
		</div>

		<button class="reset-btn" type="button" onclick={() => (showResetConfirm = true)}>
			Iniciar nueva semana
		</button>
		<p class="reset-help">
			Cuando inicies una nueva semana debés tocar este botón para volver a completar ejercicios y registrar tu nuevo progreso.
		</p>

		{#if showResetConfirm}
			<div class="modal-backdrop" role="dialog" aria-modal="true">
				<div class="modal">
					<h2>Iniciar nueva semana</h2>
					<p>Esto reiniciará los progresos actuales.</p>
					<div class="modal-actions">
						<button class="btn ghost" type="button" onclick={() => (showResetConfirm = false)}>
							Cancelar
						</button>
						<button class="btn danger" type="button" onclick={resetProgress}>
							Iniciar nueva semana
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
		padding: 1.5rem 0.5rem 2rem;
	}

	@media (min-width: 640px) {
		.client-shell {
			padding: 1.5rem 1.25rem 2rem;
		}
	}

	.hero {
		background: #121420;
		border: 1px solid #1f2333;
		border-radius: 16px;
		padding: 1.5rem;
		box-shadow: 0 15px 45px rgba(0, 0, 0, 0.35);
		text-align: center;
		margin-bottom: 1rem;
	}

	.hero h1 {
		margin: 0;
		font-size: 1.8rem;
		font-weight: 800;
		color: #f7f8fb;
	}

	.hero p {
		margin: 0.15rem 0;
		color: #c4c8d4;
	}

	.hero .objective {
		font-size: 1.05rem;
		color: #9aa0b6;
	}

	.days {
		display: grid;
		gap: 1.2rem;
	}

	.day-card {
		border: 1px solid #1f2333;
		background: #0f111b;
		border-radius: 16px;
		box-shadow: 0 12px 32px rgba(0, 0, 0, 0.28);
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
		padding: 1.05rem 1.1rem;
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
		font-weight: 800;
		font-size: 1.1rem;
	}

	.arrow {
		color: #7a8197;
		font-size: 1.25rem;
	}

	.badge {
		border-radius: 999px;
		padding: 0.25rem 0.7rem;
		font-size: 0.82rem;
		font-weight: 700;
	}

	.badge.success {
		background: #163820;
		color: #3fdd77;
		border: 1px solid #1f7c42;
	}

	.day-body {
		padding: 1.1rem 1.2rem 1.2rem;
		background: #0b0d14;
		border-top: 1px solid #1f2333;
		display: grid;
		gap: 1.35rem;
	}

	.feedback-card {
		border: 1px solid #24314f;
		background: linear-gradient(180deg, #12172b 0%, #0d1324 100%);
		border-radius: 14px;
		padding: 1.2rem;
		display: grid;
		gap: 1.2rem;
	}

	.feedback-card-saved {
		gap: 0.95rem;
	}

	.feedback-card h3 {
		margin: 0;
		font-size: 1.05rem;
		font-weight: 800;
		color: #f7f8fb;
	}

	.feedback-subtitle {
		margin: -0.35rem 0 0;
		font-size: 0.9rem;
		color: #7e89a5;
	}

	.feedback-saved-status {
		margin: 0;
		display: inline-flex;
		align-items: center;
		gap: 0.55rem;
		font-size: 0.95rem;
		font-weight: 700;
		color: #b7f7d0;
	}

	.feedback-reminder {
		border: 1px solid #22314c;
		background: #10182a;
		border-radius: 12px;
		padding: 0.95rem 1rem;
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 1rem;
	}

	.feedback-reminder p {
		margin: 0;
		font-size: 0.9rem;
		color: #d0d8ea;
	}

	.feedback-field {
		display: grid;
		gap: 0.72rem;
	}

	.feedback-zone {
		margin-top: 2.3rem;
		padding-top: 1.55rem;
		border-top: 1px solid #2a3551;
	}

	.feedback-field + .feedback-field {
		margin-top: 1.25rem;
	}

	.feedback-label {
		margin: 0;
		font-size: 0.92rem;
		font-weight: 700;
		color: #e5eaf7;
	}

	.feedback-help {
		margin: -0.2rem 0 0;
		font-size: 0.78rem;
		color: #9ea7c0;
	}

	.chip-grid {
		display: flex;
		flex-wrap: wrap;
		gap: 0.8rem;
	}

	.chip-btn {
		border: 1px solid #2c3856;
		background: #111b30;
		color: #dce4f7;
		border-radius: 999px;
		padding: 0.62rem 1rem;
		font-size: 0.84rem;
		font-weight: 700;
		display: inline-flex;
		align-items: center;
		gap: 0.45rem;
		cursor: pointer;
	}

	.chip-btn:hover {
		background: #15213a;
	}

	.chip-btn.is-selected {
		border-color: #3ea0ff;
		background: #17345d;
		color: #f2f7ff;
	}

	.mood-chip.mood-tired.is-selected {
		border-color: #f59e0b;
		background: #4a3410;
		color: #ffe2b2;
	}

	.mood-chip.mood-very_fatigued.is-selected {
		border-color: #ef4444;
		background: #5a111a;
		color: #ffd6dc;
	}

	.scale-grid {
		display: grid;
		grid-template-columns: repeat(3, minmax(0, 1fr));
		gap: 0.65rem;
	}

	@media (min-width: 640px) {
		.scale-grid {
			grid-template-columns: repeat(5, minmax(0, 1fr));
		}
	}

	.scale-btn {
		border: 1px solid #2d3957;
		background: #111b30;
		color: #dce4f7;
		border-radius: 10px;
		padding: 0.65rem 0;
		font-size: 0.83rem;
		font-weight: 800;
		cursor: pointer;
	}

	.scale-btn:hover {
		background: #15213a;
	}

	.scale-btn.is-selected {
		border-color: #34d399;
		background: #114033;
		color: #d7ffef;
	}

	.difficulty-selection {
		margin: 0.2rem 0 0;
		font-size: 0.82rem;
		color: #afbad4;
	}

	.feedback-textarea {
		border: 1px solid #2b3753;
		background: #0f172a;
		color: #e7edf8;
		border-radius: 10px;
		padding: 0.6rem 0.7rem;
		width: 100%;
		box-sizing: border-box;
		resize: none;
		overflow: hidden;
		min-height: 86px;
		font-size: 0.92rem;
		line-height: 1.45;
	}

	.feedback-textarea:focus-visible {
		outline: 2px solid #22c55e;
	}

	.feedback-counter {
		margin: 0;
		text-align: right;
		font-size: 0.76rem;
		color: #9ca8c2;
	}

	.feedback-counter.is-warning {
		color: #fcd34d;
	}

	.feedback-counter.is-danger {
		color: #f87171;
	}

	.feedback-error {
		margin: 0;
		font-size: 0.83rem;
		color: #fca5a5;
	}

	.feedback-limit-note {
		margin: -0.1rem 0 0;
		font-size: 0.78rem;
		color: #f3f4f6;
		opacity: 0.88;
	}

	.feedback-actions {
		display: flex;
		flex-wrap: wrap;
		gap: 0.9rem;
		margin-top: 0.3rem;
	}

	.exercise-card {
		background: #111423;
		border: 1px solid #1f2333;
		border-radius: 16px;
		padding: 1.05rem;
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
		font-weight: 800;
		color: #f7f8fb;
		font-size: 1.05rem;
	}

	.exercise-scheme {
		margin: 0.1rem 0 0;
		color: #c4c8d4;
		font-size: 1.02rem;
	}

	.exercise-note {
		margin: 0.35rem 0 0;
		color: #9aa0b6;
		font-size: 0.98rem;
		font-style: italic;
	}

	.exercise-controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 0.75rem;
		margin-top: 1.5rem;
	}

	@media (min-width: 640px) {
		.exercise-controls {
			margin-top: 0.85rem;
		}
	}

	.pill-btn {
		width: 56px;
		height: 56px;
		border-radius: 16px;
		border: 1px solid #27304a;
		background: linear-gradient(180deg, #12172c 0%, #0f1425 100%);
		color: #dce3ff;
		font-size: 1.45rem;
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
		font-size: 1.1rem;
	}

	.sets-total {
		color: #c4c8d4;
		font-size: 1.02rem;
	}

	.sets-separator {
		color: #5b647a;
		font-weight: 600;
	}

	.reset-btn {
		width: 100%;
		margin-top: 1.5rem;
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

	.reset-help {
		margin: 0.5rem 0 0;
		font-size: 0.8rem;
		color: #8d95ab;
		text-align: center;
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
		padding: 0.72rem 1.05rem;
		font-weight: 700;
		cursor: pointer;
	}

	.feedback-edit-btn {
		justify-self: flex-start;
	}

	.btn.ghost {
		background: #111423;
		color: #c4c8d4;
		border-color: #1f2333;
	}

	.btn.primary {
		background: #0f9960;
		border-color: #1f7c42;
		color: #f8fffb;
	}

	.btn.primary:hover {
		filter: brightness(1.08);
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
