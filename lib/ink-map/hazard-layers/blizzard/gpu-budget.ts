import type * as THREE from "three";

// Every byte of GPU memory the blizzard asks for, counted before any of it is uploaded. On a Mac the
// GPU's memory is the machine's RAM, so a layer that would need more than its share refuses to build
// and the hatched stand-in draws instead.

export const MOST_GPU_BYTES = 128 * 1024 ** 2;

export function geometryBytes(geometry: THREE.BufferGeometry) {
  const attributes = Object.values(geometry.attributes).reduce((sum, attribute) => sum + (attribute.array as ArrayLike<number> & { byteLength: number }).byteLength, 0);
  return attributes + (geometry.index ? (geometry.index.array as ArrayLike<number> & { byteLength: number }).byteLength : 0);
}

export class GpuBudget {
  private items: { label: string; bytes: number }[] = [];

  add(label: string, bytes: number) {
    this.items.push({ label, bytes });
    return this;
  }

  get total() {
    return this.items.reduce((sum, item) => sum + item.bytes, 0);
  }

  describe() {
    return this.items.map((item) => `${item.label} ${(item.bytes / 1024 ** 2).toFixed(2)} MB`).join(", ");
  }

  assertWithin(most = MOST_GPU_BYTES) {
    if (this.total > most) throw new Error(`Blizzard would need ${(this.total / 1024 ** 2).toFixed(0)} MB of GPU memory (${this.describe()})`);
  }
}
