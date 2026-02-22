import { addHoursIso } from './utils';
import { IMPORT_ARTIFACT_TTL_HOURS } from './constants';
import { saveImportJobArtifact } from './job-repo';

export const persistImportArtifact = async (params: {
	jobId: string;
	payload: Uint8Array;
	mimeType: string | null;
	fileName: string | null;
}) => {
	await saveImportJobArtifact({
		jobId: params.jobId,
		payload: params.payload,
		mimeType: params.mimeType,
		fileName: params.fileName,
		expiresAt: addHoursIso(IMPORT_ARTIFACT_TTL_HOURS)
	});
};

