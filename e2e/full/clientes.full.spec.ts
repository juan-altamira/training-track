import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { uniqueName } from '../helpers';
import { findTrainerIdByEmail, makeSeedName } from '../../tests/helpers/seed';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import { getTestAccounts } from '../fixtures/accounts';

const accounts = getTestAccounts();

test.describe('Full /clientes', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('crear alumno, validar duplicado exacto y eliminar con confirmación', async ({ page }) => {
		await page.goto('/clientes');
		const clientName = uniqueName('FullClientes');

		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 20000 });

		await page.goto('/clientes');
		await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 15000 });

		await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
		await page.click('button:has-text("Crear y generar link")');
		await expect(page.locator('text=Ya existe un alumno')).toBeVisible({ timeout: 10000 });

		const card = page.locator(`article:has-text("${clientName}")`).first();
		await card.locator('button:has-text("Eliminar alumno")').click();
		await page.fill('input[placeholder="eliminar"]', 'eliminar');
		await page.click('button:has-text("Eliminar definitivamente")');
		await expect(page).toHaveURL(/\/clientes(\?.*)?$/, { timeout: 15000 });
		await expect(page.locator(`text=${clientName}`)).not.toBeVisible({ timeout: 15000 });
	});

	test('límite de 100 alumnos activos bloquea create', async ({ page }) => {
		const supabase = getSupabaseAdmin();
		const trainerId = await findTrainerIdByEmail(accounts.trainer.email);

		const { count: activeCount, error: countError } = await supabase
			.from('clients')
			.select('id', { count: 'exact', head: true })
			.eq('trainer_id', trainerId)
			.eq('status', 'active');
		if (countError) {
			throw new Error(`Failed counting active clients: ${countError.message}`);
		}

		const missing = Math.max(0, 100 - (activeCount ?? 0));
		if (missing > 0) {
			const rows = Array.from({ length: missing }, (_, index) => ({
				trainer_id: trainerId,
				name: `${makeSeedName('Limit')}__${index}`,
				status: 'active' as const,
				objective: null
			}));

			const { error: insertError } = await supabase.from('clients').insert(rows);
			if (insertError) {
				throw new Error(`Failed seeding active clients for limit test: ${insertError.message}`);
			}
		}

		await expect
			.poll(
				async () => {
					const { count, error } = await supabase
						.from('clients')
						.select('id', { count: 'exact', head: true })
						.eq('trainer_id', trainerId)
						.eq('status', 'active');
					if (error) {
						throw new Error(`Failed polling active clients: ${error.message}`);
					}
					return count ?? 0;
				},
				{ timeout: 15000, intervals: [250, 500, 1000] }
			)
			.toBeGreaterThanOrEqual(100);
		const { count: beforeCreateCount, error: beforeCountError } = await supabase
			.from('clients')
			.select('id', { count: 'exact', head: true })
			.eq('trainer_id', trainerId)
			.eq('status', 'active');
		if (beforeCountError) {
			throw new Error(`Failed counting before create limit assertion: ${beforeCountError.message}`);
		}

		await page.goto('/clientes');
		await page.fill('input[placeholder="Ej: Ana Pérez"]', uniqueName('ShouldFailLimit'));
		await page.click('button:has-text("Crear y generar link")');
		await expect
			.poll(
				async () => {
					const { count, error } = await supabase
						.from('clients')
						.select('id', { count: 'exact', head: true })
						.eq('trainer_id', trainerId)
						.eq('status', 'active');
					if (error) {
						throw new Error(`Failed counting after create limit assertion: ${error.message}`);
					}
					return count ?? 0;
				},
				{ timeout: 15000, intervals: [500, 1000, 1500] }
			)
			.toBe(beforeCreateCount ?? 100);
	});
});
