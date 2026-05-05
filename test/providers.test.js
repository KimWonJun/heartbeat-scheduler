import assert from 'node:assert/strict';
import test from 'node:test';

import { buildClaudeCommand } from '../src/providers/claude.js';
import { buildCodexCommand } from '../src/providers/codex.js';
import { buildGeminiCommand } from '../src/providers/gemini.js';
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
    buildGeminiCommand({ prompt: 'hi', extraArgs: ['--model', 'gemini-2.5-pro'] }).args,
    ['--model', 'gemini-2.5-pro', '-p', 'hi', '--approval-mode', 'plan', '--output-format', 'text'],
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
    buildGeminiCommand({ command: 'node', commandArgs: ['-e', 'console.log("ok")'], prompt: 'ignored' }),
    { file: 'node', args: ['-e', 'console.log("ok")'] },
  );
});

test('buildGeminiCommand creates headless read-only plan invocation', () => {
  const command = buildGeminiCommand({ prompt: 'test! 출력' });

  assert.equal(command.file, 'gemini');
  assert.deepEqual(command.args, [
    '-p',
    'test! 출력',
    '--approval-mode',
    'plan',
    '--output-format',
    'text',
  ]);
});

test('buildProviderCommand routes gemini provider', () => {
  const command = buildProviderCommand({ provider: 'gemini', prompt: 'hello' });

  assert.equal(command.file, 'gemini');
  assert.deepEqual(command.args, ['-p', 'hello', '--approval-mode', 'plan', '--output-format', 'text']);
});
