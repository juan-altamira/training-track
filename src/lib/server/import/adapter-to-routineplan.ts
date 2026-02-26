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

const WEEK_DAY_ORDER = [
	'monday',
	'tuesday',
	'wednesday',
	'thursday',
	'friday',
	'saturday',
	'sunday'
] as const;

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
			message: `Se detectaron ${draft.days.length} días y una rutina admite hasta 7 días.`,
			provenance: null,
			suggested_fix: 'Asigná un día por bloque o dividí el plan en dos rutinas.'
		});
	}

	draft.days.forEach((day, dayIndex) => {
		const mappedDay =
			day.mapped_day_key && VALID_WEEK_DAYS.has(day.mapped_day_key)
				? day.mapped_day_key
				: shouldPersistCustomLabels
					? WEEK_DAY_ORDER[dayIndex] ?? null
					: null;
		if (!mappedDay || !VALID_WEEK_DAYS.has(mappedDay)) {
			issues.push({
				severity: 'needs_review_blocking',
				code: 'day_mapping_required',
				scope: 'day',
				path: `days.${dayIndex}.mapped_day_key`,
				message: `El día "${day.source_label}" no está mapeado a un día destino.`,
				provenance: null,
				suggested_fix: 'Elegí el día de destino antes de confirmar.'
			});
			return;
		}

		if (mappedDays.has(mappedDay)) {
			issues.push({
				severity: 'needs_review_blocking',
				code: 'day_mapping_collision',
				scope: 'day',
				path: `days.${dayIndex}.mapped_day_key`,
				message: 'Hay dos días apuntando al mismo destino.',
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
				const shape = node.parsed_shape ?? null;
				const sets = node.sets ?? 0;
				const repsMin = node.reps_min ?? 0;
				const repsMax = node.reps_max ?? null;
				const repsMode: 'number' | 'special' =
					node.reps_mode === 'special' || shape?.kind === 'amrap' ? 'special' : 'number';
				const repsSpecialRaw =
					(node.reps_special ?? '').trim() ||
					(repsMode === 'special' ? (node.reps_text ?? '').trim() : '');
				const repsSpecial = repsSpecialRaw ? repsSpecialRaw.slice(0, 80) : null;

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

				if (repsMode === 'special') {
					if (!repsSpecial) {
						issues.push({
							severity: 'needs_review_blocking',
							code: 'missing_special_reps',
							scope: 'field',
							path: `days.${dayIndex}.blocks.${blockIndex}.nodes.${nodeIndex}.reps_special`,
							message: `El ejercicio "${exerciseName || 'sin nombre'}" no tiene indicación de repeticiones especiales.`,
							provenance: node.field_meta.reps.provenance,
							suggested_fix: 'Completá el texto de repeticiones especiales (ej: AMRAP, 30 segundos).'
						});
					}
				} else if (!repsMin || repsMin <= 0) {
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
					repsMode,
					repsSpecial: repsMode === 'special' ? repsSpecial : null,
					repsMin: repsMode === 'number' && repsMin > 0 ? repsMin : undefined,
					repsMax:
						repsMode === 'number' && repsMax && repsMin && repsMax >= repsMin ? repsMax : null,
					showRange:
						repsMode === 'number' && Boolean(repsMax && repsMin && repsMax > repsMin),
					note: node.note ?? undefined,
					importShape: shape ?? undefined
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
