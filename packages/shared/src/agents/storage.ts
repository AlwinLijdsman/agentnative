/**
 * Agent Storage
 *
 * CRUD operations for workspace agents.
 * Agents are stored in {workspace}/agents/{slug}/ directories.
 * Follows the skills/storage.ts pattern exactly, including namespace priority.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
} from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import matter from 'gray-matter';
import type { LoadedAgent, AgentMetadata, AgentConfig, AgentSource } from './types.ts';
import { atomicWriteFileSync, readJsonFileSync } from '../utils/files.ts';
import {
  validateIconValue,
  findIconFile,
  downloadIcon,
  needsIconDownload,
  isIconUrl,
} from '../utils/icon.ts';

// ============================================================
// Agent Paths
// ============================================================

/** Global agents directory: ~/.agents/agents/ */
const GLOBAL_AGENTS_DIR = join(homedir(), '.agents', 'agents');

/** Project-level agents directory name */
const PROJECT_AGENTS_DIR = '.agents/agents';

/**
 * Get path to workspace agents directory
 * @param rootPath - Absolute path to workspace root folder
 */
export function getWorkspaceAgentsPath(rootPath: string): string {
  return join(rootPath, 'agents');
}

// ============================================================
// Parsing
// ============================================================

/**
 * Parse AGENT.md content and extract frontmatter + body
 */
function parseAgentFile(content: string): { metadata: AgentMetadata; body: string } | null {
  try {
    const parsed = matter(content);

    // Validate required fields
    if (!parsed.data.name || !parsed.data.description) {
      return null;
    }

    // Validate and extract optional icon field
    const icon = validateIconValue(parsed.data.icon, 'Agents');

    return {
      metadata: {
        name: parsed.data.name as string,
        description: parsed.data.description as string,
        type: parsed.data.type as string | undefined,
        sources: parsed.data.sources as AgentMetadata['sources'] | undefined,
        icon,
      },
      body: parsed.content,
    };
  } catch {
    return null;
  }
}

/**
 * Load and parse agent config.json
 */
function loadAgentConfig(configPath: string): AgentConfig | null {
  if (!existsSync(configPath)) {
    return null;
  }

  try {
    return readJsonFileSync<AgentConfig>(configPath);
  } catch {
    return null;
  }
}

// ============================================================
// Load Operations
// ============================================================

/**
 * Load a single agent from a directory
 * @param agentsDir - Absolute path to agents directory
 * @param slug - Agent directory name
 * @param source - Where this agent is loaded from
 */
function loadAgentFromDir(agentsDir: string, slug: string, source: AgentSource): LoadedAgent | null {
  const agentDir = join(agentsDir, slug);
  const agentFile = join(agentDir, 'AGENT.md');
  const configFile = join(agentDir, 'config.json');

  // Check directory exists
  if (!existsSync(agentDir) || !statSync(agentDir).isDirectory()) {
    return null;
  }

  // Check AGENT.md exists
  if (!existsSync(agentFile)) {
    return null;
  }

  // Check config.json exists
  if (!existsSync(configFile)) {
    return null;
  }

  // Read and parse AGENT.md
  let content: string;
  try {
    content = readFileSync(agentFile, 'utf-8');
  } catch {
    return null;
  }

  const parsed = parseAgentFile(content);
  if (!parsed) {
    return null;
  }

  // Read and parse config.json
  const config = loadAgentConfig(configFile);
  if (!config) {
    return null;
  }

  return {
    slug,
    metadata: parsed.metadata,
    content: parsed.body,
    config,
    iconPath: findIconFile(agentDir),
    path: agentDir,
    source,
  };
}

/**
 * Load all agents from a directory
 * @param agentsDir - Absolute path to agents directory
 * @param source - Where these agents are loaded from
 */
function loadAgentsFromDir(agentsDir: string, source: AgentSource): LoadedAgent[] {
  if (!existsSync(agentsDir)) {
    return [];
  }

  const agents: LoadedAgent[] = [];

  try {
    const entries = readdirSync(agentsDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip template directories
      if (entry.name.startsWith('_')) continue;

      const agent = loadAgentFromDir(agentsDir, entry.name, source);
      if (agent) {
        agents.push(agent);
      }
    }
  } catch {
    // Ignore errors reading agents directory
  }

  return agents;
}

/**
 * Load a single agent from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Agent directory name
 */
export function loadAgent(workspaceRoot: string, slug: string): LoadedAgent | null {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);
  return loadAgentFromDir(agentsDir, slug, 'workspace');
}

/**
 * Load all agents from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function loadWorkspaceAgents(workspaceRoot: string): LoadedAgent[] {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);
  return loadAgentsFromDir(agentsDir, 'workspace');
}

/**
 * Load all agents from all sources (global, workspace, project).
 * Agents with the same slug are overridden by higher-priority sources.
 * Priority: global (lowest) < workspace < project (highest)
 *
 * @param workspaceRoot - Absolute path to workspace root
 * @param projectRoot - Optional project root (working directory) for project-level agents
 */
export function loadAllAgents(workspaceRoot: string, projectRoot?: string): LoadedAgent[] {
  const agentsBySlug = new Map<string, LoadedAgent>();

  // 1. Global agents (lowest priority): ~/.agents/agents/
  for (const agent of loadAgentsFromDir(GLOBAL_AGENTS_DIR, 'global')) {
    agentsBySlug.set(agent.slug, agent);
  }

  // 2. Workspace agents (medium priority)
  for (const agent of loadWorkspaceAgents(workspaceRoot)) {
    agentsBySlug.set(agent.slug, agent);
  }

  // 3. Project agents (highest priority): {projectRoot}/.agents/agents/
  if (projectRoot) {
    const projectAgentsDir = join(projectRoot, PROJECT_AGENTS_DIR);
    for (const agent of loadAgentsFromDir(projectAgentsDir, 'project')) {
      agentsBySlug.set(agent.slug, agent);
    }
  }

  return Array.from(agentsBySlug.values());
}

// ============================================================
// Config Update
// ============================================================

/**
 * Update an agent's config.json with shallow-merged updates.
 * Uses atomicWriteFileSync to prevent corruption.
 *
 * @param agentPath - Absolute path to agent directory
 * @param updates - Partial config to merge (top-level keys only)
 */
export function updateAgentConfig(agentPath: string, updates: Partial<AgentConfig>): void {
  const configFile = join(agentPath, 'config.json');

  if (!existsSync(configFile)) {
    throw new Error(`Agent config not found: ${configFile}`);
  }

  const current = readJsonFileSync<AgentConfig>(configFile);
  const updated = { ...current, ...updates };

  atomicWriteFileSync(configFile, JSON.stringify(updated, null, 2));
}

// ============================================================
// Icon Operations
// ============================================================

/**
 * Get icon path for an agent
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Agent directory name
 */
export function getAgentIconPath(workspaceRoot: string, slug: string): string | null {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);
  const agentDir = join(agentsDir, slug);

  if (!existsSync(agentDir)) {
    return null;
  }

  return findIconFile(agentDir) || null;
}

/**
 * Download an icon from a URL and save it to the agent directory.
 * Returns the path to the downloaded icon, or null on failure.
 */
export async function downloadAgentIcon(
  agentDir: string,
  iconUrl: string
): Promise<string | null> {
  return downloadIcon(agentDir, iconUrl, 'Agents');
}

/**
 * Check if an agent needs its icon downloaded.
 * Returns true if metadata has a URL icon and no local icon file exists.
 */
export function agentNeedsIconDownload(agent: LoadedAgent): boolean {
  return needsIconDownload(agent.metadata.icon, agent.iconPath);
}

// ============================================================
// Delete Operations
// ============================================================

/**
 * Delete an agent from a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Agent directory name
 */
export function deleteAgent(workspaceRoot: string, slug: string): boolean {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);
  const agentDir = join(agentsDir, slug);

  if (!existsSync(agentDir)) {
    return false;
  }

  try {
    rmSync(agentDir, { recursive: true });
    return true;
  } catch {
    return false;
  }
}

// ============================================================
// Utility Functions
// ============================================================

/**
 * Check if an agent exists in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 * @param slug - Agent directory name
 */
export function agentExists(workspaceRoot: string, slug: string): boolean {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);
  const agentDir = join(agentsDir, slug);
  const agentFile = join(agentDir, 'AGENT.md');
  const configFile = join(agentDir, 'config.json');

  return existsSync(agentDir) && existsSync(agentFile) && existsSync(configFile);
}

/**
 * List agent slugs in a workspace
 * @param workspaceRoot - Absolute path to workspace root
 */
export function listAgentSlugs(workspaceRoot: string): string[] {
  const agentsDir = getWorkspaceAgentsPath(workspaceRoot);

  if (!existsSync(agentsDir)) {
    return [];
  }

  try {
    return readdirSync(agentsDir, { withFileTypes: true })
      .filter((entry) => {
        if (!entry.isDirectory()) return false;
        if (entry.name.startsWith('_')) return false; // Skip template dirs
        const agentFile = join(agentsDir, entry.name, 'AGENT.md');
        const configFile = join(agentsDir, entry.name, 'config.json');
        return existsSync(agentFile) && existsSync(configFile);
      })
      .map((entry) => entry.name);
  } catch {
    return [];
  }
}

/**
 * Log agent data usage for observability (v1 — no cleanup, logging only).
 * Walks data/agents/ dir tree, sums file sizes.
 *
 * @param sessionDataPath - Absolute path to session data directory (e.g., sessions/{id}/data/)
 * @returns Summary object with totals
 */
export function logAgentDataUsage(sessionDataPath: string): {
  totalBytes: number;
  runCount: number;
  agentCount: number;
} {
  const agentsDataPath = join(sessionDataPath, 'agents');
  const summary = { totalBytes: 0, runCount: 0, agentCount: 0 };

  if (!existsSync(agentsDataPath)) {
    return summary;
  }

  try {
    const agentDirs = readdirSync(agentsDataPath, { withFileTypes: true })
      .filter((d) => d.isDirectory());

    summary.agentCount = agentDirs.length;

    for (const agentDir of agentDirs) {
      const runsPath = join(agentsDataPath, agentDir.name, 'runs');
      if (existsSync(runsPath)) {
        const runDirs = readdirSync(runsPath, { withFileTypes: true })
          .filter((d) => d.isDirectory());
        summary.runCount += runDirs.length;
      }

      // Walk directory tree and sum file sizes
      sumDirectorySize(join(agentsDataPath, agentDir.name), summary);
    }
  } catch {
    // Ignore errors during usage scan
  }

  return summary;
}

/**
 * Recursively sum file sizes in a directory
 */
function sumDirectorySize(dirPath: string, summary: { totalBytes: number }): void {
  try {
    const entries = readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        sumDirectorySize(fullPath, summary);
      } else if (entry.isFile()) {
        try {
          summary.totalBytes += statSync(fullPath).size;
        } catch {
          // Skip files we can't stat
        }
      }
    }
  } catch {
    // Ignore errors reading directory
  }
}

// Re-export icon utilities for convenience
export { isIconUrl } from '../utils/icon.ts';
