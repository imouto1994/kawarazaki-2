/**
 * Export Translation Map
 *
 * Reads `merged-original.txt` and `merged-translated.txt`, parses them into
 * matching sections, and builds a JSON mapping of every unique original line
 * to its translated counterpart.
 *
 * Speech source lines (＃ in original, # in translated) and their following
 * content lines are merged into a single entry:
 *
 *   Original:  ＃優馬            →  key:   "〈優馬〉：もう手遅れだ"
 *              （もう手遅れだ）     value: "Yuma: \u201CIt's too late\u201D"
 *
 *   Original:  ＃杏奈            →  key:   "〈杏奈〉：早くっ！！"
 *              「早くっ！！」       value: "Anna: \u201CHurry!!\u201D"
 *
 * Narration lines are mapped directly:
 *
 *   key:   "再びこの地に立っている。"
 *   value: "Standing on this land again."
 *
 * Empty lines are skipped. First occurrence wins for duplicates.
 *
 * Output: `translation-map.json`
 *
 * Usage:
 *   node export-translation-map.mjs
 */

import { readFile, writeFile } from "fs/promises";

const ORIGINAL_FILE = "merged-original.txt";
const TRANSLATED_FILE = "merged-translated.txt";
const OUTPUT_FILE = "translation-map.json";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

const SPEAKER_MAP = new Map([
  ["優馬", "Yuma"],
  ["杏奈", "Anna"],
  ["真樹", "Maki"],
  ["智樹", "Tomoki"],
  ["縄綱", "Nawatsuna"],
  ["稲垣", "Inagaki"],
  ["鈴音", "Suzune"],
  ["美香", "Mika"],
  ["奈津子", "Natsuko"],
  ["鬼作", "Kisaku"],
  ["健吾", "Kengo"],
  ["老婆", "Old Woman"],
  ["農夫", "Farmer"],
  ["医者", "Doctor"],
  ["看護婦", "Nurse"],
  ["男の声", "Man's Voice"],
  ["女の子Ａ", "Girl A"],
  ["男の子Ａ", "Boy A"],
  ["男の子Ｂ", "Boy B"],
  ["＊＊＊", "***"],
]);

/**
 * Parse a merged text file into a Map of { fileName → lines[] },
 * preserving empty lines so indices stay aligned between original and
 * translated.
 */
function parseSections(text) {
  // Step 1: Split file into raw blocks by the section separator line.
  const raw = text.split(`${SECTION_SEPARATOR}\n`);
  const sections = new Map();

  for (const block of raw) {
    // Step 2: Locate the header separator to split filename from body.
    const headerEnd = block.indexOf(`\n${HEADER_SEPARATOR}\n`);
    if (headerEnd === -1) continue;

    const fileName = block.slice(0, headerEnd).trim();
    const body = block.slice(headerEnd + HEADER_SEPARATOR.length + 2);

    // Step 3: Keep all lines (including empty) to preserve index alignment.
    sections.set(fileName, body.split("\n"));
  }

  return sections;
}

/**
 * Strip the 「」 or （） brackets from a Japanese speech content line.
 */
function stripBracketsJP(line) {
  if (
    (line.startsWith("「") && line.endsWith("」")) ||
    (line.startsWith("（") && line.endsWith("）"))
  ) {
    return line.slice(1, -1);
  }
  return line;
}

/**
 * Strip the \u201C\u201D quotes from an English speech content line.
 */
function stripBracketsEN(line) {
  if (line.startsWith("\u201C") && line.endsWith("\u201D")) {
    return line.slice(1, -1);
  }
  return line;
}

async function main() {
  // Step 1: Read both merged files.
  const originalText = await readFile(ORIGINAL_FILE, "utf-8");
  const translatedText = await readFile(TRANSLATED_FILE, "utf-8");

  // Step 2: Parse into section maps keyed by filename.
  const origSections = parseSections(originalText);
  const transSections = parseSections(translatedText);

  const map = new Map();
  let totalPairs = 0;
  let duplicates = 0;
  const unknownSpeakers = new Set();

  // Step 3: Walk through each section, pairing original and translated lines.
  for (const [fileName, origLines] of origSections) {
    // Skip sections without a translated counterpart.
    if (!transSections.has(fileName)) continue;
    const transLines = transSections.get(fileName);

    let i = 0;
    while (i < origLines.length && i < transLines.length) {
      const origLine = origLines[i];
      const transLine = transLines[i];

      // Step 3a: Skip empty lines.
      if (origLine.length === 0) {
        i++;
        continue;
      }

      // Step 3b: Handle speech lines (＃ source + content on next line).
      if (origLine.startsWith("＃")) {
        const speakerJP = origLine.slice(1);
        const speakerEN = SPEAKER_MAP.get(speakerJP);

        if (!speakerEN) {
          unknownSpeakers.add(speakerJP);
        }

        // Merge speaker + content into a single map entry.
        if (i + 1 < origLines.length && i + 1 < transLines.length) {
          const contentOrig = origLines[i + 1];
          const contentTrans = transLines[i + 1];

          // Key uses 〈name〉：content format, stripping brackets from original.
          const key = `〈${speakerJP}〉：${stripBracketsJP(contentOrig)}`;
          // Value uses EN name: \u201Ccontent\u201D, stripping translated quotes.
          const value = `${speakerEN || speakerJP}: \u201C${stripBracketsEN(contentTrans)}\u201D`;

          if (!map.has(key)) {
            map.set(key, value);
            totalPairs++;
          } else {
            duplicates++;
          }

          i += 2;
        } else {
          i++;
        }
        continue;
      }

      // Step 3c: Handle narration lines — map original directly to translated.
      if (!map.has(origLine)) {
        map.set(origLine, transLine);
        totalPairs++;
      } else {
        duplicates++;
      }

      i++;
    }
  }

  // Step 4: Write the translation map to disk as JSON.
  const obj = Object.fromEntries(map);
  await writeFile(OUTPUT_FILE, JSON.stringify(obj, null, 2), "utf-8");

  // Step 5: Print summary.
  console.log("— Summary —");
  console.log(`  Sections processed: ${origSections.size}`);
  console.log(`  Unique entries:     ${totalPairs}`);
  console.log(`  Duplicates skipped: ${duplicates}`);
  console.log(`  Exported to:        ${OUTPUT_FILE}`);

  if (unknownSpeakers.size > 0) {
    console.log(
      `\n  Unknown speakers: ${[...unknownSpeakers].join(", ")}`,
    );
  }
}

main().catch(console.error);
