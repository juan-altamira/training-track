import { test as setup, expect } from '@playwright/test';
import { TEST_USER } from './helpers';

const authFile = 'e2e/.auth/user.json';

setup('authenticate', async ({ page }) => {
	await page.goto('/login');
	await page.fill('input[type="email"]', TEST_USER.email);
	await page.fill('input[type="password"]', TEST_USER.password);
	await page.click('button[type="submit"]');
	
	// Esperar a que el login sea exitoso
	await expect(page).toHaveURL(/\/clientes/, { timeout: 15000 });
	
	// Guardar el estado de la sesión
	await page.context().storageState({ path: authFile });
});
