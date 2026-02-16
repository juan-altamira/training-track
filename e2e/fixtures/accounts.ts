import type { TestAccounts } from './types';

const read = (key: string): string | undefined => {
	const value = process.env[key]?.trim();
	return value ? value : undefined;
};

const readCredential = (emailKey: string, passwordKey: string) => {
	const email = read(emailKey);
	const password = read(passwordKey);
	if (!email || !password) {
		return undefined;
	}
	return { email, password };
};

export const getTestAccounts = (): TestAccounts => {
	const trainer =
		readCredential('TEST_TRAINER_EMAIL', 'TEST_TRAINER_PASSWORD') ??
		readCredential('TEST_EMAIL', 'TEST_PASSWORD') ?? {
			email: 'juampiluduena@gmail.com',
			password: 'juan1998'
		};

	const owner = readCredential('TEST_OWNER_EMAIL', 'TEST_OWNER_PASSWORD');
	const disabled = readCredential('TEST_DISABLED_EMAIL', 'TEST_DISABLED_PASSWORD');

	return {
		trainer,
		owner,
		disabled
	};
};
