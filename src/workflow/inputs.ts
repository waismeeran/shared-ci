import type { CiConfig } from '../config/types.js';

export const actionInputNames = [
  'node-version',
  'package-manager',
  'working-directory',
  'lint',
  'typecheck',
  'unit',
  'integration',
  'build',
  'e2e',
  'lint-command',
  'typecheck-command',
  'unit-command',
  'integration-command',
  'build-command',
  'e2e-command',
] as const;

/** Reads GitHub action input environment variables without rewriting hyphens in input names. */
export function readActionInputs(
  environment: Readonly<Record<string, string | undefined>>,
): Record<(typeof actionInputNames)[number], string> {
  return Object.fromEntries(
    actionInputNames.map((name) => [
      name,
      environment[`INPUT_${name.toUpperCase().replaceAll(' ', '_')}`] ?? '',
    ]),
  ) as Record<(typeof actionInputNames)[number], string>;
}

/** Converts the scalar workflow_call contract to the resolver's existing configuration. */
export function toCiConfig(inputs: Readonly<Record<string, string>>): CiConfig {
  return {
    'node-version': inputs['node-version'] ?? 'auto',
    'package-manager': inputs['package-manager'] ?? 'auto',
    'working-directory': optional(inputs['working-directory']) ?? '.',
    lint: inputs.lint ?? 'auto',
    typecheck: inputs.typecheck ?? 'auto',
    unit: inputs.unit ?? 'auto',
    integration: inputs.integration ?? 'auto',
    build: inputs.build ?? 'auto',
    e2e: inputs.e2e ?? 'false',
    'lint-command': optional(inputs['lint-command']),
    'typecheck-command': optional(inputs['typecheck-command']),
    'unit-command': optional(inputs['unit-command']),
    'integration-command': optional(inputs['integration-command']),
    'build-command': optional(inputs['build-command']),
    'e2e-command': optional(inputs['e2e-command']),
  };
}

function optional(value: string | undefined): string | undefined {
  return value === undefined || value === '' ? undefined : value;
}
