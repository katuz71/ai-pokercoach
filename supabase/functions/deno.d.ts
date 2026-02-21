/**
 * Type declarations for Supabase Edge Functions (Deno runtime).
 * Use this so the IDE does not report errors for Deno globals and URL imports.
 */

declare global {
  const Deno: {
    env: {
      get(key: string): string | undefined;
    };
  };
}

declare module "https://deno.land/std@0.168.0/http/server.ts" {
  export function serve(
    handler: (req: Request) => Promise<Response> | Response
  ): void;
}

declare module "https://deno.land/std@0.168.0/encoding/base64.ts" {
  export function encode(input: string | ArrayBuffer): string;
  export function decode(b64: string): Uint8Array;
}

declare module "https://esm.sh/@supabase/supabase-js@2.39.0" {
  export function createClient(
    url: string,
    key: string,
    options?: { global?: { headers?: Record<string, string> } }
  ): any;
}

export {};
