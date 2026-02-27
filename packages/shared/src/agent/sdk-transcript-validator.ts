/**
 * SDK Transcript Validator
 *
 * Validates whether an SDK session transcript file is resumable before attempting
 * `{ resume: sessionId }`. This prevents the "No conversation found" error that
 * occurs when the SDK tries to resume a dequeue-only transcript (≈139 bytes)
 * produced by the first turn's subprocess lifecycle.
 *
 * The SDK stores transcripts at:
 *   `{configDir}/projects/{cwd-slug}/{sessionId}.jsonl`
 *
 * where `cwd-slug` is the CWD path with all `[:\\/]` characters replaced by `-`.
 *
 * A transcript is considered "resumable" if:
 * 1. The file exists at the expected path
 * 2. The file size is >500 bytes (dequeue-only files are ≈139 bytes)
 * 3. The file contains at least one `"type":"assistant"` record (proves conversation happened)
 *
 * When validation fails, the caller should clear the session ID and start fresh
 * instead of attempting resume — avoiding the SESSION_RECOVERY path and the
 * "Restoring conversation context..." message entirely.
 */

import { existsSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { debug } from '../utils/debug.ts';

/**
 * Minimum transcript file size (in bytes) to consider for resume.
 * Dequeue-only transcripts are ≈139 bytes. Real conversation transcripts
 * with at least one assistant message are typically >2KB.
 * 500 bytes provides a safe margin.
 */
const MIN_RESUMABLE_SIZE = 500;

/**
 * Maximum bytes to read from the transcript for content validation.
 * We only need to confirm the presence of an assistant message — reading
 * the first 8KB is sufficient even for large transcripts since the
 * assistant response appears early in the file.
 */
const PROBE_READ_SIZE = 8192;

/**
 * Returns the SDK configuration directory.
 * Respects the `CLAUDE_CONFIG_DIR` environment variable if set,
 * otherwise defaults to `~/.claude/`.
 */
export function getSdkConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR ?? join(homedir(), '.claude');
}

/**
 * Converts a CWD path to the slug format used by the SDK for project directories.
 *
 * The SDK replaces all `[:\\/]` characters with `-` to create a filesystem-safe
 * directory name under `~/.claude/projects/`.
 *
 * Examples:
 * - `C:\dev\project` → `C--dev-project`
 * - `/home/user/project` → `-home-user-project`
 * - `C:\\dev\\project` → `C--dev-project`
 */
export function slugifyCwd(cwd: string): string {
  return cwd.replace(/[:\\/]/g, '-');
}

/**
 * Returns the full path to the SDK transcript file for a given session.
 *
 * Path format: `{configDir}/projects/{cwd-slug}/{sessionId}.jsonl`
 */
export function getTranscriptPath(sdkCwd: string, sessionId: string): string {
  const configDir = getSdkConfigDir();
  const slug = slugifyCwd(sdkCwd);
  return join(configDir, 'projects', slug, `${sessionId}.jsonl`);
}

/**
 * Checks whether an SDK session transcript is resumable.
 *
 * A transcript is resumable if:
 * 1. The file exists at the expected path
 * 2. The file size exceeds MIN_RESUMABLE_SIZE (500 bytes)
 * 3. The file contains at least one `"type":"assistant"` record
 *
 * Returns `false` on any error (file missing, permission denied, etc.)
 * to ensure a safe fallback to fresh session creation.
 *
 * @param sdkCwd - The SDK cwd used for this session (determines transcript directory)
 * @param sessionId - The SDK session ID (determines transcript filename)
 * @returns `true` if the transcript contains valid conversation data for resume
 */
export function isResumableTranscript(sdkCwd: string, sessionId: string): boolean {
  try {
    const transcriptPath = getTranscriptPath(sdkCwd, sessionId);

    // Check 1: File must exist
    if (!existsSync(transcriptPath)) {
      debug('[TranscriptValidator] Transcript not found: %s', transcriptPath);
      return false;
    }

    // Check 2: File must be large enough to contain conversation data
    const stats = statSync(transcriptPath);
    if (stats.size < MIN_RESUMABLE_SIZE) {
      debug(
        '[TranscriptValidator] Transcript too small (%d bytes < %d): %s',
        stats.size,
        MIN_RESUMABLE_SIZE,
        transcriptPath
      );
      return false;
    }

    // Check 3: File must contain at least one assistant message
    // Read first PROBE_READ_SIZE bytes — assistant messages appear early in transcripts
    const fd = readFileSync(transcriptPath, { encoding: 'utf-8', flag: 'r' });
    const probe = fd.slice(0, PROBE_READ_SIZE);

    if (!probe.includes('"type":"assistant"')) {
      debug(
        '[TranscriptValidator] No assistant message in first %d bytes: %s',
        PROBE_READ_SIZE,
        transcriptPath
      );
      return false;
    }

    debug('[TranscriptValidator] Transcript is resumable (%d bytes): %s', stats.size, transcriptPath);
    return true;
  } catch (error) {
    // Any error (permission denied, corrupt file, etc.) → not resumable
    debug('[TranscriptValidator] Error checking transcript: %s', error);
    return false;
  }
}
