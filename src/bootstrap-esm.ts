/*---------------------------------------------------------------------------------------------
 * Copyright (c) Microsoft Corporation.
 * Licensed under the MIT License.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'node:fs';
import { register } from 'node:module';
import { product, pkg } from './bootstrap-meta.js';
import './bootstrap-node.js';
import * as perf from './vs/base/common/performance.js';
import { INLSConfiguration } from './vs/nls.js';

/* ---------------------------------- ESM FS Hook ---------------------------------- */

const isElectron =
	process.env.ELECTRON_RUN_AS_NODE || process.versions.electron;

if (isElectron) {
	const loader = `
		export async function resolve(specifier, ctx, next) {
			if (specifier === 'fs') {
				return {
					format: 'builtin',
					shortCircuit: true,
					url: 'node:original-fs'
				};
			}
			return next(specifier, ctx);
		}
	`;

	register(
		`data:text/javascript;base64,${Buffer.from(loader).toString('base64')}`,
		import.meta.url
	);
}

/* ---------------------------------- Globals ---------------------------------- */

Object.assign(globalThis, {
	_VSCODE_PRODUCT_JSON: { ...product },
	_VSCODE_PACKAGE_JSON: { ...pkg },
	_VSCODE_FILE_ROOT: import.meta.dirname
});

/* ---------------------------------- NLS ---------------------------------- */

let nlsSetup: Promise<INLSConfiguration | undefined> | undefined;

const setupNLS = () => nlsSetup ??= loadNLS();

async function loadNLS(): Promise<INLSConfiguration | undefined> {
	perf.mark('code/willLoadNls');

	const env = process.env.VSCODE_NLS_CONFIG;
	if (!env || process.env.VSCODE_DEV) return;

	let config: INLSConfiguration | undefined;
	let messagesFile: string | undefined;

	try {
		config = JSON.parse(env);
		messagesFile =
			config?.languagePack?.messagesFile ??
			config?.defaultMessagesFile;

		globalThis._VSCODE_NLS_LANGUAGE = config?.resolvedLanguage;
	} catch (e) {
		console.error('Invalid VSCODE_NLS_CONFIG:', e);
		return;
	}

	if (!messagesFile) return;

	try {
		globalThis._VSCODE_NLS_MESSAGES = JSON.parse(
			await fs.promises.readFile(messagesFile, 'utf8')
		);
	} catch (e) {
		console.error(`NLS read error: ${messagesFile}`, e);
		await markCorrupt(config);
		await fallbackToDefault(config, messagesFile);
	}

	perf.mark('code/didLoadNls');
	return config;
}

async function markCorrupt(config?: INLSConfiguration) {
	const file = config?.languagePack?.corruptMarkerFile;
	if (!file) return;

	try {
		await fs.promises.writeFile(file, 'corrupted');
	} catch (e) {
		console.error('Corrupt marker write failed:', e);
	}
}

async function fallbackToDefault(
	config?: INLSConfiguration,
	current?: string
) {
	const fallback = config?.defaultMessagesFile;
	if (!fallback || fallback === current) return;

	try {
		globalThis._VSCODE_NLS_MESSAGES = JSON.parse(
			await fs.promises.readFile(fallback, 'utf8')
		);
	} catch (e) {
		console.error(`Default NLS read error: ${fallback}`, e);
	}
}

/* ---------------------------------- Bootstrap ---------------------------------- */

export async function bootstrapESM(): Promise<void> {
	await setupNLS();
}
