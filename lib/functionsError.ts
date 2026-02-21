import { FunctionsHttpError } from '@supabase/supabase-js';

export async function getFunctionsErrorDetails(err: any): Promise<{
  status?: number;
  body?: string;
  message: string;
}> {
  if (err instanceof FunctionsHttpError) {
    const res = err.context;
    const status = res.status;
    let body = '';
    try {
      body = await res.text();
    } catch {
      // Failed to read body
    }
    return {
      status,
      body,
      message: body || err.message,
    };
  }

  return {
    message: err?.message || 'Unknown error',
  };
}
