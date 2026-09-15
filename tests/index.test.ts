import { describe, expect, it } from "vitest";

import {
  Blosc2Codec,
  Fletcher32Codec,
  GribscanRawGribCodec,
  LogBinsCodec,
} from "../src/index.js";

describe("package entry point", () => {
  it("exports all four codecs", () => {
    expect(Blosc2Codec).toBeTypeOf("function");
    expect(Fletcher32Codec).toBeTypeOf("function");
    expect(GribscanRawGribCodec).toBeTypeOf("function");
    expect(LogBinsCodec).toBeTypeOf("function");
  });
});
