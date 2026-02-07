import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

type Stats = {
	samples: number[];
	p50_ms: number;
	p95_ms: number;
	avg_ms: number;
	min_ms: number;
	max_ms: number;
};

const toStats = (samples: number[]): Stats => {
	const sorted = [...samples].sort((a, b) => a - b);
	const p = (value: number) => {
		if (sorted.length === 0) return 0;
		const idx = Math.ceil((value / 100) * sorted.length) - 1;
		return sorted[Math.max(0, Math.min(sorted.length - 1, idx))];
	};
	const sum = sorted.reduce((acc, ms) => acc + ms, 0);

	return {
		samples,
		p50_ms: p(50),
		p95_ms: p(95),
		avg_ms: sorted.length ? sum / sorted.length : 0,
		min_ms: sorted[0] ?? 0,
		max_ms: sorted[sorted.length - 1] ?? 0
	};
};

const main = async () => {
	const baseUrl = process.env.TEST_BASE_URL ?? 'https://training-track.vercel.app';
	const email = process.env.TEST_EMAIL;
	const password = process.env.TEST_PASSWORD;
	const rounds = Number(process.env.PERF_ROUNDS ?? 30);
	const outputFile = process.env.PERF_OUTPUT ?? 'test-results/panel-navigation-benchmark.json';

	if (!email || !password) {
		throw new Error('TEST_EMAIL y TEST_PASSWORD son obligatorios para el benchmark.');
	}
	if (!Number.isFinite(rounds) || rounds <= 0) {
		throw new Error('PERF_ROUNDS debe ser un número positivo.');
	}

	const browser = await chromium.launch({ headless: true });
	const context = await browser.newContext();
	const page = await context.newPage();

	const openSamples: number[] = [];
	const backSamples: number[] = [];

	try {
		await page.goto(`${baseUrl}/login`, { waitUntil: 'domcontentloaded', timeout: 45_000 });
		await page.fill('input[type="email"]', email);
		await page.fill('input[type="password"]', password);

		await Promise.all([
			page.waitForURL(/\/clientes(\?.*)?$/, { timeout: 45_000 }),
			page.click('button[type="submit"]')
		]);

		await page.waitForSelector('button:has-text("Abrir rutina del alumno")', { timeout: 45_000 });

		for (let i = 0; i < rounds; i++) {
			const openStart = Date.now();
			await Promise.all([
				page.waitForURL(/\/clientes\/[a-f0-9-]+$/, { timeout: 45_000 }),
				page.locator('button:has-text("Abrir rutina del alumno")').first().click()
			]);
			await page.waitForSelector('text=Volver al panel', { timeout: 45_000 });
			openSamples.push(Date.now() - openStart);

			const backStart = Date.now();
			await Promise.all([
				page.waitForURL(/\/clientes(\?.*)?$/, { timeout: 45_000 }),
				page.click('text=Volver al panel')
			]);
			await page.waitForSelector('button:has-text("Abrir rutina del alumno")', { timeout: 45_000 });
			backSamples.push(Date.now() - backStart);
		}
	} finally {
		await browser.close();
	}

	const report = {
		timestamp_utc: new Date().toISOString(),
		base_url: baseUrl,
		rounds,
		open: toStats(openSamples),
		back: toStats(backSamples)
	};

	mkdirSync(dirname(outputFile), { recursive: true });
	writeFileSync(outputFile, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

	console.log(JSON.stringify(report, null, 2));
	console.log(`\nBenchmark guardado en ${outputFile}`);
};

main().catch((error) => {
	console.error(error);
	process.exit(1);
});
