import type { ParserContext, ParserOutput } from './types';
import { normalizeLine } from '../utils';
import { parseLinesToDraft } from './text-core';
import { IMPORT_MAX_PAGE_COUNT } from '../constants';

type PdfTextItem = {
	str: string;
	transform: number[];
};

type LineBucket = {
	y: number;
	items: Array<{ x: number; text: string }>;
};

const Y_TOLERANCE = 2.5;

const ensurePdfRuntimePolyfills = async () => {
	const globalScope = globalThis as {
		DOMMatrix?: unknown;
	};
	if (typeof globalScope.DOMMatrix === 'undefined') {
		const domMatrixModule = await import('@thednp/dommatrix');
		globalScope.DOMMatrix = domMatrixModule.default as unknown;
	}
};

const toLinesByPage = (items: PdfTextItem[]) => {
	const buckets: LineBucket[] = [];
	for (const item of items) {
		const text = normalizeLine(item.str ?? '');
		if (!text) continue;
		const x = Number(item.transform?.[4] ?? 0);
		const y = Number(item.transform?.[5] ?? 0);
		const existing = buckets.find((bucket) => Math.abs(bucket.y - y) <= Y_TOLERANCE);
		if (existing) {
			existing.items.push({ x, text });
		} else {
			buckets.push({ y, items: [{ x, text }] });
		}
	}

	return buckets
		.sort((a, b) => b.y - a.y)
		.map((bucket) => bucket.items.sort((a, b) => a.x - b.x).map((item) => item.text).join(' ').trim())
		.filter(Boolean);
};

export const parsePdfDigitalPayload = async (
	payload: Uint8Array,
	context: ParserContext
): Promise<ParserOutput> => {
	await ensurePdfRuntimePolyfills();
	const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
	const loadingTask = pdfjs.getDocument({ data: payload });
	const doc = await loadingTask.promise;
	if (doc.numPages > IMPORT_MAX_PAGE_COUNT) {
		throw new Error(`PDF exceeds page limit (${IMPORT_MAX_PAGE_COUNT}).`);
	}

	const lines: Array<{ text: string; lineIndex: number; sourcePage: number }> = [];
	let lineCursor = 0;

	for (let pageIndex = 1; pageIndex <= doc.numPages; pageIndex += 1) {
		const page = await doc.getPage(pageIndex);
		const content = await page.getTextContent();
		const pageItems = (content.items as PdfTextItem[]) ?? [];
		const pageLines = toLinesByPage(pageItems);
		pageLines.forEach((line) => {
			lines.push({
				text: line,
				lineIndex: lineCursor,
				sourcePage: pageIndex
			});
			lineCursor += 1;
		});
	}

	return {
		draft: parseLinesToDraft(lines, {
			...context,
			degradeConfidenceForLayout: true
		})
	};
};
