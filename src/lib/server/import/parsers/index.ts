import type { ImportSourceType } from '$lib/import/types';
import type { ParserContext, ParserOutput } from './types';
import { parseCsvPayload, parseXlsxPayload } from './xlsx';
import { parseDocxPayload } from './docx';
import { parsePdfDigitalPayload } from './pdf-digital';
import { parseTextPayload } from './text';

export const parseImportPayloadBySource = async (
	sourceType: ImportSourceType,
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	switch (sourceType) {
		case 'text':
			return parseTextPayload(payload, context);
		case 'csv':
			return parseCsvPayload(payload, context);
		case 'xlsx':
			return parseXlsxPayload(payload, context);
		case 'docx':
			return parseDocxPayload(payload, context);
		case 'pdf':
			return parsePdfDigitalPayload(payload, context);
		default:
			throw new Error(`Unsupported source type: ${sourceType satisfies never}`);
	}
};

