// Tests for the app-root lookup, which is the only part of this plugin that
// can be exercised without a booted NodeBB.
//
// The regression this guards is not hypothetical. The old implementation
// returned '/usr/src/app' whenever no candidate matched, so on this host — which
// runs NodeBB natively at /opt/nodebb/app — the plugin threw
// `Cannot find module '/usr/src/app/src/routes/helpers'`, NodeBB logged
// "Unable to load library", and the upload route silently answered 404. Nothing
// failed loudly; the bridge just stopped posting images.
//
// library.js itself cannot be require()d here: it pulls in src/routes/helpers,
// and NodeBB core calls process.exit(0) when those load outside a booted app.
//
// Run: node test/app-root.test.js

const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { resolveAppRoot, isAppRoot, MARKER } = require(path.join(__dirname, '..', 'app-root.js'));

let passed = 0;
const failures = [];

function test(name, fn) {
	try {
		fn();
		console.log(`ok - ${name}`);
		passed += 1;
	} catch (err) {
		console.log(`not ok - ${name}`);
		console.log(`  ${err.message}`);
		failures.push(name);
	}
}

// Build a throwaway app root, and optionally a plugin installed inside it.
function fakeApp(name) {
	const app = fs.mkdtempSync(path.join(os.tmpdir(), `nbb-${name}-`));
	fs.mkdirSync(path.join(app, 'src', 'routes'), { recursive: true });
	fs.writeFileSync(path.join(app, MARKER), '// stub\n');
	return app;
}

test('isAppRoot accepts a directory containing src/routes/helpers.js', () => {
	const app = fakeApp('ok');
	assert.strictEqual(isAppRoot(app), true);
	fs.rmSync(app, { recursive: true, force: true });
});

test('isAppRoot rejects a directory without it', () => {
	const bare = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-bare-'));
	assert.strictEqual(isAppRoot(bare), false);
	fs.rmSync(bare, { recursive: true, force: true });
});

test('isAppRoot rejects a directory where the marker is a directory, not a file', () => {
	const app = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-dir-'));
	fs.mkdirSync(path.join(app, 'src', 'routes', 'helpers.js'), { recursive: true });
	assert.strictEqual(isAppRoot(app), false, 'a directory named helpers.js is not an app root');
	fs.rmSync(app, { recursive: true, force: true });
});

test('isAppRoot tolerates null and undefined', () => {
	assert.strictEqual(isAppRoot(null), false);
	assert.strictEqual(isAppRoot(undefined), false);
});

test('NODEBB_APP_ROOT wins over everything else', () => {
	const envRoot = fakeApp('env');
	const other = fakeApp('other');
	const resolved = resolveAppRoot({ env: { NODEBB_APP_ROOT: envRoot }, cwd: other, pluginDir: other });
	assert.strictEqual(resolved, envRoot);
	fs.rmSync(envRoot, { recursive: true, force: true });
	fs.rmSync(other, { recursive: true, force: true });
});

test('the cwd is used when no env var is set', () => {
	const app = fakeApp('cwd');
	const elsewhere = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-nope-'));
	const resolved = resolveAppRoot({ env: {}, cwd: app, pluginDir: elsewhere });
	assert.strictEqual(resolved, app, 'NodeBB is always started from its app root, so cwd is reliable');
	fs.rmSync(app, { recursive: true, force: true });
	fs.rmSync(elsewhere, { recursive: true, force: true });
});

test('a plugin installed at <app>/node_modules/<id> walks up to the app root', () => {
	const app = fakeApp('nm');
	const pluginDir = path.join(app, 'node_modules', 'nodebb-plugin-bridge-upload');
	fs.mkdirSync(pluginDir, { recursive: true });
	const resolved = resolveAppRoot({ env: {}, cwd: '/', pluginDir });
	assert.strictEqual(resolved, app, 'the checkout layout the walk was written for');
	fs.rmSync(app, { recursive: true, force: true });
});

test('a symlinked plugin outside the app still resolves via the walk', () => {
	// This is the live layout: the plugin is symlinked into /opt/nodebb/plugins,
	// so __dirname is outside the app entirely and only the walk can save it.
	const app = fakeApp('link');
	const pluginsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-plugins-'));
	const pluginDir = path.join(pluginsDir, 'bridge-upload-plugin');
	fs.mkdirSync(pluginDir, { recursive: true });
	const resolved = resolveAppRoot({ env: {}, cwd: app, pluginDir });
	assert.strictEqual(resolved, app, 'the cwd anchor covers the symlinked install');
	fs.rmSync(app, { recursive: true, force: true });
	fs.rmSync(pluginsDir, { recursive: true, force: true });
});

test('no candidate at all throws instead of guessing a Docker path', () => {
	// THE regression. The old code returned '/usr/src/app' here, which made the
	// caller throw `Cannot find module '/usr/src/app/src/routes/helpers'`,
	// which NodeBB logged as "Unable to load library" while carrying on — a
	// silent 404 on the upload route.
	const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-empty-'));
	assert.throws(
		() => resolveAppRoot({ env: {}, cwd: nowhere, pluginDir: nowhere }),
		/could not locate the NodeBB app root/,
		'a wrong app root must be loud, not a silent fallback'
	);
	fs.rmSync(nowhere, { recursive: true, force: true });
});

test('the error names what it tried, so the log is actionable', () => {
	const nowhere = fs.mkdtempSync(path.join(os.tmpdir(), 'nbb-msg-'));
	let message = '';
	try {
		resolveAppRoot({ env: {}, cwd: nowhere, pluginDir: nowhere });
	} catch (err) {
		message = err.message;
	}
	assert.match(message, /Tried:/, 'the message must list the candidates');
	assert.match(message, /NODEBB_APP_ROOT/, 'and say how to fix it');
	fs.rmSync(nowhere, { recursive: true, force: true });
});

test('a relative NODEBB_APP_ROOT is resolved, not used verbatim', () => {
	const app = fakeApp('rel');
	const resolved = resolveAppRoot({ env: { NODEBB_APP_ROOT: '.' }, cwd: app, pluginDir: app });
	assert.ok(path.isAbsolute(resolved), `expected an absolute path, got ${resolved}`);
	fs.rmSync(app, { recursive: true, force: true });
});

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) {
	process.exit(1);
}