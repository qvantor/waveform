import { jest } from '@jest/globals';
import { BehaviorSubject } from 'rxjs';
import { rxModel } from '../rx-model';

const simpleData = { value: 1, string: 'string', object: { value: 1, string: 'string' } };
const rxjsData = { $array: new BehaviorSubject([1, 2, 3]), $object: new BehaviorSubject(simpleData) };

describe('RxModel', () => {
  it('should return RxModelFactory', () => {
    const model = rxModel(simpleData);
    expect(typeof model.init).toBe('function');
    expect(typeof model.actions).toBe('function');
    expect(typeof model.subscriptions).toBe('function');
    expect(typeof model.plugins).toBe('function');
  });
  it('should init with a initial params', () => {
    const [model] = rxModel((value: number) => ({
      ...simpleData,
      value,
    })).init('name', 32);
    expect(model).toEqual({ ...simpleData, value: 32 });
  });
  it('should pass a model', () => {
    const model = rxModel(simpleData);
    const [modelData] = model.init('name', {});
    expect(modelData).toEqual(simpleData);
  });
  it('should attach an actions', () => {
    const fn = jest.fn();
    const [, actions] = rxModel(simpleData)
      .actions(({ value }) => ({
        fn,
        returnValue: () => value,
      }))
      .init('name', {});
    expect(actions.fn).toEqual(fn);
    expect(fn.mock.calls.length).toEqual(0);

    actions.fn();
    expect(fn.mock.calls.length).toEqual(1);

    expect(actions.returnValue()).toEqual(simpleData.value);
  });

  it('should attach and stop rx subscriptions', () => {
    const modelFactory = rxModel(rxjsData).subscriptions(({ $array }) => $array.subscribe());
    expect(rxjsData.$array.observed).toBeFalsy();

    const [, , { stop }] = modelFactory.init('name', {});
    expect(rxjsData.$array.observed).toBeTruthy();

    stop();
    expect(rxjsData.$array.observed).toBeFalsy();
  });

  it('should attach plugins', () => {
    const onInit = jest.fn();
    const onStop = jest.fn();
    const modelFactory = rxModel(simpleData).plugins({
      onInit,
      onStop,
    });
    expect(onInit.mock.calls.length).toBe(0);
    expect(onStop.mock.calls.length).toBe(0);

    const [, , { stop }] = modelFactory.init('name', {});
    expect(onInit.mock.calls[0]).toEqual([simpleData, { active: true, name: 'name' }]);
    expect(onInit.mock.calls.length).toBe(1);

    stop();
    expect(onStop.mock.calls[0]).toEqual([simpleData, { active: false, name: 'name' }]);
    expect(onStop.mock.calls.length).toBe(1);
  });

  it('runs destroy before unsubscribing and plugins onStop', () => {
    const calls: string[] = [];
    const $value = new BehaviorSubject(1);
    const [, , { stop }] = rxModel({ $value })
      .subscriptions(({ $value }) => $value.subscribe())
      .destroy(({ $value }) => calls.push(`destroy:${$value.observed}`))
      .plugins({ onStop: () => calls.push(`plugin:${$value.observed}`) })
      .init('name', {});

    stop();
    expect(calls).toEqual(['destroy:true', 'plugin:false']);
  });

  it('merges actions from several builders and passes them to subscriptions', () => {
    const subscription = jest.fn((_model: unknown, actions: { a: () => number; b: () => number }) =>
      new BehaviorSubject(actions.a() + actions.b()).subscribe()
    );
    const [, actions] = rxModel(simpleData)
      .actions(() => ({ a: () => 1 }))
      .actions(() => ({ b: () => 2 }))
      .subscriptions(subscription)
      .init('name', {});

    expect(actions.a() + actions.b()).toBe(3);
    expect(subscription).toHaveBeenCalledWith(simpleData, actions);
  });

  it('does not mutate the factory it was built from', () => {
    const base = rxModel(simpleData);
    base.actions(() => ({ extra: () => 1 }));
    const [, actions] = base.init('name', {});
    expect(actions).toEqual({});
  });
});
