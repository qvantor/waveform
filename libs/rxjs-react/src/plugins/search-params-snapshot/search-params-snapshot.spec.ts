import { rxModel } from '../../services';
import { PrimitiveBS } from '../../observables';
import { searchParamsSnapshotPlugin } from './';

const createModel = (plugin: ReturnType<typeof searchParamsSnapshotPlugin>['plugin']) =>
  rxModel(() => ({ $value: new PrimitiveBS<number>(1), $flag: new PrimitiveBS<boolean>(true) })).plugins(
    plugin({
      modelToSnap: ({ $value, $flag }) => ({ v: $value.value, f: $flag.value }),
      applySnap: (snap, { $value, $flag }) => {
        snap.v !== undefined && $value.next(snap.v);
        snap.f !== undefined && $flag.next(snap.f);
      },
    })
  );

describe('searchParamsSnapshotPlugin', () => {
  it('returns and applies snapshot at runtime', () => {
    const { plugin, getSnapshot, applySnapshot } = searchParamsSnapshotPlugin();
    const [model] = createModel(plugin).init('model', undefined);
    expect(getSnapshot()).toEqual({ model: { v: 1, f: true } });
    applySnapshot({ model: { v: 0, f: false } });
    expect(model.$value.value).toBe(0);
    expect(model.$flag.value).toBe(false);
    expect(getSnapshot()).toEqual({ model: { v: 0, f: false } });
  });

  it('emits changes only after init and stops after model stop', () => {
    const { plugin, $changes, getSnapshot } = searchParamsSnapshotPlugin();
    const changes: string[] = [];
    $changes.subscribe((name) => changes.push(name));
    const [model, , { stop }] = createModel(plugin).init('model', undefined);
    expect(changes).toEqual([]);
    model.$value.next(5);
    expect(changes).toEqual(['model']);
    stop();
    model.$value.next(6);
    expect(changes).toEqual(['model']);
    expect(getSnapshot()).toEqual({});
  });
});
