'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const GITIGNORE = path.join(__dirname, '..', '..', '.gitignore');

test('.gitignore excludes session/ (FR-016, Principio IV, research.md R9)', () => {
  assert.ok(fs.existsSync(GITIGNORE), '.gitignore must exist at repository root');
  const content = fs.readFileSync(GITIGNORE, 'utf8');
  const lines = content.split(/\r?\n/).map((l) => l.trim());
  assert.ok(
    lines.includes('session/'),
    '.gitignore must contain an exact `session/` entry'
  );
});

test('git does not track session/ contents (FR-016)', () => {
  const content = fs.readFileSync(GITIGNORE, 'utf8');
  assert.ok(!/^\s*!.*session/m.test(content), 'session/ must not be re-included via negation');
});
