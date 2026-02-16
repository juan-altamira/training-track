import type { ClientSeed, CleanupSummary, TestRunContext } from './types';
import { findTrainerIdByEmail, getTestRunId, createClientSeed } from '../../tests/helpers/seed';
import { cleanupRunData, verifyRunDataCleanup } from '../../tests/helpers/sweep';

export const getRunContext = (): TestRunContext => {
	const runId = getTestRunId();
	return {
		runId,
		prefix: `E2E__${runId}__`,
		createdAtIso: new Date().toISOString()
	};
};

export const seedClientForTrainer = async (
	trainerEmail: string,
	label: string,
	overrides?: {
		status?: 'active' | 'archived';
		objective?: string | null;
		createdAt?: string;
		lastSavedAt?: string | null;
		plan?: Record<string, unknown>;
		progress?: Record<string, unknown>;
	}
): Promise<ClientSeed> => {
	const trainerId = await findTrainerIdByEmail(trainerEmail);
	return createClientSeed({
		trainerId,
		nameLabel: label,
		status: overrides?.status,
		objective: overrides?.objective,
		createdAt: overrides?.createdAt,
		lastSavedAt: overrides?.lastSavedAt,
		plan: overrides?.plan,
		progress: overrides?.progress
	});
};

export const cleanupCurrentRunData = async (): Promise<CleanupSummary> => {
	const { runId } = getRunContext();
	return cleanupRunData(runId);
};

export const ensureRunIsClean = async (): Promise<void> => {
	const { runId } = getRunContext();
	const verification = await verifyRunDataCleanup(runId);
	if (verification.remainingClients > 0) {
		throw new Error(
			`Cleanup verification failed for run ${runId}. Remaining clients: ${verification.remainingClients}`
		);
	}
};
