export type TestCredential = {
	email: string;
	password: string;
};

export type TestAccounts = {
	trainer: TestCredential;
	owner?: TestCredential;
	disabled?: TestCredential;
};

export type TestRunContext = {
	runId: string;
	prefix: string;
	createdAtIso: string;
};

export type ClientSeed = {
	id: string;
	name: string;
	client_code: string;
	trainer_id: string;
	status: 'active' | 'archived';
	objective: string | null;
	created_at: string;
};

export type CleanupSummary = {
	runId: string;
	deletedClients: number;
	deletedProgressRows: number;
	deletedRoutineRows: number;
	deletedTrainerAccessRows: number;
	deletedTrainerRows: number;
	remainingClients: number;
};
