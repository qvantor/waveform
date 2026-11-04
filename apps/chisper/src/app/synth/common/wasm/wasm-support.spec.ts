import { isWasmSimdSupported } from './wasm-support';

describe('isWasmSimdSupported', () => {
  it('validates a module of SIMD instructions', () => {
    expect(isWasmSimdSupported()).toBe(true);
    const validate = jest.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    expect(isWasmSimdSupported()).toBe(false);
    validate.mockRestore();
  });
});
