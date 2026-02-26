import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { extractTransportConfig } from '../mcp-lifecycle.ts';

describe('extractTransportConfig', () => {
  it('resolves relative cwd and path-like command against workspace root', () => {
    const cfg = extractTransportConfig(
      {
        transport: 'stdio',
        command: 'isa-kb-mcp-server/.venv/Scripts/python.exe',
        cwd: 'isa-kb-mcp-server',
      },
      'C:/dev/deving/agentnative',
    );

    assert.equal(cfg.transport, 'stdio');
    assert.ok(cfg.command?.includes('C:')); // Windows absolute path
    assert.ok(
      cfg.command?.includes('isa-kb-mcp-server/.venv/Scripts/python.exe')
      || cfg.command?.includes('isa-kb-mcp-server\\.venv\\Scripts\\python.exe'),
    );
    assert.ok(cfg.cwd?.includes('C:'));
    assert.ok(cfg.cwd?.endsWith('isa-kb-mcp-server'));
  });

  it('preserves executable-name command for PATH lookup', () => {
    const cfg = extractTransportConfig(
      {
        transport: 'stdio',
        command: 'python',
        cwd: 'isa-kb-mcp-server',
      },
      'C:/dev/deving/agentnative',
    );

    assert.equal(cfg.command, 'python');
    assert.ok(cfg.cwd?.includes('C:'));
  });

  it('keeps absolute command/cwd unchanged', () => {
    const cfg = extractTransportConfig(
      {
        transport: 'stdio',
        command: 'C:/tools/python.exe',
        cwd: 'C:/work/agentnative/isa-kb-mcp-server',
      },
      'C:/dev/deving/agentnative',
    );

    assert.equal(cfg.command, 'C:/tools/python.exe');
    assert.equal(cfg.cwd, 'C:/work/agentnative/isa-kb-mcp-server');
  });
});
