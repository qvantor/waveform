import { BehaviorSubject } from 'rxjs';
import { Snapshotable, SnapshotValue } from '../types';
import { isSnapshotable, getSnapshotValue, snapshotToValue, isSnapshotValue } from '../plugins/snapshot';

export class ObjectBS<T extends Record<any, unknown>> extends BehaviorSubject<T> implements Snapshotable<T> {
  readonly __snapshotable = true as const;

  getSnapshot = (): SnapshotValue<Record<any, unknown>> => {
    const resultObject: Record<any, unknown> = {};
    for (const key in this.value) {
      const value = this.value[key];
      resultObject[key] = isSnapshotable(value) ? value.getSnapshot() : value;
    }
    return getSnapshotValue('ObjectBS', resultObject);
  };
  setSnapshot = (value: SnapshotValue<T>) => {
    const newValue: Record<any, unknown> = {};
    for (const key in value.value) {
      const valueItem = value.value[key];
      newValue[key] = isSnapshotValue(valueItem) ? snapshotToValue(valueItem) : value.value[key];
    }
    this.next(newValue as T);
  };
}
