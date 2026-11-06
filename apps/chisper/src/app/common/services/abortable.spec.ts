import { firstValueFrom, lastValueFrom, retry, toArray } from 'rxjs';
import { abortable } from './abortable';

const flush = () => new Promise((resolve) => setTimeout(resolve));

describe('abortable', () => {
  it('gives the value of the load and completes, its signal not aborted', async () => {
    let signal: AbortSignal | undefined;
    const values = lastValueFrom(
      abortable((given) => {
        signal = given;
        return Promise.resolve('table');
      }).pipe(toArray())
    );
    await expect(values).resolves.toEqual(['table']);
    expect(signal?.aborted).toBe(false);
  });

  it('fails with the error of the load, a throw of its start too', async () => {
    await expect(firstValueFrom(abortable(() => Promise.reject(new Error('404'))))).rejects.toThrow('404');
    await expect(
      firstValueFrom(
        abortable(() => {
          throw new Error('thrown');
        })
      )
    ).rejects.toThrow('thrown');
  });

  it('aborts the load unsubscribed before it settles and gives nothing of it', async () => {
    let signal: AbortSignal | undefined;
    let resolve!: (value: string) => void;
    const next = jest.fn();
    const subscription = abortable((given) => {
      signal = given;
      return new Promise<string>((done) => (resolve = done));
    }).subscribe(next);

    expect(signal?.aborted).toBe(false);
    subscription.unsubscribe();
    expect(signal?.aborted).toBe(true);
    resolve('table');
    await flush();
    expect(next).not.toHaveBeenCalled();
  });

  it('starts the load again for every subscription (a retry), each with a signal of its own', async () => {
    const signals: AbortSignal[] = [];
    const start = jest.fn((signal: AbortSignal) => {
      signals.push(signal);
      return signals.length < 3 ? Promise.reject(new Error('404')) : Promise.resolve('table');
    });
    await expect(firstValueFrom(abortable(start).pipe(retry(2)))).resolves.toBe('table');
    expect(start).toHaveBeenCalledTimes(3);
    expect(new Set(signals).size).toBe(3);
    expect(signals.some(({ aborted }) => aborted)).toBe(false);
  });
});
