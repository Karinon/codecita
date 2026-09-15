import { registry } from "zarrita";

// Blosc2 chunks share Blosc1's 16-byte chunk header (version, flags, typesize,
// nbytes, blocksize, cbytes) and, when unextended, its block layout too. This
// codec rewrites a Blosc2 chunk into a plain Blosc1 chunk and delegates the
// actual block/stream decompression to zarrita's existing "blosc" codec,
// rather than re-implementing shuffle/bitshuffle/delta and the blosclz/lz4/
// zlib/zstd backends.
// Format reference: https://github.com/Blosc/c-blosc2/blob/main/README_CHUNK_FORMAT.rst

const BASE_HEADER_LENGTH = 16;
const EXTENDED_HEADER_LENGTH = 32;
const BLOSC1_VERSION_FORMAT = 2;
// The Blosc1 decoder we delegate to only splits a block into per-typesize
// streams when typesize <= MAX_SPLITS and blocksize/typesize >= MIN_BUFFERSIZE
// (see c-blosc's blosc.c). A Blosc2 encoder isn't bound by that floor, so a
// chunk with tiny blocks relative to its typesize can't be safely delegated.
const BLOSC1_MAX_SPLITS = 16;
const BLOSC1_MIN_BUFFERSIZE = 128;

const BaseFlag = {
  SHUFFLE: 0x01,
  MEMCPY: 0x02,
  BITSHUFFLE: 0x04,
  DELTA: 0x08,
  DONT_SPLIT: 0x10,
  COMPRESSOR_ENUM: 0xe0,
} as const;

const Blosc2Flag = {
  DICT: 0x01,
  EXTENDED_HEADER2: 0x02,
  LAZY: 0x08,
} as const;

const Blosc2Flag2 = {
  VARIABLE_LENGTH_BLOCKS: 0x01,
} as const;

const FilterId = {
  NONE: 0,
  SHUFFLE: 1,
  BITSHUFFLE: 2,
  DELTA: 3,
} as const;
type TFilterId = (typeof FilterId)[keyof typeof FilterId];

const SpecialValue = {
  NONE: 0,
  ZERO: 1,
  NAN: 2,
  VALUE: 3,
  UNINITIALIZED: 4,
} as const;
type TSpecialValue = (typeof SpecialValue)[keyof typeof SpecialValue];

type TBlosc2Header = {
  flags: number;
  typesize: number;
  nbytes: number;
  blocksize: number;
  cbytes: number;
  isMemcpy: boolean;
  hasExtendedHeader: boolean;
  headerLength: number;
  filters: number[];
  blosc2Flags: number;
  blosc2Flags2: number;
};

type TBlosc1Codec = { decode(data: Uint8Array): unknown };

let blosc1CodecPromise: Promise<TBlosc1Codec | undefined> | undefined;

function getBlosc1Codec() {
  if (!blosc1CodecPromise) {
    blosc1CodecPromise = registry
      .get("blosc")?.()
      .then((entry) => entry.fromConfig({}, undefined as never)) as Promise<
      TBlosc1Codec | undefined
    >;
  }
  return blosc1CodecPromise;
}

export class Blosc2Codec {
  readonly kind = "bytes_to_bytes";

  static fromConfig() {
    return new Blosc2Codec();
  }

  encode(): never {
    throw new Error("encode not implemented");
  }

  async decode(bytes: Uint8Array): Promise<Uint8Array> {
    const header = parseHeader(bytes);

    if (header.hasExtendedHeader) {
      const specialValue = ((header.blosc2Flags >> 4) & 0x07) as TSpecialValue;
      if (specialValue !== SpecialValue.NONE) {
        return buildSpecialValueOutput(specialValue, bytes, header);
      }
      assertSupportedExtendedFlags(header.blosc2Flags, header.blosc2Flags2);
    }

    if (header.isMemcpy) {
      return bytes.slice(
        header.headerLength,
        header.headerLength + header.nbytes
      );
    }

    const blosc1Codec = await getBlosc1Codec();
    if (!blosc1Codec) {
      throw new Error("blosc2 codec: could not load the blosc1 backend");
    }
    return (await blosc1Codec.decode(
      reframeAsBlosc1(bytes, header)
    )) as Uint8Array;
  }
}

function parseHeader(bytes: Uint8Array): TBlosc2Header {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const flags = bytes[2];
  const hasExtendedHeader =
    (flags & BaseFlag.SHUFFLE) !== 0 && (flags & BaseFlag.BITSHUFFLE) !== 0;
  const headerLength = hasExtendedHeader
    ? EXTENDED_HEADER_LENGTH
    : BASE_HEADER_LENGTH;

  return {
    flags,
    typesize: bytes[3],
    nbytes: view.getInt32(4, true),
    blocksize: view.getInt32(8, true),
    cbytes: view.getInt32(12, true),
    isMemcpy: (flags & BaseFlag.MEMCPY) !== 0,
    hasExtendedHeader,
    headerLength,
    filters: hasExtendedHeader ? Array.from(bytes.subarray(16, 22)) : [],
    // Struct layout is filters[6], udcompcode, compcode_meta, filters_meta[6],
    // blosc2_flags2, blosc2_flags (in that order) - see blosc/blosc-private.h.
    blosc2Flags: hasExtendedHeader ? bytes[31] : 0,
    blosc2Flags2: hasExtendedHeader ? bytes[30] : 0,
  };
}

function assertSupportedExtendedFlags(
  blosc2Flags: number,
  blosc2Flags2: number
): void {
  if ((blosc2Flags & Blosc2Flag.DICT) !== 0) {
    throw new Error("blosc2 codec: dictionaries are not supported");
  }
  if ((blosc2Flags & Blosc2Flag.EXTENDED_HEADER2) !== 0) {
    throw new Error("blosc2 codec: extended header v2 is not supported");
  }
  if ((blosc2Flags & Blosc2Flag.LAZY) !== 0) {
    throw new Error("blosc2 codec: lazy chunks are not supported");
  }
  if ((blosc2Flags2 & Blosc2Flag2.VARIABLE_LENGTH_BLOCKS) !== 0) {
    throw new Error("blosc2 codec: variable-length blocks are not supported");
  }
}

function filterFlagsFromPipeline(filters: number[]): number {
  let blosc1Flags = 0;
  let shuffleLikeCount = 0;
  for (const filter of filters) {
    switch (filter as TFilterId) {
      case FilterId.NONE:
        break;
      case FilterId.SHUFFLE:
        blosc1Flags |= BaseFlag.SHUFFLE;
        shuffleLikeCount += 1;
        break;
      case FilterId.BITSHUFFLE:
        blosc1Flags |= BaseFlag.BITSHUFFLE;
        shuffleLikeCount += 1;
        break;
      case FilterId.DELTA:
        blosc1Flags |= BaseFlag.DELTA;
        break;
      default:
        throw new Error(`blosc2 codec: unsupported filter id ${filter}`);
    }
  }
  if (shuffleLikeCount > 1) {
    throw new Error(
      "blosc2 codec: unsupported filter pipeline combining shuffle and bitshuffle"
    );
  }
  return blosc1Flags;
}

// Rebuilds the chunk with a plain 16-byte Blosc1 header and delegates the
// actual decompression to zarrita's existing "blosc" codec. The per-stream
// "run of zeros" (csize == 0) and "run of a repeated byte" (csize < 0)
// encodings are Blosc2-only additions that classic Blosc1 decoders reject or
// mis-decode, so those streams are expanded into literal-copy streams here;
// every other stream is forwarded verbatim, since its format is identical
// between Blosc1 and Blosc2.
function reframeAsBlosc1(bytes: Uint8Array, header: TBlosc2Header): Uint8Array {
  const { nbytes, blocksize } = header;
  let blosc1Flags =
    header.flags & (BaseFlag.COMPRESSOR_ENUM | BaseFlag.DONT_SPLIT);
  blosc1Flags |= header.hasExtendedHeader
    ? filterFlagsFromPipeline(header.filters)
    : header.flags & (BaseFlag.SHUFFLE | BaseFlag.BITSHUFFLE | BaseFlag.DELTA);

  const nblocks = Math.ceil(nbytes / blocksize);
  const bstartsLength = nblocks * 4;
  const { newBstarts, streams } = collectBlosc1Streams(bytes, header, nblocks);
  const blocksLength = streams.reduce((sum, s) => sum + s.byteLength, 0);

  const out = new Uint8Array(BASE_HEADER_LENGTH + bstartsLength + blocksLength);
  const outView = new DataView(out.buffer);
  out.set(bytes.subarray(0, BASE_HEADER_LENGTH), 0);
  out[0] = BLOSC1_VERSION_FORMAT;
  out[2] = blosc1Flags;
  outView.setInt32(12, out.byteLength, true);
  for (let i = 0; i < nblocks; i += 1) {
    outView.setInt32(BASE_HEADER_LENGTH + i * 4, newBstarts[i], true);
  }
  let destPos = BASE_HEADER_LENGTH + bstartsLength;
  for (const stream of streams) {
    out.set(stream, destPos);
    destPos += stream.byteLength;
  }
  return out;
}

// Walks every block's compressed streams, expanding Blosc2-only "run of
// zeros"/"run of a repeated byte" streams into literal-copy streams that a
// Blosc1 decoder understands, and records where each block will start in the
// rebuilt (16-byte-header) chunk. Blocks are visited in file-position order
// (their bstart values), not index order: a multi-threaded Blosc2 encoder can
// write blocks out of order, so index order isn't guaranteed to line up with
// where each block's streams actually start.
function collectBlosc1Streams(
  bytes: Uint8Array,
  header: TBlosc2Header,
  nblocks: number
): { newBstarts: number[]; streams: Uint8Array[] } {
  const { headerLength, nbytes, blocksize, typesize } = header;
  const dontSplit = (header.flags & BaseFlag.DONT_SPLIT) !== 0;
  const srcView = new DataView(
    bytes.buffer,
    bytes.byteOffset,
    bytes.byteLength
  );

  const originalBstarts = Array.from({ length: nblocks }, (_, i) =>
    srcView.getInt32(headerLength + i * 4, true)
  );
  const order = originalBstarts
    .map((_, i) => i)
    .sort((a, b) => originalBstarts[a] - originalBstarts[b]);

  const newBstarts: number[] = new Array(nblocks);
  const streams: Uint8Array[] = [];
  let cumulative = BASE_HEADER_LENGTH + nblocks * 4;

  for (const block of order) {
    const isLeftover = block === nblocks - 1 && nbytes % blocksize !== 0;
    const blockSize = isLeftover
      ? nbytes - blocksize * (nblocks - 1)
      : blocksize;
    const nstreams = !dontSplit && !isLeftover ? typesize : 1;
    assertSplittable(nstreams, typesize, blockSize);

    newBstarts[block] = cumulative;
    let pos = originalBstarts[block];
    for (let stream = 0; stream < nstreams; stream += 1) {
      const { stream: out, nextPos } = readBlosc1Stream(
        bytes,
        srcView,
        pos,
        blockSize / nstreams
      );
      pos = nextPos;
      streams.push(out);
      cumulative += out.byteLength;
    }
  }
  return { newBstarts, streams };
}

function assertSplittable(
  nstreams: number,
  typesize: number,
  blockSize: number
): void {
  if (
    nstreams > 1 &&
    (typesize > BLOSC1_MAX_SPLITS ||
      blockSize / typesize < BLOSC1_MIN_BUFFERSIZE)
  ) {
    throw new Error(
      "blosc2 codec: block too small to delegate to the blosc1 decoder"
    );
  }
}

// Reads one compressed stream at `pos`, expanding the Blosc2-only "run of
// zeros"/"run of a repeated byte" encodings into literal-copy streams that a
// Blosc1 decoder understands. Every other stream is forwarded verbatim,
// since its format is identical between Blosc1 and Blosc2.
function readBlosc1Stream(
  bytes: Uint8Array,
  srcView: DataView,
  pos: number,
  neblock: number
): { stream: Uint8Array; nextPos: number } {
  const csize = srcView.getInt32(pos, true);
  const dataPos = pos + 4;
  if (csize === 0) {
    return { stream: literalStream(neblock, 0), nextPos: dataPos };
  }
  if (csize < 0) {
    const token = bytes[dataPos];
    if ((token & 0x01) === 0) {
      throw new Error(`blosc2 codec: unsupported run-length token ${token}`);
    }
    return {
      stream: literalStream(neblock, -csize & 0xff),
      nextPos: dataPos + 1,
    };
  }
  const length = csize === neblock ? neblock : csize;
  return {
    stream: bytes.subarray(pos, dataPos + length),
    nextPos: dataPos + length,
  };
}

// A stream's "csize == neblock" case means: no compression header, the
// `neblock` raw bytes follow directly. Used here to materialize the Blosc2
// "run of zeros"/"run of a repeated byte" encodings as plain literal data.
function literalStream(neblock: number, fillValue: number): Uint8Array {
  const stream = new Uint8Array(4 + neblock);
  new DataView(stream.buffer).setInt32(0, neblock, true);
  stream.fill(fillValue, 4);
  return stream;
}

function buildSpecialValueOutput(
  specialValue: TSpecialValue,
  bytes: Uint8Array,
  header: TBlosc2Header
): Uint8Array {
  const { nbytes, typesize, headerLength } = header;
  const out = new Uint8Array(nbytes);
  switch (specialValue) {
    case SpecialValue.ZERO:
    case SpecialValue.UNINITIALIZED:
      return out;
    case SpecialValue.NAN: {
      const view = new DataView(out.buffer);
      if (typesize === 4) {
        for (let offset = 0; offset < nbytes; offset += 4) {
          view.setFloat32(offset, NaN, true);
        }
      } else if (typesize === 8) {
        for (let offset = 0; offset < nbytes; offset += 8) {
          view.setFloat64(offset, NaN, true);
        }
      } else {
        throw new Error(
          `blosc2 codec: unsupported typesize ${typesize} for NaN special value`
        );
      }
      return out;
    }
    case SpecialValue.VALUE: {
      const value = bytes.subarray(headerLength, headerLength + typesize);
      for (let offset = 0; offset < nbytes; offset += typesize) {
        out.set(value, offset);
      }
      return out;
    }
    default:
      throw new Error(
        `blosc2 codec: unsupported special value type ${specialValue}`
      );
  }
}
