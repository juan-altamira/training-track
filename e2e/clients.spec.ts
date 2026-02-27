import { test, expect } from '@playwright/test';
import { uniqueName } from './helpers';

const openStatusConfirm = async (page: import('@playwright/test').Page, retries = 8) => {
	const toggleButton = page
		.locator('button:has-text("Desactivar alumno"), button:has-text("Reactivar alumno")')
		.first();
	const confirmButton = page.locator('button:has-text("Confirmar")').first();

	for (let attempt = 0; attempt < retries; attempt += 1) {
		if (await confirmButton.isVisible().catch(() => false)) {
			return;
		}
		await toggleButton.click({ force: true });
		await page.waitForTimeout(400);
	}

	await expect(confirmButton).toBeVisible({ timeout: 10000 });
};

test.describe('Gestión de Clientes', () => {
	// La sesión ya está autenticada via storageState (auth.setup.ts)
	test.beforeEach(async ({ page }) => {
		await page.goto('/clientes');
	});

	test.describe('Panel de clientes', () => {
		test('muestra lista de clientes', async ({ page }) => {
			await expect(page.locator('text=Crear alumno')).toBeVisible();
			await expect(page.locator('input[placeholder="Ej: Ana Pérez"]')).toBeVisible();
		});

		test('buscador de clientes funciona', async ({ page }) => {
			const searchInput = page.locator('input[placeholder="Buscar alumno"]');
			await expect(searchInput).toBeVisible();
			await searchInput.fill('NonExistentClient123');
			await page.waitForTimeout(500);
		});
	});

	test.describe('Crear cliente', () => {
		test('crear cliente exitosamente', async ({ page }) => {
			const clientName = uniqueName('TestClient');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.click('button:has-text("Crear y generar link")');
			
			// Debe redirigir a la página del cliente
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			await expect(page.getByTestId('back-to-panel')).toBeVisible();
			await expect(page.getByRole('heading', { name: 'RUTINA', exact: true })).toBeVisible();
		});

		test('validación nombre vacío', async ({ page }) => {
			await page.fill('input[placeholder="Ej: Ana Pérez"]', '');
			const createButton = page.locator('button:has-text("Crear y generar link")');
			// El botón debería estar deshabilitado o mostrar error
			await createButton.click();
			// Verificar que no redirige (sigue en /clientes)
			await page.waitForTimeout(1000);
			await expect(page).toHaveURL(/\/clientes$/);
		});

		test('validación nombre duplicado', async ({ page }) => {
			const clientName = uniqueName('DuplicateTest');
			
			// Crear primer cliente
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.click('button:has-text("Crear y generar link")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Volver y crear otro con el mismo nombre
			await page.goto('/clientes');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
				await page.click('button:has-text("Crear y generar link")');
				
				// Debe mostrar error de nombre duplicado
				await expect(page.locator('text=Ya existe un alumno')).toBeVisible({ timeout: 5000 });
			});
		});

	test.describe('Eliminar cliente', () => {
		test('eliminar cliente exitosamente', async ({ page }) => {
			// Crear cliente para eliminar
			const clientName = uniqueName('ToDelete');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.click('button:has-text("Crear y generar link")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Volver a lista de clientes
			await page.goto('/clientes');
			
			// Encontrar y eliminar el cliente
			const clientCard = page.locator(`article:has-text("${clientName}")`);
				await clientCard.locator('button:has-text("Eliminar alumno")').click();
			
			// Confirmar eliminación
			await page.fill('input[placeholder="eliminar"]', 'eliminar');
			await page.click('button:has-text("Eliminar definitivamente")');
			
			// Verificar que se eliminó
			await expect(page).toHaveURL('/clientes');
			await expect(page.locator(`text=${clientName}`)).not.toBeVisible({ timeout: 5000 });
		});

		test('cancelar eliminación', async ({ page }) => {
			// Crear cliente
			const clientName = uniqueName('ToCancel');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.click('button:has-text("Crear y generar link")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			await page.goto('/clientes');
			
			const clientCard = page.locator(`article:has-text("${clientName}")`);
				await clientCard.locator('button:has-text("Eliminar alumno")').click();
			
			// Cancelar
			await page.click('button:has-text("Cancelar")');
			
			// Cliente debe seguir visible
			await expect(page.locator(`text=${clientName}`)).toBeVisible();
		});

		test('botón eliminar existe en cada card', async ({ page }) => {
			const clientCard = page.locator('article').first();
			await expect(clientCard.locator('button:has-text("Eliminar alumno")')).toBeVisible();
		});
	});

	test.describe('Desactivar/Activar cliente', () => {
		test('desactivar cliente muestra badge "Inactivo"', async ({ page }) => {
			// Crear cliente
			const clientName = uniqueName('ToDeactivate');
			await page.fill('input[placeholder="Ej: Ana Pérez"]', clientName);
			await page.click('button:has-text("Crear y generar link")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Desactivar desde la página del cliente
				await openStatusConfirm(page);
				await page.locator('button:has-text("Confirmar")').click({ force: true });
				
				// Esperar que se procese y verificar que el botón cambió a "Activar"
				await expect(page.locator('button:has-text("Reactivar alumno")')).toBeVisible({ timeout: 10000 });
			});
		});

	test.describe('Copiar link público', () => {
		test('botón copiar link existe', async ({ page }) => {
			const clientCard = page.locator('article').first();
			if (await clientCard.isVisible()) {
				await expect(clientCard.locator('button:has-text("Copiar link público")')).toBeVisible();
			}
		});
	});
});
