/**
 * Merge Original JSON Scripts
 *
 * Reads every JSON file in `original-json/`, converts each entry into
 * the canonical text format, and writes a single `merged-original.txt`.
 *
 * Speech entries in kawarazaki-2 have no separate `name` field — the
 * speaker is inline in the `message`:
 *
 *   ［{source}］：{content}          (dialogue)
 *   ［{source}］：（{content}）        (thought)
 *
 * These are split into two lines:
 *
 *   ＃{source}
 *   {content}     — thoughts keep （）, dialogue is wrapped in 「」
 *
 * Narration entries (no ［…］ prefix) become a single line.
 *
 * Usage:
 *   node merge-original-scripts.mjs
 */

import { glob } from "glob";
import { readFile, writeFile } from "fs/promises";
import path from "path";

const INPUT_DIR = "original-json";
const OUTPUT_FILE = "merged-original.txt";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

// Matches ［speaker］：content where content is the rest of the line.
const SPEECH_RE = /^［(.+?)］：(.+)$/s;

async function main() {
  // Step 1: Discover all JSON files in the input directory.
  const files = (await glob(`${INPUT_DIR}/*.json`)).sort();

  if (files.length === 0) {
    console.error(`No JSON files found in ${INPUT_DIR}/`);
    process.exit(1);
  }

  const sections = [];

  for (const filePath of files) {
    // Step 2: Read and parse each JSON file.
    const fileName = path.basename(filePath, ".json");
    const raw = await readFile(filePath, "utf-8");
    const entries = JSON.parse(raw);

    // Step 3: Convert each JSON entry to text lines.
    const lines = [];
    for (const entry of entries) {
      // Strip \r\n sequences from the message before processing.
      const msg = entry.message.replace(/\r\n/g, "");
      const m = msg.match(SPEECH_RE);
      if (m) {
        // Speech entry — emit ＃{source} then the content.
        // Thoughts already have （）; dialogue gets wrapped in 「」.
        const source = m[1];
        const content = m[2];
        lines.push(`＃${source}`);
        const isThought =
          content.startsWith("（") && content.endsWith("）");
        lines.push(isThought ? content : `「${content}」`);
      } else {
        // Narration — emit as-is.
        lines.push(msg);
      }
    }

    // Step 4: Build the section with a filename header.
    sections.push(`${fileName}\n${HEADER_SEPARATOR}\n${lines.join("\n")}`);
  }

  // Step 5: Prepend each section with a separator and write to disk.
  const output = sections.map((s) => `${SECTION_SEPARATOR}\n${s}`).join("\n");
  await writeFile(OUTPUT_FILE, output + "\n", "utf-8");

  console.log(`${files.length} files merged into ${OUTPUT_FILE}`);
}

main().catch(console.error);
