import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

type PlaywrightTestNode = {
	title: string;
	specs?: Array<{
		title: string;
		tests: Array<{
			timeout?: number;
			results?: Array<{
				status: string;
				duration?: number;
				error?: { message?: string };
				errors?: Array<{ message?: string }>;
			}>;
		}>;
	}>;
	tests?: Array<{
		title: string;
		timeout?: number;
		results?: Array<{
			status: string;
			duration?: number;
			error?: { message?: string };
			errors?: Array<{ message?: string }>;
		}>;
	}>;
	suites?: PlaywrightTestNode[];
};

type PlaywrightJsonReport = {
	config?: { projects?: Array<{ name: string }> };
	suites?: PlaywrightTestNode[];
	errors?: Array<{ message?: string }>;
};

type FlattenedResult = {
	titlePath: string[];
	status: string;
	durationMs: number;
	errorMessage?: string;
};

const loadJson = <T>(filePath: string): T | null => {
	if (!existsSync(filePath)) return null;
	return JSON.parse(readFileSync(filePath, 'utf8')) as T;
};

const listPlaywrightReports = (): string[] => {
	const explicit = process.env.PW_JSON_REPORT?.trim();
	if (explicit) {
		return [resolve(explicit)];
	}

	const candidateDirs = [
		resolve(process.env.AUDIT_REPORT_INPUT_DIR ?? 'test-results/reports'),
		resolve('test-results', 'playwright')
	];
	const collected = new Set<string>();

	for (const dir of candidateDirs) {
		if (!existsSync(dir)) continue;
		for (const entry of readdirSync(dir)) {
			if (!entry.endsWith('.json')) continue;
			if (entry.startsWith('.')) continue;
			collected.add(resolve(dir, entry));
		}
	}

	return [...collected].sort();
};

const flattenPlaywrightResults = (suites: PlaywrightTestNode[] = [], path: string[] = []): FlattenedResult[] => {
	const results: FlattenedResult[] = [];

	for (const suite of suites) {
		const currentPath = [...path, suite.title].filter(Boolean);
		for (const spec of suite.specs ?? []) {
			for (const test of spec.tests ?? []) {
				const titlePath = [...currentPath, spec.title];
				const lastResult = test.results?.[test.results.length - 1];
				const errorFromArray = lastResult?.errors?.[0]?.message;
				results.push({
					titlePath,
					status: lastResult?.status ?? 'unknown',
					durationMs: lastResult?.duration ?? 0,
					errorMessage: lastResult?.error?.message ?? errorFromArray
				});
			}
		}

		for (const test of suite.tests ?? []) {
			const titlePath = [...currentPath, test.title];
			const lastResult = test.results?.[test.results.length - 1];
			const errorFromArray = lastResult?.errors?.[0]?.message;
			results.push({
				titlePath,
				status: lastResult?.status ?? 'unknown',
				durationMs: lastResult?.duration ?? 0,
				errorMessage: lastResult?.error?.message ?? errorFromArray
			});
		}
		results.push(...flattenPlaywrightResults(suite.suites ?? [], currentPath));
	}

	return results;
};

const writeFailureMarkdown = (targetPath: string, failed: FlattenedResult[]) => {
	if (failed.length === 0) {
		writeFileSync(targetPath, '# Failures\n\nNo failed tests.\n', 'utf8');
		return;
	}

	const lines = ['# Failures', ''];
	for (const failure of failed) {
		lines.push(`- ${failure.titlePath.join(' > ')}`);
		if (failure.errorMessage) {
			lines.push(`  - Error: ${failure.errorMessage.replace(/\n/g, ' ')}`);
		}
	}
	lines.push('');
	writeFileSync(targetPath, `${lines.join('\n')}\n`, 'utf8');
};

const writeAuthzMatrix = (targetPath: string, allResults: FlattenedResult[]) => {
	const authz = allResults.filter((result) => result.titlePath.join(' ').includes('[AUTHZ]'));
	const header = 'test,status,duration_ms\n';
	const rows = authz
		.map((row) => {
			const testName = row.titlePath.join(' > ').replace(/"/g, '""');
			return `"${testName}",${row.status},${row.durationMs}`;
		})
		.join('\n');
	writeFileSync(targetPath, `${header}${rows}${rows ? '\n' : ''}`, 'utf8');
};

const main = () => {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const auditDir = resolve('test-results', 'audit', timestamp);
	mkdirSync(auditDir, { recursive: true });

	const playwrightReportPaths = listPlaywrightReports();
	const flattened = playwrightReportPaths.flatMap((reportPath) => {
		const report = loadJson<PlaywrightJsonReport>(reportPath);
		return flattenPlaywrightResults(report?.suites ?? []);
	});

	const total = flattened.length;
	const passed = flattened.filter((result) => result.status === 'passed').length;
	const failed = flattened.filter((result) => ['failed', 'timedOut', 'interrupted'].includes(result.status));
	const flaky = flattened.filter((result) => result.status === 'flaky').length;
	const skipped = flattened.filter((result) => result.status === 'skipped').length;
	const executed = total - skipped;
	const passRate = executed > 0 ? Number(((passed / executed) * 100).toFixed(2)) : 0;

	const desktopPerf = loadJson<Record<string, unknown>>(
		resolve(process.env.PERF_OUTPUT ?? 'test-results/panel-navigation-benchmark.json')
	);
	const mobilePerf = loadJson<Record<string, unknown>>(
		resolve(process.env.PERF_OUTPUT_MOBILE ?? 'test-results/panel-navigation-mobile-benchmark.json')
	);

	const summary = {
		timestamp_utc: new Date().toISOString(),
		playwright_report_paths: playwrightReportPaths,
		totals: {
			total,
			executed,
			passed,
			failed: failed.length,
			flaky,
			skipped,
			pass_rate_percent: passRate
		},
		critical: {
			pass_rate_target_percent: 98,
			pass_rate_ok: passRate >= 98
		},
		artifacts: {
			failures_md: 'failures.md',
			authz_matrix_csv: 'authz-matrix.csv',
			perf_json: 'perf.json'
		}
	};

	writeFileSync(resolve(auditDir, 'summary.json'), `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
	writeFailureMarkdown(resolve(auditDir, 'failures.md'), failed);
	writeAuthzMatrix(resolve(auditDir, 'authz-matrix.csv'), flattened);
	writeFileSync(
		resolve(auditDir, 'perf.json'),
		`${JSON.stringify({ desktop: desktopPerf, mobile: mobilePerf }, null, 2)}\n`,
		'utf8'
	);

	console.log(JSON.stringify({ ok: true, audit_dir: auditDir, summary }, null, 2));
};

main();
