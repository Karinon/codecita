import { describe, expect, it } from "vitest";

import { Fletcher32Codec } from "../src/fletcher32.js";

describe("Fletcher32Codec", () => {
  it("decodes data whose trailing checksum matches", () => {
    const encoded = new Uint8Array([1, 2, 3, 4, 6, 4, 8, 5]);

    const decoded = new Fletcher32Codec().decode(encoded);

    expect(Array.from(decoded)).toEqual([1, 2, 3, 4]);
  });

  it("throws when the checksum does not match", () => {
    const corrupted = new Uint8Array([1, 2, 3, 4, 0, 0, 0, 0]);

    expect(() => new Fletcher32Codec().decode(corrupted)).toThrow(
      /checksum mismatch/
    );
  });

  it("throws when the input is too short to contain a checksum", () => {
    const tooShort = new Uint8Array([1, 2, 3]);

    expect(() => new Fletcher32Codec().decode(tooShort)).toThrow(
      /must contain data and a checksum/
    );
  });

  it("computeEncodedSize adds the checksum length", () => {
    expect(Fletcher32Codec.fromConfig().computeEncodedSize(10)).toBe(14);
  });

  it("encode throws", () => {
    expect(() => new Fletcher32Codec().encode()).toThrow(
      /encode not implemented/
    );
  });
});
