import { supabase } from './supabase';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * Call Supabase Edge Function with custom x-user-jwt header to bypass legacy JWT verification.
 * 
 * @param fnName - Name of the Edge Function (e.g., 'ai-analyze-hand')
 * @param body - Request body (will be JSON stringified)
 * @returns Parsed JSON response or null if empty
 * @throws Error if session is missing or request fails
 */
export async function callEdge(fnName: string, body: any): Promise<any> {
  // Get user session
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();
  
  if (sessionError || !session?.access_token) {
    throw new Error('No active session');
  }

  // Make fetch request with custom headers
  const url = `${SUPABASE_URL}/functions/v1/${fnName}`;
  
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-jwt': session.access_token,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Edge ${fnName} ${res.status}: ${text}`);
  }

  const contentType = res.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return await res.json();
  }

  return null;
}

export type OcrSuccess = { text: string; meta?: { truncated?: boolean } };

/**
 * Call Edge Function ai-ocr-hand with multipart/form-data (image file).
 * Client should validate size/type before building FormData; server enforces again.
 *
 * @param formData - FormData with 'file' (image) and 'mode' = 'hand_history'
 * @returns Parsed JSON { text, meta?: { truncated } }
 * @throws Error with optional .code = 'not_hand_history' | 'ocr_empty' for 422 responses
 */
export async function callEdgeOcr(formData: FormData): Promise<OcrSuccess> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('No active session');
  }

  if (!formData.get('file')) {
    throw new Error('Missing file in FormData');
  }

  const url = `${SUPABASE_URL}/functions/v1/ai-ocr-hand`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-jwt': session.access_token,
    },
    body: formData,
  });

  const contentType = res.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const bodyText = await res.text();

  if (!res.ok) {
    if (isJson) {
      try {
        const data = JSON.parse(bodyText) as { error?: string; detail?: string };
        const err = new Error(data.detail ?? data.error ?? bodyText) as Error & { code?: string };
        err.code = data.error;
        throw err;
      } catch (e) {
        if (e instanceof Error && 'code' in e) throw e;
        throw new Error(`Edge ai-ocr-hand ${res.status}: ${bodyText}`);
      }
    }
    throw new Error(`Edge ai-ocr-hand ${res.status}: ${bodyText}`);
  }

  if (isJson) {
    return JSON.parse(bodyText) as OcrSuccess;
  }

  throw new Error('OCR response was not JSON');
}

export type ParseHandMeta = {
  confidence: 'LOW' | 'MEDIUM' | 'HIGH';
  source_message: string;
};

export type ParseHandSuccess = {
  ok: true;
  hand: {
    game: string;
    stakes: string | null;
    hero_pos: string;
    effective_stack_bb: number | null;
    preflop: string;
    flop: string | null;
    turn: string | null;
    river: string | null;
    board: { flop: string; turn: string; river: string } | null;
  };
  meta: ParseHandMeta;
};
export type ParseHandFailure = { ok: false; error: string; meta: ParseHandMeta };

/**
 * Call Edge Function ai-parse-hand-text to extract quick-form fields from hand history text.
 *
 * @param text - Raw hand history text
 * @returns { ok: true, hand } or { ok: false, error }
 */
export async function callParseHandText(
  text: string
): Promise<ParseHandSuccess | ParseHandFailure> {
  const { data: { session }, error: sessionError } = await supabase.auth.getSession();

  if (sessionError || !session?.access_token) {
    throw new Error('No active session');
  }

  const url = `${SUPABASE_URL}/functions/v1/ai-parse-hand-text`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      'x-user-jwt': session.access_token,
    },
    body: JSON.stringify({ text: text.trim() }),
  });

  const contentType = res.headers.get('content-type');
  const isJson = contentType && contentType.includes('application/json');
  const bodyText = await res.text();

  if (!res.ok) {
    throw new Error(`Edge ai-parse-hand-text ${res.status}: ${bodyText}`);
  }

  if (!isJson) {
    return { ok: false, error: 'unparseable', meta: { confidence: 'LOW', source_message: 'response was not JSON' } };
  }

  const data = JSON.parse(bodyText) as ParseHandSuccess | ParseHandFailure;
  if (data.ok === false) {
    const meta = data.meta ?? { confidence: 'LOW' as const, source_message: 'could not parse hand history' };
    return { ok: false, error: data.error ?? 'unparseable', meta };
  }
  return data;
}

/**
 * Alias for callParseHandText — calls ai-parse-hand-text Edge Function.
 */
export async function callEdgeParseHandText(
  text: string
): Promise<ParseHandSuccess | ParseHandFailure> {
  return callParseHandText(text);
}
