import { decodeUtf8, normalizeText } from '../utils';
import { parseLinesToDraft } from './text-core';
import type { ParserContext, ParserOutput } from './types';

export const parseTextPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	const text = normalizeText(decodeUtf8(payload));
	const lines = text.split('\n').map((line, index) => ({
		text: line,
		lineIndex: index
	}));

	return {
		draft: parseLinesToDraft(lines, context)
	};
};

