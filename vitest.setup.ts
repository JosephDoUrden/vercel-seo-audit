// Polyfill File global for Node 18 (File became a global in Node 20)
// Required because undici (used by vitest) references File at import time
if (typeof globalThis.File === 'undefined') {
  // @ts-expect-error — minimal polyfill for test compatibility
  globalThis.File = class File extends Blob {
    name: string;
    lastModified: number;
    constructor(bits: BlobPart[], name: string, options?: FilePropertyBag) {
      super(bits, options);
      this.name = name;
      this.lastModified = options?.lastModified ?? Date.now();
    }
  };
}
