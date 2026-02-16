import { defineConfig, devices } from '@playwright/test';
import dotenv from 'dotenv';
import { resolve } from 'node:path';

dotenv.config({ path: resolve(process.cwd(), '.env') });
dotenv.config({ path: resolve(process.cwd(), 'e2e/.env'), override: true });

const retries = process.env.PW_RETRIES
	? Number(process.env.PW_RETRIES)
	: process.env.CI
		? 1
		: 0;

const testBaseUrl = process.env.TEST_BASE_URL || 'http://localhost:5173';
const shouldStartWebServer =
	!process.env.CI &&
	/localhost|127\.0\.0\.1/.test(testBaseUrl);

export default defineConfig({
	testDir: './e2e',
	fullyParallel: false,
	forbidOnly: !!process.env.CI,
	retries: Number.isFinite(retries) ? retries : 0,
	workers: 1,
	reporter: [
		['list'],
		['html', { open: 'never', outputFolder: process.env.PW_HTML_REPORT ?? 'playwright-report' }],
		['json', { outputFile: process.env.PW_JSON_REPORT ?? 'test-results/playwright/results.json' }]
	],
	timeout: 60000,
	outputDir: 'test-results/playwright',
	use: {
		baseURL: testBaseUrl,
		trace: 'on-first-retry',
		screenshot: 'only-on-failure',
		video: 'retain-on-failure'
	},
	projects: [
		{
			name: 'setup',
			testMatch: /.*\.setup\.ts/
		},
		{
			name: 'chromium',
			use: {
				...devices['Desktop Chrome'],
				storageState: 'e2e/.auth/user.json'
			},
			dependencies: ['setup'],
			testIgnore: /.*\.setup\.ts/
		},
		{
			name: 'mobile-chromium',
			use: {
				...devices['Pixel 7'],
				storageState: 'e2e/.auth/user.json'
			},
			dependencies: ['setup'],
			testIgnore: /.*\.setup\.ts/
		}
	],
	webServer: shouldStartWebServer
		? {
				command: 'npm run dev',
				url: 'http://localhost:5173',
				reuseExistingServer: !process.env.CI,
				timeout: 120000
			}
		: undefined
});
