import { cleanupCurrentRunData, ensureRunIsClean } from './dataFactory';

export const cleanupRunAndAssert = async () => {
	const summary = await cleanupCurrentRunData();
	if (summary.remainingClients > 0) {
		throw new Error(
			`Data cleanup incomplete for run ${summary.runId}. Remaining clients: ${summary.remainingClients}`
		);
	}
	await ensureRunIsClean();
};
