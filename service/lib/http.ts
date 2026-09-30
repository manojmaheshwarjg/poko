import { NextResponse } from 'next/server';

const ALLOWED = process.env.COPILOT_ALLOWED_ORIGIN ?? 'http://localhost:4500';

export function cors(origin: string | null): Record<string, string> {
  /* Echo the origin only when it is the one we allow, so the header can never
     be turned into a wildcard by a caller. */
  return {
    'Access-Control-Allow-Origin': origin === ALLOWED ? origin : ALLOWED,
    'Access-Control-Allow-Headers': 'content-type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    Vary: 'Origin',
  };
}

export function preflight(request: Request) {
  return new NextResponse(null, { status: 204, headers: cors(request.headers.get('origin')) });
}

export function fail(request: Request, status: number, error: string) {
  return NextResponse.json({ error }, { status, headers: cors(request.headers.get('origin')) });
}

export function ok(request: Request, body: unknown) {
  return NextResponse.json(body, { headers: cors(request.headers.get('origin')) });
}

/* A missing key or model is a precondition failure, not a server error.
   Surfacing it as 412 with this message means the panel can say something
   useful instead of showing an SDK stack trace. */
export function requireConfig(request: Request) {
  if (!process.env.GROQ_API_KEY) {
    return fail(
      request,
      412,
      'GROQ_API_KEY is not set on the service. The planner makes a paid API call and will not run without it.'
    );
  }
  if (!process.env.GROQ_MODEL) {
    return fail(
      request,
      412,
      'GROQ_MODEL is not set. Run `node scripts/list-models.mjs` in the service directory to see which models this key can reach, then set one in .env.local.'
    );
  }
  return null;
}
