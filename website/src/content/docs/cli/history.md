---
title: "openlogos history"
description: "Query verification and smoke runs by run ID."
---

Each verify or smoke run that reaches execution can write a structured history record. Use `openlogos history list --kind smoke --slug <slug> --result fail --format json` to filter newest first, and `openlogos history show <run_id> --format json` to inspect one run and locate available artifacts. `--module` filters by module and `--limit` defaults to 20.

The index lives in `logos/resources/verify/history/`; if a proposal was active, its full records usually move with the proposal on archive. When a clone has only the index, the command still returns structured details and identifies unavailable evidence.

Reports and free-form evidence are included in proposal history by default. Set `verify.history.raw_in_proposal: false` before running to keep that new history evidence in the local runtime directory. Existing shared reports and result paths remain separate.
