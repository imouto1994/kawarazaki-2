/**
 * Merge Original JSON Scripts
 *
 * Reads every JSON file in `original-json/`, joins fragmented entries,
 * converts each entry into the canonical text format, and writes a single
 * `merged-original.txt`.
 *
 * Speech entries in kawarazaki-2 have no separate `name` field — the
 * speaker is inline in the `message`:
 *
 *   ［{source}］：{content}          (dialogue)
 *   ［{source}］：（{content}）        (thought)
 *
 * Many lines are split across adjacent JSON entries. The script joins:
 *   1. Lone bracket open: "［" + "］：content"  →  "［］：content"
 *   2. Empty-content speech: "［speaker］：" + "content"  →  "［speaker］：content"
 *   3. Lone punctuation: previous + "。"  →  "previous。"
 *   4. Incomplete speech + continuation: "［speaker］：partial…" + "rest"
 *      when the speech doesn't end with a sentence terminator and the
 *      next entry is not a new speech line.
 *
 * After joining, speech lines become two lines:
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
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import path from "path";

const INPUT_DIR = "original-json";
const OUTPUT_FILE = "merged-original.txt";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

const MAX_CHUNK_LINES = 1200;
const CHUNKS_DIR = "original-merged-chunks";

// Matches ［speaker］：content where speaker can be empty (anonymous protagonist).
const SPEECH_RE = /^［(.*?)］：(.+)$/s;

// Matches ［speaker］： with nothing after the colon (speaker can be empty).
const SPEECH_EMPTY_RE = /^［.*?］：$/;

// Characters that mark the end of a complete sentence.
const SENTENCE_ENDERS = new Set(["。", "！", "？", "）", "」"]);

// Matches standalone punctuation.
const LONE_PUNCT_RE = /^[。、？！…～]+$/;

/**
 * Check whether a message looks like a new speech line or bracket.
 */
function isNewSpeechOrBracket(msg) {
  return msg.startsWith("［");
}

/**
 * Check whether a speech line's content ends with a sentence terminator.
 */
function hasCompleteEnding(msg) {
  if (msg.length === 0) return false;
  return SENTENCE_ENDERS.has(msg[msg.length - 1]);
}

/**
 * Pre-join fragmented entries into complete messages.
 */
function joinFragments(entries) {
  const messages = entries.map((e) => e.message.replace(/\r\n/g, ""));
  const joined = [];

  let i = 0;
  while (i < messages.length) {
    let msg = messages[i];

    // Pattern 1: Lone open bracket "［" followed by "］：..."
    if (msg === "［" && i + 1 < messages.length) {
      msg = "［" + messages[i + 1];
      i += 2;
      joined.push(msg);
      continue;
    }

    // Pattern 2: Speech with empty content "［speaker］：" followed by continuation.
    if (SPEECH_EMPTY_RE.test(msg) && i + 1 < messages.length) {
      msg = msg + messages[i + 1];
      i += 2;
      // After joining, the next entry might be lone punctuation — handle below.
    } else {
      i++;
    }

    // Pattern 3: Lone punctuation — append to the last joined message.
    if (LONE_PUNCT_RE.test(msg) && joined.length > 0) {
      joined[joined.length - 1] += msg;
      continue;
    }

    joined.push(msg);

    // Pattern 4: Incomplete speech + plain continuation.
    // If this is a speech line whose content doesn't end with a sentence
    // terminator, keep absorbing the next non-speech entries.
    const speechMatch = joined[joined.length - 1].match(SPEECH_RE);
    if (speechMatch) {
      while (!hasCompleteEnding(joined[joined.length - 1]) && i < messages.length) {
        const next = messages[i];
        // Stop if the next entry starts a new speech/bracket.
        if (isNewSpeechOrBracket(next)) break;
        // Absorb lone punctuation or plain continuation.
        joined[joined.length - 1] += next;
        i++;
      }
    }
  }

  return joined;
}

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

    // Step 3: Join fragmented entries into complete messages.
    const messages = joinFragments(entries);

    // Step 4: Convert each joined message to output lines.
    const lines = [];
    for (const msg of messages) {
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

    // Step 5: Build the section with a filename header.
    sections.push(`${fileName}\n${HEADER_SEPARATOR}\n${lines.join("\n")}`);
  }

  // Step 6: Prepend each section with a separator and write to disk.
  const output = sections.map((s) => `${SECTION_SEPARATOR}\n${s}`).join("\n");
  await writeFile(OUTPUT_FILE, output + "\n", "utf-8");

  console.log(`${files.length} files merged into ${OUTPUT_FILE}`);

  // Step N: Split sections into line-limited chunks.
  await rm(CHUNKS_DIR, { recursive: true, force: true });
  await mkdir(CHUNKS_DIR, { recursive: true });

  const chunks = [];
  let currentChunk = [];
  let currentLineCount = 0;

  for (const section of sections) {
    const sectionText = `${SECTION_SEPARATOR}\n${section}`;
    const sectionLineCount = sectionText.split("\n").length;

    // If adding this section exceeds the limit and we already have content,
    // flush the current chunk first.
    if (currentLineCount + sectionLineCount > MAX_CHUNK_LINES && currentChunk.length > 0) {
      chunks.push(currentChunk);
      currentChunk = [];
      currentLineCount = 0;
    }

    currentChunk.push(sectionText);
    currentLineCount += sectionLineCount;
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunkNum = String(i + 1).padStart(3, "0");
    const chunkPath = path.join(CHUNKS_DIR, `part-${chunkNum}.txt`);
    await writeFile(chunkPath, chunks[i].join("\n") + "\n", "utf-8");
  }

  console.log(`${chunks.length} chunks written to ${CHUNKS_DIR}/`);
}

main().catch(console.error);
