import { jest } from '@jest/globals';
import { rxModel } from '../../../';
import { snapshotPlugin } from '../';
import { PrimitiveBS, ArrayBS, ObjectBS } from '../../../';

const primitives = {
  null: null,
  boolean: true,
  string: 'string',
  number: 12,
};

const primitivesAlternative = {
  null: null,
  boolean: false,
  string: 'hello world',
  number: 32,
};

const primitiveBs: Record<string, PrimitiveBS<keyof typeof primitives>> = (
  Object.keys(primitives) as Array<keyof typeof primitives>
).reduce((sum, key) => ({ ...sum, [key]: new PrimitiveBS(primitives[key]) }), {});

const arrayBs = new ArrayBS<number[]>([1, 2, 3, 4]);
const arrayBsDeep = new ArrayBS<ArrayBS<ArrayBS<number[]>[]>[]>([
  new ArrayBS<ArrayBS<number[]>[]>([arrayBs, arrayBs]),
]);

const objectBs = new ObjectBS(primitives);
const objectBsDeep = new ObjectBS({
  ...primitives,
  object1: new ObjectBS({ object2: new ObjectBS({ ...primitives, arrayBs }) }),
});

const modelName = 'modelName';
const snapshotInstance = snapshotPlugin();

const snapshotWrapper = (data: Record<string, unknown>) => JSON.stringify({ [modelName]: data });

describe('snapshotPlugin', () => {
  it('getSnapshot should ignore not active model', () => {
    const modelFactory = rxModel(primitives).plugins(snapshotInstance.modelPlugin());
    expect(snapshotInstance.getSnapshot()).toBe('{}');

    const [, , { stop }] = modelFactory.init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(snapshotWrapper({}));

    stop();
    expect(snapshotInstance.getSnapshot()).toBe('{}');
  });

  it('getSnapshot should ignore primitive values', () => {
    rxModel(primitives).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(snapshotWrapper({}));
  });
  it('getSnapshot should make snapshot of PrimitiveBS values', () => {
    rxModel(primitiveBs)
      .plugins(snapshotInstance.modelPlugin(['string', 'number']))
      .init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(
      snapshotWrapper({
        string: {
          _type_: 'PrimitiveBS',
          value: primitives.string,
        },
        number: {
          _type_: 'PrimitiveBS',
          value: primitives.number,
        },
      })
    );
  });
  it('getSnapshot make snapshot of ArrayBS', () => {
    rxModel({ arrayBs }).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(
      snapshotWrapper({
        arrayBs: {
          _type_: 'ArrayBS',
          value: arrayBs.value,
        },
      })
    );
  });

  it('getSnapshot make snapshot of ArrayBS deep', () => {
    rxModel({ arrayBsDeep }).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(
      snapshotWrapper({
        arrayBsDeep: {
          _type_: 'ArrayBS',
          value: [
            {
              _type_: 'ArrayBS',
              value: [
                {
                  _type_: 'ArrayBS',
                  value: arrayBs.value,
                },
                {
                  _type_: 'ArrayBS',
                  value: arrayBs.value,
                },
              ],
            },
          ],
        },
      })
    );
  });
  it('getSnapshot make snapshot of ObjectBs', () => {
    rxModel({ objectBs }).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(
      snapshotWrapper({
        objectBs: {
          _type_: 'ObjectBS',
          value: primitives,
        },
      })
    );
  });

  it('getSnapshot make snapshot of ObjectBs deep', () => {
    rxModel({ objectBsDeep }).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    expect(snapshotInstance.getSnapshot()).toBe(
      snapshotWrapper({
        objectBsDeep: {
          _type_: 'ObjectBS',
          value: {
            ...primitives,
            object1: {
              _type_: 'ObjectBS',
              value: {
                object2: {
                  _type_: 'ObjectBS',
                  value: {
                    ...primitives,
                    arrayBs: {
                      _type_: 'ArrayBS',
                      value: arrayBs.value,
                    },
                  },
                },
              },
            },
          },
        },
      })
    );
  });

  it('loadSnapshot should load PrimitiveBS', () => {
    const stringSub = jest.fn();
    const [model] = rxModel(primitiveBs)
      .plugins(snapshotInstance.modelPlugin())
      .subscriptions(({ string }) => string.subscribe(stringSub))
      .init(modelName, {});
    expect(stringSub.mock.calls.length).toBe(1);

    const newStringValue = 'newStringValue';
    snapshotInstance.loadSnapshot(
      snapshotWrapper({
        string: {
          _type_: 'PrimitiveBS',
          value: newStringValue,
        },
      })
    );
    expect(stringSub.mock.calls.length).toBe(2);
    expect(model['string'].value).toBe(newStringValue);
  });

  it('loadSnapshot should load ArrayBS', () => {
    const arraySub = jest.fn();
    const [model] = rxModel({ arrayBs })
      .plugins(snapshotInstance.modelPlugin())
      .subscriptions(({ arrayBs }) => arrayBs.subscribe(arraySub))
      .init(modelName, {});
    expect(arraySub.mock.calls.length).toBe(1);

    const newArrayValue = [100, 99, 98];
    snapshotInstance.loadSnapshot(
      snapshotWrapper({
        arrayBs: {
          _type_: 'ArrayBS',
          value: newArrayValue,
        },
      })
    );
    expect(model.arrayBs.value).toEqual(newArrayValue);
    expect(arraySub.mock.calls.length).toBe(2);
  });
  it('loadSnapshot should load ArrayBS deep', () => {
    const arraySub = jest.fn();
    const [model] = rxModel({ arrayBsDeep })
      .subscriptions(({ arrayBsDeep }) => arrayBsDeep.subscribe(arraySub))
      .plugins(snapshotInstance.modelPlugin())
      .init(modelName, {});

    const newArrayValue = [50, 40, 30];
    expect(arraySub.mock.calls.length).toEqual(1);

    snapshotInstance.loadSnapshot(
      snapshotWrapper({
        arrayBsDeep: {
          _type_: 'ArrayBS',
          value: [
            {
              _type_: 'ArrayBS',
              value: [
                {
                  _type_: 'ArrayBS',
                  value: newArrayValue,
                },
                {
                  _type_: 'ObjectBS',
                  value: primitives,
                },
              ],
            },
          ],
        },
      })
    );

    expect(model.arrayBsDeep.value[0].value[0].value).toEqual(newArrayValue);
    expect(model.arrayBsDeep.value[0].value[1].value).toEqual(primitives);
    expect(arraySub.mock.calls.length).toEqual(2);
  });

  it('loadSnapshot should load objectBs', () => {
    const objectSub = jest.fn();
    const [model] = rxModel({ objectBs })
      .subscriptions(({ objectBs }) => objectBs.subscribe(objectSub))
      .plugins(snapshotInstance.modelPlugin())
      .init(modelName, {});
    expect(objectSub.mock.calls.length).toEqual(1);

    snapshotInstance.loadSnapshot(
      snapshotWrapper({
        objectBs: {
          _type_: 'ObjectBS',
          value: primitivesAlternative,
        },
      })
    );
    expect(model.objectBs.value).toEqual(primitivesAlternative);
    expect(objectSub.mock.calls.length).toEqual(2);
  });

  it('loadSnapshot should load objectBs deep', () => {
    const objectSub = jest.fn();
    const [model] = rxModel({ objectBsDeep })
      .subscriptions(({ objectBsDeep }) => objectBsDeep.subscribe(objectSub))
      .plugins(snapshotInstance.modelPlugin())
      .init(modelName, {});
    expect(objectSub.mock.calls.length).toEqual(1);

    const newArrayValue = [6, 5, 4, 3, 2, 1];
    snapshotInstance.loadSnapshot(
      snapshotWrapper({
        objectBsDeep: {
          _type_: 'ObjectBS',
          value: {
            ...primitivesAlternative,
            object1: {
              _type_: 'ObjectBS',
              value: {
                ...primitivesAlternative,
                object2: {
                  _type_: 'ObjectBS',
                  value: {
                    ...primitivesAlternative,
                    arrayBs: {
                      _type_: 'ArrayBS',
                      value: newArrayValue,
                    },
                  },
                },
              },
            },
          },
        },
      })
    );
    expect(objectSub.mock.calls.length).toEqual(2);
    expect(model.objectBsDeep.value.object1.value.object2.value.arrayBs.value).toEqual(newArrayValue);
    expect(model.objectBsDeep.value.object1.value.object2.value.null).toBe(primitivesAlternative.null);
    expect(model.objectBsDeep.value.object1.value.object2.value.string).toBe(primitivesAlternative.string);
    expect(model.objectBsDeep.value.object1.value.object2.value.number).toBe(primitivesAlternative.number);
    expect(model.objectBsDeep.value.object1.value.object2.value.boolean).toBe(primitivesAlternative.boolean);
  });

  it('save/load snapshot is equal', () => {
    rxModel({ objectBsDeep }).plugins(snapshotInstance.modelPlugin()).init(modelName, {});
    const snapshot1 = snapshotInstance.getSnapshot();
    snapshotInstance.loadSnapshot(snapshot1);
    const snapshot2 = snapshotInstance.getSnapshot();
    expect(snapshot1).toBe(snapshot2);
  });

  it('should ignore incorrect snapshot', () => {
    const sub = jest.fn();
    rxModel({ objectBsDeep })
      .subscriptions(({ objectBsDeep }) => objectBsDeep.subscribe(sub))
      .plugins(snapshotInstance.modelPlugin())
      .init(modelName, {});
    const snapshot1 = snapshotInstance.getSnapshot();

    snapshotInstance.loadSnapshot('[1,2,3]');
    expect(sub.mock.calls.length).toBe(1);

    snapshotInstance.loadSnapshot(snapshotWrapper({ anotherModelName: 'value' }));
    expect(sub.mock.calls.length).toBe(1);

    snapshotInstance.loadSnapshot(snapshotWrapper({ objectBsDeep: { foo: 'bar' } }));
    expect(sub.mock.calls.length).toBe(1);

    const snapshot2 = snapshotInstance.getSnapshot();
    expect(snapshot1).toBe(snapshot2);
  });

  it('setInitSnapshot should set Snapshot after model created', async () => {
    const newStringValue = 'newStringValue';
    snapshotInstance.setInitSnapshot(
      snapshotWrapper({
        string: {
          _type_: 'PrimitiveBS',
          value: newStringValue,
        },
      })
    );
    const [model] = rxModel(primitiveBs)
      .plugins(snapshotInstance.modelPlugin())
      .init(modelName, {});
    expect(model['string'].value).toBe(newStringValue);

    snapshotInstance.setInitSnapshot();
    const [model2] = rxModel({ string: new PrimitiveBS(primitives.string) }).init(modelName, {});
    expect(model2['string'].value).toBe(primitives.string);
  });
});
