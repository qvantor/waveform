import { BehaviorSubject } from 'rxjs';
import { Snapshotable, SnapshotValue } from '../types';
import { getSnapshotValue, isSnapshotable, snapshotToValue, isSnapshotValue } from '../plugins/snapshot';

export class ArrayBS<T> extends BehaviorSubject<Array<T>> implements Snapshotable<Array<T>> {
  readonly __snapshotable = true as const;

  getSnapshot = (): SnapshotValue<Array<unknown>> => {
    return getSnapshotValue(
      'ArrayBS',
      this.value.map((value) => (isSnapshotable(value) ? value.getSnapshot() : value))
    );
  };
  setSnapshot = (snap: SnapshotValue<Array<T>>) => {
    this.next(
      snap.value.map((value) => (isSnapshotValue(value) ? snapshotToValue(value) : value)) as Array<T>
    );
  };
}
