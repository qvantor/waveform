import {
  dspMode,
  isWasmModule,
  isWasmSimdSupported,
  WASM_DEFAULT,
  WASM_MODULES,
  workletBundle,
} from './dsp-mode';

const setSearch = (search: string) => window.history.replaceState(null, '', `/${search}`);

describe('dspMode', () => {
  afterEach(() => {
    setSearch('');
    window.localStorage.clear();
  });

  it('loads the wasm core of the modules that passed their gate by default', () => {
    expect(dspMode()).toBeNull();
    WASM_DEFAULT.forEach((name) => {
      expect(WASM_MODULES).toContain(name);
      expect(workletBundle(name)).toBe(`${name}.wasm`);
    });
  });

  it('a module without a wasm core loads its bundle', () => {
    expect(isWasmModule('probe')).toBe(false);
    expect(workletBundle('probe')).toBe('probe');
    setSearch('?dsp=wasm');
    expect(workletBundle('probe')).toBe('probe');
  });

  it('?dsp=js loads the TS cores (a rollback without a build), so does localStorage.dsp', () => {
    setSearch('?dsp=js');
    expect(dspMode()).toBe('js');
    WASM_MODULES.forEach((name) => expect(workletBundle(name)).toBe(name));
    setSearch('');
    window.localStorage.setItem('dsp', 'js');
    WASM_MODULES.forEach((name) => expect(workletBundle(name)).toBe(name));
  });

  it('the url wins over the storage, an unknown value is the default', () => {
    window.localStorage.setItem('dsp', 'js');
    setSearch('?dsp=wasm');
    expect(dspMode()).toBe('wasm');
    WASM_MODULES.forEach((name) => expect(workletBundle(name)).toBe(`${name}.wasm`));
    setSearch('?dsp=fast');
    window.localStorage.clear();
    expect(dspMode()).toBeNull();
  });

  it('a storage that throws is the default', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(dspMode()).toBeNull();
    getItem.mockRestore();
  });
});

describe('isWasmSimdSupported', () => {
  it('validates a module of SIMD instructions', () => {
    expect(isWasmSimdSupported()).toBe(true);
    const validate = jest.spyOn(WebAssembly, 'validate').mockReturnValue(false);
    expect(isWasmSimdSupported()).toBe(false);
    validate.mockRestore();
  });
});
