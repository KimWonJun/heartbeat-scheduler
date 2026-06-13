import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAntigravityCommand } from '../src/providers/antigravity.js';
import { buildClaudeCommand } from '../src/providers/claude.js';
import { buildCodexCommand } from '../src/providers/codex.js';
import { buildProviderCommand } from '../src/providers/index.js';

test('buildClaudeCommand creates non-persistent no-tools print invocation', () => {
  const command = buildClaudeCommand({ prompt: 'test! 출력' });

  assert.equal(command.file, 'claude');
  assert.deepEqual(command.args, [
    '-p',
    '--no-session-persistence',
    '--permission-mode',
    'dontAsk',
    '--tools',
    '',
    '--output-format',
    'text',
    'test! 출력',
  ]);
});

test('buildCodexCommand creates ephemeral read-only exec invocation', () => {
  const command = buildCodexCommand({ prompt: 'test! 출력만 하고 종료하세요.' });

  assert.equal(command.file, 'codex');
  assert.deepEqual(command.args, [
    '--ask-for-approval',
    'never',
    'exec',
    '--ephemeral',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    'test! 출력만 하고 종료하세요.',
  ]);
});

test('provider commands append extraArgs before prompt', () => {
  assert.deepEqual(
    buildClaudeCommand({ prompt: 'hi', extraArgs: ['--model', 'sonnet'] }).args.slice(-3),
    ['--model', 'sonnet', 'hi'],
  );
  assert.deepEqual(
    buildCodexCommand({ prompt: 'hi', extraArgs: ['--model', 'gpt-5.4'] }).args.slice(-3),
    ['--model', 'gpt-5.4', 'hi'],
  );
  assert.deepEqual(
    buildAntigravityCommand({ prompt: 'hi', extraArgs: ['--model', 'default'] }).args,
    ['--model', 'default', '--sandbox', '--print', 'hi'],
  );
});

test('provider commands allow full commandArgs override for tests and custom probes', () => {
  assert.deepEqual(
    buildClaudeCommand({ command: 'node', commandArgs: ['-e', 'console.log("ok")'], prompt: 'ignored' }),
    { file: 'node', args: ['-e', 'console.log("ok")'] },
  );
  assert.deepEqual(
    buildCodexCommand({ command: 'node', commandArgs: ['-e', 'console.log("ok")'], prompt: 'ignored' }),
    { file: 'node', args: ['-e', 'console.log("ok")'] },
  );
  assert.deepEqual(
    buildAntigravityCommand({ command: 'node', commandArgs: ['-e', 'console.log("ok")'], prompt: 'ignored' }),
    { file: 'node', args: ['-e', 'console.log("ok")'] },
  );
});

test('buildAntigravityCommand creates sandboxed print invocation', () => {
  const command = buildAntigravityCommand({ prompt: 'test! 출력' });

  assert.equal(command.file, 'agy');
  assert.deepEqual(command.args, [
    '--sandbox',
    '--print',
    'test! 출력',
  ]);
});

test('buildProviderCommand routes antigravity provider', () => {
  const command = buildProviderCommand({ provider: 'antigravity', prompt: 'hello' });

  assert.equal(command.file, 'agy');
  assert.deepEqual(command.args, ['--sandbox', '--print', 'hello']);
});
