// Ported from CatalystViewer (packages/core/src/bonds/fundamentals/filings/pdfText.ts, 7e8a24c) for the Catalyst module's
// phase 2 (Docs/catalyst-phase2-plan.md, N3): functionality kept, imports adapted.

// Text of a PDF, page by page: items on one baseline are joined into a line, wide gaps between them
// shown as " | " (table cells). Statement tables come out as "label | note | 2025 | 2024" lines.

export type PdfPage = { page: number; lines: string[] };

export function isPdf(data: Buffer): boolean {
    return data.subarray(0, 5).toString('latin1') === '%PDF-';
}

type TextItem = { str: string; transform: number[]; width: number };

// Gaps wider than this (in PDF points) separate table cells.
const CELL_GAP = 12;

export async function readPdfPages(data: Buffer): Promise<PdfPage[]> {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(data), isEvalSupported: false, useSystemFonts: false, verbosity: 0 }).promise;
    const pages: PdfPage[] = [];
    try {
        for (let n = 1; n <= doc.numPages; n++) {
            const page = await doc.getPage(n);
            const content = await page.getTextContent();
            const rows = new Map<number, { x: number; width: number; text: string }[]>();
            for (const item of content.items as TextItem[]) {
                if (!item.str?.trim()) continue;
                const y = Math.round(item.transform[5]! / 2) * 2;
                const row = rows.get(y) ?? [];
                row.push({ x: item.transform[4]!, width: item.width, text: item.str });
                rows.set(y, row);
            }
            const lines = [...rows.entries()]
                .sort((a, b) => b[0] - a[0])
                .map(([, cells]) => {
                    cells.sort((a, b) => a.x - b.x);
                    let line = '';
                    let end: number | undefined;
                    for (const cell of cells) {
                        const gap = end === undefined ? 0 : cell.x - end;
                        line += end === undefined ? cell.text : (gap > CELL_GAP ? ' | ' : gap > 1 ? ' ' : '') + cell.text;
                        end = cell.x + cell.width;
                    }
                    return line.replace(/\s+/g, ' ').trim();
                })
                .filter(Boolean);
            pages.push({ page: n, lines });
            page.cleanup();
        }
    } finally {
        await doc.destroy();
    }
    return pages;
}
