# Agent operating rules

Read, in order: `docs/14_MUMBAI_BUILD_BRIEF.md`, `docs/15_MUMBAI_HANDOFF.md`, `STYLE.md`. The handoff wins on conflicts.

## Always

- Work in your own git worktree and branch. Never edit another agent's worktree.
- Commit small and often with conventional-commit messages. Never force-push. Never rewrite history.
- Run `pnpm verify` before every push. Run `pnpm test:access-flow` when you change `brambled/` or `sidecar/`.
- Respect the invariants in section 3 of the handoff. `pnpm check:no-endpoints` and `pnpm check:no-local-state` must stay green.
- Trace every task to a demo beat (handoff section 4). If it serves no beat, stop and ask.
- Open a PR against `hackathon`. A reviewer from the other model family approves it. Only a human merges to `main`.
- Update `docs/AI_USAGE.md` with the paths you wrote.
- Follow `STYLE.md`.

## Never

- Never read, search for, print, log or commit credentials, private keys or authenticated RPC URLs. If a secret is missing, mark the task blocked and say which one.
- Never spend real money, write to a mainnet, publish somewhere new, or delete a branch, repo or deployment.
- Never make a design decision that belongs to a human. Write the options in an ADR draft and request approval.
- Never claim something works unless you ran it. Label findings Verified, Read from source or Open.

## Skills

Use `grill-me` and `grill-with-docs` to resolve ambiguity before building, `to-spec` and `to-tickets` to plan, `tdd` and `implement` to build, `diagnosing-bugs` for failures, `code-review` for reviews, and `improve-codebase-architecture` only when asked. Use `handoff` when you stop mid-task.
