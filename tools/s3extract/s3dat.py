"""Readers for the Settlers III (May 1998 rolling demo) data files.

Formats were worked out from the demo files themselves; the retail release
uses a close relative of the same container.

Graphics container (siedler3_NN.f8007e01f.dat = RGB565, .7c003e01f.dat = RGB555):
    0x00  u32 0x00041304, u32 0x0a, ...           fixed magic
    0x20  u32 r_mask, g_mask, b_mask, 0            pixel format
    0x30  u32 file_size
    0x34  u32 x8 section offsets
Every section starts with  u32 type, u16 byte_len, u16 count, u32[count] offsets.
    0x1904  end-of-header marker          0x2412  landscape textures
    0x1306  GUI images                    0x0106  sprite sequences (RGB layer)
    0x3112  torso sequences (player colour, 8-bit indices)
    0x5982  shadow sequences (mask only)  0x21702 animation scripts
    0x2607  player palettes (extra u32 entry count before the offsets)

A sequence is  u32 0x1402, u16 8, u8 0, u8 frame_count, u32[n] offsets
(relative to the sequence start). A frame is
    u32 12, u16 w, u16 h, s16 x, s16 y, u8 0, pad to an even file offset,
followed by RLE rows. Each run is  u8 count, u8 skip|0x80(end of row),
then `count` pixels (2 bytes RGB565, 1 byte palette index, or 0 bytes for
shadows). The skip is applied before the pixels.
Textures are  u16 w, u16 h, u8 1, u8 kind  followed by the same RLE rows.
GUI images are  u16 w, u16 h, u16 0  followed by the same RLE rows.
Player palettes are 8 brightness levels x 256 RGB565 entries (level 7 = full).
Animation scripts (files 15/25/35) are  u32 step_count  then 24-byte steps,
stored last step first:  s16 dx, s16 dy, (u16 seq, u16 file) x3 for
base/torso/shadow, u16 frame, u16 shadow_frame, s32 sound (-1 = none; low
16 bits = sound id). They match the animationdata blocks in the .gfx sources
exactly, so extract.py reads those instead.

Sound bank (Siedler3_00.dat):
    u32 0x11544, ... u32 file_size @0x10, u32 dir_offset @0x14
    dir: u32 0x11f74, u16 len, u16 count, u32[count] sound offsets
    sound: u32 variant_count, u32[variant_count] variant offsets
    variant: u32 total_len (incl. this 20-byte header), 16-byte PCM WAVEFORMAT,
             then raw PCM.
"""

import re
import struct
import zlib

SEC_HEADER_END = 0x1904
SEC_LANDSCAPE = 0x2412
SEC_GUI = 0x1306
SEC_SETTLER = 0x0106
SEC_TORSO = 0x3112
SEC_SHADOW = 0x5982
SEC_ANIMDATA = 0x21702
SEC_PALETTE = 0x2607

PALETTE_LEVELS = 8          # brightness levels per player palette, 7 = full
PALETTE_ENTRIES = 256


def rgb565(c):
    r, g, b = (c >> 11) & 31, (c >> 5) & 63, c & 31
    return (r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)


_RGBA565 = {}


def _rgb565_rgba(c):
    v = _RGBA565.get(c)
    if v is None:
        v = _RGBA565[c] = bytes(rgb565(c) + (255,))
    return v


class Image:
    """A decoded frame: RGBA pixels plus its hotspot-relative offset."""

    def __init__(self, w, h, x=0, y=0):
        self.w, self.h, self.x, self.y = w, h, x, y
        self.px = bytearray(w * h * 4)

    def put(self, x, y, rgba):
        i = (y * self.w + x) * 4
        self.px[i:i + 4] = bytes(rgba)

    def paste(self, src, dx, dy):
        """Copy src (all pixels, including transparent) into self at (dx, dy)."""
        s = src.w * 4
        for y in range(src.h):
            j = ((y + dy) * self.w + dx) * 4
            self.px[j:j + s] = src.px[y * s:(y + 1) * s]

    def png(self):
        return encode_png(self.w, self.h, self.px)


def encode_png(w, h, rgba):
    def chunk(tag, data):
        c = tag + data
        return struct.pack('>I', len(data)) + c + struct.pack('>I', zlib.crc32(c) & 0xffffffff)

    stride = w * 4
    raw = b''.join(b'\0' + bytes(rgba[y * stride:(y + 1) * stride]) for y in range(h))
    return (b'\x89PNG\r\n\x1a\n'
            + chunk(b'IHDR', struct.pack('>IIBBBBB', w, h, 8, 6, 0, 0, 0))
            + chunk(b'IDAT', zlib.compress(raw, 9))
            + chunk(b'IEND', b''))


class GfxFile:
    def __init__(self, path):
        self.path = path
        self.d = open(path, 'rb').read()
        d = self.d
        if struct.unpack_from('<I', d, 0)[0] != 0x41304:
            raise ValueError('%s: not a Settlers III gfx file' % path)
        if struct.unpack_from('<I', d, 0x30)[0] != len(d):
            raise ValueError('%s: size mismatch' % path)
        self.sections = {}
        for off in struct.unpack_from('<8I', d, 0x34):
            typ, _, count = struct.unpack_from('<IHH', d, off)
            if typ == SEC_PALETTE:
                self.palette_size = struct.unpack_from('<I', d, off + 8)[0]
                self.sections[typ] = list(struct.unpack_from('<%dI' % count, d, off + 12))
            else:
                self.sections[typ] = list(struct.unpack_from('<%dI' % count, d, off + 8))

    def offsets(self, sec):
        return self.sections.get(sec, [])

    # --- sequences -------------------------------------------------------
    def sequence_frames(self, seq_off):
        magic, _, _, n = struct.unpack_from('<IHBB', self.d, seq_off)
        if magic != 0x1402:
            raise ValueError('bad sequence magic at %#x' % seq_off)
        return [seq_off + o for o in struct.unpack_from('<%dI' % n, self.d, seq_off + 8)]

    def _rle(self, img, p, h, bpp, pixel, dx=0, dy=0):
        """Decode `h` RLE rows starting at byte `p` into img at (dx, dy)."""
        d, px, stride = self.d, img.px, img.w * 4
        y = x = 0
        while y < h:
            count, skip = d[p], d[p + 1]
            p += 2
            x += skip & 0x7f
            i = (y + dy) * stride + (x + dx) * 4
            for _ in range(count):
                if bpp == 2:
                    px[i:i + 4] = pixel(d[p] | d[p + 1] << 8)
                elif bpp == 1:
                    px[i:i + 4] = pixel(d[p])
                else:
                    px[i:i + 4] = pixel(None)
                p += bpp
                i += 4
            x += count
            if skip & 0x80:
                y += 1
                x = 0
        return p

    def frame_rect(self, off):
        """(w, h, x, y) of a frame; x/y are the top-left corner relative to the hotspot."""
        hdr, w, h, x, y = struct.unpack_from('<IHHhh', self.d, off)
        if hdr != 12:
            raise ValueError('bad frame header at %#x' % off)
        return w, h, x, y

    def frame(self, off, bpp, pixel, into=None, dx=0, dy=0):
        w, h, x, y = self.frame_rect(off)
        img = into if into is not None else Image(w, h, x, y)
        start = off + 13
        start += start & 1
        self._rle(img, start, h, bpp, pixel, dx, dy)
        return img

    def settler_frame(self, off, **kw):
        return self.frame(off, 2, _rgb565_rgba, **kw)

    def torso_frame(self, off, palette, **kw):
        rgba = [bytes(c + (255,)) for c in palette]
        return self.frame(off, 1, rgba.__getitem__, **kw)

    def torso_index_frame(self, off, **kw):
        """Torso layer as raw palette indices (grey = index) for engine-side tinting."""
        return self.frame(off, 1, lambda i: bytes((i, i, i, 255)), **kw)

    def shadow_frame(self, off, alpha=110, **kw):
        px = bytes((0, 0, 0, alpha))
        return self.frame(off, 0, lambda _: px, **kw)

    # --- textures / GUI --------------------------------------------------
    def texture(self, off):
        w, h, _, kind = struct.unpack_from('<HHBB', self.d, off)
        img = Image(w, h)
        self._rle(img, off + 6, h, 2, _rgb565_rgba)
        img.kind = kind
        return img

    def gui_image(self, off):
        w, h = struct.unpack_from('<HH', self.d, off)
        img = Image(w, h)
        self._rle(img, off + 6, h, 2, _rgb565_rgba)
        return img

    # --- palettes --------------------------------------------------------
    def palette(self, idx, level=PALETTE_LEVELS - 1):
        off = self.sections[SEC_PALETTE][idx] + level * PALETTE_ENTRIES * 2
        return [rgb565(c) for c in struct.unpack_from('<%dH' % PALETTE_ENTRIES, self.d, off)]


class SoundBank:
    def __init__(self, path):
        d = self.d = open(path, 'rb').read()
        if struct.unpack_from('<I', d, 0x10)[0] != len(d):
            raise ValueError('%s: size mismatch' % path)
        dir_off = struct.unpack_from('<I', d, 0x14)[0]
        _, _, count = struct.unpack_from('<IHH', d, dir_off)
        self.sounds = []
        for off in struct.unpack_from('<%dI' % count, d, dir_off + 8):
            n = struct.unpack_from('<I', d, off)[0]
            self.sounds.append(list(struct.unpack_from('<%dI' % n, d, off + 4)))

    def wav(self, variant_off):
        d = self.d
        total = struct.unpack_from('<I', d, variant_off)[0]
        fmt = d[variant_off + 4:variant_off + 20]
        pcm = d[variant_off + 20:variant_off + total]
        return (b'RIFF' + struct.pack('<I', 36 + len(pcm)) + b'WAVE'
                + b'fmt ' + struct.pack('<I', 16) + fmt
                + b'data' + struct.pack('<I', len(pcm)) + pcm)

    def format(self, variant_off):
        tag, ch, rate, _, _, bits = struct.unpack_from('<HHIIHH', self.d, variant_off + 4)
        total = struct.unpack_from('<I', self.d, variant_off)[0]
        return {'channels': ch, 'rate': rate, 'bits': bits,
                'seconds': round((total - 20) / (rate * ch * bits // 8), 3)}


# --- generated C++ headers (name -> index) ------------------------------
def read_header_names(path):
    """Parse siedler3_NN_gfx.hpp / _snd.hpp into {prefix: {index: name}}."""
    names = {}
    for m in re.finditer(r'const int ([A-Z]+)_(\w+) = (\d+);', open(path, encoding='latin-1').read()):
        prefix, name, value = m.group(1), m.group(2), int(m.group(3))
        names.setdefault(prefix, {})[value & 0xffff] = name
    return names
