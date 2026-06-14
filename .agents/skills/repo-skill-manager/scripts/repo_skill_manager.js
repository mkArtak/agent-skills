#!/usr/bin/env node

"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");

const SOURCE_REPOSITORY = "mkArtak/agent-skills";
const REMOTE_SKILLS_ROOT = ".agents/skills";
const INSTALL_METADATA_NAME = ".repo-skill-install.json";
const REQUEST_HEADERS = {
  Accept: "application/vnd.github+json",
  "User-Agent": "repo-skill-manager",
};

class SkillManagerError extends Error {}

function addAuthHeader(headers) {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    return headers;
  }
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
  };
}

async function httpGet(url, { json = false } = {}) {
  const response = await fetch(url, {
    headers: addAuthHeader(REQUEST_HEADERS),
  });

  if (!response.ok) {
    throw new SkillManagerError(
      `GitHub request failed for ${url}: HTTP ${response.status}: ${await response.text()}`
    );
  }

  if (json) {
    return response.json();
  }

  return Buffer.from(await response.arrayBuffer());
}

async function githubApiJson(apiPath) {
  const url = `https://api.github.com/repos/${SOURCE_REPOSITORY}${apiPath}`;
  return httpGet(url, { json: true });
}

async function getDefaultBranch() {
  const repo = await githubApiJson("");
  if (!repo.default_branch || typeof repo.default_branch !== "string") {
    throw new SkillManagerError(`Could not determine default branch for ${SOURCE_REPOSITORY}.`);
  }
  return repo.default_branch;
}

function stripQuotes(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed[0] === trimmed.at(-1) && [`"`, `'`].includes(trimmed[0])) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(text) {
  const lines = text.split(/\r?\n/);
  if (lines.length === 0 || lines[0].trim() !== "---") {
    return {};
  }

  const data = {};
  let currentMap = null;

  for (const line of lines.slice(1)) {
    if (line.trim() === "---") {
      break;
    }
    if (!line.trim()) {
      continue;
    }

    if (!line.startsWith(" ")) {
      const separator = line.indexOf(":");
      if (separator === -1) {
        continue;
      }

      const key = line.slice(0, separator).trim();
      const rawValue = line.slice(separator + 1).trim();
      if (rawValue) {
        data[key] = stripQuotes(rawValue);
        currentMap = null;
      } else {
        data[key] = {};
        currentMap = key;
      }
      continue;
    }

    if (!currentMap) {
      continue;
    }

    const stripped = line.trim();
    const separator = stripped.indexOf(":");
    if (separator === -1) {
      continue;
    }

    const key = stripped.slice(0, separator).trim();
    const rawValue = stripQuotes(stripped.slice(separator + 1).trim());
    if (typeof data[currentMap] !== "object" || data[currentMap] === null || Array.isArray(data[currentMap])) {
      data[currentMap] = {};
    }
    data[currentMap][key] = rawValue;
  }

  return data;
}

async function listRemoteSkills() {
  const branch = await getDefaultBranch();
  const contents = await githubApiJson(
    `/contents/${encodeURIComponent(REMOTE_SKILLS_ROOT).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`
  );

  if (!Array.isArray(contents)) {
    throw new SkillManagerError("Unexpected response when listing remote skills.");
  }

  const skills = [];
  for (const entry of contents) {
    if (entry.type !== "dir" || typeof entry.name !== "string") {
      continue;
    }

    const skillFile = await githubApiJson(
      `/contents/${encodeURIComponent(`${REMOTE_SKILLS_ROOT}/${entry.name}/SKILL.md`).replace(/%2F/g, "/")}?ref=${encodeURIComponent(branch)}`
    );

    if (typeof skillFile.content !== "string" || skillFile.encoding !== "base64") {
      throw new SkillManagerError(`Unexpected SKILL.md payload for ${entry.name}.`);
    }

    const decoded = Buffer.from(skillFile.content, "base64").toString("utf8");
    const frontmatter = parseFrontmatter(decoded);
    const metadata = typeof frontmatter.metadata === "object" && frontmatter.metadata !== null
      ? frontmatter.metadata
      : {};

    skills.push({
      name: entry.name,
      description: typeof frontmatter.description === "string" ? frontmatter.description : "",
      version: typeof metadata.version === "string" ? metadata.version : null,
      path: `${REMOTE_SKILLS_ROOT}/${entry.name}`,
    });
  }

  skills.sort((left, right) => left.name.localeCompare(right.name));
  return skills;
}

function findRepoRoot(startDirectory) {
  let current = path.resolve(startDirectory);
  for (;;) {
    if (require("node:fs").existsSync(path.join(current, ".git"))) {
      return current;
    }
    const parent = path.dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

function getProjectSkillsRoot() {
  const repoRoot = findRepoRoot(process.cwd());
  if (!repoRoot) {
    throw new SkillManagerError("Project-scoped skill management requires running inside a Git repository.");
  }
  return path.join(repoRoot, ".agents", "skills");
}

function getUserSkillsRoot() {
  return path.join(os.homedir(), ".agents", "skills");
}

function ensureRemoteSkillExists(skillName, availableSkills) {
  const skill = availableSkills.find((candidate) => candidate.name === skillName);
  if (skill) {
    return skill;
  }
  const available = availableSkills.map((candidate) => candidate.name).join(", ");
  throw new SkillManagerError(
    `Skill '${skillName}' was not found in ${SOURCE_REPOSITORY}. Available skills: ${available}`
  );
}

async function listRemoteTree(remotePath, ref) {
  const result = await githubApiJson(
    `/contents/${encodeURIComponent(remotePath).replace(/%2F/g, "/")}?ref=${encodeURIComponent(ref)}`
  );
  if (!Array.isArray(result)) {
    throw new SkillManagerError(`Unexpected response when reading ${remotePath}.`);
  }
  return result;
}

async function downloadTree(remotePath, destination, ref) {
  await fs.mkdir(destination, { recursive: true });
  const entries = await listRemoteTree(remotePath, ref);

  for (const entry of entries) {
    if (typeof entry.name !== "string" || typeof entry.path !== "string") {
      throw new SkillManagerError(`Malformed tree entry under ${remotePath}.`);
    }

    const target = path.join(destination, entry.name);
    if (entry.type === "dir") {
      await downloadTree(entry.path, target, ref);
      continue;
    }
    if (entry.type !== "file") {
      continue;
    }
    if (typeof entry.download_url !== "string") {
      throw new SkillManagerError(`Missing download URL for ${entry.path}.`);
    }

    await fs.mkdir(path.dirname(target), { recursive: true });
    const contents = await httpGet(entry.download_url);
    await fs.writeFile(target, contents);
  }
}

async function hashFile(filePath) {
  const digest = crypto.createHash("sha256");
  digest.update(await fs.readFile(filePath));
  return digest.digest("hex");
}

async function collectHashes(skillDirectory) {
  const hashes = {};

  async function visit(directory) {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      const relativePath = path.relative(skillDirectory, fullPath).split(path.sep).join("/");

      if (entry.isDirectory()) {
        await visit(fullPath);
        continue;
      }

      if (!entry.isFile() || relativePath === INSTALL_METADATA_NAME) {
        continue;
      }

      hashes[relativePath] = await hashFile(fullPath);
    }
  }

  await visit(skillDirectory);
  return hashes;
}

async function writeInstallMetadata(skillDirectory, scope, ref) {
  const metadata = {
    installed_from: SOURCE_REPOSITORY,
    scope,
    ref,
    installed_at: new Date().toISOString(),
    file_hashes: await collectHashes(skillDirectory),
  };

  await fs.writeFile(
    path.join(skillDirectory, INSTALL_METADATA_NAME),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8"
  );
}

async function readInstallMetadata(skillDirectory) {
  const metadataPath = path.join(skillDirectory, INSTALL_METADATA_NAME);
  try {
    return JSON.parse(await fs.readFile(metadataPath, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

async function installSkill(skillName, globalScope, dryRun, force) {
  const skills = await listRemoteSkills();
  const remoteSkill = ensureRemoteSkillExists(skillName, skills);
  const branch = await getDefaultBranch();
  const scope = globalScope ? "user" : "project";
  const targetRoot = globalScope ? getUserSkillsRoot() : getProjectSkillsRoot();
  const destination = path.join(targetRoot, skillName);

  try {
    await fs.access(destination);
    if (!force) {
      throw new SkillManagerError(
        `Target directory already exists: ${destination}. Re-run with --force to replace it.`
      );
    }
  } catch (error) {
    if (!(error && error.code === "ENOENT")) {
      if (error instanceof SkillManagerError) {
        throw error;
      }
      throw error;
    }
  }

  if (dryRun) {
    return {
      action: "install",
      scope,
      skill: skillName,
      target: destination,
      status: "dry-run",
      source_path: remoteSkill.path,
    };
  }

  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${skillName}-`));
  const tempSkillRoot = path.join(tempRoot, skillName);

  try {
    await downloadTree(remoteSkill.path, tempSkillRoot, branch);
    await writeInstallMetadata(tempSkillRoot, scope, branch);

    await fs.mkdir(path.dirname(destination), { recursive: true });
    await fs.rm(destination, { recursive: true, force: true });
    await fs.cp(tempSkillRoot, destination, { recursive: true });
  } finally {
    await fs.rm(tempRoot, { recursive: true, force: true });
  }

  return {
    action: "install",
    scope,
    skill: skillName,
    target: destination,
    status: "installed",
    source_path: remoteSkill.path,
  };
}

async function loadLocalSkillMetadata(skillDirectory) {
  const skillFile = path.join(skillDirectory, "SKILL.md");
  try {
    return parseFrontmatter(await fs.readFile(skillFile, "utf8"));
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return {};
    }
    throw error;
  }
}

async function discoverInstalledRepoSkills() {
  const locations = [];
  const projectRoot = findRepoRoot(process.cwd());
  if (projectRoot) {
    locations.push(["project", path.join(projectRoot, ".agents", "skills")]);
  }
  locations.push(["user", getUserSkillsRoot()]);

  const discovered = [];
  const seen = new Set();
  for (const [scope, root] of locations) {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      entries.sort((left, right) => left.name.localeCompare(right.name));

      for (const entry of entries) {
        if (!entry.isDirectory()) {
          continue;
        }

        const skillDirectory = path.join(root, entry.name);
        if (seen.has(skillDirectory)) {
          continue;
        }

        const frontmatter = await loadLocalSkillMetadata(skillDirectory);
        const metadata = typeof frontmatter.metadata === "object" && frontmatter.metadata !== null
          ? frontmatter.metadata
          : null;
        if (!metadata || metadata["source-repository"] !== SOURCE_REPOSITORY) {
          continue;
        }

        discovered.push([scope, skillDirectory]);
        seen.add(skillDirectory);
      }
    } catch (error) {
      if (!(error && error.code === "ENOENT")) {
        throw error;
      }
    }
  }

  return discovered;
}

async function updateSkills(dryRun, force) {
  const branch = await getDefaultBranch();
  const remoteSkills = new Map((await listRemoteSkills()).map((skill) => [skill.name, skill]));
  const updated = [];
  const skipped = [];

  for (const [scope, skillDirectory] of await discoverInstalledRepoSkills()) {
    const skillName = path.basename(skillDirectory);
    const remoteSkill = remoteSkills.get(skillName);
    if (!remoteSkill) {
      skipped.push({
        skill: skillName,
        scope,
        path: skillDirectory,
        reason: "Skill no longer exists in the source repository.",
      });
      continue;
    }

    const installMetadata = await readInstallMetadata(skillDirectory);
    if (!installMetadata) {
      skipped.push({
        skill: skillName,
        scope,
        path: skillDirectory,
        reason: `Missing ${INSTALL_METADATA_NAME}; update safety cannot be verified.`,
      });
      continue;
    }

    if (
      typeof installMetadata.file_hashes !== "object" ||
      installMetadata.file_hashes === null ||
      Array.isArray(installMetadata.file_hashes)
    ) {
      skipped.push({
        skill: skillName,
        scope,
        path: skillDirectory,
        reason: "Install metadata is malformed.",
      });
      continue;
    }

    const currentHashes = await collectHashes(skillDirectory);
    if (JSON.stringify(currentHashes) !== JSON.stringify(installMetadata.file_hashes) && !force) {
      skipped.push({
        skill: skillName,
        scope,
        path: skillDirectory,
        reason: "Local modifications detected. Re-run with --force to replace them.",
      });
      continue;
    }

    const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), `${skillName}-update-`));
    const tempSkillRoot = path.join(tempRoot, skillName);

    try {
      await downloadTree(remoteSkill.path, tempSkillRoot, branch);
      const remoteHashes = await collectHashes(tempSkillRoot);
      if (JSON.stringify(currentHashes) === JSON.stringify(remoteHashes)) {
        skipped.push({
          skill: skillName,
          scope,
          path: skillDirectory,
          reason: "Already up to date.",
        });
        continue;
      }

      if (dryRun) {
        updated.push({
          skill: skillName,
          scope,
          path: skillDirectory,
          status: "dry-run",
        });
        continue;
      }

      await writeInstallMetadata(tempSkillRoot, scope, branch);
      await fs.rm(skillDirectory, { recursive: true, force: true });
      await fs.cp(tempSkillRoot, skillDirectory, { recursive: true });
      updated.push({
        skill: skillName,
        scope,
        path: skillDirectory,
        status: "updated",
      });
    } finally {
      await fs.rm(tempRoot, { recursive: true, force: true });
    }
  }

  return {
    action: "update",
    repository: SOURCE_REPOSITORY,
    updated,
    skipped,
  };
}

function emitResult(payload, asJson) {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
    return;
  }

  if (payload.action === "list") {
    process.stdout.write(`Available skills from ${payload.repository}:\n`);
    for (const skill of payload.skills) {
      process.stdout.write(`- ${skill.name} (${skill.version || "unknown"}): ${skill.description}\n`);
    }
    return;
  }

  if (payload.action === "install") {
    process.stdout.write(`${payload.status}: ${payload.skill} -> ${payload.target}\n`);
    return;
  }

  if (payload.action === "update") {
    process.stdout.write(`Updated skills from ${payload.repository}:\n`);
    for (const item of payload.updated) {
      process.stdout.write(`- ${item.skill} [${item.scope}] ${item.status} at ${item.path}\n`);
    }
    for (const item of payload.skipped) {
      process.stdout.write(`- ${item.skill} [${item.scope}] skipped: ${item.reason}\n`);
    }
    return;
  }

  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function parseArgs(argv) {
  const [command, ...rest] = argv;
  if (!command) {
    throw new SkillManagerError("Usage: node scripts/repo_skill_manager.js <list|install|update> [options]");
  }

  const flags = new Set(rest.filter((value) => value.startsWith("--")));

  if (command === "list") {
    return {
      command,
      json: flags.has("--json"),
    };
  }

  if (command === "install") {
    const skillName = rest.find((value) => !value.startsWith("--"));
    if (!skillName) {
      throw new SkillManagerError("Usage: node scripts/repo_skill_manager.js install <skill-name> [--global] [--dry-run] [--force] [--json]");
    }
    return {
      command,
      skillName,
      globalScope: flags.has("--global"),
      dryRun: flags.has("--dry-run"),
      force: flags.has("--force"),
      json: flags.has("--json"),
    };
  }

  if (command === "update") {
    return {
      command,
      dryRun: flags.has("--dry-run"),
      force: flags.has("--force"),
      json: flags.has("--json"),
    };
  }

  throw new SkillManagerError(`Unsupported command: ${command}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "list") {
    emitResult(
      {
        action: "list",
        repository: SOURCE_REPOSITORY,
        skills: await listRemoteSkills(),
      },
      args.json
    );
    return;
  }

  if (args.command === "install") {
    emitResult(
      await installSkill(args.skillName, args.globalScope, args.dryRun, args.force),
      args.json
    );
    return;
  }

  if (args.command === "update") {
    emitResult(await updateSkills(args.dryRun, args.force), args.json);
  }
}

main().catch((error) => {
  if (error instanceof SkillManagerError) {
    console.error(`Error: ${error.message}`);
    process.exit(1);
  }

  console.error(error);
  process.exit(1);
});
