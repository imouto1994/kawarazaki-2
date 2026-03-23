/**
 * Validate Translations (chunk-based)
 *
 * Compares translated chunks in `translated-merged-chunks/` against original
 * chunks in `original-merged-chunks/` to ensure structural consistency.
 *
 * Checks performed per section:
 *   1. Every original section has a matching translated section (by filename).
 *   2. Non-empty line counts match.
 *   3. Line types match (source / speech / normal).
 *   4. Speech source names match via SPEAKER_MAP (JP → EN).
 *
 * Errors are collected and printed in reverse order so the first mismatch
 * appears at the bottom of the terminal (most visible).
 *
 * Usage:
 *   node validate-translations.mjs
 */

import { readFile } from "fs/promises";
import { glob } from "glob";

const ORIGINAL_CHUNKS_DIR = "original-merged-chunks";
const TRANSLATED_CHUNKS_DIR = "translated-merged-chunks";

const SECTION_SEPARATOR = "--------------------";
const HEADER_SEPARATOR = "********************";

/**
 * Classify a line into a structural type with bracket-specific subtypes:
 *   "source"         — speaker name (＃ in original, $ in translated)
 *   "speech-quote"   — quoted speech (「」 / \u201C\u201D / "")
 *   "speech-paren"   — thought/parenthetical (（） / ())
 *   "speech-bracket" — emphasis (【】 / [])
 *   "normal"         — narration / everything else
 */
function lineType(line, isTranslated) {
  if (isTranslated ? line.startsWith("$") : line.startsWith("＃"))
    return "source";

  if (isTranslated) {
    if (line.startsWith("\u201C") && line.endsWith("\u201D")) return "speech-quote";
    if (line.startsWith('"') && line.endsWith('"')) return "speech-quote";
    if (line.startsWith("(") && line.endsWith(")")) return "speech-paren";
    if (line.startsWith("[") && line.endsWith("]")) return "speech-bracket";
  } else {
    if (line.startsWith("「") && line.endsWith("」")) return "speech-quote";
    if (line.startsWith("（") && line.endsWith("）")) return "speech-paren";
    if (line.startsWith("【") && line.endsWith("】")) return "speech-bracket";
  }

  return "normal";
}

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
 * Parse all chunk files in a directory into a Map of
 * { fileName → { lines, chunkPath, startLine } }.
 */
async function parseSectionsFromChunks(dir) {
  const chunkFiles = (await glob(`${dir}/part-*.txt`)).sort();
  const sections = new Map();

  for (const chunkPath of chunkFiles) {
    const text = await readFile(chunkPath, "utf-8");
    const allLines = text.split("\n");

    let i = 0;
    while (i < allLines.length) {
      // Scan for the next section separator.
      if (allLines[i] !== SECTION_SEPARATOR) { i++; continue; }

      const sectionStartLine = i + 1; // 1-indexed
      i++; // skip separator
      if (i >= allLines.length) break;

      const fileName = allLines[i].trim();
      i++; // skip filename
      if (i >= allLines.length || allLines[i] !== HEADER_SEPARATOR) continue;
      i++; // skip header separator

      // Collect non-empty content lines and their 1-indexed chunk line numbers.
      const contentLines = [];
      const contentLineNos = [];
      while (i < allLines.length && allLines[i] !== SECTION_SEPARATOR) {
        if (allLines[i].length > 0) {
          contentLines.push(allLines[i]);
          contentLineNos.push(i + 1);
        }
        i++;
      }

      sections.set(fileName, {
        lines: contentLines,
        lineNos: contentLineNos,
        chunkPath,
        startLine: sectionStartLine,
      });
    }
  }

  return sections;
}

async function main() {
  // Step 1: Parse sections from both chunk directories.
  const origSections = await parseSectionsFromChunks(ORIGINAL_CHUNKS_DIR);
  const transSections = await parseSectionsFromChunks(TRANSLATED_CHUNKS_DIR);

  let checked = 0;
  let mismatched = 0;
  const errors = [];

  // Step 2: Validate each original section against its translated counterpart.
  for (const [fileName, origEntry] of origSections) {
    const { lines: origLines, lineNos: origLineNos, chunkPath: origChunk, startLine: origStart } = origEntry;

    // Step 2a: Check that the translated chunks have a matching section.
    if (!transSections.has(fileName)) {
      mismatched++;
      errors.push({
        header: `✗  ${origChunk}:${origStart} > ${fileName}`,
        details: ["   Missing from translated chunks"],
      });
      continue;
    }

    checked++;
    const transEntry = transSections.get(fileName);
    const { lines: transLines, lineNos: transLineNos, chunkPath: transChunk, startLine: transStart } = transEntry;
    const sectionErrors = [];
    let firstErrorLineIdx = -1;

    if (origLines.length !== transLines.length) {
      // Step 2b: Non-empty line counts must match.
      sectionErrors.push(
        `Line count mismatch: original has ${origLines.length} lines, translated has ${transLines.length} lines`,
      );

      const minLen = Math.min(origLines.length, transLines.length);
      for (let i = 0; i < minLen; i++) {
        const origType = lineType(origLines[i], false);
        const transType = lineType(transLines[i], true);
        if (origType !== transType) {
          if (firstErrorLineIdx === -1) firstErrorLineIdx = i;
          sectionErrors.push(
            `First type mismatch at line ${i + 1} (${origType} vs. ${transType}):\n     original:   ${origLines[i]}\n     translated: ${transLines[i]}`,
          );
          break;
        }
      }
    } else {
      // Step 2c: Line-by-line structural comparison.
      for (let i = 0; i < origLines.length; i++) {
        const origLine = origLines[i];
        const transLine = transLines[i];
        const origType = lineType(origLine, false);
        const transType = lineType(transLine, true);

        if (origType !== transType) {
          if (firstErrorLineIdx === -1) firstErrorLineIdx = i;
          sectionErrors.push(
            `Line ${i + 1}: type mismatch (${origType} vs. ${transType})\n     original:   ${origLine}\n     translated: ${transLine}`,
          );
          break;
        } else if (origType === "source") {
          const origName = origLine.slice(1);
          const transName = transLine.slice(1);
          const expectedEN = SPEAKER_MAP.get(origName);

          if (!expectedEN) {
            if (firstErrorLineIdx === -1) firstErrorLineIdx = i;
            sectionErrors.push(
              `Line ${i + 1}: unknown speaker "${origName}" — add to SPEAKER_MAP`,
            );
          } else if (transName !== expectedEN) {
            if (firstErrorLineIdx === -1) firstErrorLineIdx = i;
            sectionErrors.push(
              `Line ${i + 1}: speaker name mismatch\n     expected: $${expectedEN}\n     got:      ${transLine}`,
            );
          }
        }
      }
    }

    if (sectionErrors.length > 0) {
      mismatched++;
      const origErrLine = firstErrorLineIdx >= 0 && origLineNos[firstErrorLineIdx]
        ? origLineNos[firstErrorLineIdx] : origStart;
      const transErrLine = firstErrorLineIdx >= 0 && transLineNos[firstErrorLineIdx]
        ? transLineNos[firstErrorLineIdx] : transStart;
      errors.push({
        header: `✗  ${origChunk}:${origErrLine} | ${transChunk}:${transErrLine} > ${fileName}`,
        details: sectionErrors.map((e) => `   ${e}`),
      });
    }
  }

  // Step 3: Warn about extra sections in translated that have no original.
  const extraInTranslated = [...transSections.keys()].filter(
    (f) => !origSections.has(f),
  );
  if (extraInTranslated.length > 0) {
    const details = extraInTranslated.map((f) => {
      const entry = transSections.get(f);
      return `   ${entry.chunkPath}:${entry.startLine} > ${f}`;
    });
    errors.push({
      header: "⚠  Extra sections in translated chunks not in original:",
      details,
    });
  }

  // Step 4: Print errors in reverse order (first mismatch at bottom).
  if (errors.length > 0) {
    console.log("\n--- Errors (first mismatch at bottom) ---");
    for (let i = errors.length - 1; i >= 0; i--) {
      console.log(`\n${errors[i].header}`);
      for (const d of errors[i].details) {
        console.log(d);
      }
    }
  }

  // Step 5: Print summary.
  console.log("\n— Summary —");
  console.log(`  Sections checked: ${checked}`);
  console.log(`  Mismatched:       ${mismatched}`);

  if (mismatched > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
