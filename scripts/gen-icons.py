"""Generates placeholder PNG icons for Tauri using only Python stdlib."""
import struct, zlib, os

def make_png(width: int, height: int, r: int, g: int, b: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        crc = zlib.crc32(tag + data) & 0xFFFFFFFF
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", crc)

    sig = b"\x89PNG\r\n\x1a\n"
    ihdr_data = struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0)  # color type 6 = RGBA
    ihdr = chunk(b"IHDR", ihdr_data)

    # Build raw scanlines: filter byte 0x00 + RGBA pixels
    row = b"\x00" + bytes([r, g, b, 255]) * width
    raw = row * height
    idat = chunk(b"IDAT", zlib.compress(raw, 9))
    iend = chunk(b"IEND", b"")

    return sig + ihdr + idat + iend

# Purple accent colour matching Mocha theme
R, G, B = 203, 166, 247  # #cba6f7

out = os.path.join(os.path.dirname(__file__), "..", "src-tauri", "icons")
os.makedirs(out, exist_ok=True)

sizes = {
    "32x32.png": (32, 32),
    "128x128.png": (128, 128),
    "128x128@2x.png": (256, 256),
    "256x256.png": (256, 256),
}

for fname, (w, h) in sizes.items():
    path = os.path.join(out, fname)
    with open(path, "wb") as f:
        f.write(make_png(w, h, R, G, B))
    print(f"  created {path}")

print("Icons generated. Replace with real art before shipping!")
