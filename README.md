# codecita

Zarrita-compatible codec implementations shared across projects:

- `Blosc2Codec` — `blosc2` / `numcodecs.blosc2` bytes-to-bytes codec, decoding
  Blosc2 chunks by reframing them as Blosc1 and delegating to zarrita's
  built-in `blosc` codec
- `Fletcher32Codec` — `numcodecs.fletcher32` checksum codec
- `GribscanRawGribCodec` — `numcodecs.gribscan.rawgrib` raw GRIB1/GRIB2 decoder
- `LogBinsCodec` — `numcodecs.log_bins` array-to-array quantization codec

Only decoding is implemented; `encode()` throws for every codec.

## Usage

Register the codecs on a zarrita registry the same way you would any other
codec:

```ts
import { registry } from "zarrita";
import {
  Blosc2Codec,
  Fletcher32Codec,
  GribscanRawGribCodec,
  LogBinsCodec,
} from "codecita";

registry.set("blosc2", async () => Blosc2Codec);
registry.set("numcodecs.blosc2", async () => Blosc2Codec);
registry.set("numcodecs.fletcher32", async () => Fletcher32Codec);
registry.set("numcodecs.gribscan.rawgrib", async () => GribscanRawGribCodec);
registry.set("numcodecs.log_bins", async () => LogBinsCodec);
```

## Development

### Scripts

- `npm run build` — compiles `src` to `dist`
- `npm test` — runs the vitest suite against `src`
- `npm run lint` / `npm run lint:fix` — eslint
- `npm run format` / `npm run format:check` — prettier
- `npm run typecheck` — `tsc --noEmit`

## Credits

- `Blosc2Codec` reframes chunks per the
  [Blosc2 chunk format](https://github.com/Blosc/c-blosc2/blob/main/README_CHUNK_FORMAT.rst)
  documented by the [Blosc development team](https://github.com/Blosc).
- `LogBinsCodec` is a TypeScript port of the `log_bins` codec from the
  [Chalmers Cloud Ice Climatology (CCIC)](https://github.com/SEE-GEO/ccic)
  project.
- `GribscanRawGribCodec` reimplements the raw GRIB1/GRIB2 decoding used by
  [gribscan/gribscan](https://github.com/gribscan/gribscan).

## Disclaimer

All codec implementations are mostly vibe coded.
