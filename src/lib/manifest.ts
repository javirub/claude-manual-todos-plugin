/**
 * The plugin's own identity, read from the manifest that Claude Code reads.
 *
 * There used to be three versions — `plugin.json`, `package.json` and a literal
 * in the MCP server constructor — and they had already drifted apart by 0.1.1.
 * The manifest is the one an installer actually sees, so it wins, and
 * `test/manifest.test.ts` holds `package.json` to it.
 */
import manifest from "../../.claude-plugin/plugin.json";

export const PLUGIN_NAME: string = manifest.name;
export const PLUGIN_VERSION: string = manifest.version;
export const PLUGIN_DISPLAY_NAME: string = manifest.displayName;
