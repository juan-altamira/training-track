import { test as setup, expect } from '@playwright/test';
import { TEST_USER } from './helpers';
import { getSupabaseAdmin, isSupabaseAdminConfigured } from '../tests/helpers/supabase-admin';

const authFile = 'e2e/.auth/user.json';
const shouldAutoEnableTrainer = process.env.TEST_AUTO_ENABLE_TRAINER === '1';

const ensureTrainerEnabledForSetup = async () => {
	if (!shouldAutoEnableTrainer) return;
	if (!isSupabaseAdminConfigured()) return;

	const email = TEST_USER.email.trim().toLowerCase();
	if (!email) return;

	const supabase = getSupabaseAdmin();
	const { error: accessError } = await supabase.from('trainer_access').upsert({ email, active: true });
	if (accessError) {
		console.error('auth.setup trainer_access upsert error', accessError);
	}

	const { data: trainer, error: trainerError } = await supabase
		.from('trainers')
		.select('id')
		.eq('email', email)
		.maybeSingle();

	if (trainerError) {
		console.error('auth.setup trainer lookup error', trainerError);
		return;
	}

	if (trainer?.id) {
		const { error: statusError } = await supabase
			.from('trainers')
			.update({ status: 'active' })
			.eq('id', trainer.id);
		if (statusError) {
			console.error('auth.setup trainer status update error', statusError);
		}
	}
};

setup('authenticate', async ({ page }) => {
	await ensureTrainerEnabledForSetup();

	await page.goto('/login');
	await expect(page.locator('input[type="email"]')).toBeVisible({ timeout: 15000 });
	await page.fill('input[type="email"]', TEST_USER.email);
	await page.fill('input[type="password"]', TEST_USER.password);
	await page.click('button[type="submit"]');
	
	// Esperar a que el login sea exitoso
	await expect(page).toHaveURL(/\/clientes/, { timeout: 15000 });
	
	// Guardar el estado de la sesión
	await page.context().storageState({ path: authFile });
});
