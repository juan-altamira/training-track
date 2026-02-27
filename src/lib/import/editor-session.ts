import { IMPORT_WEEK_DAY_KEYS, type ImportDraft, type ImportIssue, type ImportParsedBlockContext } from '$lib/import/types';
import { normalizeRoutineUiMeta } from '$lib/routines';
import type { RoutinePlan, RoutineUiMeta } from '$lib/types';

const VALID_WEEK_DAYS = new Set(IMPORT_WEEK_DAY_KEYS);
const WEEK_DAY_ORDER = IMPORT_WEEK_DAY_KEYS;

export type ImportEditorFieldKey = 'name' | 'sets' | 'reps';
export type ImportEditorBlockFieldKey = 'rounds';

export type ImportEditorIssueIndex = {
	globalIssues: ImportIssue[];
	dayIssues: Record<string, ImportIssue[]>;
	blockIssues: Record<string, ImportIssue[]>;
	blockFieldIssues: Record<string, ImportIssue[]>;
	fieldIssues: Record<string, ImportIssue[]>;
};

type DraftNodeTarget = {
	dayKey: string;
	blockKey: string;
	blockType: 'normal' | 'circuit';
	exerciseId: string;
};

type DraftBlockTarget = {
	dayKey: string;
	blockKey: string;
	blockType: 'normal' | 'circuit';
};

type DraftTargetMaps = {
	nodeTargets: Map<string, DraftNodeTarget>;
	blockTargets: Map<string, DraftBlockTarget>;
	dayTargets: Map<number, string>;
};

const appendIssue = (bucket: Record<string, ImportIssue[]>, key: string, issue: ImportIssue) => {
	bucket[key] = [...(bucket[key] ?? []), issue];
};

const normalizeDraftMode = (value: string | null | undefined) => {
	if (value === 'sequential' || value === 'custom') return value;
	return 'weekday';
};

const getBlockContext = (block: ImportDraft['days'][number]['blocks'][number]): ImportParsedBlockContext | null =>
	block.nodes.find((node) => node.parsed_shape?.block)?.parsed_shape?.block ?? null;

const getDraftBlockType = (
	block: ImportDraft['days'][number]['blocks'][number]
): 'normal' | 'circuit' => {
	const context = getBlockContext(block);
	if (context?.kind === 'circuit' || context?.kind === 'superset') return 'circuit';
	return block.block_type === 'circuit' || block.block_type === 'superset' ? 'circuit' : 'normal';
};

const getDraftBlockId = (
	dayId: string,
	blockIndex: number,
	block: ImportDraft['days'][number]['blocks'][number]
) => {
	const context = getBlockContext(block);
	const blockType = getDraftBlockType(block);
	return context?.header_unit_id?.trim() || `${blockType}-${block.id || `${dayId}-${blockIndex + 1}`}`;
};

const getFieldKey = (fieldPath: string): ImportEditorFieldKey | null => {
	if (fieldPath === 'raw_exercise_name' || fieldPath === 'source_raw_name') return 'name';
	if (fieldPath === 'sets') return 'sets';
	if (fieldPath === 'reps_text' || fieldPath === 'reps_mode' || fieldPath.startsWith('reps')) {
		return 'reps';
	}
	return null;
};

export const buildImportedRoutineUiMeta = (
	draft: ImportDraft,
	fallbackUiMeta: RoutineUiMeta | null | undefined
) => {
	const fallback = normalizeRoutineUiMeta(fallbackUiMeta ?? null);
	return normalizeRoutineUiMeta({
		...fallback,
		day_label_mode: normalizeDraftMode(draft.presentation?.day_label_mode ?? fallback.day_label_mode),
		hide_empty_days_in_sequential: true
	});
};

const buildDraftTargetMaps = (draft: ImportDraft, plan: RoutinePlan): DraftTargetMaps => {
	const uiMeta = buildImportedRoutineUiMeta(draft, null);
	const shouldPersistCustomLabels = uiMeta.day_label_mode === 'custom';
	const mappedDays = new Set<string>();
	const nodeTargets = new Map<string, DraftNodeTarget>();
	const blockTargets = new Map<string, DraftBlockTarget>();
	const dayTargets = new Map<number, string>();

	for (const [dayIndex, day] of draft.days.entries()) {
		const mappedDay =
			day.mapped_day_key &&
			VALID_WEEK_DAYS.has(day.mapped_day_key as (typeof IMPORT_WEEK_DAY_KEYS)[number])
				? (day.mapped_day_key as (typeof IMPORT_WEEK_DAY_KEYS)[number])
				: shouldPersistCustomLabels
					? (WEEK_DAY_ORDER[dayIndex] ?? null)
					: null;

		if (!mappedDay || !VALID_WEEK_DAYS.has(mappedDay) || mappedDays.has(mappedDay)) {
			continue;
		}

		mappedDays.add(mappedDay);
		dayTargets.set(dayIndex, mappedDay);

		const targetExercises = plan[mappedDay]?.exercises ?? [];
		let nextOrder = 0;

		for (const [blockIndex, block] of day.blocks.entries()) {
			const blockType = getDraftBlockType(block);
			const blockId = getDraftBlockId(day.id, blockIndex, block);
			const blockPath = `days.${dayIndex}.blocks.${blockIndex}`;
			let firstDerivedBlockTarget: DraftBlockTarget | null = null;

			for (const [nodeIndex] of block.nodes.entries()) {
				const exercise = targetExercises[nextOrder];
				if (exercise) {
					const derivedBlockType =
						exercise.blockType === 'circuit' || exercise.blockType === 'normal'
							? exercise.blockType
							: blockType;
					const derivedBlockId =
						(typeof exercise.blockId === 'string' && exercise.blockId.trim()) ||
						(blockType === 'circuit'
							? blockId
							: `${blockId}-${block.nodes[nodeIndex]?.id || `${blockIndex + 1}-${nodeIndex + 1}`}`);
					const derivedTarget: DraftNodeTarget = {
						dayKey: mappedDay,
						blockKey: `${derivedBlockType}:${derivedBlockId}`,
						blockType: derivedBlockType,
						exerciseId: exercise.id
					};
					nodeTargets.set(`${blockPath}.nodes.${nodeIndex}`, {
						...derivedTarget
					});
					if (!firstDerivedBlockTarget) {
						firstDerivedBlockTarget = {
							dayKey: mappedDay,
							blockKey: derivedTarget.blockKey,
							blockType: derivedTarget.blockType
						};
					}
				}
				nextOrder += 1;
			}

			blockTargets.set(
				blockPath,
				firstDerivedBlockTarget ?? {
					dayKey: mappedDay,
					blockKey: `${blockType}:${blockId}`,
					blockType
				}
			);
		}
	}

	return { nodeTargets, blockTargets, dayTargets };
};

export const indexImportIssuesForEditor = (
	draft: ImportDraft,
	plan: RoutinePlan,
	issues: ImportIssue[]
): ImportEditorIssueIndex => {
	const index: ImportEditorIssueIndex = {
		globalIssues: [],
		dayIssues: {},
		blockIssues: {},
		blockFieldIssues: {},
		fieldIssues: {}
	};

	const { nodeTargets, blockTargets, dayTargets } = buildDraftTargetMaps(draft, plan);

	for (const issue of issues) {
		if (issue.scope === 'job') {
			index.globalIssues.push(issue);
			continue;
		}

		const nodeMatch = issue.path.match(/^days\.(\d+)\.blocks\.(\d+)\.nodes\.(\d+)(?:\.(.+))?$/);
		if (nodeMatch) {
			const [, dayIndexRaw, blockIndexRaw, nodeIndexRaw, fieldPath = ''] = nodeMatch;
			const target = nodeTargets.get(`days.${dayIndexRaw}.blocks.${blockIndexRaw}.nodes.${nodeIndexRaw}`);
			if (!target) {
				index.globalIssues.push(issue);
				continue;
			}
			const fieldKey = getFieldKey(fieldPath);
			if (target.blockType === 'circuit' && fieldKey === 'sets') {
				appendIssue(index.blockFieldIssues, `${target.dayKey}::${target.blockKey}::rounds`, issue);
				continue;
			}
			if (fieldKey) {
				appendIssue(index.fieldIssues, `${target.dayKey}::${target.exerciseId}::${fieldKey}`, issue);
				continue;
			}
			appendIssue(index.blockIssues, `${target.dayKey}::${target.blockKey}`, issue);
			continue;
		}

		const blockMatch = issue.path.match(/^days\.(\d+)\.blocks\.(\d+)(?:\.|$)/);
		if (blockMatch) {
			const [, dayIndexRaw, blockIndexRaw] = blockMatch;
			const target = blockTargets.get(`days.${dayIndexRaw}.blocks.${blockIndexRaw}`);
			if (!target) {
				index.globalIssues.push(issue);
				continue;
			}
			appendIssue(index.blockIssues, `${target.dayKey}::${target.blockKey}`, issue);
			continue;
		}

		const dayMatch = issue.path.match(/^days\.(\d+)(?:\.|$)/);
		if (dayMatch) {
			const mappedDay = dayTargets.get(Number(dayMatch[1]));
			if (!mappedDay) {
				index.globalIssues.push(issue);
				continue;
			}
			appendIssue(index.dayIssues, mappedDay, issue);
			continue;
		}

		index.globalIssues.push(issue);
	}

	return index;
};
