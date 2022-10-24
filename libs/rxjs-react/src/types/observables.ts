export type SnapshotType = 'PrimitiveBS' | 'ArrayBS' | 'ObjectBS';
export type SnapshotValue<V> = { _type_: SnapshotType; value: V };

export interface Snapshotable<T = unknown> {
  readonly __snapshotable: true;
  getSnapshot: () => unknown;
  setSnapshot: (value: SnapshotValue<T>) => void;
}
