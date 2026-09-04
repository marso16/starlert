# Project Instructions

This repository contains both `backend/` and `frontend/` (SvelteKit). Treat them
as **one project with one GitHub repository** — do not split them into separate
repos, do not create separate remotes, and do not version them independently.
Commits, branches, and PRs span both folders as needed.

## Plan before executing

Do not jump straight to execution on non-trivial work. Think through the
approach, form a plan, and only then execute:

- Use the brainstorming/planning skills and plan mode for anything beyond a
  trivial, single-file change.
- Prefer surfacing a short plan (approach, key files, tradeoffs) before
  editing, especially for multi-step features, architecture decisions, or
  anything touching both backend and frontend.
- Deep, deliberate planning is the default mode here, not an exception.

## Use installed plugins and skills

Actively check for and use installed plugins/skills whenever they are
relevant — do not default to plain, unassisted output when a skill exists
for the task.

- This applies especially to frontend/UI work: use the frontend-design skill
  (or equivalent installed design skill) whenever building or modifying UI.
- Do not produce generic, cookie-cutter Tailwind UI — the kind of
  interchangeable "vibe coded" layout (centered card, purple-to-blue
  gradient hero, generic rounded shadow cards, default font stack) that
  looks identical across unrelated projects.
- Favor novel, considered visual design: distinctive layout choices,
  intentional typography, a real color/theme identity, and details specific
  to what this product actually is — not a reskin of the most common
  Tailwind template patterns.

## Use ruflo

Ruflo (the `ruflo` MCP server, published from the `ruvnet/claude-flow`
project) is registered locally for this project. Use its MCP tools
(memory_store, memory_search, hooks_route, swarm_init, agent_spawn, and
related tools) when they fit the task, the same way you would reach for any
other installed skill or plugin: do not skip them in favor of ad hoc
approaches when a ruflo tool is the better fit.

- If ruflo tools do not show up, check `claude mcp list`: it must be
  registered as `ruflo mcp start` (the installed global binary), not
  `npx ruflo@latest`, which pulls a broken cached copy
  (`ERR_MODULE_NOT_FOUND` on `@claude-flow/cli-core/mcp-tools/types`).
  Reload MCP connections (`/mcp` or a new session) after registering.
- Known bug (ruflo v3.38.21): `ruflo mcp toggle` and the config file's
  `mcp.tools` allowlist do not actually disable tools, despite printing
  success. All 333 advertised tools stay enabled regardless. Do not spend
  time re-attempting this until a fixed version ships.

## No em dashes

Never use em dashes (—) anywhere in this project: not in code, comments,
commit messages, PR descriptions, UI copy, or documentation. This applies
now and to all future work in this repo. Use a comma, colon, parentheses,
or a period plus a new sentence instead.
