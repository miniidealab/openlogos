---
description: "Initialize OpenLogos project — MUST ask language preference first, then run init"
---

**STOP — do NOT run any command yet.**

You MUST ask the user this question first and WAIT for their answer:

> 请选择语言 / Choose language:
> 1. English
> 2. 中文

After the user replies, determine the locale value:
- User says 1 or "English" → locale is `en`
- User says 2 or "中文" → locale is `zh`

Then run this exact command:

```
openlogos init --locale <LOCALE> --ai-tool claude-code $ARGUMENTS
```

Replace `<LOCALE>` with `en` or `zh` based on the user's answer. If `$ARGUMENTS` is provided, append it as the project name.

If `openlogos` command is not found, tell the user:
```
npm install -g @miniidealab/openlogos
```

After init completes, suggest running `/openlogos:next` for guidance.
