import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { encode as encodeBase64 } from 'https://deno.land/std@0.168.0/encoding/base64.ts';
import { corsHeaders } from '../_shared/cors.ts';
import { requireUserClient, AuthError } from '../_shared/userAuth.ts';

const MAX_FILE_BYTES = 6 * 1024 * 1024; // 6MB
const ALLOWED_MIMES = ['image/jpeg', 'image/png'];
const OCR_TIMEOUT_MS = 25_000;
const MIN_TEXT_LEN = 30;
const MAX_TEXT_LEN = 8000;

const POKER_MARKERS_EN = [
  'flop', 'turn', 'river', 'preflop', 'button', 'sb', 'bb',
  'raises', 'calls', 'folds',
];
const POKER_MARKERS_RU = [
  'флоп', 'тёрн', 'терн', 'ривер', 'префлоп', 'рейз', 'колл', 'фолд', 'баттон', 'блайнд',
];

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function normalizeText(s: string): string {
  // Remove null and non-printable characters
  let out = s.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  // Collapse 3+ consecutive newlines to at most 2
  out = out.replace(/\n{3,}/g, '\n\n');
  // Strip leading markdown code fence
  out = out.replace(/^\s*```[\w]*\s*\n?/i, '').trim();
  return out.trim();
}

function looksLikePokerHandHistory(text: string): boolean {
  const lower = text.toLowerCase();
  for (const m of POKER_MARKERS_EN) {
    if (lower.includes(m)) return true;
  }
  for (const m of POKER_MARKERS_RU) {
    if (lower.includes(m)) return true;
  }
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }
  if (req.method !== 'POST') {
    return json({ error: 'Method not allowed' }, 405);
  }

  try {
    await requireUserClient(req);

    const contentType = req.headers.get('content-type') ?? '';
    if (!contentType.includes('multipart/form-data')) {
      return json({ error: 'Unsupported content type', detail: 'Use multipart/form-data' }, 400);
    }

    const formData = await req.formData();
    const file = formData.get('file');

    if (!file || !(file instanceof File)) {
      return json({ error: 'file is required', detail: 'Missing or invalid file field' }, 400);
    }

    const mime = file.type?.toLowerCase() ?? '';
    if (!ALLOWED_MIMES.includes(mime)) {
      return json({ error: 'Invalid file type', detail: 'Only image/jpeg and image/png are allowed' }, 400);
    }

    const bytes = await file.arrayBuffer();
    if (bytes.byteLength > MAX_FILE_BYTES) {
      return json({ error: 'File too large', detail: `Max size is ${MAX_FILE_BYTES / (1024 * 1024)}MB` }, 400);
    }

    const openAiKey = Deno.env.get('OPENAI_API_KEY');
    if (!openAiKey) {
      return json({ error: 'Missing OPENAI_API_KEY secret' }, 500);
    }

    const base64 = encodeBase64(bytes);
    const dataUrl = `data:${mime};base64,${base64}`;

    const visionModel = Deno.env.get('OPENAI_VISION_MODEL') ?? 'gpt-4o-mini';
    const prompt =
      'Extract poker hand history text from this screenshot. Output ONLY plain text, no markdown. ' +
      'Preserve structure of streets, actions, and stack sizes if visible.';

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), OCR_TIMEOUT_MS);

    const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${openAiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: visionModel,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'text', text: prompt },
              { type: 'image_url', image_url: { url: dataUrl } },
            ],
          },
        ],
        max_tokens: 2000,
      }),
    });

    clearTimeout(timeoutId);

    if (!openaiRes.ok) {
      const errText = await openaiRes.text();
      return json({ error: 'OpenAI request failed', detail: errText }, 502);
    }

    const payload = await openaiRes.json();
    let text = payload.choices?.[0]?.message?.content?.trim() ?? '';
    text = normalizeText(text);

    if (text.length < MIN_TEXT_LEN) {
      console.log('ocr_empty', { fileBytes: bytes.byteLength, textLen: text.length });
      return json(
        { error: 'ocr_empty', detail: 'OCR returned too little or empty text.' },
        422
      );
    }

    let truncated = false;
    if (text.length > MAX_TEXT_LEN) {
      text = text.slice(0, MAX_TEXT_LEN) + '\n\n[TRUNCATED]';
      truncated = true;
    }

    if (!looksLikePokerHandHistory(text)) {
      console.log('not_hand_history', { fileBytes: bytes.byteLength, textLen: text.length, truncated });
      return json(
        { error: 'not_hand_history', detail: "Screenshot doesn't look like poker hand history." },
        422
      );
    }

    console.log('ocr_ok', { fileBytes: bytes.byteLength, textLen: text.length, truncated });
    return json({ text, meta: { truncated } });
  } catch (err) {
    if (err instanceof AuthError) {
      return json(err.body, err.status);
    }
    if (err instanceof Error && err.name === 'AbortError') {
      return json({ error: 'OCR timeout', detail: 'Request took too long' }, 504);
    }
    const msg = err instanceof Error ? err.message : String(err);
    return json({ error: 'internal', detail: msg }, 500);
  }
});
