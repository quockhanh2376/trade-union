/**
 * Compact, human-friendly rendering of a group-action run's PowerShell stdout.
 *
 * The script prints machine-oriented lines (RESULT_JSON, aggregate counters,
 * absolute export paths) and verbose per-email lines. The log box already
 * shows the frontend's own summary, so this formatter keeps only what adds
 * information and shortens the rest:
 *
 *   dropped  RESULT_JSON:...                          (result table shows it)
 *   dropped  Completed Add for 1 group(s).            (Done ... summary shows it)
 *   dropped  Success: 6 | Failed: 0                   (same)
 *   dropped  Last exported group: <group>             (Members exported covers it)
 *   rewrote  Updated members exported to <path> for <group>  -> "Members exported for <group>"
 *   rewrote  Add success [<group>]: <email>           -> "  ✓ <email>"
 *   rewrote  Add failed [<group>]: <email>            -> "  ✗ <email>"
 *   rewrote  Error [<group>][<email>]: <message>      -> "    ↳ <message>"
 */
export function formatRunStdout(stdout: string): string {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd());

  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (
      !trimmed ||
      trimmed.startsWith("RESULT_JSON:") ||
      /^Completed (Add|Remove) for \d+ group\(s\)\.$/.test(trimmed) ||
      /^Success: \d+ \| Failed: \d+$/.test(trimmed) ||
      /^Last exported group: \S+$/.test(trimmed)
    ) {
      continue;
    }

    const exported = trimmed.match(/^Updated members exported to \S+ for (\S+)$/);
    if (exported) {
      out.push(`Members exported for ${exported[1]}`);
      continue;
    }

    const success = trimmed.match(/^(Add|Remove) success \[[^\]]+\]: (\S+)$/);
    if (success) {
      out.push(`  ✓ ${success[2]}`);
      continue;
    }

    const failed = trimmed.match(/^(Add|Remove) failed \[[^\]]+\]: (\S+)$/);
    if (failed) {
      out.push(`  ✗ ${failed[2]}`);
      continue;
    }

    const reason = trimmed.match(/^Error \[[^\]]+\]\[[^\]]+\]: (.+)$/);
    if (reason) {
      out.push(`    ↳ ${reason[1]}`);
      continue;
    }

    out.push(trimmed);
  }

  return out.join("\n").replace(/\s+$/, "");
}
