/**
 * Agent Pipeline Core
 *
 * Deterministic agent pipeline handlers and renderer primitives.
 */

// Types
export type {
  CredentialInputMode,
  GoogleService,
  SlackService,
  MicrosoftService,
  AuthRequestType,
  BaseAuthRequest,
  CredentialAuthRequest,
  McpOAuthAuthRequest,
  GoogleOAuthAuthRequest,
  SlackOAuthAuthRequest,
  MicrosoftOAuthAuthRequest,
  AuthRequest,
  AuthResult,
  CallbackMessage,
  TextContent,
  ToolResult,
  ValidationIssue,
  ValidationResult,
  SourceType,
  McpTransport,
  McpAuthType,
  ApiAuthType,
  McpSourceConfig,
  ApiSourceConfig,
  LocalSourceConfig,
  SourceConfig,
  ConnectionStatus,
} from './types.ts';

// Response helpers
export {
  successResponse,
  errorResponse,
  textContent,
  multiBlockResponse,
} from './response.ts';

// Validation-lite helpers
export {
  validResult,
  invalidResult,
  mergeResults,
  formatValidationResult,
  SLUG_REGEX,
  validateSlug,
} from './validation-lite.ts';

// Context interface
export type {
  SessionToolContext,
  SessionToolCallbacks,
  FileSystemInterface,
  CredentialManagerInterface,
  ValidatorInterface,
  LoadedSource,
  StdioMcpConfig,
  HttpMcpConfig,
  StdioValidationResult,
  McpValidationResult,
  ApiTestResult,
} from './context.ts';

export { createNodeFileSystem } from './context.ts';

// Handlers
export {
  handleAgentStageGate,
  handleAgentState,
  handleAgentValidate,
  handleAgentRenderOutput,
} from './handlers/index.ts';

export type {
  AgentStageGateArgs,
  AgentStateArgs,
  AgentValidateArgs,
  AgentRenderOutputArgs,
} from './handlers/index.ts';
