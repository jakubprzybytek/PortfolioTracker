// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/zip.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Minimal zip reader (stored and deflated entries) for ESEF report packages, on Node's zlib.
import { inflateRawSync } from "node:zlib";

export type ZipEntry = { name: string; data: () => Buffer };

const EOCD = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

export function isZip(data: Buffer): boolean {
    return data.length >= 4 && data.readUInt32LE(0) === LOCAL;
}

export function readZip(data: Buffer): ZipEntry[] {
    // End of central directory: the last 22+ bytes (a comment of up to 64 KiB may follow it).
    let eocd = -1;
    for (let i = data.length - 22; i >= Math.max(0, data.length - 22 - 0xffff); i--) {
        if (data.readUInt32LE(i) === EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error('Not a zip file (no end of central directory)');
    const count = data.readUInt16LE(eocd + 10);
    let offset = data.readUInt32LE(eocd + 16);

    const entries: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
        if (data.readUInt32LE(offset) !== CENTRAL) throw new Error('Corrupt zip central directory');
        const method = data.readUInt16LE(offset + 10);
        const compressedSize = data.readUInt32LE(offset + 20);
        const nameLength = data.readUInt16LE(offset + 28);
        const extraLength = data.readUInt16LE(offset + 30);
        const commentLength = data.readUInt16LE(offset + 32);
        const localOffset = data.readUInt32LE(offset + 42);
        const name = data.subarray(offset + 46, offset + 46 + nameLength).toString('utf-8');
        offset += 46 + nameLength + extraLength + commentLength;
        if (name.endsWith('/')) continue;

        entries.push({
            name,
            data: () => {
                if (data.readUInt32LE(localOffset) !== LOCAL) throw new Error(`Corrupt zip entry ${name}`);
                const start = localOffset + 30 + data.readUInt16LE(localOffset + 26) + data.readUInt16LE(localOffset + 28);
                const raw = data.subarray(start, start + compressedSize);
                if (method === 0) return Buffer.from(raw);
                if (method === 8) return inflateRawSync(raw);
                throw new Error(`Unsupported zip compression method ${method} in ${name}`);
            },
        });
    }
    return entries;
}
