import type { CleanupSummary } from '../../e2e/fixtures/types';
import dotenv from 'dotenv';
import { resolve } from 'node:path';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from './supabase-admin';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'e2e/.env'), override: true });

const assertConfigured = () => {
	if (!isSupabaseAdminConfigured()) {
		throw new Error(
			'Missing TEST_SUPABASE_URL / TEST_SUPABASE_SERVICE_ROLE_KEY. Sweep requires service role access.'
		);
	}
};

const getRunIdOrThrow = (): string => {
	const runId = process.env.TEST_RUN_ID?.trim();
	if (!runId) {
		throw new Error('TEST_RUN_ID is required for cleanup/verify commands.');
	}
	return runId;
};

const collectClientIds = async (namePattern: string): Promise<string[]> => {
	const supabase = getSupabaseAdmin();
	const { data, error } = await supabase.from('clients').select('id').ilike('name', namePattern);
	if (error) {
		throw new Error(`Failed to list clients for sweep: ${error.message}`);
	}
	return (data ?? []).map((row) => row.id);
};

export const cleanupRunData = async (runId: string): Promise<CleanupSummary> => {
	assertConfigured();
	const supabase = getSupabaseAdmin();
	const namePattern = `E2E__${runId}__%`;
	const clientIds = await collectClientIds(namePattern);

	let deletedProgressRows = 0;
	let deletedRoutineRows = 0;
	let deletedClients = 0;

	if (clientIds.length > 0) {
		const { error: progressError, count: progressCount } = await supabase
			.from('progress')
			.delete({ count: 'exact' })
			.in('client_id', clientIds);
		if (progressError) {
			throw new Error(`Failed deleting progress rows: ${progressError.message}`);
		}
		deletedProgressRows = progressCount ?? 0;

		const { error: routineError, count: routineCount } = await supabase
			.from('routines')
			.delete({ count: 'exact' })
			.in('client_id', clientIds);
		if (routineError) {
			throw new Error(`Failed deleting routine rows: ${routineError.message}`);
		}
		deletedRoutineRows = routineCount ?? 0;

		const { error: clientError, count: clientCount } = await supabase
			.from('clients')
			.delete({ count: 'exact' })
			.in('id', clientIds);
		if (clientError) {
			throw new Error(`Failed deleting clients: ${clientError.message}`);
		}
		deletedClients = clientCount ?? 0;
	}

	const trainerEmailPattern = `e2e+${runId}%`;
	const { error: accessError, count: trainerAccessCount } = await supabase
		.from('trainer_access')
		.delete({ count: 'exact' })
		.ilike('email', trainerEmailPattern);
	if (accessError) {
		throw new Error(`Failed deleting trainer_access rows: ${accessError.message}`);
	}

	const { error: trainerError, count: trainerCount } = await supabase
		.from('trainers')
		.delete({ count: 'exact' })
		.ilike('email', trainerEmailPattern);
	if (trainerError) {
		throw new Error(`Failed deleting trainer rows: ${trainerError.message}`);
	}

	const { count: remainingClientsCount, error: remainingError } = await supabase
		.from('clients')
		.select('id', { count: 'exact', head: true })
		.ilike('name', namePattern);
	if (remainingError) {
		throw new Error(`Failed verifying remaining clients: ${remainingError.message}`);
	}

	return {
		runId,
		deletedClients,
		deletedProgressRows,
		deletedRoutineRows,
		deletedTrainerAccessRows: trainerAccessCount ?? 0,
		deletedTrainerRows: trainerCount ?? 0,
		remainingClients: remainingClientsCount ?? 0
	};
};

export const verifyRunDataCleanup = async (runId: string): Promise<{ runId: string; remainingClients: number }> => {
	assertConfigured();
	const namePattern = `E2E__${runId}__%`;
	const remaining = await collectClientIds(namePattern);
	return { runId, remainingClients: remaining.length };
};

export const verifyNoStaleE2EData = async (maxAgeHours = 48) => {
	assertConfigured();
	const supabase = getSupabaseAdmin();
	const cutoff = new Date(Date.now() - maxAgeHours * 60 * 60 * 1000).toISOString();
	const { data, error } = await supabase
		.from('clients')
		.select('id,name,created_at')
		.ilike('name', 'E2E__%')
		.lt('created_at', cutoff)
		.order('created_at', { ascending: true });

	if (error) {
		throw new Error(`Failed stale-data check: ${error.message}`);
	}

	return {
		cutoff,
		staleCount: (data ?? []).length,
		staleClients: data ?? []
	};
};

const cli = async () => {
	const command = process.argv[2] ?? 'verify';
	try {
		if (command === 'cleanup') {
			const runId = getRunIdOrThrow();
			const summary = await cleanupRunData(runId);
			console.log(JSON.stringify(summary, null, 2));
			if (summary.remainingClients > 0) {
				process.exitCode = 1;
			}
			return;
		}

		if (command === 'verify') {
			const runId = getRunIdOrThrow();
			const result = await verifyRunDataCleanup(runId);
			console.log(JSON.stringify(result, null, 2));
			if (result.remainingClients > 0) {
				process.exitCode = 1;
			}
			return;
		}

		if (command === 'verify-all') {
			const maxAgeHours = Number(process.env.TEST_STALE_HOURS ?? 48);
			const stale = await verifyNoStaleE2EData(maxAgeHours);
			console.log(JSON.stringify(stale, null, 2));
			if (stale.staleCount > 0) {
				process.exitCode = 1;
			}
			return;
		}

		throw new Error(`Unknown command: ${command}`);
	} catch (error) {
		console.error(error);
		process.exitCode = 1;
	}
};

if (import.meta.url === `file://${process.argv[1]}`) {
	void cli();
}
