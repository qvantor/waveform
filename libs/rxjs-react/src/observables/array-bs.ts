import { BehaviorSubject } from 'rxjs';
import { Snapshotable, SnapshotValue } from '../types';
import { getSnapshotValue, isSnapshotable, snapshotToValue, isSnapshotValue } from '../plugins/snapshot';

export class ArrayBS<T extends Array<unknown>> extends BehaviorSubject<T> implements Snapshotable<T> {
  readonly __snapshotable = true as const;

  getSnapshot = (): SnapshotValue<Array<unknown>> => {
    return getSnapshotValue(
      'ArrayBS',
      this.value.map((value) => (isSnapshotable(value) ? value.getSnapshot() : value))
    );
  };
  setSnapshot = (snap: SnapshotValue<T>) => {
    this.next(snap.value.map((value) => (isSnapshotValue(value) ? snapshotToValue(value) : value)) as T);
  };
}
