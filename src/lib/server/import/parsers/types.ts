import type { ImportDraft } from '$lib/import/types';

export type ParsedLine = {
	text: string;
	lineIndex: number;
	sourcePage?: number;
};

export type ParserContext = {
	sourceType: ImportDraft['source_type'];
	parserVersion: string;
	rulesetVersion: string;
	extractorVersion: string;
	degradeConfidenceForLayout?: boolean;
};

export type ParserOutput = {
	draft: ImportDraft;
};

