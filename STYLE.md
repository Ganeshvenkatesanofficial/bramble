# Style guide for agents

Applies to docs, ADRs, README text, PR descriptions, commit messages and task comments.

## Structure: Diátaxis (https://diataxis.fr)

Put each page in exactly one of four kinds, and do not mix them:

- **Tutorial**: learning by doing. Steps a newcomer follows to reach a working result.
- **How-to**: a goal-oriented recipe for a competent user ("How to enroll a device").
- **Reference**: neutral, complete facts: flags, env vars, APIs, records. No opinions.
- **Explanation**: why it works this way, trade-offs, rejected alternatives. ADRs live here.

## Language: Google technical writing

- Use active voice and present tense. Name the actor: "The gateway rejects the request."
- Keep sentences short, one idea each. Keep paragraphs short.
- Use the same term for the same thing everywhere. Check `docs/` before inventing one.
- Define an acronym on first use. Prefer plain words over jargon.
- Put the most important information first. Lead with the action or the answer.
- Use numbered lists for sequences, bullets for sets, tables for comparisons.
- Write exact commands, paths and values in code formatting. Do not paraphrase them.
- State measurements with their conditions and date. Do not use "fast", "soon" or "small" without a number.
- Be accurate. Describe what the code does today. Mark untested claims as untested.

## Commits and PRs

- Conventional commits: `feat(sidecar): route ENS reads through Tor`.
- One logical change per commit. Commit early and often.
- A PR description says what changed, why, how you checked it, and which demo beat it serves.
