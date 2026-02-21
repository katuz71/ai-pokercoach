import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const PARSE_TIMEOUT_MS = 15_000;
const MAX_TEXT_LEN = 12_000;

type HeroPos = 'BTN' | 'SB' | 'BB' | 'CO' | 'HJ' | 'UTG' | 'MP' | 'UNKNOWN';
type Game = 'NLH' | 'PLO' | 'UNKNOWN';

type ParsedBoard = {
  flop: string;
  turn: string | null;
  river: string | null;
};

type ParsedHand = {
  game: Game;
  stakes: string | null;
  hero_pos: HeroPos;
  effective_stack_bb: number | null;
  preflop: string;
  flop: string | null;
  turn: string | null;
  river: string | null;
  board: ParsedBoard | null;
};

const META_MSG_MAX = 120;
type Confidence = 'LOW' | 'MEDIUM' | 'HIGH';
type ParseMeta = { confidence: Confidence; source_message: string };

function truncateMetaMsg(s: string): string {
  if (s.length <= META_MSG_MAX) return s;
  return s.slice(0, META_MSG_MAX - 3) + '...';
}

function stringifyRawBoard(raw: unknown): string {
  if (raw == null) return '';
  if (typeof raw === 'string') return raw.trim();
  if (typeof raw === 'object' && raw !== null) {
    const o = raw as Record<string, unknown>;
    return (
      (o.flop != null ? String(o.flop) : '') +
      (o.turn != null ? String(o.turn) : '') +
      (o.river != null ? String(o.river) : '')
    );
  }
  return '';
}

function buildMetaFromHand(
  hand: ParsedHand,
  rawHeroPos?: string,
  rawGame?: string,
  rawStakes?: string | null,
  rawBoard?: unknown,
): ParseMeta {
  const reasons: string[] = [];
  if (hand.hero_pos === 'UNKNOWN') reasons.push('missing hero position');
  if (hand.game === 'UNKNOWN') reasons.push('game type unclear');
  if (hand.effective_stack_bb == null) reasons.push('no effective stack');
  if (!hand.board?.flop && !hand.flop) reasons.push('no clear board');
  if (!hand.preflop || hand.preflop.length < 3) reasons.push('minimal preflop');
  const hasStakes = hand.stakes != null && String(hand.stakes).trim().length > 0;
  if (!hasStakes) reasons.push('stakes missing');

  let source_message = reasons.length > 0
    ? reasons.join('; ')
    : 'all key fields present';
  const normNote =
    rawHeroPos != null &&
    rawHeroPos.trim() !== '' &&
    !isValidHeroPos(rawHeroPos.trim())
      ? `; hero_pos normalized from '${rawHeroPos.trim().slice(0, 25)}' to '${hand.hero_pos}'`
      : '';
  const gameNormNote =
    rawGame != null &&
    String(rawGame).trim() !== '' &&
    !['NLH', 'PLO', 'UNKNOWN'].includes(String(rawGame).trim().toUpperCase())
      ? `; game normalized from '${String(rawGame).trim().slice(0, 25)}' to '${hand.game}'`
      : '';
  const stakesNormNote =
    rawStakes != null &&
    String(rawStakes).trim() !== '' &&
    normalizeStakes(rawStakes) !== rawStakes
      ? '; stakes normalized'
      : '';
  const boardNote =
    rawBoard != null && hand.board === null
      ? '; board dropped (invalid)'
      : rawBoard != null &&
          hand.board != null &&
          stringifyRawBoard(rawBoard) !== stringifyBoard(hand.board)
        ? '; board normalized'
        : '';
  source_message = truncateMetaMsg(
    source_message + normNote + gameNormNote + stakesNormNote + boardNote,
  );

  let confidence: Confidence = 'HIGH';
  if (reasons.length >= 3 || hand.hero_pos === 'UNKNOWN' || !hand.preflop?.trim()) {
    confidence = 'LOW';
  } else if (reasons.length >= 1) {
    confidence = 'MEDIUM';
  }
  return { confidence, source_message };
}

function defaultErrorMeta(reason: string): ParseMeta {
  return { confidence: 'LOW', source_message: truncateMetaMsg(reason) };
}

type ParseResult =
  | {
      ok: true;
      hand: ParsedHand;
      rawHeroPos?: string;
      rawGame?: string;
      rawStakes?: string | null;
      rawBoard?: unknown;
    }
  | { ok: false; error: string; source_message?: string };

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function isValidHeroPos(s: string): s is HeroPos {
  return ['BTN', 'SB', 'BB', 'CO', 'HJ', 'UTG', 'MP', 'UNKNOWN'].includes(s);
}

/** Strict normalization to whitelist; multi-position or unrecognized → UNKNOWN */
function normalizeHeroPos(input: string | null | undefined): HeroPos {
  if (input == null) return 'UNKNOWN';
  const s = String(input).trim().toUpperCase();
  if (s === '' || /[\/,]/.test(s)) return 'UNKNOWN';
  const n = s.replace(/\s+/g, '');
  if (n === 'BU' || n === 'BUTTON' || n === 'BTN') return 'BTN';
  if (n === 'SB' || n === 'SMALLBLIND') return 'SB';
  if (n === 'BB' || n === 'BIGBLIND') return 'BB';
  if (n === 'CO' || n === 'CUTOFF') return 'CO';
  if (n === 'HJ' || n === 'HIJACK') return 'HJ';
  if (n === 'UTG+1' || n === 'UTG+2' || n === 'MP1' || n === 'MP2' || n === 'MP3' || n === 'MP' ||
      n === 'MIDDLEPOSITION') return 'MP';
  if (n === 'UTG' || n === 'UNDERTHEGUN') return 'UTG';
  return 'UNKNOWN';
}

function isValidGame(s: string): s is Game {
  return ['NLH', 'PLO', 'UNKNOWN'].includes(s);
}

const STAKES_MAX_LEN = 32;

/** Canonical game: NLH | PLO | UNKNOWN. Handles "Holdem", "NLHE", "PLO5", "Omaha", etc. */
function normalizeGame(input: string | null | undefined): Game {
  if (input == null) return 'UNKNOWN';
  const s = String(input).trim().toUpperCase();
  if (s === '') return 'UNKNOWN';
  const hasPLO = s.includes('PLO') || s.includes('OMAHA');
  const hasHOLD = s.includes('HOLD') || s.includes('NLH') || s.includes('NLHE') || s.includes('TEXAS');
  if (hasPLO && hasHOLD) return 'UNKNOWN';
  if (hasPLO) return 'PLO';
  if (hasHOLD) return 'NLH';
  return 'UNKNOWN';
}

/** Trim, collapse spaces around / and $, cap length. Empty → null. */
function normalizeStakes(input: string | null | undefined): string | null {
  if (input == null) return null;
  let s = String(input).trim();
  if (s === '') return null;
  s = s.replace(/\s*\/\s*/g, '/').replace(/\$\s+/g, '$').replace(/\s+\$/g, '$');
  if (s.length > STAKES_MAX_LEN) s = s.slice(0, STAKES_MAX_LEN);
  return s;
}

const RANKS = 'AKQJT98765432';
const SUITS = 'shdc';

/** Single card token → canonical "RankSuit" (e.g. "As", "Td") or null. */
function normalizeCardToken(token: string): string | null {
  if (!token || typeof token !== 'string') return null;
  let s = token.trim().replace(/\s+/g, '');
  s = s.replace(/♠/g, 's').replace(/♥/g, 'h').replace(/♦/g, 'd').replace(/♣/g, 'c');
  s = s.replace(/10/gi, 'T');
  s = s.replace(/[^AKQJT2-9shdc]/gi, '');
  if (s.length < 2) return null;
  const r = s[0].toUpperCase(), suit = s[1].toLowerCase();
  if (!RANKS.includes(r) || !SUITS.includes(suit)) return null;
  return r + suit;
}

/** Parse a string into canonical card array (handles "As 7d 2c", "A♠7♦2♣", "AS7D2C"). */
function parseCardsFromString(s: string): string[] {
  if (!s || typeof s !== 'string') return [];
  let t = s.trim().replace(/\s+/g, '');
  t = t.replace(/♠/g, 's').replace(/♥/g, 'h').replace(/♦/g, 'd').replace(/♣/g, 'c');
  t = t.replace(/10/gi, 'T');
  const cards: string[] = [];
  const re = /([AKQJT2-9])([shdc])/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(t)) !== null) {
    cards.push(m[1].toUpperCase() + m[2].toLowerCase());
  }
  return cards;
}

/** Board input → canonical { flop, turn?, river? } or null. Invalid or river without turn → null. */
function normalizeBoard(
  input: string | { flop?: unknown; turn?: unknown; river?: unknown } | null | undefined,
): ParsedBoard | null {
  if (input == null) return null;

  if (typeof input === 'string') {
    const cards = parseCardsFromString(input);
    if (cards.length === 3) {
      return { flop: cards[0] + cards[1] + cards[2], turn: null, river: null };
    }
    if (cards.length === 4) {
      return { flop: cards[0] + cards[1] + cards[2], turn: cards[3], river: null };
    }
    if (cards.length === 5) {
      return { flop: cards[0] + cards[1] + cards[2], turn: cards[3], river: cards[4] };
    }
    return null;
  }

  if (typeof input !== 'object') return null;
  const b = input as Record<string, unknown>;
  const flopStr = b.flop != null ? String(b.flop) : '';
  const turnStr = b.turn != null ? String(b.turn) : '';
  const riverStr = b.river != null ? String(b.river) : '';

  const flopCards = parseCardsFromString(flopStr);
  if (flopCards.length !== 3) return null;

  const turnCards = parseCardsFromString(turnStr);
  const riverCards = parseCardsFromString(riverStr);
  if (riverCards.length > 0 && turnCards.length === 0) return null;

  return {
    flop: flopCards[0] + flopCards[1] + flopCards[2],
    turn: turnCards.length >= 1 ? turnCards[0] : null,
    river: riverCards.length >= 1 ? riverCards[0] : null,
  };
}

function stringifyBoard(b: ParsedBoard | null): string {
  if (!b) return '';
  return b.flop + (b.turn ?? '') + (b.river ?? '');
}

function parseAndValidate(raw: unknown): ParseResult {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'unparseable' };
  const o = raw as Record<string, unknown>;
  if (o.ok === false && typeof o.error === 'string') {
    const meta = o.meta && typeof o.meta === 'object' ? (o.meta as Record<string, unknown>) : null;
    const source_message = typeof meta?.source_message === 'string' ? meta.source_message : undefined;
    return { ok: false, error: o.error, source_message };
  }
  if (o.ok !== true || !o.hand || typeof o.hand !== 'object') return { ok: false, error: 'unparseable' };

  const h = o.hand as Record<string, unknown>;
  const rawGame = typeof h.game === 'string' ? h.game : undefined;
  const rawStakes = h.stakes != null ? String(h.stakes) : null;
  const game = normalizeGame(rawGame);
  const stakes = normalizeStakes(rawStakes);
  const rawHeroPos = typeof h.hero_pos === 'string' ? h.hero_pos : undefined;
  const hero_pos = normalizeHeroPos(rawHeroPos);
  const effective_stack_bb =
    typeof h.effective_stack_bb === 'number' && Number.isFinite(h.effective_stack_bb)
      ? h.effective_stack_bb
      : null;
  const preflop = typeof h.preflop === 'string' ? h.preflop.trim() : '';
  if (!preflop) return { ok: false, error: 'unparseable' };

  const flop = h.flop != null ? String(h.flop) : null;
  const turn = h.turn != null ? String(h.turn) : null;
  const river = h.river != null ? String(h.river) : null;

  const rawBoard = h.board;
  const board = normalizeBoard(
    rawBoard != null && typeof rawBoard === 'object'
      ? (rawBoard as Record<string, unknown>)
      : typeof rawBoard === 'string'
        ? rawBoard
        : null,
  );

  return {
    ok: true,
    hand: {
      game,
      stakes,
      hero_pos,
      effective_stack_bb,
      preflop,
      flop,
      turn,
      river,
      board,
    },
    rawHeroPos,
    rawGame,
    rawStakes,
    rawBoard: rawBoard ?? undefined,
  };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed', detail: 'Use POST' }, 405);
  }

  try {
    await requireUserClient(req);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('application/json')) {
      return json({ error: 'Content-Type must be application/json', detail: 'Send JSON body' }, 400);
    }

    const body = await req.json().catch(() => null);
    if (!body || typeof body.text !== 'string') {
      return json({ error: 'Body must be JSON with "text" string', detail: 'Missing or invalid text field' }, 400);
    }

    let text = body.text.trim();
    if (!text) {
      return json({ ok: false, error: 'unparseable', meta: defaultErrorMeta('empty input') });
    }
    if (text.length > MAX_TEXT_LEN) {
      text = text.slice(0, MAX_TEXT_LEN);
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret', detail: 'Server configuration error' }, 500);
    }

    const systemPrompt = `You are a poker hand history parser. Given raw text of a hand history, output a single JSON object and nothing else.

Rules:
- Output ONLY valid JSON, no markdown, no code fence, no explanation.
- If you are not confident that the text is a poker hand history, or you cannot reliably extract fields, respond with: {"ok":false,"error":"unparseable"}
- Do NOT invent any cards, actions, or numbers. Only use information explicitly present in the text. If something is missing, use null or empty string or UNKNOWN as specified below.
- Game: one of "NLH", "PLO", "UNKNOWN".
- hero_pos: one of "BTN", "SB", "BB", "CO", "HJ", "UTG", "MP", "UNKNOWN".
- effective_stack_bb: number (hero's effective stack in big blinds) or null.
- stakes: string (e.g. "0.5/1") or null.
- preflop: string description of preflop action (from the text). Required; use "" if none.
- flop, turn, river: string description of action on that street, or null.
- board: object with "flop", "turn", "river" (e.g. "As7d2c", "3h", "4c") or null if not visible.

Success format:
{"ok":true,"hand":{"game":"NLH","stakes":null,"hero_pos":"CO","effective_stack_bb":100,"preflop":"UTG open 2.5bb, Hero call","flop":"...","turn":null,"river":null,"board":{"flop":"As7d2c","turn":"3h","river":"4c"}}}

Failure format (when unsure or not hand history). Include meta with a short reason about recognition quality only (e.g. "no preflop action", "not hand history", "missing hero position"), no invented details:
{"ok":false,"error":"unparseable","meta":{"confidence":"LOW","source_message":"short reason <=120 chars"}}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), PARSE_TIMEOUT_MS);

    const completion = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: Deno.env.get('OPENAI_CHAT_MODEL') ?? 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: text },
        ],
        max_tokens: 800,
        temperature: 0.1,
      }),
    });

    clearTimeout(timeoutId);

    if (!completion.ok) {
      const errText = await completion.text();
      console.error('OpenAI parse-hand error', completion.status, errText);
      return json({ ok: false, error: 'unparseable', meta: defaultErrorMeta('model request failed') });
    }

    const payload = await completion.json();
    let content = payload.choices?.[0]?.message?.content?.trim() ?? '';
    content = content.replace(/^\s*```[\w]*\s*\n?/i, '').replace(/\n?\s*```\s*$/i, '').trim();

    let parsed: unknown;
    try {
      parsed = JSON.parse(content);
    } catch {
      console.error('Parse hand: invalid JSON from model', content.slice(0, 200));
      return json({ ok: false, error: 'unparseable', meta: defaultErrorMeta('invalid JSON from model') });
    }

    const result = parseAndValidate(parsed);
    if (result.ok) {
      return json({
        ok: true,
        hand: result.hand,
        meta: buildMetaFromHand(
          result.hand,
          result.rawHeroPos,
          result.rawGame,
          result.rawStakes,
          result.rawBoard,
        ),
      });
    }
    const msg = result.source_message || 'could not parse hand history';
    return json({ ok: false, error: result.error, meta: defaultErrorMeta(msg) });
  } catch (err) {
    if (err instanceof AuthError) {
      return json(err.body, err.status);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return json({ error: 'timeout', detail: 'Parse request took too long' }, 504);
    }
    const msg = err instanceof Error ? err.message : String(err);
    console.error('ai-parse-hand-text', msg);
    return json({ error: 'internal', detail: msg }, 500);
  }
});
