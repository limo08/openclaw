---
name: operon-guard
description: "Pre-flight trust verification for AI agents. Verify behavior, detect injection vulnerabilities, check for PII leaks, and measure reliability before granting Write/Execute permissions."
homepage: https://pypi.org/project/operon-guard/
metadata:
  {
    "openclaw":
      {
        "emoji": "🛡️",
        "requires": { "bins": ["operon-guard"] },
        "install":
          [
            {
              "id": "uv",
              "kind": "uv",
              "package": "operon-guard",
              "bins": ["operon-guard"],
              "label": "Install operon-guard (uv)",
            },
          ],
      },
  }
---

# operon-guard

## Usage

Run `operon-guard test <path>` to verify an agent before granting it Write or Execute permissions.

## What You Check

- **Determinism** — Same input, consistent output across runs?
- **Prompt Injection Detection** — Is the agent vulnerable to adversarial inputs?
- **PII Leak Scanning** — Does the agent expose sensitive data?
- **Reliability Scoring** — How consistent are the agent's outputs?
- **Race Condition Detection** — Are concurrent operations safe?

## Commands

- `operon-guard test <path>` — Run full trust verification suite
- `operon-guard test <path> --quick` — Fast smoke test
- `operon-guard report <path>` — Generate detailed trust report

## Output

Returns a **Trust Score** (0-100) with pass/fail verdicts per category. Agents scoring below 70 (the default threshold) are flagged as untrusted. Override with `--threshold <0-100>`.
