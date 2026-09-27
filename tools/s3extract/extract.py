#!/usr/bin/env python3
"""Extract graphics, sounds and animation data from the Settlers III May 1998 demo.

usage: extract.py RAW_DIR OUT_DIR [--player N] [--layers]

Pure standard library; no Pillow/numpy needed.
"""

import argparse
import glob
import json
import os
import re
import shutil
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from s3dat import (GfxFile, Image, SoundBank, encode_png, read_header_names,  # noqa: E402
                   SEC_GUI, SEC_LANDSCAPE, SEC_PALETTE, SEC_SETTLER, SEC_SHADOW, SEC_TORSO,
                   PALETTE_LEVELS, PALETTE_ENTRIES)

FILE_DESCRIPTIONS = {
    0: 'landscape_textures', 1: 'landscape_objects', 2: 'start_menus', 3: 'common_buttons',
    4: 'ingame_side_menu',
    10: 'roman_carriers', 11: 'roman_workers', 12: 'roman_soldiers', 13: 'roman_buildings',
    14: 'roman_buttons', 15: 'roman_animdata',
    20: 'egyptian_carriers', 21: 'egyptian_workers', 22: 'egyptian_soldiers',
    23: 'egyptian_buildings', 24: 'egyptian_buttons', 25: 'egyptian_animdata',
    30: 'asian_carriers', 31: 'asian_workers', 32: 'asian_soldiers', 33: 'asian_buildings',
    34: 'asian_buttons', 35: 'asian_animdata',
}
TEXTURE_KINDS = {1: 'txt128', 2: 'txt32', 3: 'trans32', 4: 'spot32', 5: 'steep256'}


def write(path, data):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, 'wb') as f:
        f.write(data)


def safe(name):
    return re.sub(r'[^\w.-]+', '_', name)


def shadow_for(base, shadows):
    """Pair a base animation with its shadow; the .gfx sources name them inconsistently
    (X_shadow, Xshadow, X__1_shadow, plant_treeshadow01, bluetree2shadow for bluetree02...)."""
    def key(n):
        return n.lower().replace('_', '').replace('shadow', '')
    by_key = {key(n): i for i, n in shadows.items()}
    k = key(base)
    for cand in (k, re.sub(r'0+(\d)$', r'\1', k), re.sub(r'\d+$', '', k), k.rstrip('s')):
        if cand in by_key:
            return by_key[cand]
    return None


def parse_frame_groups(gfx_text):
    """From a .gfx source, read how each animation's frames are grouped.

    Every `range:` in an animation's first `frames:` block is one run of frames
    (for settlers: one of the six walking directions A-F); loose `{file: ...}`
    entries are collected into a single group.
    Returns {anim_name: [(label, frame_count), ...]}.
    """
    groups, name, frames_seen, depth = {}, None, 0, 0
    pending = None
    for line in gfx_text.splitlines():
        m = re.match(r'\s*(\w+):\s*(\{)?\s*$', line)
        if m and depth == 1:
            pending = m.group(1)
            if m.group(2):
                name, frames_seen = pending, 0
        elif pending and depth == 1 and line.strip() == '{':
            name, frames_seen = pending, 0
        if re.match(r'\s*frames:', line) and name:
            frames_seen += 1
        if name and frames_seen == 1:
            r = re.search(r'range:\s*\{first:\s*([^;]+);\s*last:\s*([^;]+);', line)
            f = re.search(r'\{\s*file:\s*([^;]+);', line)
            if r:
                a = re.search(r'(\d+)\.bmp', r.group(1), re.I)
                b = re.search(r'(\d+)\.bmp', r.group(2), re.I)
                d = re.search(r'_([A-F])_\d+\.bmp', r.group(1), re.I)
                n = int(b.group(1)) - int(a.group(1)) + 1 if a and b else 1
                label = d.group(1).upper() if d else 'run %d' % (len(groups.get(name, [])) + 1)
                groups.setdefault(name, []).append((label, n))
            elif f:
                g = groups.setdefault(name, [])
                if g and g[-1][0] == 'frames':
                    g[-1] = ('frames', g[-1][1] + 1)
                else:
                    g.append(('frames', 1))
        depth += line.count('{') - line.count('}')
        if depth <= 1 and name and line.strip().startswith('}'):
            name = pending = None
    return groups


def sheet_columns(n, groups):
    counts = {c for _, c in groups}
    if len(groups) > 1 and len(counts) == 1:
        return counts.pop()     # one row per group (e.g. per walking direction)
    return min(n, 12)


def build_sheet(frames, groups):
    """frames: list of Image on a common canvas size. Returns (sheet, cols)."""
    cols = sheet_columns(len(frames), groups)
    rows = (len(frames) + cols - 1) // cols
    cw, ch = frames[0].w, frames[0].h
    sheet = Image(cw * cols, ch * rows)
    for k, f in enumerate(frames):
        sheet.paste(f, (k % cols) * cw, (k // cols) * ch)
    return sheet, cols


def extract_sprites(g, fid, names, gfx_groups, out, palette, layers, manifest):
    anim = names.get('ANIM', {})
    cianim = {v: k for k, v in names.get('CIANIM', {}).items()}
    shanim = names.get('SHANIM', {})
    settlers = g.offsets(SEC_SETTLER)
    torsos = g.offsets(SEC_TORSO)
    shadows = g.offsets(SEC_SHADOW)
    used_shadows = set()
    folder = '%02d_%s' % (fid, FILE_DESCRIPTIONS.get(fid, 'file'))
    entries = {}

    jobs = []
    for idx, off in enumerate(settlers):
        name = anim.get(idx, 'anim_%03d' % idx)
        t_idx = cianim.get(name)
        s_idx = shadow_for(name, shanim)
        if s_idx is not None:
            used_shadows.add(s_idx)
        jobs.append((name, off, t_idx, s_idx))
    for s_idx, off in enumerate(shadows):
        if s_idx not in used_shadows:
            jobs.append((shanim.get(s_idx, 'shadow_%03d' % s_idx), None, None, s_idx))

    for name, off, t_idx, s_idx in jobs:
        base_f = g.sequence_frames(off) if off is not None else []
        torso_f = g.sequence_frames(torsos[t_idx]) if t_idx is not None and t_idx < len(torsos) else []
        shadow_f = g.sequence_frames(shadows[s_idx]) if s_idx is not None and s_idx < len(shadows) else []
        n = max(len(base_f), len(shadow_f))
        if n == 0:
            continue
        layer_offs = [('shadow', shadow_f), ('base', base_f), ('torso', torso_f)]
        frame_meta = []
        for k in range(n):
            frame_meta.append({layer: dict(zip('whxy', g.frame_rect(offs[k])))
                               for layer, offs in layer_offs if k < len(offs)})

        # common canvas: union of every layer's rect relative to the hotspot
        rects = [(r['x'], r['y'], r['x'] + r['w'], r['y'] + r['h']) for f in frame_meta for r in f.values()]
        x0 = min(r[0] for r in rects); y0 = min(r[1] for r in rects)
        x1 = max(r[2] for r in rects); y1 = max(r[3] for r in rects)
        cw, ch = max(x1 - x0, 1), max(y1 - y0, 1)

        composed = []
        for k, f in enumerate(frame_meta):
            canvas = Image(cw, ch)
            # painter's order: shadow under the body, player-colour torso on top
            for layer, offs in layer_offs:
                if layer not in f:
                    continue
                pos = dict(into=canvas, dx=f[layer]['x'] - x0, dy=f[layer]['y'] - y0)
                if layer == 'shadow':
                    g.shadow_frame(offs[k], **pos)
                elif layer == 'base':
                    g.settler_frame(offs[k], **pos)
                else:
                    g.torso_frame(offs[k], palette, **pos)
            composed.append(canvas)
            write(os.path.join(out, 'sprites', folder, safe(name), '%03d.png' % k), canvas.png())
            if layers:
                for layer, offs in layer_offs:
                    if k < len(offs):
                        im = {'shadow': g.shadow_frame, 'base': g.settler_frame,
                              'torso': g.torso_index_frame}[layer](offs[k])
                        write(os.path.join(out, 'sprites_layers', folder, safe(name),
                                           '%03d_%s.png' % (k, layer)), im.png())

        groups = gfx_groups.get(name)
        if not groups or sum(c for _, c in groups) != n:
            groups = [('all', n)]
        sheet, cols = build_sheet(composed, groups)
        write(os.path.join(out, 'sprites', folder, safe(name) + '.png'), sheet.png())
        entries[name] = {
            'frames': n, 'cell_w': cw, 'cell_h': ch, 'cols': cols,
            'groups': [{'label': l, 'start': sum(c for _, c in groups[:i]), 'count': c}
                       for i, (l, c) in enumerate(groups)],
            'anchor_x': -x0, 'anchor_y': -y0,   # hotspot (game position) inside each cell
            'sheet': 'sprites/%s/%s.png' % (folder, safe(name)),
            'layers': [l for l in ('base', 'torso', 'shadow') if any(l in f for f in frame_meta)],
            'frame_layers': frame_meta,
        }
    if entries:
        manifest['sprites'][folder] = entries
    return sum(e['frames'] for e in entries.values())


def extract_gui(g, fid, names, out, manifest):
    imgs = names.get('IMAG', names.get('IMG', {}))
    folder = '%02d_%s' % (fid, FILE_DESCRIPTIONS.get(fid, 'file'))
    items = []
    offsets = g.offsets(SEC_GUI)
    # "mode: all" images are stored once per screen resolution (small/medium/large),
    # so a header name covers every index up to the next name.
    starts = sorted(imgs) + [len(offsets)]
    for idx, off in enumerate(offsets):
        img = g.gui_image(off)
        name = 'image_%03d' % idx
        for a, b in zip(starts, starts[1:]):
            if a <= idx < b:
                name = imgs[a] if b - a == 1 else '%s_size%d' % (imgs[a], idx - a)
        rel = 'gui/%s/%03d_%s.png' % (folder, idx, safe(name))
        write(os.path.join(out, rel), img.png())
        items.append({'index': idx, 'name': name, 'w': img.w, 'h': img.h, 'file': rel})
    if items:
        manifest['gui'][folder] = items
    return len(items)


def extract_textures(g, names, out, manifest):
    tex = names.get('TEX', {})
    items = []
    for idx, off in enumerate(g.offsets(SEC_LANDSCAPE)):
        img = g.texture(off)
        name = tex.get(idx, 'tex_%03d' % idx)
        rel = 'textures/%03d_%s.png' % (idx, safe(name))
        write(os.path.join(out, rel), img.png())
        items.append({'index': idx, 'name': name, 'w': img.w, 'h': img.h,
                      'kind': TEXTURE_KINDS.get(img.kind, img.kind), 'file': rel})
    manifest['textures'] = items
    return len(items)


def extract_palettes(g, names, out, manifest):
    cols = names.get('COL', {})
    n = len(g.offsets(SEC_PALETTE))
    # one row block per player: 8 brightness levels x 256 entries, 2px per entry
    cell = 2
    img = Image(PALETTE_ENTRIES * cell, n * PALETTE_LEVELS * cell)
    players = []
    for p in range(n):
        for lvl in range(PALETTE_LEVELS):
            pal = g.palette(p, lvl)
            for e, rgb in enumerate(pal):
                for yy in range(cell):
                    for xx in range(cell):
                        img.put(e * cell + xx, (p * PALETTE_LEVELS + lvl) * cell + yy, rgb + (255,))
        full = g.palette(p)
        players.append({'index': p, 'name': cols.get(p, 'player_%d' % p),
                        'palette_level7_rgb': ['#%02x%02x%02x' % c for c in full]})
    write(os.path.join(out, 'palettes', 'player_palettes.png'), img.png())
    write(os.path.join(out, 'palettes', 'player_palettes.json'),
          json.dumps(players, indent=1).encode())
    manifest['palettes'] = [{'index': p['index'], 'name': p['name']} for p in players]
    return n


def extract_sounds(raw, out, manifest):
    bank_path = os.path.join(raw, 'Siedler3_00.dat')
    names = read_header_names(os.path.join(raw, 'siedler3_00_snd.hpp')).get('SND', {})
    bank = SoundBank(bank_path)
    items = []
    for i, variants in enumerate(bank.sounds):
        name = names.get(i, 'sound_%02d' % i)
        for v, off in enumerate(variants):
            rel = 'sounds/%02d_%s_%d.wav' % (i, safe(name), v)
            write(os.path.join(out, rel), bank.wav(off))
            items.append(dict(index=i, name=name, variant=v, file=rel, **bank.format(off)))
    manifest['sounds'] = items
    return len(items)


def parse_animdata(text):
    sounds = [{'anim': m.group(1), 'frame': int(m.group(2)), 'sound': m.group(3)}
              for m in re.finditer(r'\{\s*frame:\s*(\w+)@(\d+);\s*sound:\s*(\w+);\s*\}', text)]
    anims = {}
    body = text[text.find('animationdata'):]
    for m in re.finditer(r'(\w+):\s*\{((?:\s*\{[^{}]*\}\s*,?)+)\s*\};', body):
        steps = []
        for s in re.finditer(r'\{([^{}]*)\}', m.group(2)):
            step = {}
            for kv in s.group(1).split(';'):
                if ':' not in kv:
                    continue
                k, v = (t.strip() for t in kv.split(':', 1))
                if '@' in v:
                    a, f = v.split('@')
                    step[k] = {'anim': a.strip(), 'frame': int(f)}
                else:
                    step[k] = int(v)
            steps.append(step)
        anims[m.group(1)] = steps
    return {'sound_triggers': sounds, 'animations': anims}


def copy_sources(raw, out):
    n = 0
    for p in sorted(glob.glob(os.path.join(raw, '*.gfx')) + glob.glob(os.path.join(raw, '*.hpp'))):
        text = open(p, encoding='latin-1').read().replace('\r\n', '\n')
        write(os.path.join(out, 'source', os.path.basename(p)), text.encode('utf-8'))
        n += 1
    return n


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('raw')
    ap.add_argument('out')
    ap.add_argument('--player', type=int, default=1, help='player palette for torso layers (default 1 = blau)')
    ap.add_argument('--layers', action='store_true', help='also dump raw base/torso-index/shadow layers per frame')
    args = ap.parse_args()

    raw, out = args.raw, args.out
    if os.path.isdir(out):
        shutil.rmtree(out)
    manifest = {'source': 'The Settlers III rolling demo, build of 1998-05-12',
                'player_palette': args.player, 'sprites': {}, 'gui': {}}

    pal_file = GfxFile(os.path.join(raw, 'siedler3_01.f8007e01f.dat'))
    palette = pal_file.palette(args.player)
    print('palettes', extract_palettes(pal_file, read_header_names(os.path.join(raw, 'siedler3_01_gfx.hpp')), out, manifest))
    print('sounds  ', extract_sounds(raw, out, manifest))

    for path in sorted(glob.glob(os.path.join(raw, 'siedler3_*.f8007e01f.dat'))):
        fid = int(re.search(r'siedler3_(\d+)\.', os.path.basename(path)).group(1))
        hpp = os.path.join(raw, 'siedler3_%02d_gfx.hpp' % fid)
        names = read_header_names(hpp) if os.path.exists(hpp) else {}
        g = GfxFile(path)
        counts = []
        if g.offsets(SEC_LANDSCAPE):
            counts.append('textures %d' % extract_textures(g, names, out, manifest))
        if g.offsets(SEC_GUI):
            counts.append('gui %d' % extract_gui(g, fid, names, out, manifest))
        if g.offsets(SEC_SETTLER) or g.offsets(SEC_SHADOW):
            gfx = os.path.join(raw, 'siedler3_%02d.gfx' % fid)
            groups = parse_frame_groups(open(gfx, encoding='latin-1').read()) if os.path.exists(gfx) else {}
            counts.append('sprite frames %d' % extract_sprites(g, fid, names, groups, out, palette, args.layers, manifest))
        if counts:
            print('%02d %-20s %s' % (fid, FILE_DESCRIPTIONS.get(fid, ''), ', '.join(counts)))

    for fid in (15, 25, 35):
        p = os.path.join(raw, 'siedler3_%d.gfx' % fid)
        if os.path.exists(p):
            data = parse_animdata(open(p, encoding='latin-1').read())
            write(os.path.join(out, 'animdata', '%d_%s.json' % (fid, FILE_DESCRIPTIONS[fid])),
                  json.dumps(data, indent=1).encode())
            print('%d animdata: %d scripts, %d sound triggers' % (fid, len(data['animations']), len(data['sound_triggers'])))

    print('sources ', copy_sources(raw, out))
    write(os.path.join(out, 'manifest.json'), json.dumps(manifest, indent=1).encode())
    slim = json.loads(json.dumps(manifest))
    for entries in slim['sprites'].values():
        for e in entries.values():
            e.pop('frame_layers', None)
    write(os.path.join(out, 'manifest.js'), b'window.S3_MANIFEST = ' + json.dumps(slim).encode() + b';\n')
    shutil.copy(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'index.html'),
                os.path.join(out, 'index.html'))


if __name__ == '__main__':
    main()
