# Security Policy

## Reporting a vulnerability

Email the maintainer with `[SECURITY]` in the subject, or open a **private**
security advisory on GitHub. Include: affected version/commit, steps to
reproduce, and impact. Expect an acknowledgement within 72 hours. Do not open a
public issue for an unpatched vulnerability.

## Hardening guide (read before exposing anything)

Viclaw runs shell commands and writes files. The defaults are safe for local
use; remote use needs explicit lockdown:

1. **Gateway token (mandatory for non-localhost).** Set a long random secret:
   `GATEWAY_TOKEN=$(openssl rand -hex 32)`. Every WebSocket `request` must
   carry it as `message.auth`. Binding a non-loopback interface without a token
   prints a loud startup warning — treat that warning as a blocker, not noise.
2. **Permission modes.** `plan` (read-only) for exploration, `ask` (mutating
   tools fail closed) for untrusted tasks, `acceptEdits` for file work without
   shell, `normal` only when you trust the task. See `src/tools/mod.ts`
   (`PermissionMode`).
3. **Sandbox shell work.** `SANDBOX_TYPE=docker` isolates `Bash`. The compose
   file mounts `/var/run/docker.sock` for this — that mount is full host
   control if the agent is compromised, so keep it only when you use the Docker
   sandbox.
4. **Command allow-list.** Set `allowedCommands` (e.g. `["git","npm","node"]`);
   it is the authoritative gate, matching the invoked binary token exactly.
   A deny-list alone is bypassable and is treated as a second layer only.
5. **Local services.** Redis and Ollama in `docker-compose.yml` bind
   `127.0.0.1` only — both are unauthenticated. Do not change that without
   adding auth.
6. **Web fetching.** Cloud instance-metadata endpoints
   (`169.254.169.254`, `169.254.169.123`, `100.100.100.200`,
   `metadata.google.internal`) are refused by `WebFetchTool`, and fetched
   content is wrapped as labelled untrusted data. Residual risk: DNS rebinding
   past the host list — use the Docker sandbox for hostile browsing.

## Known residual risks (not hidden)

- `ask` mode fails closed instead of prompting interactively (no approval loop yet).
- Path checks are separator-aware but case-sensitive; on Windows, ACLs still apply.
- `Bash` spawns `sh` (Unix-only); Windows runs file/web tools but not shell tools.

## Scope

`viclaw/` source, `Dockerfile`, and `docker-compose.yml`. The `docs/research/`
directory is third-party fetched evidence, not shipped code.
