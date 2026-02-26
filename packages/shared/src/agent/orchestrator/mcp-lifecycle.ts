/**
 * MCP Lifecycle Manager
 *
 * Manages CraftMcpClient lifecycle for the orchestrator.
 * Reads source config → creates CraftMcpClient → connect() → passes to McpBridge → close().
 *
 * The orchestrator's MCP client is SEPARATE from SDK-managed connections (G18).
 * This means:
 * - Safe Mode (SDK's PreToolUse hook) does NOT apply to orchestrator tool calls (G23)
 * - The orchestrator has full control over when connections open/close
 * - Connection errors are handled at the orchestrator level, not the SDK level
 *
 * Usage:
 * ```typescript
 * const lifecycle = new McpLifecycleManager();
 *
 * // Option 1: Manual connect/close
 * const client = await lifecycle.connect(sourceConfig);
 * const bridge = new OrchestratorMcpBridge(client);
 * // ... use bridge ...
 * await lifecycle.close();
 *
 * // Option 2: Scoped — auto-close on completion or error
 * const result = await lifecycle.withClient(sourceConfig, async (client) => {
 *   const bridge = new OrchestratorMcpBridge(client);
 *   return bridge.kbSearch('ISA 315 risk assessment');
 * });
 * ```
 */

import { CraftMcpClient, type McpClientConfig } from '../../mcp/client.ts';
import { isAbsolute, resolve } from 'node:path';

// ============================================================================
// SOURCE CONFIG TYPES — Input from sources/*/config.json
// ============================================================================

/**
 * MCP source configuration — matches the `mcp` block in source config.json files.
 *
 * This is a subset of the full FolderSourceConfig.mcp field, containing
 * only the fields needed to create a CraftMcpClient.
 */
export interface McpSourceTransportConfig {
  /** Transport type: 'stdio' for local subprocess, 'http' for remote server. */
  transport: 'stdio' | 'http';
  /** Command to spawn (stdio transport). */
  command?: string;
  /** Arguments for the command (stdio transport). */
  args?: string[];
  /** Working directory for the subprocess (stdio transport). */
  cwd?: string;
  /** Environment variables for the subprocess (stdio transport). */
  env?: Record<string, string>;
  /** URL endpoint (http transport). */
  url?: string;
  /** HTTP headers (http transport). */
  headers?: Record<string, string>;
}

// ============================================================================
// LIFECYCLE MANAGER
// ============================================================================

export class McpLifecycleManager {
  private client: CraftMcpClient | null = null;
  private connecting = false;

  /**
   * Create and connect a CraftMcpClient from the given transport config.
   *
   * If a client is already connected, closes it first (only one active connection).
   *
   * @param transportConfig - MCP transport configuration from source config.json
   * @returns Connected CraftMcpClient ready for tool calls
   * @throws Error if connection fails (health check includes listTools())
   */
  async connect(transportConfig: McpSourceTransportConfig): Promise<CraftMcpClient> {
    // Close existing connection if any
    if (this.client) {
      await this.close();
    }

    this.connecting = true;

    try {
      const clientConfig = toClientConfig(transportConfig);
      this.client = new CraftMcpClient(clientConfig);
      await this.client.connect();
      return this.client;
    } catch (error) {
      this.client = null;
      throw new Error(
        `Failed to connect MCP client (${transportConfig.transport} transport): ` +
        `${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      this.connecting = false;
    }
  }

  /**
   * Close the active MCP client connection.
   *
   * Safe to call multiple times — no-op if no active connection.
   * Silently catches close errors (best-effort cleanup).
   */
  async close(): Promise<void> {
    if (this.client) {
      try {
        await this.client.close();
      } catch (error) {
        console.warn(
          '[McpLifecycleManager] Error closing MCP client:',
          error instanceof Error ? error.message : error,
        );
      }
      this.client = null;
    }
  }

  /**
   * Execute a function with a connected MCP client, ensuring cleanup on completion or error.
   *
   * This is the recommended pattern for orchestrator pipeline runs:
   * 1. Connects the MCP client
   * 2. Passes it to the callback
   * 3. Closes the client when the callback completes (or throws)
   *
   * @param transportConfig - MCP transport configuration
   * @param fn - Async function that receives the connected client
   * @returns Result of the callback function
   * @throws Rethrows any error from connect() or fn(), always cleans up
   */
  async withClient<T>(
    transportConfig: McpSourceTransportConfig,
    fn: (client: CraftMcpClient) => Promise<T>,
  ): Promise<T> {
    const client = await this.connect(transportConfig);
    try {
      return await fn(client);
    } finally {
      await this.close();
    }
  }

  /**
   * Get the current active client, or null if not connected.
   *
   * Used for checking connection state without side effects.
   */
  getClient(): CraftMcpClient | null {
    return this.client;
  }

  /** Whether a client is currently connected. */
  get isConnected(): boolean {
    return this.client !== null;
  }

  /** Whether a connection attempt is in progress. */
  get isConnecting(): boolean {
    return this.connecting;
  }
}

// ============================================================================
// CONFIG CONVERSION — McpSourceTransportConfig → CraftMcpClient config
// ============================================================================

/**
 * Convert orchestrator-level transport config to CraftMcpClient config.
 *
 * Maps the simplified McpSourceTransportConfig to the union type
 * expected by CraftMcpClient constructor (HttpMcpClientConfig | StdioMcpClientConfig).
 *
 * @param config - Orchestrator transport config from source config.json
 * @returns CraftMcpClient-compatible config object
 * @throws Error if required fields are missing for the transport type
 */
function toClientConfig(config: McpSourceTransportConfig): McpClientConfig {
  if (config.transport === 'stdio') {
    if (!config.command) {
      throw new Error(
        'Stdio transport requires a "command" field. ' +
        'Check the source config.json mcp block.',
      );
    }
    return {
      transport: 'stdio',
      command: config.command,
      args: config.args,
      env: config.env,
      cwd: config.cwd,
    };
  }

  if (config.transport === 'http') {
    if (!config.url) {
      throw new Error(
        'HTTP transport requires a "url" field. ' +
        'Check the source config.json mcp block.',
      );
    }
    return {
      transport: 'http',
      url: config.url,
      headers: config.headers,
    };
  }

  // Exhaustiveness guard — TypeScript should prevent this at compile time
  throw new Error(`Unknown MCP transport type: ${config.transport as string}`);
}

// ============================================================================
// HELPER — Extract transport config from source config.json
// ============================================================================

/**
 * Extract McpSourceTransportConfig from a source config.json `mcp` block.
 *
 * This is a convenience function for consumers that have access to the
 * full FolderSourceConfig and want to extract just the transport fields
 * needed by McpLifecycleManager.
 *
 * @param mcpBlock - The `mcp` field from a source config.json
 * @returns Transport config suitable for McpLifecycleManager.connect()
 * @throws Error if the mcp block is missing or has no transport
 */
export function extractTransportConfig(
  mcpBlock: Record<string, unknown> | undefined,
  workspaceRootPath: string,
): McpSourceTransportConfig {
  if (!mcpBlock) {
    throw new Error('Source config.json has no "mcp" block');
  }

  const transport = (mcpBlock['transport'] as string) ?? 'http';
  if (transport !== 'stdio' && transport !== 'http') {
    throw new Error(
      `Unsupported MCP transport: "${transport}". Expected "stdio" or "http".`,
    );
  }

  const rawCommand = mcpBlock['command'] as string | undefined;
  const rawCwd = mcpBlock['cwd'] as string | undefined;

  const resolvedCwd = rawCwd
    ? (isAbsolute(rawCwd) ? rawCwd : resolve(workspaceRootPath, rawCwd))
    : undefined;

  // Preserve PATH lookups for executable names; only resolve path-like commands.
  const resolvedCommand = rawCommand && isPathLike(rawCommand)
    ? (isAbsolute(rawCommand) ? rawCommand : resolve(workspaceRootPath, rawCommand))
    : rawCommand;

  return {
    transport,
    command: resolvedCommand,
    args: mcpBlock['args'] as string[] | undefined,
    cwd: resolvedCwd,
    env: mcpBlock['env'] as Record<string, string> | undefined,
    url: mcpBlock['url'] as string | undefined,
    headers: mcpBlock['headers'] as Record<string, string> | undefined,
  };
}

function isPathLike(command: string): boolean {
  return command.includes('/') || command.includes('\\');
}
