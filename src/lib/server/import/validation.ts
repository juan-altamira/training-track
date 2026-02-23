import type { ImportDraft, ImportDraftBundle, ImportIssue, ImportStats } from '$lib/import/types';
import { PDF_COVERAGE_THRESHOLDS } from './constants';
import { deriveRoutinePlanFromDraft } from './adapter-to-routineplan';

const countLowConfidenceFields = (draft: ImportDraft) => {
	let total = 0;
	for (const day of draft.days) {
		for (const block of day.blocks) {
			for (const node of block.nodes) {
				if (node.field_meta.day.confidence.label === 'low') total += 1;
				if (node.field_meta.name.confidence.label === 'low') total += 1;
				if (node.field_meta.sets.confidence.label === 'low') total += 1;
				if (node.field_meta.reps.confidence.label === 'low') total += 1;
				if (node.field_meta.note?.confidence.label === 'low') total += 1;
			}
		}
	}
	return total;
};

export const validateCoverageForPdf = (draft: ImportDraft): ImportIssue[] => {
	if (draft.source_type !== 'pdf') return [];
	const issues: ImportIssue[] = [];

	if (draft.coverage.days_detected < PDF_COVERAGE_THRESHOLDS.minDaysDetected) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_days_below_threshold',
			scope: 'job',
			path: 'coverage.days_detected',
			message: 'No pudimos reconocer suficientes días en el PDF.',
			provenance: null,
			suggested_fix: 'Probá copiando y pegando el texto de la rutina.'
		});
	}

	if (draft.coverage.exercises_parsed < PDF_COVERAGE_THRESHOLDS.minExercisesParsed) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_exercises_below_threshold',
			scope: 'job',
			path: 'coverage.exercises_parsed',
			message: 'Se reconocieron muy pocos ejercicios en el PDF.',
			provenance: null,
			suggested_fix: 'Probá copiando y pegando el texto en lugar del archivo.'
		});
	}

	if (draft.coverage.parseable_ratio < PDF_COVERAGE_THRESHOLDS.minParseableRatio) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_parseable_ratio_below_threshold',
			scope: 'job',
			path: 'coverage.parseable_ratio',
			message: `Solo pudimos leer ${Math.round(draft.coverage.parseable_ratio * 100)}% del contenido del PDF.`,
			provenance: null,
			suggested_fix: 'Probá con un PDF más claro o copiando y pegando el texto.'
		});
	}

	if (draft.coverage.required_fields_ratio < PDF_COVERAGE_THRESHOLDS.minRequiredFieldsRatio) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_required_fields_ratio_below_threshold',
			scope: 'job',
			path: 'coverage.required_fields_ratio',
			message: `Faltan datos importantes en varios ejercicios (${Math.round(draft.coverage.required_fields_ratio * 100)}% completo).`,
			provenance: null,
			suggested_fix: 'Completá lo faltante en pantalla o probá con un archivo más prolijo.'
		});
	}

	return issues;
};

export const buildDraftBundle = (draft: ImportDraft): ImportDraftBundle => {
	const coverageIssues = validateCoverageForPdf(draft);
	const unresolvedMultiExerciseLines = draft.coverage.unresolved_multi_exercise_lines ?? 0;
	const linesWithPrescriptionDetected = draft.coverage.lines_with_prescription_detected ?? 0;
	const exerciseNodesOut = draft.coverage.exercise_nodes_out ?? draft.coverage.exercises_parsed;

	if (unresolvedMultiExerciseLines > 0) {
		coverageIssues.push({
			severity: 'needs_review',
			code: 'possible_multi_exercise_line',
			scope: 'job',
			path: 'coverage.unresolved_multi_exercise_lines',
			message: `Hay ${unresolvedMultiExerciseLines} línea(s) con más de un ejercicio que no se separaron solas.`,
			provenance: null,
			suggested_fix: 'Revisalas y separá manualmente cada ejercicio.'
		});
	}

	if (linesWithPrescriptionDetected > 0 && exerciseNodesOut < linesWithPrescriptionDetected) {
		coverageIssues.push({
			severity: 'needs_review',
			code: 'exercise_nodes_below_prescription_lines',
			scope: 'job',
			path: 'coverage.exercise_nodes_out',
			message: `Se detectaron ${linesWithPrescriptionDetected} líneas con ejercicios, pero solo ${exerciseNodesOut} quedaron listadas.`,
			provenance: null,
			suggested_fix: 'Revisá si hay líneas que incluyan dos ejercicios juntos.'
		});
	}

	if (
		draft.source_type !== 'pdf' &&
		draft.coverage.candidate_lines >= 5 &&
		draft.coverage.parseable_ratio < 0.75
	) {
		coverageIssues.push({
			severity: 'needs_review',
			code: 'low_parse_ratio_non_pdf',
			scope: 'job',
			path: 'coverage.parseable_ratio',
			message: `Pudimos reconocer ${Math.round(draft.coverage.parseable_ratio * 100)}% de las líneas con ejercicios.`,
			provenance: null,
			suggested_fix: 'Corregí lo que falte en pantalla o pegá el texto en un formato más claro.'
		});
	}
	if (draft.coverage.exercises_parsed <= 0) {
		coverageIssues.push({
			severity: 'hard_error',
			code: 'no_exercises_detected',
			scope: 'job',
			path: 'coverage.exercises_parsed',
			message: 'No pudimos reconocer ejercicios válidos en el contenido cargado.',
			provenance: null,
			suggested_fix: 'Revisá el formato y probá nuevamente con archivo o texto pegado.'
		});
	}
	const { plan, issues: adapterIssues } = deriveRoutinePlanFromDraft(draft);
	const issues = [...coverageIssues, ...adapterIssues];
	const blockingIssues = issues.filter((issue) =>
		['hard_error', 'needs_review_blocking'].includes(issue.severity)
	);

	const stats: ImportStats = {
		days_detected: draft.coverage.days_detected,
		exercises_parsed: draft.coverage.exercises_parsed,
		issues_total: issues.length,
		blocking_issues: blockingIssues.length,
		low_confidence_fields: countLowConfidenceFields(draft),
		parseable_ratio: draft.coverage.parseable_ratio,
		required_fields_ratio: draft.coverage.required_fields_ratio
	};

	return {
		draft,
		issues,
		derivedPlan: plan,
		stats
	};
};

export const hasBlockingIssues = (issues: ImportIssue[]) =>
	issues.some((issue) => issue.severity === 'hard_error' || issue.severity === 'needs_review_blocking');
