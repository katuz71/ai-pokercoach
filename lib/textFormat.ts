export type TextChunk = {
  text: string;
  bold: boolean;
};

/**
 * Formats coach text by:
 * - Removing markdown headers (###, ##, #)
 * - Removing backticks (``` and `)
 * - Parsing **bold** syntax
 * - Removing remaining single asterisks
 */
export function formatCoachText(input: string): TextChunk[] {
  if (!input || input.trim() === '') {
    return [];
  }

  // Normalize line endings: CRLF -> LF
  let text = input.replace(/\r\n/g, '\n');

  // Remove markdown headers at the start of lines: ^\s{0,3}#{1,6}\s+
  text = text.replace(/^[ \t]{0,3}#{1,6}\s+/gm, '');

  // Remove triple backticks
  text = text.replace(/```/g, '');

  // Remove single backticks
  text = text.replace(/`/g, '');

  // Parse **bold** syntax
  const chunks: TextChunk[] = [];
  let currentIndex = 0;
  const boldPattern = /\*\*(.+?)\*\*/g;
  let match: RegExpExecArray | null;

  while ((match = boldPattern.exec(text)) !== null) {
    const beforeText = text.slice(currentIndex, match.index);
    
    // Add text before the bold part (if any)
    if (beforeText) {
      chunks.push({ text: beforeText, bold: false });
    }

    // Add bold text
    chunks.push({ text: match[1], bold: true });

    currentIndex = match.index + match[0].length;
  }

  // Add remaining text after the last bold match
  if (currentIndex < text.length) {
    chunks.push({ text: text.slice(currentIndex), bold: false });
  }

  // If no bold patterns found, add the entire text as one chunk
  if (chunks.length === 0) {
    chunks.push({ text, bold: false });
  }

  // Remove remaining single asterisks from all chunks
  const cleanedChunks = chunks.map((chunk) => ({
    ...chunk,
    text: chunk.text.replace(/\*/g, ''),
  }));

  // Filter out empty chunks
  return cleanedChunks.filter((chunk) => chunk.text !== '');
}
