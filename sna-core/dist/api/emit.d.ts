import { NextRequest } from 'next/server';

declare const runtime = "nodejs";
declare function POST(req: NextRequest): Promise<Response>;

export { POST, runtime };
