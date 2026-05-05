import os from 'node:os';
import path from 'node:path';

export function defaultRootDir() {
  return path.join(os.homedir(), '.cli-heartbeat-scheduler');
}

export function defaultRuntimeDir() {
  return path.join(defaultRootDir(), 'app');
}

export function defaultConfigPath() {
  return path.join(defaultRootDir(), 'config.json');
}

export function defaultRuntimeConfigPath() {
  return path.join(defaultRuntimeDir(), 'config.json');
}

export function defaultLaunchAgentsDir() {
  return path.join(os.homedir(), 'Library', 'LaunchAgents');
}
