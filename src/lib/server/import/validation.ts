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
			message: 'No se detectaron días suficientes para un import confiable.',
			provenance: null,
			suggested_fix: 'Convertí a texto o corregí el PDF original.'
		});
	}

	if (draft.coverage.exercises_parsed < PDF_COVERAGE_THRESHOLDS.minExercisesParsed) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_exercises_below_threshold',
			scope: 'job',
			path: 'coverage.exercises_parsed',
			message: 'Se detectaron menos de 5 ejercicios en PDF.',
			provenance: null,
			suggested_fix: 'Usá la importación por texto/tabla como fallback.'
		});
	}

	if (draft.coverage.parseable_ratio < PDF_COVERAGE_THRESHOLDS.minParseableRatio) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_parseable_ratio_below_threshold',
			scope: 'job',
			path: 'coverage.parseable_ratio',
			message: `Cobertura de parseo ${Math.round(draft.coverage.parseable_ratio * 100)}% (< 60%).`,
			provenance: null,
			suggested_fix: 'Revisá formato de origen o usá importación tabular.'
		});
	}

	if (draft.coverage.required_fields_ratio < PDF_COVERAGE_THRESHOLDS.minRequiredFieldsRatio) {
		issues.push({
			severity: 'hard_error',
			code: 'pdf_required_fields_ratio_below_threshold',
			scope: 'job',
			path: 'coverage.required_fields_ratio',
			message: `Campos obligatorios completos ${Math.round(draft.coverage.required_fields_ratio * 100)}% (< 70%).`,
			provenance: null,
			suggested_fix: 'Corregí datos en preview o usá formato más estructurado.'
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
			message: `Detectamos ${unresolvedMultiExerciseLines} línea(s) con múltiples prescripciones que no pudieron separarse automáticamente.`,
			provenance: null,
			suggested_fix: 'Revisá esas líneas en el preview y separá ejercicios compuestos manualmente.'
		});
	}

	if (linesWithPrescriptionDetected > 0 && exerciseNodesOut < linesWithPrescriptionDetected) {
		coverageIssues.push({
			severity: 'needs_review',
			code: 'exercise_nodes_below_prescription_lines',
			scope: 'job',
			path: 'coverage.exercise_nodes_out',
			message: `Se detectaron ${linesWithPrescriptionDetected} línea(s) con prescripción, pero solo ${exerciseNodesOut} nodos de ejercicio.`,
			provenance: null,
			suggested_fix: 'Validá si hay líneas con más de un ejercicio y separalas manualmente.'
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
			message: `Parseamos ${Math.round(draft.coverage.parseable_ratio * 100)}% de líneas candidatas. Revisá el preview antes de confirmar.`,
			provenance: null,
			suggested_fix: 'Corregí ejercicios no detectados o pegá texto con formato más consistente.'
		});
	}
	if (draft.coverage.exercises_parsed <= 0) {
		coverageIssues.push({
			severity: 'hard_error',
			code: 'no_exercises_detected',
			scope: 'job',
			path: 'coverage.exercises_parsed',
			message: 'No detectamos ejercicios válidos en el contenido importado.',
			provenance: null,
			suggested_fix: 'Verificá el formato (ej: "Ejercicio (3x8)") o probá con CSV/XLSX.'
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
