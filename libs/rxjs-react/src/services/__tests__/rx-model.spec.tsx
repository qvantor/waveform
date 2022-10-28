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
});
