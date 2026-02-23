import type { ImportJobScope, ImportSourceType } from '$lib/import/types';
import { IMPORT_ERROR_CODES } from '$lib/import/error-codes';
import {
	IMPORT_EXTRACTOR_VERSION,
	IMPORT_MAX_FILE_SIZE_BYTES,
	IMPORT_PARSER_VERSION,
	IMPORT_RULESET_VERSION,
	IMPORT_SOURCE_MIME_BY_TYPE
} from './constants';
import { createImportJob, findReusableImportJob } from './job-repo';
import { inferSourceTypeFromName, sha256Hex } from './utils';
import { persistImportArtifact } from './storage';
import { logImportAudit } from './audit-service';
import { supabaseAdmin } from '$lib/server/supabaseAdmin';

type BuildPayloadInput =
	| {
			mode: 'raw_text';
			rawText: string;
			clientId: string | null;
			trainerId: string;
			scope: ImportJobScope;
	  }
	| {
			mode: 'file';
			fileName: string;
			mimeType: string | null;
			payload: Uint8Array;
			clientId: string | null;
			trainerId: string;
			scope: ImportJobScope;
			sourceType?: ImportSourceType;
	  };

type BuildPayloadResult =
	| {
			ok: true;
			sourceType: ImportSourceType;
			payload: Uint8Array;
			fileName: string | null;
			mimeType: string | null;
			fileMeta: Record<string, unknown>;
	  }
	| {
			ok: false;
			status: number;
			code: string;
			message: string;
	  };

export const isImportEnabled = () => process.env.IMPORT_V1_ENABLED !== '0';
export const isPdfImportEnabled = () => process.env.IMPORT_PDF_DIGITAL_ENABLED !== '0';

const isMimeAllowedForType = (sourceType: ImportSourceType, mimeType: string | null) => {
	if (!mimeType) return true;
	const allowed = IMPORT_SOURCE_MIME_BY_TYPE[sourceType];
	return allowed.some((allowedMime) => mimeType.includes(allowedMime));
};

const getTenantKillSwitch = async (trainerId: string) => {
	const { data, error } = await supabaseAdmin
		.from('import_tenant_limits')
		.select('kill_switch')
		.eq('trainer_id', trainerId)
		.maybeSingle();
	if (error) {
		console.error('import tenant kill switch lookup error', error);
		return false;
	}
	return data?.kill_switch === true;
};

const buildPayload = (input: BuildPayloadInput): BuildPayloadResult => {
	if (input.mode === 'raw_text') {
		const content = input.rawText.trim();
		if (!content) {
			return {
				ok: false,
				status: 400,
				code: IMPORT_ERROR_CODES.INVALID_PAYLOAD,
				message: 'El texto a importar no puede estar vacío.'
			};
		}
		const payload = new Uint8Array(Buffer.from(content, 'utf8'));
		return {
			ok: true,
			sourceType: 'text',
			payload,
			fileName: null,
			mimeType: 'text/plain',
			fileMeta: {
				size_bytes: payload.byteLength,
				mode: 'raw_text'
			}
		};
	}

	if (input.payload.byteLength <= 0) {
		return {
			ok: false,
			status: 400,
			code: IMPORT_ERROR_CODES.INVALID_PAYLOAD,
			message: 'El archivo está vacío.'
		};
	}
	if (input.payload.byteLength > IMPORT_MAX_FILE_SIZE_BYTES) {
		return {
			ok: false,
			status: 413,
			code: IMPORT_ERROR_CODES.FILE_TOO_LARGE,
			message: 'El archivo es demasiado pesado. El máximo permitido es 12 MB.'
		};
	}

	const inferred = inferSourceTypeFromName(input.fileName);
	const sourceType = input.sourceType ?? inferred;
	if (!sourceType) {
		return {
			ok: false,
			status: 400,
			code: IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
			message: 'El formato del archivo no está soportado. Probá con TXT, CSV, XLSX, DOCX o PDF.'
		};
	}

	if (sourceType === 'pdf') {
		const header = Buffer.from(input.payload.slice(0, 4)).toString('utf8');
		if (header !== '%PDF') {
			return {
				ok: false,
				status: 400,
				code: IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
				message: 'El archivo no tiene cabecera PDF válida.'
			};
		}
	}

	if (!isMimeAllowedForType(sourceType, input.mimeType)) {
		return {
			ok: false,
			status: 400,
			code: IMPORT_ERROR_CODES.INVALID_FILE_TYPE,
			message: 'El archivo parece tener un formato distinto al esperado.'
		};
	}

	return {
		ok: true,
		sourceType,
		payload: input.payload,
		fileName: input.fileName,
		mimeType: input.mimeType,
		fileMeta: {
			size_bytes: input.payload.byteLength,
			file_name: input.fileName,
			mime_type: input.mimeType,
			mode: 'file'
		}
	};
};

export const createImportJobFromInput = async (input: BuildPayloadInput) => {
	if (!isImportEnabled()) {
		return {
			ok: false as const,
			status: 503,
			code: IMPORT_ERROR_CODES.INVALID_PAYLOAD,
			message: 'La importación está deshabilitada temporalmente.'
		};
	}

	if (await getTenantKillSwitch(input.trainerId)) {
		return {
			ok: false as const,
			status: 403,
			code: IMPORT_ERROR_CODES.KILL_SWITCH_ENABLED,
			message: 'La carga de rutinas está desactivada para esta cuenta.'
		};
	}

	const prepared = buildPayload(input);
	if (!prepared.ok) return prepared;

	if (prepared.sourceType === 'pdf' && !isPdfImportEnabled()) {
		return {
			ok: false as const,
			status: 503,
			code: IMPORT_ERROR_CODES.UNSUPPORTED_SOURCE,
			message: 'La importación de PDF está deshabilitada temporalmente.'
		};
	}

	const fileHash = sha256Hex(prepared.payload);
	const reusable = await findReusableImportJob({
		trainerId: input.trainerId,
		clientId: input.clientId,
		scope: input.scope,
		fileHash,
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});

	if (reusable) {
		return {
			ok: true as const,
			status: 200,
			data: {
				jobId: reusable.id,
				reused: true
			}
		};
	}

	const job = await createImportJob({
		trainerId: input.trainerId,
		clientId: input.clientId,
		scope: input.scope,
		sourceType: prepared.sourceType,
		fileHash,
		storagePath: null,
		fileMeta: prepared.fileMeta,
		parserVersion: IMPORT_PARSER_VERSION,
		rulesetVersion: IMPORT_RULESET_VERSION,
		extractorVersion: IMPORT_EXTRACTOR_VERSION
	});

	await persistImportArtifact({
		jobId: job.id,
		payload: prepared.payload,
		mimeType: prepared.mimeType,
		fileName: prepared.fileName
	});

	await logImportAudit({
		jobId: job.id,
		trainerId: input.trainerId,
		clientId: input.clientId,
		event: 'job_created',
		payload: {
			source_type: prepared.sourceType,
			file_hash_sha256: fileHash
		}
	});

	return {
		ok: true as const,
		status: 201,
		data: {
			jobId: job.id,
			reused: false
		}
	};
};
