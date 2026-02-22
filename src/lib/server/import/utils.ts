import { createHash, randomUUID } from 'node:crypto';
import type { FieldConfidence, FieldProvenance } from '$lib/import/types';

export const sha256Hex = (payload: Uint8Array) =>
	createHash('sha256').update(payload).digest('hex');

export const toBase64 = (payload: Uint8Array) => Buffer.from(payload).toString('base64');
export const fromBase64 = (value: string) => new Uint8Array(Buffer.from(value, 'base64'));

export const decodeUtf8 = (payload: Uint8Array) => Buffer.from(payload).toString('utf8');

export const normalizeText = (value: string) =>
	value
		.replace(/\r\n/g, '\n')
		.replace(/\r/g, '\n')
		.replace(/\u00a0/g, ' ')
		.replace(/×/g, 'x')
		.replace(/[ \t]+/g, ' ')
		.trim();

export const normalizeLine = (line: string) =>
	line
		.replace(/\u00a0/g, ' ')
		.replace(/×/g, 'x')
		.replace(/[ \t]+/g, ' ')
		.trim();

export const toConfidence = (score: number): FieldConfidence => {
	const clamped = Math.max(0, Math.min(1, score));
	if (clamped >= 0.8) return { score: clamped, label: 'high' };
	if (clamped >= 0.55) return { score: clamped, label: 'medium' };
	return { score: clamped, label: 'low' };
};

export const makeProvenance = (raw: string, lineIndex: number, sourcePage?: number): FieldProvenance => ({
	source_page: sourcePage ?? null,
	line_index: lineIndex,
	line_span: [lineIndex, lineIndex],
	bbox: null,
	raw_snippet: raw.slice(0, 500)
});

export const makeId = () => randomUUID();

export const mapSpanishWeekdayToKey = (raw: string): string | null => {
	const value = raw
		.normalize('NFD')
		.replace(/\p{Diacritic}/gu, '')
		.toLowerCase();
	if (value.startsWith('lunes')) return 'monday';
	if (value.startsWith('martes')) return 'tuesday';
	if (value.startsWith('miercoles')) return 'wednesday';
	if (value.startsWith('jueves')) return 'thursday';
	if (value.startsWith('viernes')) return 'friday';
	if (value.startsWith('sabado')) return 'saturday';
	if (value.startsWith('domingo')) return 'sunday';
	return null;
};

export const inferSourceTypeFromName = (fileName: string): 'text' | 'csv' | 'xlsx' | 'docx' | 'pdf' | null => {
	const lower = fileName.toLowerCase();
	if (lower.endsWith('.txt')) return 'text';
	if (lower.endsWith('.csv')) return 'csv';
	if (lower.endsWith('.xlsx')) return 'xlsx';
	if (lower.endsWith('.docx')) return 'docx';
	if (lower.endsWith('.pdf')) return 'pdf';
	return null;
};

export const nowIso = () => new Date().toISOString();

export const addHoursIso = (hours: number) => new Date(Date.now() + hours * 60 * 60 * 1000).toISOString();

