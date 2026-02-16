import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { seedClientForTrainer } from '../fixtures/dataFactory';
import { getTestAccounts } from '../fixtures/accounts';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import type { ArchiveInactiveResponse } from '../../tests/contracts/http-types';

const accounts = getTestAccounts();
const cronSecret = process.env.TEST_CRON_SECRET || process.env.CRON_SECRET;
const allowMutation = process.env.TEST_ALLOW_CRON_MUTATION === '1';

test.describe('Full maintenance cron', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('archive-inactive endpoint requiere auth token', async ({ request }) => {
		const noAuth = await request.post('/api/maintenance/archive-inactive');
		expect(noAuth.status()).toBe(401);

		const wrongAuth = await request.post('/api/maintenance/archive-inactive', {
			headers: { Authorization: 'Bearer wrong-token' }
		});
		expect(wrongAuth.status()).toBe(401);
	});

	test('archive-inactive archiva >= 6 meses y respeta recientes', async ({ request }) => {
		test.skip(!cronSecret, 'TEST_CRON_SECRET/CRON_SECRET no configurado');
		test.skip(!allowMutation, 'Set TEST_ALLOW_CRON_MUTATION=1 para habilitar prueba mutante de cron');

		const oldDate = new Date(Date.now() - 220 * 24 * 60 * 60 * 1000).toISOString();
		const recentDate = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();

		const oldClient = await seedClientForTrainer(accounts.trainer.email, 'CronOldInactive', {
			lastSavedAt: oldDate,
			status: 'active'
		});
		const recentClient = await seedClientForTrainer(accounts.trainer.email, 'CronRecentActive', {
			lastSavedAt: recentDate,
			status: 'active'
		});

		const cronRes = await request.post('/api/maintenance/archive-inactive', {
			headers: {
				Authorization: `Bearer ${cronSecret}`
			}
		});
		expect(cronRes.status()).toBe(200);
		const payload = (await cronRes.json()) as ArchiveInactiveResponse;
		expect(payload.ok).toBe(true);

		const supabase = getSupabaseAdmin();
		const { data: archivedRow } = await supabase
			.from('clients')
			.select('status')
			.eq('id', oldClient.id)
			.single();
		expect(archivedRow?.status).toBe('archived');

		const { data: recentRow } = await supabase
			.from('clients')
			.select('status')
			.eq('id', recentClient.id)
			.single();
		expect(recentRow?.status).toBe('active');
	});
});
