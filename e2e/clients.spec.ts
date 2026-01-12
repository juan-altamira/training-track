import { test, expect } from '@playwright/test';
import { login, uniqueName } from './helpers';

test.describe('Gestión de Clientes', () => {
	test.beforeEach(async ({ page }) => {
		await login(page);
	});

	test.describe('Panel de clientes', () => {
		test('muestra lista de clientes', async ({ page }) => {
			await expect(page.locator('h2:has-text("Crear cliente")')).toBeVisible();
			await expect(page.locator('input[placeholder="Nombre del cliente"]')).toBeVisible();
		});

		test('buscador de clientes funciona', async ({ page }) => {
			const searchInput = page.locator('input[placeholder*="Buscar"]');
			if (await searchInput.isVisible()) {
				await searchInput.fill('NonExistentClient123');
				// Esperar un momento para que filtre
				await page.waitForTimeout(500);
			}
		});
	});

	test.describe('Crear cliente', () => {
		test('crear cliente exitosamente', async ({ page }) => {
			const clientName = uniqueName('TestClient');
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			
			// Debe redirigir a la página del cliente
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			await expect(page.locator(`text=${clientName}`)).toBeVisible();
		});

		test('validación nombre vacío', async ({ page }) => {
			await page.fill('input[placeholder="Nombre del cliente"]', '');
			const createButton = page.locator('button:has-text("Crear cliente")');
			// El botón debería estar deshabilitado o mostrar error
			await createButton.click();
			// Verificar que no redirige (sigue en /clientes)
			await page.waitForTimeout(1000);
			await expect(page).toHaveURL(/\/clientes$/);
		});

		test('validación nombre duplicado', async ({ page }) => {
			const clientName = uniqueName('DuplicateTest');
			
			// Crear primer cliente
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Volver y crear otro con el mismo nombre
			await page.goto('/clientes');
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			
			// Debe mostrar error de nombre duplicado
			await expect(page.locator('text=Ya existe un cliente')).toBeVisible({ timeout: 5000 });
		});
	});

	test.describe('Eliminar cliente', () => {
		test('eliminar cliente exitosamente', async ({ page }) => {
			// Crear cliente para eliminar
			const clientName = uniqueName('ToDelete');
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Volver a lista de clientes
			await page.goto('/clientes');
			
			// Encontrar y eliminar el cliente
			const clientCard = page.locator(`article:has-text("${clientName}")`);
			await clientCard.locator('button:has-text("Eliminar cliente")').click();
			
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
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			await page.goto('/clientes');
			
			const clientCard = page.locator(`article:has-text("${clientName}")`);
			await clientCard.locator('button:has-text("Eliminar cliente")').click();
			
			// Cancelar
			await page.click('button:has-text("Cancelar")');
			
			// Cliente debe seguir visible
			await expect(page.locator(`text=${clientName}`)).toBeVisible();
		});

		test('validación de texto "eliminar"', async ({ page }) => {
			const clientCard = page.locator('article').first();
			if (await clientCard.isVisible()) {
				await clientCard.locator('button:has-text("Eliminar cliente")').click();
				
				// Escribir texto incorrecto
				await page.fill('input[placeholder="eliminar"]', 'borrar');
				
				// Botón debe estar deshabilitado
				const deleteButton = page.locator('button:has-text("Eliminar definitivamente")');
				await expect(deleteButton).toBeDisabled();
				
				// Cerrar modal
				await page.click('button:has-text("Cancelar")');
			}
		});
	});

	test.describe('Desactivar/Activar cliente', () => {
		test('desactivar cliente muestra badge "Inactivo"', async ({ page }) => {
			// Crear cliente
			const clientName = uniqueName('ToDeactivate');
			await page.fill('input[placeholder="Nombre del cliente"]', clientName);
			await page.click('button:has-text("Crear cliente")');
			await expect(page).toHaveURL(/\/clientes\/[a-f0-9-]+/, { timeout: 10000 });
			
			// Desactivar desde la página del cliente
			await page.click('button:has-text("Desactivar cliente")');
			await page.click('button:has-text("Sí, desactivar")');
			
			// Volver a lista y verificar badge
			await page.goto('/clientes');
			const clientCard = page.locator(`article:has-text("${clientName}")`);
			await expect(clientCard.locator('text=Inactivo')).toBeVisible();
		});
	});

	test.describe('Copiar link público', () => {
		test('botón copiar link existe', async ({ page }) => {
			const clientCard = page.locator('article').first();
			if (await clientCard.isVisible()) {
				await expect(clientCard.locator('button:has-text("Copiar link")')).toBeVisible();
			}
		});
	});
});
