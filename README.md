# agent-skills

Repository for storing and sharing reusable agent skills I use periodically.

This repo uses the open [Agent Skills](https://agentskills.io/) format so the skills here stay **AI toolchain agnostic**. The canonical location for skills in this repository is `.agents/skills/`, which aligns with the cross-client convention described by agentskills.io.

## Repository intent

- Keep reusable skills in a portable, shareable format.
- Prefer the standard `SKILL.md`-based Agent Skills structure over tool-specific skill formats.
- Use this repository as the source of truth for skills that can be consumed by any compatible agent or client.

## Skill layout

Each skill should live under `.agents/skills/<skill-name>/` and follow the standard structure:

```text
.agents/
└── skills/
    └── <skill-name>/
        ├── SKILL.md
        ├── scripts/
        ├── references/
        └── assets/
```

Notes:

- `SKILL.md` is required.
- `scripts/`, `references/`, and `assets/` are optional.
- Keep instructions portable and avoid coupling a skill to one AI product unless that dependency is explicit and necessary.

## Adding skills

When adding a new skill:

1. Create a new directory under `.agents/skills/`.
2. Add a `SKILL.md` file with valid Agent Skills frontmatter.
3. Add optional scripts, references, or assets only when the skill needs them.
4. Keep the skill focused, reusable, and vendor-neutral by default.

## Skills index

This section is the running catalog of skills in this repository.

| Skill | Purpose | Notes |
| --- | --- | --- |
| `commit-and-push` | Stages intended changes, creates a commit, and pushes the current branch. | Portable git workflow skill for publishing repository work. |
