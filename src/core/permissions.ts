import type {PermissionMode, ToolRisk} from './types.js';

export type PermissionDecision = 'allow' | 'ask' | 'deny';

export function resolvePermission(mode: PermissionMode, risk: ToolRisk): PermissionDecision {
  if (risk === 'read' || mode === 'bypass') return 'allow';
  if (mode === 'plan') return 'deny';
  return 'ask';
}
