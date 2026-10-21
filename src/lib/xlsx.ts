// Maison Academy · read the first sheet of an Excel (.xlsx) file in the browser.
// Copyright © 2026 Creneau Hospitality. All rights reserved.
//
// Enough for roster exports (for example Bayzat): text, numbers and dates as
// Excel stores them. The file never leaves this computer.

import { strFromU8, unzipSync } from 'fflate';

function colIndex(ref: string): number {
  const letters = ref.replace(/\d+$/, '');
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function readXlsx(buf: ArrayBuffer): string[][] {
  const files = unzipSync(new Uint8Array(buf), { filter: (f) => f.name.startsWith('xl/') });
  const xml = (name: string) => (files[name] ? new DOMParser().parseFromString(strFromU8(files[name]), 'application/xml') : null);
  const text = (el: Element) => Array.from(el.getElementsByTagName('t')).map((t) => t.textContent ?? '').join('');

  const shared = Array.from(xml('xl/sharedStrings.xml')?.getElementsByTagName('si') ?? []).map(text);

  // The first sheet, found through the workbook's relationships.
  let path = 'xl/worksheets/sheet1.xml';
  const first = xml('xl/workbook.xml')?.getElementsByTagName('sheet')[0];
  const rid = first ? Array.from(first.attributes).find((a) => a.name.endsWith(':id'))?.value : undefined;
  if (rid) {
    const rel = Array.from(xml('xl/_rels/workbook.xml.rels')?.getElementsByTagName('Relationship') ?? []).find((r) => r.getAttribute('Id') === rid);
    const target = rel?.getAttribute('Target');
    if (target) path = target.startsWith('/') ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
  }
  const sheet = xml(path);
  if (!sheet) throw new Error('No sheet found in this file.');

  const rows: string[][] = [];
  for (const row of Array.from(sheet.getElementsByTagName('row'))) {
    const out: string[] = [];
    let next = 0;
    for (const c of Array.from(row.getElementsByTagName('c'))) {
      const ref = c.getAttribute('r');
      const i = ref ? colIndex(ref) : next;
      next = i + 1;
      const t = c.getAttribute('t');
      const v = c.getElementsByTagName('v')[0]?.textContent ?? '';
      out[i] = t === 's' ? shared[Number(v)] ?? '' : t === 'inlineStr' ? text(c) : v;
    }
    rows.push(Array.from(out, (x) => x ?? ''));
  }
  return rows;
}
