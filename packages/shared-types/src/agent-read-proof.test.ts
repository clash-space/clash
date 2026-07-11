import { describe, expect, it } from "vitest";
import {
  agentReadToken,
  agentReadReceiptToken,
  localConfigReadToken,
  projectReadToken,
  providerAccountReadToken,
  providerAccountsReadToken,
  providerOAuthReadToken,
  sessionReadToken,
  validateAgentReadProof,
} from "./agent-read-proof";
import { canvasNodeReadToken } from "./canvas-update-guardrails";

describe("agent read proof", () => {
  it("builds stable read tokens that can back canvas read-before-write CAS", () => {
    const subject = {
      id: "text-1",
      type: "text",
      data: { content: "before", label: "Script" },
      parentId: null,
      position: null,
    };

    const token = agentReadToken({
      namespace: "node",
      subject,
    });

    expect(token).toMatch(/^node-v1:[a-f0-9]{16}$/);
    expect(agentReadToken({
      namespace: "node",
      subject: {
        position: null,
        parentId: null,
        data: { label: "Script", content: "before" },
        type: "text",
        id: "text-1",
      },
    })).toBe(token);
    expect(canvasNodeReadToken(subject)).toBe(token);
  });

  it("builds project read tokens from project metadata, independent of timestamp shape", () => {
    const token = projectReadToken({
      id: "project-1",
      name: "Cutdown",
      description: "TVC edit",
      updatedAt: "2026-07-07T01:02:03.456Z",
      deletedAt: null,
    });

    expect(token).toMatch(/^project-v1:[a-f0-9]{16}$/);
    expect(projectReadToken({
      id: "project-1",
      name: "Cutdown",
      description: "TVC edit",
      updated_at: Math.floor(Date.parse("2026-07-07T01:02:03.456Z") / 1000),
      deleted_at: null,
    })).toBe(token);
  });

  it("builds local config read tokens from public config plus update version", () => {
    const token = localConfigReadToken({
      id: "sync",
      updatedAt: "2026-07-07T02:00:00.000Z",
      config: {
        mode: "cloud-sync",
        remote_loro: {
          enabled: true,
          url: "https://cloud.example",
          has_token: true,
          source: "config",
        },
      },
    });

    expect(token).toMatch(/^local-config-v1:[a-f0-9]{16}$/);
    expect(localConfigReadToken({
      id: "sync",
      updated_at: Math.floor(Date.parse("2026-07-07T02:00:00.000Z") / 1000),
      config: {
        remote_loro: {
          source: "config",
          has_token: true,
          url: "https://cloud.example",
          enabled: true,
        },
        mode: "cloud-sync",
      },
    })).toBe(token);
    expect(localConfigReadToken({
      id: "sync",
      updatedAt: "2026-07-07T02:01:00.000Z",
      config: {
        mode: "cloud-sync",
        remote_loro: {
          enabled: true,
          url: "https://cloud.example",
          has_token: true,
          source: "config",
        },
      },
    })).not.toBe(token);
  });

  it("builds provider account read tokens from public config without secret material", () => {
    const account = {
      id: "replicate-primary",
      providerId: "replicate",
      upstreamId: "replicate",
      enabled: true,
      configuredCredentials: ["webhookSecret", "apiKey", "apiKey"],
      availableOAuth: [],
      supportedModelIds: ["nano-banana-2", "kling-video-v2"],
      modelPriorities: { "nano-banana-2": 5 },
      weight: 10,
      updatedAt: "2026-07-07T02:00:00.000Z",
    };
    const token = providerAccountReadToken(account);

    expect(token).toMatch(/^provider-account-v1:[a-f0-9]{16}$/);
    expect(providerAccountReadToken({
      updated_at: Math.floor(Date.parse("2026-07-07T02:00:00.000Z") / 1000),
      weight: 10,
      model_priorities: { "nano-banana-2": 5 },
      supported_model_ids: ["kling-video-v2", "nano-banana-2"],
      available_oauth: [],
      configured_credentials: ["apiKey", "webhookSecret"],
      enabled: true,
      upstream_id: "replicate",
      provider_id: "replicate",
      id: "replicate-primary",
    })).toBe(token);
    expect(providerAccountReadToken({
      ...account,
      configuredCredentials: ["apiKey"],
    })).not.toBe(token);
    expect(providerAccountReadToken({
      ...account,
      updatedAt: "2026-07-07T02:01:00.000Z",
    })).not.toBe(token);
  });

  it("builds provider account collection read tokens independent of list order", () => {
    const primary = {
      id: "replicate-primary",
      providerId: "replicate",
      upstreamId: "replicate",
      enabled: true,
      configuredCredentials: ["apiKey"],
      updatedAt: "2026-07-07T02:00:00.000Z",
    };
    const secondary = {
      id: "fal-primary",
      providerId: "fal",
      upstreamId: "fal",
      enabled: true,
      configuredCredentials: ["apiKey"],
      updatedAt: "2026-07-07T02:00:00.000Z",
    };

    const token = providerAccountsReadToken([primary, secondary]);

    expect(token).toMatch(/^provider-accounts-v1:[a-f0-9]{16}$/);
    expect(providerAccountsReadToken([secondary, primary])).toBe(token);
    expect(providerAccountsReadToken([primary])).not.toBe(token);
  });

  it("builds provider OAuth read tokens from public OAuth state without raw secret material", () => {
    const token = providerOAuthReadToken({
      providerId: "dreamina",
      accountId: "jimeng-primary",
      status: "authorized",
      accountLabel: "Primary Dreamina",
      expiresAt: "2026-07-07T03:00:00.000Z",
      hasAccessToken: true,
      updatedAt: "2026-07-07T02:00:00.000Z",
    });

    expect(token).toMatch(/^provider-oauth-v1:[a-f0-9]{16}$/);
    expect(providerOAuthReadToken({
      provider_id: "dreamina",
      account_id: "jimeng-primary",
      status: "authorized",
      account_label: "Primary Dreamina",
      expires_at: Math.floor(Date.parse("2026-07-07T03:00:00.000Z") / 1000),
      has_access_token: true,
      updated_at: Math.floor(Date.parse("2026-07-07T02:00:00.000Z") / 1000),
    })).toBe(token);
    expect(providerOAuthReadToken({
      providerId: "dreamina",
      accountId: "jimeng-primary",
      status: "revoked",
      accountLabel: "Primary Dreamina",
      expiresAt: "2026-07-07T03:00:00.000Z",
      hasAccessToken: false,
      updatedAt: "2026-07-07T02:01:00.000Z",
    })).not.toBe(token);
  });

  it("builds session read tokens from mutable session metadata", () => {
    const token = sessionReadToken({
      id: "session-1",
      projectId: "project-1",
      title: "Cut review",
      type: "runtime",
      runtimeId: "desktop-local",
      agentId: "codex",
      agentTemplateId: "master-clash",
      permissionMode: "workspace-write",
      acpSessionId: "acp-1",
      status: "active",
      createdAt: "2026-07-07T01:02:03.456Z",
      updatedAt: "2026-07-07T01:03:03.456Z",
    });

    expect(token).toMatch(/^session-v1:[a-f0-9]{16}$/);
    expect(sessionReadToken({
      id: "session-1",
      project_id: "project-1",
      title: "Cut review",
      type: "runtime",
      runtime_id: "desktop-local",
      agent_id: "codex",
      agent_template_id: "master-clash",
      permission_mode: "workspace-write",
      acp_session_id: "acp-1",
      status: "active",
      created_at: Math.floor(Date.parse("2026-07-07T01:02:03.456Z") / 1000),
      updated_at: Math.floor(Date.parse("2026-07-07T01:03:03.456Z") / 1000),
    })).toBe(token);
    expect(sessionReadToken({
      id: "session-1",
      projectId: "project-1",
      title: "Cut review",
      type: "runtime",
      runtimeId: "desktop-local",
      agentId: "codex",
      agentTemplateId: "master-clash",
      permissionMode: "workspace-write",
      acpSessionId: "acp-1",
      status: "active",
      createdAt: "2026-07-07T01:02:03.456Z",
      updatedAt: "2026-07-07T01:04:03.456Z",
    })).not.toBe(token);
  });

  it("validates missing, stale, and fresh agent read proofs without blocking non-agent callers", () => {
    const currentReadToken = agentReadToken({
      namespace: "node",
      subject: { id: "text-1", content: "after" },
    });
    const staleReadToken = agentReadToken({
      namespace: "node",
      subject: { id: "text-1", content: "before" },
    });

    const missing = validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      readCommandHint: "Run `clash canvas get --json` first.",
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.error).toContain("Missing canvas update read proof");
      expect(missing.error).toContain("clash canvas get");
    }

    const stale = validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      expectedReadToken: staleReadToken,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("Stale canvas update rejected");
      expect(stale.code).toBe("STALE_READ");
      expect(stale.error).not.toContain(currentReadToken);
      expect(stale.error).not.toContain(staleReadToken);
      expect(stale.error).not.toContain("--if-match");
    }

    expect(validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      expectedReadToken: currentReadToken,
    })).toEqual({ ok: true });
    expect(validateAgentReadProof({
      actorClientType: "user",
      operation: "canvas update",
      currentReadToken,
    })).toEqual({ ok: true });
  });

  it("honors supplied CAS tokens for non-agent callers without requiring receipts", () => {
    const currentReadToken = agentReadToken({
      namespace: "project",
      subject: { id: "project-1", name: "after" },
    });
    const staleReadToken = agentReadToken({
      namespace: "project",
      subject: { id: "project-1", name: "before" },
    });

    const stale = validateAgentReadProof({
      actorClientType: "cli",
      operation: "project update",
      currentReadToken,
      expectedReadToken: staleReadToken,
      requireReceipt: true,
      readReceiptVerifier: () => false,
    });

    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("Stale project update rejected");
      expect(stale.error).toContain("re-read the target");
      expect(stale.error).not.toContain(currentReadToken);
      expect(stale.error).not.toContain(staleReadToken);
    }
    expect(validateAgentReadProof({
      actorClientType: "cli",
      operation: "project update",
      currentReadToken,
      expectedReadToken: currentReadToken,
      requireReceipt: true,
      readReceiptVerifier: () => false,
    })).toEqual({ ok: true });
    expect(validateAgentReadProof({
      actorClientType: "cli",
      operation: "project update",
      currentReadToken,
      requireReceipt: true,
      readReceiptVerifier: () => false,
    })).toEqual({ ok: true });
  });

  it("can combine CAS with a host-issued read receipt", () => {
    const currentReadToken = agentReadToken({
      namespace: "node",
      subject: { id: "text-1", content: "before" },
    });
    const receiptToken = agentReadReceiptToken({
      readToken: currentReadToken,
      receipt: "host.issued.receipt",
    });

    const accepted = validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      expectedReadToken: receiptToken,
      requireReceipt: true,
      readReceiptVerifier: (proof) =>
        proof.baseReadToken === currentReadToken &&
        proof.receipt === "host.issued.receipt",
    });

    expect(accepted).toEqual({ ok: true });

    const bareCas = validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      expectedReadToken: currentReadToken,
      requireReceipt: true,
      readReceiptVerifier: () => true,
    });
    expect(bareCas.ok).toBe(false);
    if (!bareCas.ok) {
      expect(bareCas.error).toContain("Missing canvas update read receipt");
    }

    const staleBase = agentReadToken({
      namespace: "node",
      subject: { id: "text-1", content: "stale" },
    });
    const staleReceipt = agentReadReceiptToken({
      readToken: staleBase,
      receipt: "host.issued.receipt",
    });
    const stale = validateAgentReadProof({
      actorClientType: "agent",
      operation: "canvas update",
      currentReadToken,
      expectedReadToken: staleReceipt,
      requireReceipt: true,
      readReceiptVerifier: () => true,
    });
    expect(stale.ok).toBe(false);
    if (!stale.ok) {
      expect(stale.error).toContain("Stale canvas update rejected");
      expect(stale.error).toContain("re-read the target");
      expect(stale.error).not.toContain(currentReadToken);
      expect(stale.error).not.toContain(staleBase);
    }
  });
});
