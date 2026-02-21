/**
 * Allowed leak tags whitelist
 * All tags must be in lower_snake_case format
 */
export const ALLOWED_LEAK_TAGS = new Set([
  'chasing_draws',
  'missed_value_bet',
  'overbet_bluff',
  'passive_play',
  'bad_pot_odds_call',
  'river_betting_strategy',
  'turn_raise_undervalue',
  'preflop_3bet_defense',
  'cbet_frequency',
  'position_awareness',
  'bluff_catching',
  'sizing_mistakes',
  'fundamentals',
]);

/**
 * Normalize leak tag to canonical format (lower_snake_case)
 * 
 * Examples:
 * - "Position Awareness" -> "position_awareness"
 * - "Tilt-Control" -> "tilt_control"
 * - "  over-betting  " -> "over_betting"
 * - "Multi__Word___Tag" -> "multi_word_tag"
 */
export function normalizeLeakTag(tag: string): string {
  if (!tag) return '';
  return tag
    .trim()
    .toLowerCase()
    .replace(/[\s\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Normalize leak tag and return null if empty
 * 
 * @param tag - The tag to normalize (can be null or undefined)
 * @returns Normalized tag or null if empty
 */
export function normalizeOrNull(tag: string | null | undefined): string | null {
  const normalized = normalizeLeakTag(tag ?? '');
  return normalized ? normalized : null;
}

/**
 * Enforce allowed leak tag whitelist
 * 
 * Normalizes the tag and checks if it's in the allowed list.
 * If not allowed or empty, returns 'fundamentals' as fallback.
 * 
 * Examples:
 * - "Position Awareness" -> "position_awareness" (allowed)
 * - "Crazy River Bluffing" -> "fundamentals" (not allowed)
 * - "" -> null
 * - null -> null
 * 
 * @param tag - The tag to validate and normalize
 * @returns Allowed normalized tag, 'fundamentals', or null
 */
export function enforceAllowedLeakTag(tag: string | null | undefined): string | null {
  const normalized = normalizeOrNull(tag);
  if (!normalized) return null;
  if (ALLOWED_LEAK_TAGS.has(normalized)) return normalized;
  return 'fundamentals';
}
