import { test, expect } from '@playwright/test';
import { cleanupRunAndAssert } from '../fixtures/cleanup';
import { seedClientForTrainer } from '../fixtures/dataFactory';
import { createEmptyPlan } from '../../tests/helpers/seed';
import { getTestAccounts } from '../fixtures/accounts';
import { getSupabaseAdmin } from '../../tests/helpers/supabase-admin';
import { uniqueName } from '../helpers';

const accounts = getTestAccounts();
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

test.describe('Full /clientes/[id] actions', () => {
	test.afterAll(async () => {
		await cleanupRunAndAssert();
	});

	test('saveRoutine valida JSON inválido y límite >50 ejercicios', async ({ page }) => {
		const created = await createOwnedClient(page, 'RoutineEditorValidation');
		const invalidJsonResponse = await actionPost(page, `/clientes/${created.id}?/saveRoutine`, {
			plan: '{invalid-json'
		});
		const invalidJsonText = await invalidJsonResponse.text();
		expect(invalidJsonText).toContain('Formato de rutina inválido');

		const plan = createEmptyPlan();
		plan.monday.exercises = Array.from({ length: 51 }, (_, index) => ({
			id: `ex-${index}`,
			name: `Ejercicio ${index}`,
			scheme: '',
			order: index,
			totalSets: 1,
			repsMin: 8,
			repsMax: null,
			showRange: false
		}));

		const tooManyResponse = await actionPost(page, `/clientes/${created.id}?/saveRoutine`, {
			plan: JSON.stringify(plan)
		});
		const tooManyText = await tooManyResponse.text();
		expect(tooManyText).toContain('Límite de 50 ejercicios');
	});

	test('copyRoutine: self-copy inválido, copy success y reset de progreso', async ({ page }) => {
		const sourcePlan = createEmptyPlan();
		sourcePlan.monday.exercises.push({
			id: 'src-ex-1',
			name: 'Dominadas',
			scheme: '',
			order: 0,
			totalSets: 4,
			repsMin: 6,
			repsMax: null,
			showRange: false
		});

		const source = await createOwnedClient(page, 'CopySource');
		const target = await createOwnedClient(page, 'CopyTarget');

		const saveSourcePlanRes = await actionPost(page, `/clientes/${source.id}?/saveRoutine`, {
			plan: JSON.stringify(sourcePlan)
		});
		expect(saveSourcePlanRes.status()).toBe(200);

		const selfCopy = await actionPost(page, `/clientes/${target.id}?/copyRoutine`, {
			source_client_id: target.id
		});
		const selfCopyText = await selfCopy.text();
		expect(selfCopyText).toContain('No tiene sentido copiar sobre el mismo alumno');

		const copyRes = await actionPost(page, `/clientes/${target.id}?/copyRoutine`, {
			source_client_id: source.id
		});
		expect(copyRes.status()).toBe(200);

		const supabase = getSupabaseAdmin();
		const { data: targetRoutine } = await supabase
			.from('routines')
			.select('plan')
			.eq('client_id', target.id)
			.single();
		expect((targetRoutine?.plan as any)?.monday?.exercises?.[0]?.name).toBe('Dominadas');

		const { data: targetProgress } = await supabase
			.from('progress')
			.select('last_completed_at')
			.eq('client_id', target.id)
			.single();
		expect(targetProgress?.last_completed_at).toBeNull();
	});

	test('setStatus y resetProgress dejan estado consistente', async ({ page }) => {
		const created = await createOwnedClient(page, 'StatusReset');
		const supabase = getSupabaseAdmin();

		const archive = await actionPost(page, `/clientes/${created.id}?/setStatus`, {
			status: 'archived'
		});
		expect(archive.status()).toBe(200);

		const { data: archivedRow } = await supabase
			.from('clients')
			.select('status')
			.eq('id', created.id)
			.single();
		expect(archivedRow?.status).toBe('archived');

		const activate = await actionPost(page, `/clientes/${created.id}?/setStatus`, {
			status: 'active'
		});
		expect(activate.status()).toBe(200);

		const reset = await actionPost(page, `/clientes/${created.id}?/resetProgress`, {
			reset: 'true'
		});
		expect(reset.status()).toBe(200);

		const { data: progressRows } = await supabase
			.from('progress')
			.select('client_id,progress,last_completed_at')
			.eq('client_id', created.id);
		expect(progressRows?.length).toBe(1);
		expect(progressRows?.[0]?.last_completed_at).toBeNull();
	});

	test('copyRoutine prohíbe copiar desde cliente de otro entrenador', async ({ page }) => {
		test.skip(!accounts.owner, 'Owner account no configurada para cross-trainer authz');

		const sourceOtherTrainer = await seedClientForTrainer(accounts.owner!.email, 'SourceOtherTrainer');
		const target = await createOwnedClient(page, 'TargetTrainerSelf');
		const res = await actionPost(page, `/clientes/${target.id}?/copyRoutine`, {
			source_client_id: sourceOtherTrainer.id
		});
		expect(res.status()).toBe(403);
	});
});
