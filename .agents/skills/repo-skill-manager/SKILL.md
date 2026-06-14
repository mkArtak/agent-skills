---
name: repo-skill-manager
description: List available skills in the mkArtak/agent-skills repository, install a named skill into the current repository or the user's global skills directory, and update previously installed skills from that repository. Use when asked to list available skills, install a skill from this repository, or update skills from this repository.
compatibility: Requires Node.js 18+ and internet access. Uses standard .agents/skills directories so it works with GitHub Copilot-compatible Agent Skills clients, including the GitHub Copilot app.
metadata:
  author: mkArtak
  version: "1.0"
  source-repository: mkArtak/agent-skills
  source-path: .agents/skills/repo-skill-manager
---

Manage skills published from the `mkArtak/agent-skills` repository.

## When to use

Use this skill when asked to do any of the following:

- List the skills available from this repository
- Install a named skill from this repository
- Install a named skill globally for the current user
- Update skills previously installed from this repository

## Command mapping

Interpret the user's request and run the management script from this skill directory:

```bash
node scripts/repo_skill_manager.js <command> [arguments]
```

Map common requests to these commands:

- `list available skills` -> `node scripts/repo_skill_manager.js list --json`
- `install skill <name>` -> `node scripts/repo_skill_manager.js install <name> --json`
- `install skill <name> --global` -> `node scripts/repo_skill_manager.js install <name> --global --json`
- `update skills` -> `node scripts/repo_skill_manager.js update --json`

## Workflow

Progress:
- [ ] Identify which operation the user requested
- [ ] Run the management script with the matching arguments
- [ ] Review the script output for warnings or skipped items
- [ ] Apply any required reload step for the active client

### 1. Prefer the bundled script

Use `scripts/repo_skill_manager.js` for the requested operation instead of re-implementing the workflow manually. The script:

- lists remote skills from `mkArtak/agent-skills`
- installs skills into `.agents/skills` for the current repository
- installs skills into `~/.agents/skills` when `--global` is requested
- updates skills that were previously installed from this repository

### 2. Interpret the result

The script prints structured JSON when called with `--json`. Use that output to report:

- available remote skills
- the install target path
- which skills were updated
- which skills were skipped and why

### 3. Reload skills if needed

After an install or update, tell the caller to reload skills if their client requires it. For GitHub Copilot CLI, `/skills reload` avoids restarting the session.

## Gotchas

- Project-scoped installs require running inside a Git repository so the script can place the skill under the repository's `.agents/skills` directory.
- Global installs go to `~/.agents/skills` to stay aligned with the repository's toolchain-neutral layout.
- Updates only manage skills that carry this repository's source metadata. Skills installed with this manager also record install metadata so local modifications are not overwritten silently on update.
- If a target skill directory already exists, do not overwrite it unless the user explicitly asked to replace local changes.
