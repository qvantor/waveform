import { BehaviorSubject } from 'rxjs';
import { isSnapshotable, isSnapshotValue, snapshotToValue } from '../plugins/snapshot';
import { ArrayBS, ObjectBS, PrimitiveBS } from './index';

describe('snapshotable BehaviorSubjects', () => {
  it('are BehaviorSubjects marked as snapshotable', () => {
    [new PrimitiveBS(1), new ArrayBS([1]), new ObjectBS({ a: 1 })].forEach((subject) => {
      expect(subject).toBeInstanceOf(BehaviorSubject);
      expect(isSnapshotable(subject)).toBe(true);
    });
    expect(isSnapshotable(new BehaviorSubject(1))).toBe(false);
  });

  it('PrimitiveBS snapshots and restores its value', () => {
    const subject = new PrimitiveBS<number | null>(5);
    const snapshot = subject.getSnapshot();
    expect(snapshot).toEqual({ _type_: 'PrimitiveBS', value: 5 });
    expect(isSnapshotValue(snapshot)).toBe(true);

    subject.next(null);
    subject.setSnapshot(snapshot);
    expect(subject.value).toBe(5);
  });

  it('ArrayBS snapshots nested subjects and restores them as new subjects', () => {
    const subject = new ArrayBS([new ArrayBS([1, 2]), new ArrayBS([3])]);
    const snapshot = subject.getSnapshot();
    expect(snapshot).toEqual({
      _type_: 'ArrayBS',
      value: [
        { _type_: 'ArrayBS', value: [1, 2] },
        { _type_: 'ArrayBS', value: [3] },
      ],
    });

    const restored = new ArrayBS<ArrayBS<number[]>[]>([]);
    restored.setSnapshot(snapshot as never);
    expect(restored.value).toHaveLength(2);
    expect(restored.value[0]).toBeInstanceOf(ArrayBS);
    expect(restored.value[0]).not.toBe(subject.value[0]);
    expect(restored.value.map((item) => item.value)).toEqual([[1, 2], [3]]);
  });

  it('ObjectBS snapshots plain and nested values', () => {
    const subject = new ObjectBS({ gain: 0.5, env: new ObjectBS({ attack: 1 }) });
    const snapshot = subject.getSnapshot();
    expect(snapshot).toEqual({
      _type_: 'ObjectBS',
      value: { gain: 0.5, env: { _type_: 'ObjectBS', value: { attack: 1 } } },
    });

    subject.setSnapshot({
      _type_: 'ObjectBS',
      value: { gain: 1, env: { _type_: 'ObjectBS', value: { attack: 2 } } },
    } as never);
    expect(subject.value.gain).toBe(1);
    expect(subject.value.env).toBeInstanceOf(ObjectBS);
    expect(subject.value.env.value).toEqual({ attack: 2 });
  });

  it('snapshotToValue builds subjects of the snapshot type', () => {
    expect(snapshotToValue({ _type_: 'PrimitiveBS', value: 'x' })).toBe('x');
    expect(snapshotToValue({ _type_: 'ArrayBS', value: [1] })).toBeInstanceOf(ArrayBS);
    expect(snapshotToValue({ _type_: 'ObjectBS', value: { a: 1 } }).value).toEqual({ a: 1 });
  });
});
