import { describe, expect, it } from "vitest";

import { Blosc2Codec } from "../src/blosc2.js";

describe("Blosc2Codec", () => {
  it("decodes a memcpy chunk (real fixture: silam-dust a/0.0.0)", async () => {
    const decoded = await new Blosc2Codec().decode(hexToBytes(MEMCPY_FIXTURE));
    expect(Array.from(toFloat32Array(decoded))).toEqual([0]);
  });

  it("decodes a shuffled, zstd-compressed, multi-block chunk", async () => {
    const decoded = await new Blosc2Codec().decode(
      hexToBytes(MULTI_BLOCK_SHUFFLE_ZSTD_FIXTURE)
    );
    expect(Array.from(toFloat32Array(decoded))).toEqual(
      Array.from({ length: 2000 }, (_, i) => i)
    );
  });

  it("rejects chunks whose split blocks are too small to delegate safely", async () => {
    // blocksize=64 with typesize=4 (neblock=16 bytes/stream) is below the
    // classic Blosc1 decoder's MIN_BUFFERSIZE floor for splitting - decoding
    // it would silently misinterpret the stream layout, so this must throw.
    await expect(
      new Blosc2Codec().decode(hexToBytes(TINY_BLOCK_SHUFFLE_ZSTD_FIXTURE))
    ).rejects.toThrow(/too small/);
  });

  it("decodes an all-NaN block compressed with shuffle and zstd", async () => {
    const decoded = await new Blosc2Codec().decode(hexToBytes(NAN_FIXTURE));
    expect(Array.from(toFloat32Array(decoded)).every(Number.isNaN)).toBe(true);
  });

  it("decodes the 'run of zeros' special-value encoding", async () => {
    const decoded = await new Blosc2Codec().decode(hexToBytes(ZERO_FIXTURE));
    expect(Array.from(toFloat32Array(decoded))).toEqual(new Array(50).fill(0));
  });
});

describe("Blosc2Codec special-value chunks (synthetic)", () => {
  it("decodes a synthetic 'run of NaN' special-value chunk", async () => {
    const header = buildSpecialValueHeader({
      nbytes: 20,
      typesize: 4,
      specialValue: SPECIAL_VALUE_NAN,
    });
    const decoded = await new Blosc2Codec().decode(header);
    expect(Array.from(toFloat32Array(decoded)).every(Number.isNaN)).toBe(true);
  });

  it("decodes a synthetic 'repeated value' special-value chunk", async () => {
    const value = new Uint8Array(new Float32Array([7.5]).buffer);
    const header = buildSpecialValueHeader({
      nbytes: 20,
      typesize: 4,
      specialValue: SPECIAL_VALUE_REPEATED,
      trailingBytes: value,
    });
    const decoded = await new Blosc2Codec().decode(header);
    expect(Array.from(toFloat32Array(decoded))).toEqual(new Array(5).fill(7.5));
  });

  it("rejects unsupported blosc2 features instead of silently mis-decoding", async () => {
    const dictHeader = buildSpecialValueHeader({
      nbytes: 20,
      typesize: 4,
      specialValue: 0,
      blosc2Flags: 0x01,
    });
    await expect(new Blosc2Codec().decode(dictHeader)).rejects.toThrow(
      /dictionaries/
    );
  });
});

// Real chunks fetched from https://data.source.coop/bkr/silam-dust/data.zarr,
// and small chunks produced by python-blosc2, used to pin the decoder against
// actual encoder output rather than only against our own reading of the spec.

const MEMCPY_FIXTURE =
  "050107040400000004000000240000000000000000010500000000000000000000000000";

const MULTI_BLOCK_SHUFFLE_ZSTD_FIXTURE =
  "05018504401f0000000400006506000001000000000005000000000000000000aa000000f5020000190400003f050000400000008b020000d50100003f020000000000001900000028b52ffd6000007d0000400020406080a0c0e00100f551850b4000000028b52ffd600000b50100840280808182838485868788898a8b8c8d8e8f909192939495969798999a9b9c9d9e9f9f9f9f9f9f9f9f1f9810f0070010143f6d0552bcffffff010000000000000000000100000080004080a0c0e0001020304050607080889098a0a8b0b8c0c8d0d8e0e8f0f80004080c1014181c2024282c3034383c4044484c5054585c6064686c7074787c80828486888a8c8e90929496989a9c9ea0a2a4a6a8aaacaeb0b2b4b6b8babcbec0c2c4c6c8caccced0d2d4d6d8dadcdee0e2e4e6e8eaeceef0f2f4f6f8fafcfe000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f202122232425262728292a2b2c2d2e2f303132333435363738393a3b3c3d3e3f404142434445464748494a4b4c4d4e4f505152535455565758595a5b5c5d5e5f606162636465666768696a6b6c6d6e6f707172737475767778797a7b7c7d7e7f1b00000028b52ffd6000008d000030003f404142430410003c159eae32c10d000000001900000028b52ffd6000007d0000400020406080a0c0e00100f551850b4000000028b52ffd600000b501008402c0c0c1c2c3c4c5c6c7c8c9cacbcccdcecfd0d1d2d3d4d5d6d7d8d9dadbdcdddedfdfdfdfdfdfdfdf1f9810f0070010143f6d0552bcffffff014800000028b52ffd604002f501003402000020406080a0c0e0e1e2e3e4e5e6e7e8e9eaebecedeeeff0f1f2f3f4f5f6f7f8f9441da820bccde0d710c6b3ffff7f064ccf59cc82e22431e59201000000001900000028b52ffd6000007d0000400020406080a0c0e00100f551850b4000000028b52ffd600000b501008402a0a0a1a2a3a4a5a6a7a8a9aaabacadaeafb0b1b2b3b4b5b6b7b8b9babbbcbdbebfbfbfbfbfbfbfbf1f9810f0070010143f6d0552bcffffff01000000001300000028b52ffd6000004d00001000800100fb2887050001000080808181828283838484858586868787888889898a8a8b8b8c8c8d8d8e8e8f8f90909191929293939494959596969797989899999a9a9b9b9c9c9d9d9e9e9f9fa0a0a1a1a2a2a3a3a4a4a5a5a6a6a7a7a8a8a9a9aaaaababacacadadaeaeafafb0b0b1b1b2b2b3b3b4b4b5b5b6b6b7b7b8b8b9b9bababbbbbcbcbdbdbebebfbfc0c0c1c1c2c2c3c3c4c4c5c5c6c6c7c7c8c8c9c9cacacbcbcccccdcdcececfcfd0d0d1d1d2d2d3d3d4d4d5d5d6d6d7d7d8d8d9d9dadadbdbdcdcdddddededfdfe0e0e1e1e2e2e3e3e4e4e5e5e6e6e7e7e8e8e9e9eaeaebebececededeeeeefeff0f0f1f1f2f2f3f3f4f4f5f5f6f6f7f7f8f8f9f9fafafbfbfcfcfdfdfefeffffbdffffff01000000001500000028b52ffd6000005d000020004080c00100f929470400010000000000000101010102020202030303030404040405050505060606060707070708080808090909090a0a0a0a0b0b0b0b0c0c0c0c0d0d0d0d0e0e0e0e0f0f0f0f101010101111111112121212131313131414141415151515161616161717171718181818191919191a1a1a1a1b1b1b1b1c1c1c1c1d1d1d1d1e1e1e1e1f1f1f1f202020202121212122222222232323232424242425252525262626262727272728282828292929292a2a2a2a2b2b2b2b2c2c2c2c2d2d2d2d2e2e2e2e2f2f2f2f303030303131313132323232333333333434343435353535363636363737373738383838393939393a3a3a3a3b3b3b3b3c3c3c3c3d3d3d3d3e3e3e3e3f3f3f3fbcffffff01000000001500000028b52ffd6000005d000020004080c00100f929470400010000404040404141414142424242434343434444444445454545464646464747474748484848494949494a4a4a4a4b4b4b4b4c4c4c4c4d4d4d4d4e4e4e4e4f4f4f4f505050505151515152525252535353535454545455555555565656565757575758585858595959595a5a5a5a5b5b5b5b5c5c5c5c5d5d5d5d5e5e5e5e5f5f5f5f606060606161616162626262636363636464646465656565666666666767676768686868696969696a6a6a6a6b6b6b6b6c6c6c6c6d6d6d6d6e6e6e6e6f6f6f6f707070707171717172727272737373737474747475757575767676767777777778787878797979797a7a7a7a7b7b7b7b7c7c7c7c7d7d7d7d7e7e7e7e7f7f7f7fbcffffff01";

const TINY_BLOCK_SHUFFLE_ZSTD_FIXTURE =
  "05018504900100004000000025010000010000000000050000000000000000003c000000040100006c0000008d000000ae000000cf000000f00000000000000000000000100000000080004080a0c0e0001020304050607010000000003f40404040404041414141414141410000000000000000100000000004080c1014181c2024282c3034383cbeffffff010000000000000000100000004044484c5054585c6064686c7074787cbeffffff0100000000000000001000000080828486888a8c8e90929496989a9c9ebeffffff01000000000000000010000000a0a2a4a6a8aaacaeb0b2b4b6b8babcbebeffffff01100000000000000000000000c0c2c4c64242424200000000000000001000000080889098a0a8b0b8c0c8d0d8e0e8f0f8bfffffff01";

const NAN_FIXTURE =
  "05019508c8000000c80000004200000000000000000105000000000000000000240000001a00000028b52ffd20c88d0000200000c07f0400e10c2900f000c88a401b";

const ZERO_FIXTURE =
  "05019508c8000000c80000002000000000000000000105000000000000000010";

const SPECIAL_VALUE_NAN = 2;
const SPECIAL_VALUE_REPEATED = 3;

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i += 1) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function toFloat32Array(bytes: Uint8Array): Float32Array {
  return new Float32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);
}

// Builds a synthetic Blosc2 extended-header chunk that uses the "special
// value" encoding (no blocks section at all), per blosc/blosc-private.h's
// blosc_header_s layout: filters[6], udcompcode, compcode_meta,
// filters_meta[6], blosc2_flags2, blosc2_flags.
function buildSpecialValueHeader(options: {
  nbytes: number;
  typesize: number;
  specialValue: number;
  blosc2Flags?: number;
  trailingBytes?: Uint8Array;
}): Uint8Array {
  const trailingBytes = options.trailingBytes ?? new Uint8Array(0);
  const cbytes = 32 + trailingBytes.length;
  const bytes = new Uint8Array(cbytes);
  const view = new DataView(bytes.buffer);

  bytes[0] = 5; // version
  bytes[1] = 1; // versionlz
  bytes[2] = 0x05; // flags: shuffle(0x01) + bitshuffle(0x04) sentinel => extended header
  bytes[3] = options.typesize;
  view.setInt32(4, options.nbytes, true);
  view.setInt32(8, options.nbytes, true); // blocksize, unused for special values
  view.setInt32(12, cbytes, true);
  bytes[30] = 0; // blosc2_flags2
  bytes[31] = options.blosc2Flags ?? options.specialValue << 4;
  bytes.set(trailingBytes, 32);

  return bytes;
}
