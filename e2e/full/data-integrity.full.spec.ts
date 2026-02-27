import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import { createEmptyPlan } from '../../tests/helpers/seed';
import { uniqueName } from '../helpers';

const ACTION_ORIGIN = new URL(process.env.TEST_BASE_URL ?? 'http://localhost:5173').origin;
const actionPost = (
	page: import('@playwright/test').Page,
	path: string,
	form: Record<string, string>
) =>
	page.request.post(path, {
		form,
		headers: {
			origin: ACTION_ORIGIN
		}
	});

const createOwnedClient = async (page: import('@playwright/test').Page, label: string) => {
	const name = uniqueName(label);
	await page.goto('/clientes');
	await page.fill('input[placeholder="Ej: Ana Pérez"]', name);
	await page.click('button:has-text("Crear y generar link")');
	await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 20000 });
	const id = page.url().split('/').pop();
	if (!id) {
		throw new Error('Could not resolve created client id from URL');
	}
	return { id, name };
};

test.describe('Full data integrity', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('GET /clientes no escribe datos en filas observadas', async ({ page }) => {
		const seeded = await createOwnedClient(page, 'NoWriteLoad');
		const supabase = getSupabaseAdmin();

		const { data: beforeClient } = await supabase
			.from('clients')
			.select('id,status,objective,created_at')
			.eq('id', seeded.id)
			.single();
		const { data: beforeRoutine } = await supabase
			.from('routines')
			.select('client_id,last_saved_at,plan')
			.eq('client_id', seeded.id)
			.single();
		const { data: beforeProgress } = await supabase
			.from('progress')
			.select('client_id,last_completed_at,progress')
			.eq('client_id', seeded.id)
			.single();

		await page.goto('/clientes');
		await expect(page.locator('input[placeholder="Buscar alumno"]')).toBeVisible({ timeout: 15000 });
		await page.goto(`/clientes/${seeded.id}`);
		await expect(page.getByTestId('back-to-panel')).toBeVisible({ timeout: 15000 });

		const { data: afterClient } = await supabase
			.from('clients')
			.select('id,status,objective,created_at')
			.eq('id', seeded.id)
			.single();
		const { data: afterRoutine } = await supabase
			.from('routines')
			.select('client_id,last_saved_at,plan')
			.eq('client_id', seeded.id)
			.single();
		const { data: afterProgress } = await supabase
			.from('progress')
			.select('client_id,last_completed_at,progress')
			.eq('client_id', seeded.id)
			.single();

		expect(afterClient).toEqual(beforeClient);
		expect(afterRoutine).toEqual(beforeRoutine);
		expect(afterProgress).toEqual(beforeProgress);
	});

	test('upserts repetidos mantienen unicidad funcional en progress/routines', async ({ page }) => {
		const plan = createEmptyPlan();
		plan.monday.exercises.push({
			id: 'unique-ex-1',
			name: 'Fondos en paralelas',
			scheme: '',
			order: 0,
			totalSets: 3,
			repsMin: 10,
			repsMax: null,
			showRange: false
		});

		const seeded = await createOwnedClient(page, 'UniqueUpsert');
		const savePlan = await actionPost(page, `/clientes/${seeded.id}?/saveRoutine`, {
			plan: JSON.stringify(plan)
		});
		expect(savePlan.status()).toBe(200);

		for (let i = 0; i < 3; i++) {
			const resetRes = await actionPost(page, `/clientes/${seeded.id}?/resetProgress`, {
				reset: 'true'
			});
			expect(resetRes.status()).toBe(200);
		}

		for (let i = 0; i < 2; i++) {
			const saveRes = await actionPost(page, `/clientes/${seeded.id}?/saveRoutine`, {
				plan: JSON.stringify(plan)
			});
			expect(saveRes.status()).toBe(200);
		}

		const supabase = getSupabaseAdmin();
		const { data: progressRows } = await supabase
			.from('progress')
			.select('client_id')
			.eq('client_id', seeded.id);
		const { data: routineRows } = await supabase
			.from('routines')
			.select('client_id')
			.eq('client_id', seeded.id);

		expect(progressRows?.length).toBe(1);
		expect(routineRows?.length).toBe(1);
	});
});
