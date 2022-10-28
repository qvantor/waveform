import { isRecord } from '../../utils';
import { Snapshotable, SnapshotType, SnapshotValue } from '../../types';
import { ArrayBS, ObjectBS } from '../../observables';

export const isSnapshotable = (value: unknown): value is Snapshotable =>
  isRecord(value) && '__snapshotable' in value;

export const getSnapshotValue = <T>(type: SnapshotType, value: T): SnapshotValue<T> => ({
  _type_: type,
  value,
});
export const isSnapshotValue = (value: unknown): value is SnapshotValue<unknown> =>
  isRecord(value) && '_type_' in value;

export const snapshotToValue = (value: SnapshotValue<any>): any => {
  switch (value._type_) {
    case 'PrimitiveBS':
      return value.value;
    case 'ArrayBS':
      return new ArrayBS(
        value.value.map((value: unknown) => (isSnapshotValue(value) ? snapshotToValue(value) : value))
      );
    case 'ObjectBS':
      return new ObjectBS(
        Object.keys(value.value).reduce((sum, key) => {
          const result = value.value[key];
          return { ...sum, [key]: isSnapshotValue(result) ? snapshotToValue(result) : result };
        }, {})
      );
  }
};
