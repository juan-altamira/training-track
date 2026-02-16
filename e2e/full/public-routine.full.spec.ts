import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { createEmptyPlan } from '../../tests/helpers/seed';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import { uniqueName } from '../helpers';

const ACTION_ORIGIN = new URL(process.env.TEST_BASE_URL ?? 'http://localhost:5173').origin;
const ACTION_HEADERS = { origin: ACTION_ORIGIN };

const buildProgress = (exerciseId: string, doneSets: number, completed: boolean) => ({
	monday: { completed, exercises: { [exerciseId]: doneSets } },
	tuesday: { completed: false, exercises: {} },
	wednesday: { completed: false, exercises: {} },
	thursday: { completed: false, exercises: {} },
	friday: { completed: false, exercises: {} },
	saturday: { completed: false, exercises: {} },
	sunday: { completed: false, exercises: {} },
	_meta: {
		last_activity_utc: new Date().toISOString(),
		last_reset_utc: new Date().toISOString(),
		first_set_ts: {},
		baseline_sets: {}
	}
});

const createOwnedClientWithPlan = async (
	page: import('@playwright/test').Page,
	label: string,
	plan: ReturnType<typeof createEmptyPlan>
) => {
	const name = uniqueName(label);
	await page.goto('/clientes');
	await page.fill('input[placeholder="Ej: Ana Pérez"]', name);
	await page.click('button:has-text("Crear y generar link")');
	await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 20000 });
	const id = page.url().split('/').pop();
	if (!id) {
		throw new Error('Could not resolve created client id from URL');
	}

	const saveRes = await page.request.post(`/clientes/${id}?/saveRoutine`, {
		form: { plan: JSON.stringify(plan) },
		headers: ACTION_HEADERS
	});
	expect(saveRes.status()).toBe(200);

	const supabase = getSupabaseAdmin();
	const { data: clientRow, error } = await supabase
		.from('clients')
		.select('id,client_code')
		.eq('id', id)
		.single();
	if (error || !clientRow) {
		throw new Error(`Could not load client_code for seeded client: ${error?.message ?? 'missing row'}`);
	}

	return { id: clientRow.id, client_code: clientRow.client_code };
};

test.describe('Full /r/[clientCode] actions', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('saveProgress mantiene el máximo entre envíos sucesivos', async ({ request, page }) => {
		const plan = createEmptyPlan();
		plan.monday.exercises.push({
			id: 'merge-ex-1',
			name: 'Remo con barra',
			scheme: '',
			order: 0,
			totalSets: 3,
			repsMin: 8,
			repsMax: null,
			showRange: false
		});
		const seeded = await createOwnedClientWithPlan(page, 'PublicMerge', plan);

		const url = `/r/${seeded.client_code}?/saveProgress`;
		const saveLow = await request.post(url, {
			form: {
				progress: JSON.stringify(buildProgress('merge-ex-1', 1, false)),
				session_day: 'monday',
				session_start: new Date(Date.now() - 45_000).toISOString(),
				session_end: new Date().toISOString(),
				had_progress_before: '0'
			},
			headers: ACTION_HEADERS
		});
		const saveHigh = await request.post(url, {
			form: {
				progress: JSON.stringify(buildProgress('merge-ex-1', 3, true)),
				session_day: 'monday',
				session_start: new Date(Date.now() - 40_000).toISOString(),
				session_end: new Date().toISOString(),
				had_progress_before: '0'
			},
			headers: ACTION_HEADERS
		});
		const saveLowAgain = await request.post(url, {
			form: {
				progress: JSON.stringify(buildProgress('merge-ex-1', 1, false)),
				session_day: 'monday',
				session_start: new Date(Date.now() - 35_000).toISOString(),
				session_end: new Date().toISOString(),
				had_progress_before: '0'
			},
			headers: ACTION_HEADERS
		});

		expect(saveLow.status()).toBe(200);
		expect(saveHigh.status()).toBe(200);
		expect(saveLowAgain.status()).toBe(200);

		const supabase = getSupabaseAdmin();
		const { data: row } = await supabase
			.from('progress')
			.select('progress')
			.eq('client_id', seeded.id)
			.single();

		expect((row?.progress as any)?.monday?.exercises?.['merge-ex-1']).toBe(3);
	});

	test('saveProgress marca suspicious con completion < 60s desde cero', async ({ request, page }) => {
		const plan = createEmptyPlan();
		plan.monday.exercises.push({
			id: 'sus-ex-1',
			name: 'Peso muerto',
			scheme: '',
			order: 0,
			totalSets: 2,
			repsMin: 5,
			repsMax: null,
			showRange: false
		});
		const seeded = await createOwnedClientWithPlan(page, 'PublicSuspicious', plan);

		const now = Date.now();
		const res = await request.post(`/r/${seeded.client_code}?/saveProgress`, {
			form: {
				progress: JSON.stringify(buildProgress('sus-ex-1', 2, true)),
				session_day: 'monday',
				session_start: new Date(now - 30_000).toISOString(),
				session_end: new Date(now).toISOString(),
				ts_primera_serie: new Date(now - 30_000).toISOString(),
				ts_ultima_serie: new Date(now).toISOString(),
				had_progress_before: '0'
			},
			headers: ACTION_HEADERS
		});
		expect(res.status()).toBe(200);

		const supabase = getSupabaseAdmin();
		const { data: row } = await supabase
			.from('progress')
			.select('progress')
			.eq('client_id', seeded.id)
			.single();

		expect((row?.progress as any)?.monday?.suspicious).toBe(true);
		expect((row?.progress as any)?._meta?.first_set_ts?.monday).toBeTruthy();
		expect(((row?.progress as any)?._meta?.baseline_sets?.monday ?? 0) >= 0).toBe(true);
	});

	test('resetProgress público limpia contadores y client archived muestra acceso desactivado', async ({
		request,
		browser,
		page
	}) => {
		const plan = createEmptyPlan();
		plan.monday.exercises.push({
			id: 'reset-ex-1',
			name: 'Press militar',
			scheme: '',
			order: 0,
			totalSets: 3,
			repsMin: 10,
			repsMax: null,
			showRange: false
		});
		const seeded = await createOwnedClientWithPlan(page, 'PublicReset', plan);

		await request.post(`/r/${seeded.client_code}?/saveProgress`, {
			form: {
				progress: JSON.stringify(buildProgress('reset-ex-1', 3, true)),
				session_day: 'monday',
				session_start: new Date(Date.now() - 30_000).toISOString(),
				session_end: new Date().toISOString(),
				had_progress_before: '1'
			},
			headers: ACTION_HEADERS
		});

		const resetRes = await request.post(`/r/${seeded.client_code}?/resetProgress`, {
			form: { reset: 'true' },
			headers: ACTION_HEADERS
		});
		expect(resetRes.status()).toBe(200);

		const supabase = getSupabaseAdmin();
		const { data: progressAfterReset } = await supabase
			.from('progress')
			.select('progress')
			.eq('client_id', seeded.id)
			.single();
		expect((progressAfterReset?.progress as any)?.monday?.exercises?.['reset-ex-1'] ?? 0).toBe(0);

		await supabase.from('clients').update({ status: 'archived' }).eq('id', seeded.id);
		const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
		const publicPage = await context.newPage();
		await publicPage.goto(`/r/${seeded.client_code}`);
		await expect(publicPage.locator('text=Acceso desactivado')).toBeVisible({ timeout: 10000 });
		await context.close();
	});
});
