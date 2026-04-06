import { approvalManager } from '../../approval-manager.js';
import {
  deleteToolPolicy,
  getToolPolicies,
  upsertToolPolicy,
} from '../../db.js';

// ─── GET /api/approvals ───

export function getPendingApprovals(): unknown[] {
  return approvalManager.getPending();
}

// ─── POST /api/approvals/:id ───

export function respondToApproval(
  id: string,
  decision: string | undefined,
  alwaysAllow: boolean,
): { data?: unknown; error?: string; status: number } {
  if (!decision || !['allow', 'deny'].includes(decision)) {
    return { error: 'decision must be "allow" or "deny"', status: 400 };
  }
  const ok = approvalManager.respond(id, decision as 'allow' | 'deny', alwaysAllow);
  if (!ok) {
    return { error: 'Approval request not found', status: 404 };
  }
  return { data: { ok: true }, status: 200 };
}

// ─── GET /api/tool-policies ───

export function getToolPoliciesForGroup(group: string | null): {
  data?: unknown;
  error?: string;
  status: number;
} {
  if (!group) {
    return { error: 'group query param required', status: 400 };
  }
  return { data: getToolPolicies(group), status: 200 };
}

// ─── PUT /api/tool-policies ───

export function upsertPolicy(body: {
  group_folder?: string;
  tool_pattern?: string;
  action?: string;
}): { data?: unknown; error?: string; status: number } {
  const { group_folder, tool_pattern, action } = body;
  if (!group_folder || !tool_pattern || !action || !['allow', 'deny', 'ask'].includes(action)) {
    return {
      error: 'group_folder, tool_pattern, and action (allow/deny/ask) required',
      status: 400,
    };
  }
  upsertToolPolicy(group_folder, tool_pattern, action as 'allow' | 'deny' | 'ask');
  return { data: { ok: true }, status: 200 };
}

// ─── DELETE /api/tool-policies ───

export function removePolicy(body: {
  group_folder?: string;
  tool_pattern?: string;
}): { data?: unknown; error?: string; status: number } {
  const { group_folder, tool_pattern } = body;
  if (!group_folder || !tool_pattern) {
    return { error: 'group_folder and tool_pattern required', status: 400 };
  }
  const deleted = deleteToolPolicy(group_folder, tool_pattern);
  return { data: { ok: true, deleted }, status: 200 };
}
