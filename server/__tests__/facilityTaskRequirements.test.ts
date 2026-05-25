import { describe, expect, it } from 'vitest';

import {
  CLAUDE_STREAM_PROVIDER_ID,
  KIMI_CLI_PROVIDER_ID,
  KIMI_WORKER_PROVIDER_ID,
  ZAI_WORKER_PROVIDER_ID,
} from '../src/facilityConstants.js';
import { CURSOR_WORKER_PROVIDER_ID } from '../src/facilityProviders.js';
import {
  providerSupportsSelfMaintain,
  taskKindRequiresLocalRepo,
} from '../src/facilityTaskRequirements.js';

describe('facilityTaskRequirements', () => {
  it('marks maintain tasks as requiring local repo access', () => {
    expect(taskKindRequiresLocalRepo('maintain')).toBe(true);
    expect(taskKindRequiresLocalRepo('operate')).toBe(false);
    expect(taskKindRequiresLocalRepo('design')).toBe(false);
  });

  it('allows owned CLI lanes for self-maintain', () => {
    expect(providerSupportsSelfMaintain(CLAUDE_STREAM_PROVIDER_ID)).toBe(true);
    expect(providerSupportsSelfMaintain(KIMI_CLI_PROVIDER_ID)).toBe(true);
    expect(providerSupportsSelfMaintain(CURSOR_WORKER_PROVIDER_ID)).toBe(true);
  });

  it('denies API-only lanes for self-maintain', () => {
    expect(providerSupportsSelfMaintain(KIMI_WORKER_PROVIDER_ID)).toBe(false);
    expect(providerSupportsSelfMaintain(ZAI_WORKER_PROVIDER_ID)).toBe(false);
    expect(providerSupportsSelfMaintain('nvidia-nim-glm-5.1')).toBe(false);
  });
});
