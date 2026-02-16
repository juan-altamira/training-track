import { expect, type APIRequestContext, type Page } from '@playwright/test';

export const expectStatusForPath = async (
	request: APIRequestContext,
	path: string,
	expected: number,
	headers?: Record<string, string>
) => {
	const response = await request.get(path, { headers });
	expect(response.status(), `Unexpected status for ${path}`).toBe(expected);
	return response;
};

export const expectRedirectToLogin = async (page: Page, path: string) => {
	await page.goto(path);
	await expect(page).toHaveURL(/\/login(\?.*)?$/);
};
