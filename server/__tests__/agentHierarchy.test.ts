/**
 * Unit tests for agentHierarchy.ts (#27 — agent hierarchy + delegated approval).
 *
 * Covers:
 *  - Tier assignment per provider id
 *  - findSeniorAgent: routing to lowest-tier senior, no-senior escalation,
 *    self-approval guard, prefer lowest tier + earliest id
 *  - parseApprovalReply: [APPROVE] / [DENY] parsing with reason extraction
 *  - summarizeInput: path / command extraction
 *  - buildApprovalPrompt: output format
 */

import { describe, expect, it } from 'vitest';

import {
  type AgentTierEntry,
  buildApprovalPrompt,
  DEFAULT_PROVIDER_TIER_MAP,
  findSeniorAgent,
  getTierForProvider,
  parseApprovalReply,
  summarizeInput,
} from '../src/omc/agentHierarchy.js';

// ── Tier assignment ──────────────────────────────────────────────────────────

describe('getTierForProvider', () => {
  it('classifies claude-stream as tier 1 (senior)', () => {
    expect(getTierForProvider('claude-stream')).toBe(1);
  });

  it('classifies kimi-k2 as tier 1 (senior)', () => {
    expect(getTierForProvider('kimi-k2')).toBe(1);
  });

  it('classifies codex as tier 1 (senior)', () => {
    expect(getTierForProvider('codex')).toBe(1);
  });

  it('classifies zai-glm-5.1-coding as tier 2 (mid)', () => {
    expect(getTierForProvider('zai-glm-5.1-coding')).toBe(2);
  });

  it('classifies zai-glm-5-coding as tier 2 (mid)', () => {
    expect(getTierForProvider('zai-glm-5-coding')).toBe(2);
  });

  it('classifies codex-cli as tier 1 (senior)', () => {
    expect(getTierForProvider('codex-cli')).toBe(1);
  });

  it('defaults unknown providers to tier 3 (junior)', () => {
    expect(getTierForProvider('unknown-provider')).toBe(3);
    expect(getTierForProvider('')).toBe(3);
  });

  it('accepts a custom tier map override', () => {
    const customMap = { 'my-model': 1 as const };
    expect(getTierForProvider('my-model', customMap)).toBe(1);
    expect(getTierForProvider('unknown-provider', customMap)).toBe(3);
  });

  it('covers every provider in DEFAULT_PROVIDER_TIER_MAP', () => {
    for (const [providerId, tier] of Object.entries(DEFAULT_PROVIDER_TIER_MAP)) {
      expect(getTierForProvider(providerId)).toBe(tier);
    }
  });
});

// ── findSeniorAgent ──────────────────────────────────────────────────────────

describe('findSeniorAgent', () => {
  const makeEntry = (id: number, tier: AgentTierEntry['tier'], isAvailable = true): AgentTierEntry =>
    ({ id, tier, isAvailable });

  it('routes to a senior agent when one is available', () => {
    const agents = [
      makeEntry(1, 1), // senior (available)
      makeEntry(2, 3), // requester
    ];
    expect(findSeniorAgent(2, 3, agents)).toBe(1);
  });

  it('returns null when no agent outranks the requester', () => {
    const agents = [
      makeEntry(1, 3), // same tier
      makeEntry(2, 3), // requester
    ];
    expect(findSeniorAgent(2, 3, agents)).toBeNull();
  });

  it('escalates to null when no senior is available (runner busy)', () => {
    const agents = [
      makeEntry(1, 1, false), // senior but unavailable
      makeEntry(2, 3),        // requester
    ];
    expect(findSeniorAgent(2, 3, agents)).toBeNull();
  });

  it('enforces self-approval guard — agent cannot approve itself', () => {
    // Only candidate is the requesting agent itself at a "lower" tier
    // (shouldn't happen in practice, but guard must hold)
    const agents = [makeEntry(1, 0)]; // requesting agent id=1
    expect(findSeniorAgent(1, 0, agents)).toBeNull();
  });

  it('prefers the lowest-tier (most capable) senior among multiple candidates', () => {
    const agents = [
      makeEntry(10, 1), // senior tier 1
      makeEntry(20, 2), // mid tier 2
      makeEntry(30, 3), // requester
    ];
    expect(findSeniorAgent(30, 3, agents)).toBe(10); // tier 1 wins
  });

  it('breaks ties by earliest (lowest) agent id', () => {
    const agents = [
      makeEntry(5, 1),  // same tier, later id
      makeEntry(3, 1),  // same tier, earlier id
      makeEntry(9, 3),  // requester
    ];
    expect(findSeniorAgent(9, 3, agents)).toBe(3); // id 3 < id 5
  });

  it('skips unavailable seniors and picks the next best', () => {
    const agents = [
      makeEntry(1, 1, false), // tier 1 but busy
      makeEntry(2, 2, true),  // tier 2, available
      makeEntry(3, 3),        // requester
    ];
    expect(findSeniorAgent(3, 3, agents)).toBe(2); // tier 1 unavailable → tier 2
  });

  it('returns null when the only agent is the requester', () => {
    expect(findSeniorAgent(1, 3, [makeEntry(1, 3)])).toBeNull();
  });

  it('returns null with empty agent list', () => {
    expect(findSeniorAgent(1, 3, [])).toBeNull();
  });

  it('mid-tier agent (tier 2) is approved by tier-1 senior, not another tier-2', () => {
    const agents = [
      makeEntry(1, 1), // senior
      makeEntry(2, 2), // requester (mid)
      makeEntry(3, 2), // peer — same tier, must not approve
    ];
    expect(findSeniorAgent(2, 2, agents)).toBe(1);
  });
});

// ── parseApprovalReply ───────────────────────────────────────────────────────

describe('parseApprovalReply', () => {
  it('parses [APPROVE] with a reason', () => {
    const result = parseApprovalReply('[APPROVE] Looks safe — proceed.');
    expect(result).toEqual({ approved: true, reason: 'Looks safe — proceed.' });
  });

  it('parses [DENY] with a reason', () => {
    const result = parseApprovalReply('[DENY] This would delete production data.');
    expect(result).toEqual({ approved: false, reason: 'This would delete production data.' });
  });

  it('is case-insensitive for keywords', () => {
    expect(parseApprovalReply('[approve] ok')).not.toBeNull();
    expect(parseApprovalReply('[deny] no')).not.toBeNull();
  });

  it('returns null when no keyword is present', () => {
    expect(parseApprovalReply('This is a normal message.')).toBeNull();
    expect(parseApprovalReply('')).toBeNull();
  });

  it('prefers [APPROVE] when both keywords appear (approve first)', () => {
    const result = parseApprovalReply('[APPROVE] yes [DENY] no');
    expect(result?.approved).toBe(true);
  });

  it('prefers [DENY] when it appears before [APPROVE]', () => {
    const result = parseApprovalReply('[DENY] no [APPROVE] yes');
    expect(result?.approved).toBe(false);
  });

  it('provides a default reason when none follows the keyword', () => {
    const approve = parseApprovalReply('[APPROVE]');
    expect(approve?.reason).toBeTruthy();
    const deny = parseApprovalReply('[DENY]');
    expect(deny?.reason).toBeTruthy();
  });

  it('strips leading punctuation from the reason', () => {
    const result = parseApprovalReply('[APPROVE]: Safe to proceed.');
    expect(result?.reason).toBe('Safe to proceed.');
  });
});

// ── summarizeInput ───────────────────────────────────────────────────────────

describe('summarizeInput', () => {
  it('extracts path from file-operation input', () => {
    expect(summarizeInput({ path: 'src/foo.ts', diff: '...' })).toBe('src/foo.ts');
  });

  it('extracts file_path when path is absent', () => {
    expect(summarizeInput({ file_path: '/tmp/bar.txt' })).toBe('/tmp/bar.txt');
  });

  it('extracts command from bash input', () => {
    expect(summarizeInput({ command: 'npm run build' })).toBe('npm run build');
  });

  it('truncates long commands to 100 chars', () => {
    const longCmd = 'a'.repeat(150);
    expect(summarizeInput({ command: longCmd })).toHaveLength(100);
  });

  it('returns empty string for null/undefined input', () => {
    expect(summarizeInput(null)).toBe('');
    expect(summarizeInput(undefined)).toBe('');
  });

  it('returns empty string for non-object input', () => {
    expect(summarizeInput('string')).toBe('');
    expect(summarizeInput(42)).toBe('');
  });
});

// ── buildApprovalPrompt ──────────────────────────────────────────────────────

describe('buildApprovalPrompt', () => {
  it('includes [APPROVAL REQUEST], agent id, and tool name', () => {
    const prompt = buildApprovalPrompt(7, 'Edit', 'src/foo.ts');
    expect(prompt).toContain('[APPROVAL REQUEST]');
    expect(prompt).toContain('Worker #7');
    expect(prompt).toContain('Edit');
    expect(prompt).toContain('src/foo.ts');
  });

  it('includes [APPROVE] and [DENY] instructions', () => {
    const prompt = buildApprovalPrompt(3, 'Bash', 'rm -f ./tmp');
    expect(prompt).toContain('[APPROVE]');
    expect(prompt).toContain('[DENY]');
  });

  it('omits the target phrase when inputSummary is empty', () => {
    const prompt = buildApprovalPrompt(1, 'Read', '');
    expect(prompt).not.toContain('on:');
  });
});
