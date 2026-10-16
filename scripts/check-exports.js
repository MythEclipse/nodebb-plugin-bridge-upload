'use strict';

// NodeBB mounts this plugin's route from `load`, and it must be a direct
// property of module.exports at require time. The earlier shape
//
//   module.exports = function (Plugin) { Plugin.load = ... }
//
// produced a plugin that loaded without error and registered nothing, so the
// upload route silently never appeared.
//
// A file rather than an inline `node -e`, for the same reason as
// check-no-docker-path.js: bash rewrites backticks and $ inside a
// double-quoted -e string, which is how the first version of that check died
// before it ran a single check.

const fs = require('fs');
const path = require('path');

const source = fs.readFileSync(path.join(__dirname, '..', 'library.js'), 'utf8');

const checks = [
	{
		what: '`load` is a direct property of module.exports',
		pattern: /module\.exports\s*=\s*\{[^}]*\bload\b/,
		fix: 'Export load directly: module.exports = { load, ... }.',
	},
	{
		what: 'uploadPost is exported',
		pattern: /module\.exports\.uploadPost\s*=/,
		fix: 'Re-export uploadsController.uploadPost so the core controller is reachable.',
	},
	{
		what: 'the app root is resolved from ./app-root, not guessed',
		pattern: /require\(['"]\.\/app-root['"]\)/,
		fix: 'Require { resolveAppRoot } from ./app-root instead of hardcoding a path.',
	},
];

let failed = 0;
for (const check of checks) {
	if (check.pattern.test(source)) {
		console.log(`  ok - ${check.what}`);
		continue;
	}
	console.error(`  FAIL - ${check.what}`);
	console.error(`         ${check.fix}`);
	failed += 1;
}

if (failed) {
	console.error('');
	console.error('library.js would load without error but register nothing.');
	process.exit(1);
}
