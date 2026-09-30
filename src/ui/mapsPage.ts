// The title screen's page of the player's own maps: pick one for free play, open one in the editor,
// make a new one there, or import a map file.
import { decodeMap, type MapData } from '../game/map';
import { glyph } from './glyphs';
import type { MenuPage } from './menu';
import { deleteMap, getMap, listMaps, type MapSummary } from './mapStore';
import { timeAgo } from './saveStore';

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function mapsPage(o: {
  /** the map free play is set to, by name (none: the generator's) */
  current?: string;
  pick: (data: MapData) => void;
  edit: (data?: MapData) => void;
}): MenuPage {
  const body = document.createElement('div');
  body.className = 'tm-maps';
  body.innerHTML = `
    <div class="tm-maps-bar">
      <button class="tm-btn" data-a="new">${glyph('brush', 16)}New map in the editor</button>
      <button class="tm-btn" data-a="import">${glyph('upload', 16)}Import a map file</button>
    </div>
    <div class="tm-maps-list" data-err><p class="muted">Looking…</p></div>`;
  const list = body.querySelector<HTMLElement>('.tm-maps-list')!;
  const fail = (e: unknown) => { list.querySelector('.menu-err')?.remove(); const p = document.createElement('p'); p.className = 'menu-err'; p.textContent = (e as Error)?.message ?? String(e); list.prepend(p); };
  body.querySelector<HTMLButtonElement>('[data-a=new]')!.onclick = () => o.edit();
  body.querySelector<HTMLButtonElement>('[data-a=import]')!.onclick = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.tnmap';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      try { o.pick(await decodeMap(new Uint8Array(await f.arrayBuffer()))); } catch (e) { fail(e); }
    };
    input.click();
  };
  const render = (maps: MapSummary[]) => {
    if (!maps.length) { list.innerHTML = '<p class="muted">No maps of your own yet. The editor makes one from a generated world, an open sea or flat land.</p>'; return; }
    list.innerHTML = maps.map((m) => `<div class="tm-maprow${m.meta.name === o.current ? ' cur' : ''}" data-id="${m.id}">
        ${m.meta.thumb ? `<img src="${m.meta.thumb}" alt="">` : '<span class="ed-nothumb"></span>'}
        <div class="tm-mapt"><b>${esc(m.meta.name)}</b><small>${m.meta.size}² · ${m.meta.players} player${m.meta.players === 1 ? '' : 's'} · saved ${timeAgo(m.meta.savedAt)}${m.meta.author ? ` · by ${esc(m.meta.author)}` : ''}</small>${m.meta.description ? `<small class="desc">${esc(m.meta.description)}</small>` : ''}</div>
        <button class="tm-btn primary" data-a="pick">Play on it</button>
        <button class="tm-btn" data-a="edit" title="Open it in the editor">${glyph('brush', 16)}</button>
        <button class="ed-x" data-a="del" title="Delete">${glyph('trash', 16)}</button>
      </div>`).join('');
    list.querySelectorAll<HTMLElement>('.tm-maprow').forEach((row) => {
      const id = row.dataset.id!;
      const load = async () => { const d = await getMap(id); if (!d) throw new Error('That map is gone'); return d; };
      row.querySelector<HTMLButtonElement>('[data-a=pick]')!.onclick = () => load().then(o.pick).catch(fail);
      row.querySelector<HTMLButtonElement>('[data-a=edit]')!.onclick = () => load().then((d) => o.edit(d)).catch(fail);
      row.querySelector<HTMLButtonElement>('[data-a=del]')!.onclick = () => {
        if (!row.classList.contains('sure')) { row.classList.add('sure'); row.querySelector<HTMLButtonElement>('[data-a=del]')!.title = 'Click again to delete'; return; }
        deleteMap(id).then(() => row.remove()).catch(fail);
      };
    });
  };
  listMaps().then((maps) => { if (body.isConnected) render(maps.filter((m) => m.id !== 'draft')); }).catch(fail);
  return { title: 'Your maps', sub: 'Maps of your own making, from the editor or a file. Pick one to play free play on it.', body };
}
