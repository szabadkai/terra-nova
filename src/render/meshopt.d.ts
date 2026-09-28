// The parts of meshoptimizer's simplifier (bundled with three) that lod.ts uses.
declare module 'three/examples/jsm/libs/meshopt_simplifier.module.js' {
  type Indices = Uint32Array | Int32Array | Uint16Array | Int16Array;
  export const MeshoptSimplifier: {
    ready: Promise<void>;
    supported: boolean;
    getScale(positions: Float32Array, stride: number): number;
    simplify(indices: Indices, positions: Float32Array, stride: number, targetIndexCount: number, targetError: number, flags?: string[]): [Uint32Array, number];
    simplifySloppy(indices: Indices, positions: Float32Array, stride: number, lock: Uint8Array | null, targetIndexCount: number, targetError: number): [Uint32Array, number];
  };
}
