import test from 'node:test';
import assert from 'node:assert/strict';
import {
	createEmptyPlan,
	formatSpecialRepsForDisplay,
	formatPrescriptionLong,
	getDisplayDays,
	normalizePlan,
	resolveEffectiveDayLabelMode
} from '../../src/lib/routines';
import type { RoutinePlan } from '../../src/lib/types';

const withExercise = (plan: RoutinePlan, dayKey: string) => {
	plan[dayKey].exercises = [
		{
			id: `ex-${dayKey}`,
			name: `Ejercicio ${dayKey}`,
			scheme: '3x10',
			order: 0,
			totalSets: 3,
			repsMin: 10,
			repsMax: null,
			showRange: false
		}
	];
};

test('resolveEffectiveDayLabelMode: defaults to weekday for legacy/default labels', () => {
	const plan = createEmptyPlan();
	assert.equal(resolveEffectiveDayLabelMode(plan, null), 'weekday');
});

test('resolveEffectiveDayLabelMode: returns explicit mode when ui_meta is valid', () => {
	const plan = createEmptyPlan();
	assert.equal(resolveEffectiveDayLabelMode(plan, { day_label_mode: 'sequential' }), 'sequential');
	assert.equal(resolveEffectiveDayLabelMode(plan, { day_label_mode: 'custom' }), 'custom');
});

test('resolveEffectiveDayLabelMode: legacy custom evidence promotes mode to custom', () => {
	const plan = createEmptyPlan();
	withExercise(plan, 'monday');
	plan['monday'].label = 'Día de empuje';
	assert.equal(resolveEffectiveDayLabelMode(plan, null), 'custom');
});

test('getDisplayDays: sequential hides empties but keeps active empty day', () => {
	const plan = createEmptyPlan();
	withExercise(plan, 'monday');
	withExercise(plan, 'wednesday');

	const visible = getDisplayDays(
		plan,
		{ day_label_mode: 'sequential', hide_empty_days_in_sequential: true },
		{ activeDayKey: 'tuesday' }
	);

	assert.deepEqual(
		visible.map((day) => day.dayKey),
		['monday', 'tuesday', 'wednesday']
	);
	assert.deepEqual(
		visible.map((day) => day.displayLabel),
		['Día 1', 'Día 2', 'Día 3']
	);
	assert.equal(visible.find((day) => day.dayKey === 'tuesday')?.isEmpty, true);
});

test('normalizePlan: preserves existing labels when provided', () => {
	const input = createEmptyPlan();
	input['monday'].label = 'Empuje A';
	const normalized = normalizePlan(input);
	assert.equal(normalized['monday'].label, 'Empuje A');
	assert.equal(normalized['tuesday'].label, 'Martes');
});

test('formatPrescriptionLong: special reps uses series x texto', () => {
	const plan = createEmptyPlan();
	plan['monday'].exercises = [
		{
			id: 'ex-special',
			name: 'Dominadas',
			scheme: '',
			order: 0,
			totalSets: 3,
			repsMode: 'special',
			repsSpecial: 'amrap'
		}
	];
	assert.equal(formatPrescriptionLong(plan['monday'].exercises[0]), '3 series x AMRAP');
});

test('formatSpecialRepsForDisplay: normalizes duration units for display', () => {
	assert.equal(formatSpecialRepsForDisplay('20 seg'), '20 segundos');
	assert.equal(formatSpecialRepsForDisplay('15 s'), '15 segundos');
	assert.equal(formatSpecialRepsForDisplay('5 min'), '5 minutos');
	assert.equal(formatSpecialRepsForDisplay('20 segun2'), '20 segundos');
	assert.equal(formatSpecialRepsForDisplay('20 segudos'), '20 segundos');
	assert.equal(formatSpecialRepsForDisplay('3 minuttos'), '3 minutos');
});

test('formatPrescriptionLong: duration special reps keeps explicit time unit', () => {
	const plan = createEmptyPlan();
	plan['monday'].exercises = [
		{
			id: 'ex-duration',
			name: 'Plancha',
			scheme: '',
			order: 0,
			totalSets: 1,
			repsMode: 'special',
			repsSpecial: '20 seg'
		}
	];
	assert.equal(formatPrescriptionLong(plan['monday'].exercises[0]), '1 serie de 20 segundos');
});
