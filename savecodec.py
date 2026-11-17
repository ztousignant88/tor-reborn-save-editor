"""Tactics Ogre: Reborn SAVEDATA container: decode, re-encode, validate.

Standalone copy for the save editor. The block cipher tables come from
Gibbed.Reborn DataBogoCrypt (zlib licence, (c) Rick/gibbed); the save layout
(60-byte header, 84-byte block headers, MD5 per decoded payload) is documented
in restored-spells/SAVE_FORMAT_RESEARCH.md. Only same-size block edits are
supported; every other byte of the file is kept exactly.
"""
from __future__ import annotations

import hashlib
import struct

SIGNATURE = bytes.fromhex("5341564544415441b2fb45a701e5a0dc")
MAIN_TAG = 0x10000001
SUMMARY_TAG = 0x10000004

T2 = bytes([0xB0,0xBC,0x6D,0x19,0xE5,0x14,0xB6,0xEA,0xF4,0xCB,0x16,0xB1,0x7D,0xE5,0x7F,0xB5,0x0B,0x7C,0x5E,0xC4,0x2D,0x4F,0x31,0x99,0x67,0x98,0x19,0xE8,0x28,0x58,0xDE,0xC9,0xC1,0x9B,0xC9,0x83,0x34,0xC4,0x64,0x85,0x36,0xFA,0x0E,0xDE,0xFB,0xE7,0x68,0x99,0x71,0x32,0x34,0x36,0xE5,0x01,0x7D,0x63,0x5C,0x81,0x77,0x7C])
T3 = bytes([0xC6,0x53,0x98,0xED,0xD0,0xAA,0xE0,0x1B,0x43,0x31,0x16,0x32,0xCE,0x0D,0x52,0x57,0x7B,0x72,0x0F,0xFB,0xB7,0xA9,0xC6,0xF1,0xF1,0x72,0x2C,0x89,0x5F,0xB2,0x1B,0xFA,0xA8,0xDB,0xE3,0xE2,0x41,0xB5,0xBE,0xC9,0x5D,0xAE,0xC6,0x21,0xE4,0xD2,0x88,0x74,0x97,0x26,0x4F,0x87,0x7A,0xF0,0x69,0x7A,0xB7,0x7E,0x15,0x09,0xBA,0x55,0xAD,0xCA,0xB1,0x60,0x34,0x76])


class SaveFormatError(ValueError):
    pass


def _keystream(table: bytes, seed: int, n: int) -> bytes:
    words = len(table) // 4
    seed %= words
    rotated = table[seed * 4:] + table[:seed * 4]
    whole = n - (n % 4)
    stream = (rotated * (whole // len(rotated) + 1))[:whole]
    return stream + bytes(n - whole)  # a trailing partial word is not XORed


def _xor(buf: bytearray, offset: int, table: bytes, seed: int) -> None:
    seg = buf[offset:]
    ks = _keystream(table, seed, len(seg))
    value = int.from_bytes(seg, "big") ^ int.from_bytes(ks, "big")
    buf[offset:] = value.to_bytes(len(seg), "big")


def _rotl(buf: bytes, s: int) -> bytearray:
    n = len(buf) * 8
    v = int.from_bytes(buf, "big")
    return bytearray((((v << s) | (v >> (n - s))) & ((1 << n) - 1)).to_bytes(len(buf), "big"))


def _rotr(buf: bytes, s: int) -> bytearray:
    n = len(buf) * 8
    v = int.from_bytes(buf, "big")
    return bytearray((((v >> s) | (v << (n - s))) & ((1 << n) - 1)).to_bytes(len(buf), "big"))


def decode_payload(data: bytes, digest: bytes) -> bytes:
    if not data:
        raise SaveFormatError("Empty save block")
    result = _rotl(data, 2)
    _xor(result, 0, T2, 4)
    _xor(result, 0, T3, (sum(digest) + 3) & 255)
    return bytes(result)


def encode_payload(data: bytes, digest: bytes) -> bytes:
    if not data:
        raise SaveFormatError("Empty save block")
    result = bytearray(data)
    _xor(result, 0, T3, (sum(digest) + 3) & 255)
    _xor(result, 0, T2, 4)
    return bytes(_rotr(result, 2))


class SaveFile:
    """A decoded SAV file. blocks: tag -> (offset, payload)."""

    def __init__(self, data: bytes):
        if len(data) < 60 or data[:16] != SIGNATURE:
            raise SaveFormatError("Not a Tactics Ogre: Reborn save file")
        count = struct.unpack_from("<I", data, 16)[0]
        if not 1 <= count <= 16:
            raise SaveFormatError("Invalid save block count")
        self.original = bytes(data)
        self.blocks: dict[int, tuple[int, bytes]] = {}
        offset = 60
        for _ in range(count):
            if offset + 84 > len(data):
                raise SaveFormatError("Truncated save block header")
            tag, reserved, flags, size, total = struct.unpack_from("<5I", data, offset)
            if not 0x10000000 <= tag <= 0x10000004 or tag in self.blocks:
                raise SaveFormatError("Unknown or duplicate save block")
            if reserved or flags != 3:
                raise SaveFormatError("Unsupported save block flags")
            if not 0 < size <= 8 * 1024 * 1024 or total != ((84 + size + 3) & ~3):
                raise SaveFormatError("Invalid save block size")
            if offset + total > len(data):
                raise SaveFormatError("Save block runs past the end of the file")
            digest = data[offset + 20:offset + 36]
            encoded = data[offset + 84:offset + 84 + size]
            payload = decode_payload(encoded, digest)
            if hashlib.md5(payload).digest() != digest:
                raise SaveFormatError("Save block checksum mismatch (damaged file?)")
            if encode_payload(payload, digest) != encoded:
                raise SaveFormatError("Save block does not re-encode exactly")
            self.blocks[tag] = (offset, payload)
            offset += total
        if offset != len(data):
            raise SaveFormatError("Unexpected data after the last save block")
        if MAIN_TAG not in self.blocks:
            raise SaveFormatError("Save has no main block")

    def payload(self, tag: int) -> bytes:
        return self.blocks[tag][1]

    def rebuild(self, replacements: dict[int, bytes]) -> bytes:
        """Return a new file with the given block payloads (same sizes only)."""
        out = bytearray(self.original)
        for tag, payload in replacements.items():
            if tag not in self.blocks:
                raise SaveFormatError("Save block is missing")
            offset, old = self.blocks[tag]
            if len(payload) != len(old):
                raise SaveFormatError("Changing a save block's size is not supported")
            if payload == old:
                continue
            digest = hashlib.md5(payload).digest()
            out[offset + 20:offset + 36] = digest
            out[offset + 84:offset + 84 + len(payload)] = encode_payload(payload, digest)
        result = bytes(out)
        check = SaveFile(result)
        for tag, (_, old) in self.blocks.items():
            if check.payload(tag) != replacements.get(tag, old):
                raise SaveFormatError("Rebuilt save failed verification")
        return result
