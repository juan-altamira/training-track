import { decodeUtf8 } from '../utils';
import { parseLinesToDraft } from './text-core';
import type { ParserContext, ParserOutput } from './types';

export const parseTextPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	// Preserve the original per-line content for offset-based note slicing.
	// Only normalize line breaks and NBSP to keep line tokenization stable.
	const text = decodeUtf8(payload).replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\u00a0/g, ' ');
	const lines = text.split('\n').map((line, index) => ({
		text: line,
		lineIndex: index
	}));

	return {
		draft: parseLinesToDraft(lines, context)
	};
};
