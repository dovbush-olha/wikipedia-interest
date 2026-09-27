import { join } from "node:path";
import * as fontkit from "fontkit";
import { SKILL_DIR } from "./env.ts";

// The one font of the report, and which characters it can draw: a character without a glyph renders as an empty box.

export const FONT_FILE = join(SKILL_DIR, "assets", "fonts", "NotoSans-Regular.ttf");

let font: fontkit.Font | undefined;

/** Each run of consecutive characters in `text` that the font has no glyph for, once, in order of appearance. */
export function unsupportedCharacters(text: string): string[] {
  font ??= fontkit.openSync(FONT_FILE) as fontkit.Font;
  const runs = new Set<string>();
  let run = "";
  for (const character of text) {
    // A plain space and a line break are laid out by pdfkit, not drawn from the font; any other space needs a glyph.
    const supported = character === " " || character === "\n" || font.hasGlyphForCodePoint(character.codePointAt(0)!);
    if (supported) {
      if (run !== "") runs.add(run);
      run = "";
    } else {
      run += character;
    }
  }
  if (run !== "") runs.add(run);
  return [...runs];
}
