import { NextRequest, NextResponse } from 'next/server';
import { appendFile } from 'node:fs/promises';

const LOG_PATH = '/tmp/clash-browser.log';

export async function POST(req: NextRequest) {
    if (process.env.NODE_ENV === 'production') {
        return new NextResponse(null, { status: 404 });
    }
    try {
        const body = await req.json();
        const ts = new Date(body.ts ?? Date.now()).toISOString().slice(11, 23);
        const level = String(body.level ?? 'log').toUpperCase().padEnd(5);
        const url = body.url ?? '';
        const args = Array.isArray(body.args) ? body.args : [body.args];
        const line = `${ts} ${level} ${url} ${args.map((a: unknown) => typeof a === 'string' ? a : JSON.stringify(a)).join(' ')}\n`;
        await appendFile(LOG_PATH, line);
    } catch {
        // swallow
    }
    return new NextResponse(null, { status: 204 });
}
