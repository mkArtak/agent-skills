---
name: commit-and-push
description: Stage repository changes, create a git commit, and push the current branch to its remote. Use when asked to commit work, publish the current branch, or commit and push with an optional explicit commit message.
compatibility: Requires git, a repository with a configured remote, and permission to push.
metadata:
  author: mkArtak
  version: "1.0"
  source-repository: mkArtak/agent-skills
  source-path: .agents/skills/commit-and-push
---

Commit local repository changes and push the current branch safely.

## When to use

Use this skill when asked to do any of the following:

- Commit current worktree changes
- Push the current branch
- Commit and push in one flow
- Publish a branch with an explicit commit message

## Workflow

Progress:
- [ ] Inspect branch and working tree state
- [ ] Confirm the intended commit scope
- [ ] Stage the correct files
- [ ] Create the commit
- [ ] Push the current branch

### 1. Inspect the repository state

Start by checking:

```bash
git --no-pager status --short --branch
```

Review whether changes are already staged, whether there are untracked files, and which branch will be pushed.

### 2. Decide the commit scope

Default behavior:

- If the request is to commit the current worktree, stage all intended changes for this task.
- If unrelated changes are present, do not include them unless the request clearly includes everything.
- If an explicit commit message was provided, use it.
- If no message was provided, derive a concise message from the actual changes.

### 3. Stage files deliberately

If the request is to commit all current worktree changes:

```bash
git add -A
```

If only specific files should be committed, stage only those files:

```bash
git add <path> <path>
```

After staging, verify the result:

```bash
git --no-pager status --short
```

### 4. Create the commit

Use a direct commit when the message is already known:

```bash
git commit -m "<message>"
```

Write commit messages that reflect the actual change, using a short imperative summary.

### 5. Push the current branch

Push the checked-out branch to its configured upstream:

```bash
git push
```

If the branch has no upstream yet, publish it with:

```bash
git push -u origin HEAD
```

## Validation

Before finishing, confirm that:

1. The intended files were committed.
2. The commit succeeded.
3. The branch push succeeded.
4. The worktree is in the expected post-push state.

Useful checks:

```bash
git --no-pager status --short --branch
git --no-pager log -1 --stat
```

## Gotchas

- Do not stage or commit unrelated changes unless the request explicitly includes them.
- Do not rewrite history unless the request explicitly asks for it.
- Do not assume `origin` is correct without checking when a branch is being published for the first time.
- If push fails because of authentication, branch protection, or non-fast-forward history, surface the error clearly instead of guessing.
- If there is nothing to commit, say so plainly and do not create an empty commit unless the request explicitly asks for one.
