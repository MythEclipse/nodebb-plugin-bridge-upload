'use strict';

// Guard against the Docker-era app path creeping back into this plugin.
//
// That path is what broke the native install: the plugin resolved
// '/usr/src/app', NodeBB logged "Unable to load library", and the upload
// route answered 404 exactly like a route that never existed.
//
// This lives in a script file rather than an inline `node -e` step. An inline
// version is what shipped first and it could not even run: bash consumed the
// backticks inside the double-quoted string, so the regex that strips template
// literals arrived mangled as /(?:[^\])/, and node died with "Unterminated
// regexp literal" before checking anything. Keeping the JS in a file removes
// the shell from the picture entirely.
//
// Comments and template literals are stripped first, so the explanation of the
// bug in app-root.js and the regression test that quotes it do not trip the
// check. Only a real reference in code does.

const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');

// Assembled from fragments so this file does not contain the needle it looks
// for, and so it is not excluded from its own scan.
const NEEDLE = ['/usr', '/src', '/app'].join('');

const files = [];
(function walk(dir) {
	let entries;
	try {
		entries = fs.readdirSync(dir, { withFileTypes: true });
	} catch (err) {
		return;
	}
	for (const entry of entries) {
		// node_modules and dotfiles (.github) hold no plugin source.
		if (entry.name === 'node_modules' || entry.name.startsWith('.')) {
			continue;
		}
		const full = path.join(dir, entry.name);
		if (entry.isDirectory()) {
			walk(full);
		} else if (entry.name.endsWith('.js')) {
			files.push(full);
		}
	}
})(repoRoot);

// A block comment, a line comment, or a template literal. Good enough to keep
// prose out of the result; a path that survives all three is a real reference.
const NOISE = [
	[/\/\*[\s\S]*?\*\//g, ''],
	[/^\s*\/\/.*$/gm, ''],
	[/(?:^|[^\\])`(?:[^`\\]|\\.)*`/g, '``'],
];

function stripNoise(source) {
	return NOISE.reduce((acc, [pattern, replacement]) => acc.replace(pattern, replacement), source);
}

const offenders = [];
for (const file of files) {
	const code = stripNoise(fs.readFileSync(file, 'utf8'));
	if (code.includes(NEEDLE)) {
		offenders.push(path.relative(repoRoot, file));
	}
}

if (offenders.length) {
	console.error(`FAIL: ${NEEDLE} referenced in code by:`);
	for (const file of offenders) {
		console.error(`  ${file}`);
	}
	console.error('');
	console.error('That is the Docker app path and it does not exist on this host.');
	console.error('Resolve the app root instead — see app-root.js.');
	process.exit(1);
}

console.log(`  checked ${files.length} JS files, no Docker app path in code`);