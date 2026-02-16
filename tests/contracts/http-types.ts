import type { OtherClientRow, OwnerActionHistoryRow, TrainerAdminRow } from '../../src/lib/types';

export type AdminTrainersResponse = {
	trainers: TrainerAdminRow[];
	ownerActionHistory?: OwnerActionHistoryRow[];
};

export type OtherClientsResponse = {
	otherClients: OtherClientRow[];
};

export type ArchiveInactiveResponse = {
	ok: boolean;
	checked?: number;
	archived?: number;
	run_at?: string;
	message?: string;
};
