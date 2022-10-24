import { BehaviorSubject } from 'rxjs';
import { Snapshotable, SnapshotValue } from '../types';
import { getSnapshotValue, snapshotToValue } from '../plugins/snapshot';

export class PrimitiveBS<T extends string | boolean | number | null | undefined>
  extends BehaviorSubject<T>
  implements Snapshotable<T>
{
  readonly __snapshotable = true as const;
  getSnapshot = (): SnapshotValue<T> => {
    return getSnapshotValue('PrimitiveBS', this.value);
  };
  setSnapshot = (value: SnapshotValue<T>) => {
    this.next(snapshotToValue(value));
  };
}
