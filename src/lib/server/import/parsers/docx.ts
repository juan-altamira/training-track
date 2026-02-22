import type { ParserContext, ParserOutput } from './types';
import { normalizeText } from '../utils';
import { parseLinesToDraft } from './text-core';

export const parseDocxPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	const mammoth = await import('mammoth');
	const result = await mammoth.extractRawText({ buffer: Buffer.from(payload) });
	const text = normalizeText(result.value ?? '');
	const lines = text.split('\n').map((line, index) => ({
		text: line,
		lineIndex: index
	}));

	return {
		draft: parseLinesToDraft(lines, context)
	};
};

