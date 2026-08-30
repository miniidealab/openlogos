## ADDED — OpenLogos 0.14.0 Merge Transaction Contract (Normative Override)

> This section applies to merge transactions created or recovered by OpenLogos 0.14.0. It overrides earlier instructions that require `MERGE_APPLY_MANIFEST.json`, Base64 apply payloads, or direct Agent writes to canonical targets, metadata, markers, journals, or receipts. Legacy artifacts are diagnostic-only.

### Role boundary

The merge executor is a semantic content-slot producer, not the canonical writer. It may only:

1. read the transaction prompt, proposal/tasks, declared deltas, current canonical target bytes, and the read-only transaction projection;
2. compute the final bytes for each declared content slot;
3. submit those bytes through the transaction-owned slot interface;
4. read back the slot summary and verify slot identity and content SHA-256;
5. stop and wait for the Driver/core to invoke seal and apply.

The executor MUST NOT create, update, or complete `MERGE_APPLY_MANIFEST.json`; write canonical targets, OpenLogos-produced metadata, dogfood mirrors, `SPEC_MERGED`, journals, or receipts; or treat work-unit completion as merge completion.

### Identity checks

Before producing a slot, verify the transaction id, slug, slot id, delta path, target path, mode, source SHA-256, and the MODIFY before SHA-256 byte-for-byte. Fail closed on drift, undeclared slots, out-of-root targets, or a phase that does not allow `submit_content`. Do not rename, reorder, add, remove, or silently rebaseline targets.

### Content production

- For Markdown deltas, apply ADDED/MODIFIED/REMOVED semantics to the frozen target and omit control markers from final content.
- For non-Markdown deltas, strip the required first-line control marker; all remaining bytes are the complete final payload.
- CREATE requires a complete file and an absent target; MODIFY is based on the frozen before hash.
- Core derives metadata deterministically from the sealed resource closure; there are no human-writable metadata slots.
- A no-delta transaction has no resource slots. Never invent an empty file or manifest to make it look complete.

### Handoff and stop condition

After every required slot is submitted and read back, report only the transaction id, submitted slot ids, content SHA-256 values, missing-slot ids, and current read-only phase. This completes only the collecting work unit. Merge succeeds only after the core atomically seals/applies the closure and persists a valid completed receipt.

### Recovery and version gate

On retry, read transaction status first and perform only operations present in `allowed_actions`. Never rewrite a slot in sealed, applying, or completed phases. A completed retry returns the existing receipt summary. Conflicting legacy-manifest instructions fail with `legacy_manifest_rejected`; no compatibility downgrade is allowed.

RunLogos must pin the globally installed `openlogos` command path, exact 0.14.0 version, transaction schema hash, and contract hash before dispatch. Any mismatch stops execution; a source checkout or 0.13.x skill cannot substitute for the packaged 0.14.0 contract.
