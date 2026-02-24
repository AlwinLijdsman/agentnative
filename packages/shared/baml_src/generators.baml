// BAML Generator Configuration — TypeScript output
//
// Generates typed TypeScript clients into the orchestrator directory.
// Run: pnpm run baml:generate (or: npx baml generate)
//
// The generated baml_client/ directory is gitignored — regenerate
// after every BAML source change.

generator target {
  output_type "typescript"
  output_dir "../src/agent/orchestrator/baml_client"
  version "0.85.0"
}
