import type { ImportDraft, ImportIssue } from '$lib/import/types';
import type { RoutineExercise, RoutinePlan } from '$lib/types';
import { createEmptyPlan, normalizeRoutineUiMeta, sanitizeCustomLabel } from '$lib/routines';
import { randomUUID } from 'node:crypto';

const VALID_WEEK_DAYS = new Set([
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
]);

export const deriveRoutinePlanFromDraft = (
	draft: ImportDraft
): { plan: RoutinePlan; issues: ImportIssue[] } => {
	const plan = createEmptyPlan();
	const issues: ImportIssue[] = [];
	const mappedDays = new Set<string>();
	const uiMeta = normalizeRoutineUiMeta(draft.presentation ?? null);
	const shouldPersistCustomLabels = uiMeta.day_label_mode === 'custom';

	if (draft.days.length > 7) {
		issues.push({
			severity: 'hard_error',
			code: 'too_many_days_for_v1',
			scope: 'job',
			path: 'days',
			message: `Se detectaron ${draft.days.length} días y V1 soporta hasta 7.`,
			provenance: null,
			suggested_fix: 'Mapeá manualmente días o dividí la rutina en dos importaciones.'
		});
	}

	draft.days.forEach((day, dayIndex) => {
		const mappedDay = day.mapped_day_key;
		if (!mappedDay || !VALID_WEEK_DAYS.has(mappedDay)) {
			issues.push({
				severity: 'needs_review_blocking',
				code: 'day_mapping_required',
				scope: 'day',
				path: `days.${dayIndex}.mapped_day_key`,
				message: `El día "${day.source_label}" no está mapeado a un día destino.`,
				provenance: null,
				suggested_fix: 'Asigná el día en el wizard antes de confirmar.'
			});
			return;
		}

		if (mappedDays.has(mappedDay)) {
			issues.push({
				severity: 'needs_review_blocking',
				code: 'day_mapping_collision',
				scope: 'day',
				path: `days.${dayIndex}.mapped_day_key`,
				message: `El día destino "${mappedDay}" está repetido en el mapeo.`,
				provenance: null,
				suggested_fix: 'Usá un destino distinto por día detectado.'
			});
			return;
		}
		mappedDays.add(mappedDay);

		const targetDay = plan[mappedDay];
		if (shouldPersistCustomLabels) {
			targetDay.label = sanitizeCustomLabel(
				day.display_label ?? day.source_label ?? targetDay.label,
				targetDay.label
			);
		}
		let nextOrder = targetDay.exercises.length;

		day.blocks.forEach((block, blockIndex) => {
			block.nodes.forEach((node, nodeIndex) => {
				const exerciseName = node.raw_exercise_name?.trim() ?? '';
				const sets = node.sets ?? 0;
				const repsMin = node.reps_min ?? 0;

				if (!exerciseName) {
					issues.push({
						severity: 'needs_review_blocking',
						code: 'missing_exercise_name',
						scope: 'node',
						path: `days.${dayIndex}.blocks.${blockIndex}.nodes.${nodeIndex}.raw_exercise_name`,
						message: 'Falta el nombre del ejercicio.',
						provenance: node.field_meta.name.provenance,
						suggested_fix: 'Ingresá un nombre de ejercicio.'
					});
				}

				if (!sets || sets <= 0) {
					issues.push({
						severity: 'needs_review_blocking',
						code: 'missing_sets',
						scope: 'field',
						path: `days.${dayIndex}.blocks.${blockIndex}.nodes.${nodeIndex}.sets`,
						message: `El ejercicio "${exerciseName || 'sin nombre'}" no tiene series válidas.`,
						provenance: node.field_meta.sets.provenance,
						suggested_fix: 'Definí un valor de series mayor a 0.'
					});
				}

				if (!repsMin || repsMin <= 0) {
					issues.push({
						severity: 'needs_review_blocking',
						code: 'missing_reps',
						scope: 'field',
						path: `days.${dayIndex}.blocks.${blockIndex}.nodes.${nodeIndex}.reps_min`,
						message: `El ejercicio "${exerciseName || 'sin nombre'}" no tiene repeticiones válidas.`,
						provenance: node.field_meta.reps.provenance,
						suggested_fix: 'Definí repeticiones mínimas mayores a 0.'
					});
				}

				const exercise: RoutineExercise = {
					id: randomUUID(),
					name: exerciseName || 'Ejercicio sin nombre',
					scheme: '',
					order: nextOrder,
					totalSets: sets > 0 ? sets : undefined,
					repsMin: repsMin > 0 ? repsMin : undefined,
					repsMax:
						node.reps_max && node.reps_min && node.reps_max >= node.reps_min
							? node.reps_max
							: null,
					showRange: Boolean(
						node.reps_max && node.reps_min && node.reps_max > node.reps_min
					),
					note:
						[node.note, block.block_type !== 'single' ? `Bloque: ${block.block_type}` : null]
							.filter(Boolean)
							.join(' · ') || undefined
				};

				targetDay.exercises.push(exercise);
				nextOrder += 1;
			});
		});
	});

	Object.values(plan).forEach((dayPlan) => {
		dayPlan.exercises = dayPlan.exercises.sort((a, b) => a.order - b.order);
	});

	return { plan, issues };
};
