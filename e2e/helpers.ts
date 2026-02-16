import { Page, expect } from '@playwright/test';

// Test credentials - usar variables de entorno en CI
export const TEST_USER = {
	email:
		process.env.TEST_TRAINER_EMAIL ||
		process.env.TEST_EMAIL ||
		'juampiluduena@gmail.com',
	password:
		process.env.TEST_TRAINER_PASSWORD ||
		process.env.TEST_PASSWORD ||
		'juan1998'
};

const sanitize = (value: string) => value.replace(/[^a-zA-Z0-9_-]/g, '_');
const TEST_RUN_ID =
	process.env.TEST_RUN_ID ||
	sanitize(`${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);
process.env.TEST_RUN_ID = TEST_RUN_ID;

// Helper para login
export async function login(page: Page, email = TEST_USER.email, password = TEST_USER.password) {
	await page.goto('/login');
	await page.fill('input[type="email"]', email);
	await page.fill('input[type="password"]', password);
	await page.click('button[type="submit"]');
	await page.waitForURL(/\/clientes/, { timeout: 15000 });
}

// Helper para logout
export async function logout(page: Page) {
	await page.request.post('/logout', {
		form: {}
	});
	await page.goto('/clientes');
	await page.waitForURL(/\/login|\/$/);
}

// Helper para crear cliente de prueba
export async function createTestClient(page: Page, name: string) {
	await page.goto('/clientes');
	await page.fill('input[placeholder="Ej: Ana Pérez"]', name);
	await page.click('button:has-text("Crear y generar link")');
	await page.waitForURL(/\/clientes\/[a-f0-9-]+/);
	return page.url().split('/').pop()!;
}

// Helper para eliminar cliente
export async function deleteClient(page: Page, clientId: string) {
	await page.goto(`/clientes`);
	// Buscar el cliente y abrir el modal de eliminación
	const clientCard = page.locator(`article:has(button:has-text("Eliminar alumno"))`).first();
	await clientCard.locator('button:has-text("Eliminar alumno")').click();
	await page.fill('input[placeholder="eliminar"]', 'eliminar');
	await page.click('button:has-text("Eliminar definitivamente")');
	await page.waitForURL('/clientes');
}

// Helper para generar nombre único
export function uniqueName(prefix: string) {
	return `E2E__${TEST_RUN_ID}__${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
}

// Helper para esperar feedback
export async function waitForFeedback(page: Page, text: string, timeout = 5000) {
	await expect(page.locator(`text=${text}`)).toBeVisible({ timeout });
}
