import { supabaseAdmin } from '$lib/server/supabaseAdmin';

export const logImportAudit = async (params: {
	jobId: string;
	trainerId: string;
	clientId: string | null;
	event: string;
	payload?: Record<string, unknown>;
}) => {
	const { error } = await supabaseAdmin.from('import_audit').insert({
		job_id: params.jobId,
		trainer_id: params.trainerId,
		client_id: params.clientId,
		event: params.event,
		payload: params.payload ?? {}
	});
	if (error) {
		console.error('import audit insert error', error);
	}
};

