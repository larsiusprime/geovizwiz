import { vi } from 'vitest';

// 1. Mock all UI-coupled modules to prevent them from executing at load time
vi.mock('./dom-refs.js', () => ({
  btnNewCivilOSDataSource: null,
  civilSetupOverlay: null,
  civilDomainInput: null,
  civilSetupError: null,
  btnCancelCivilSetup: null,
  btnConfirmCivilSetup: null
}));

vi.mock('./main.js', () => ({
  renderSettingsDataSourcesSection: vi.fn(),
  revealUI: vi.fn(),
}));

vi.mock('./layers.js', () => ({
  createLayerState: vi.fn(),
  registerLayer: vi.fn(),
}));

vi.mock('./rendering.js', () => ({
  addOrUpdateSourceForLayer: vi.fn(),
}));

vi.mock('./state.js', () => ({
  S: {
    dataStores: new Map(),
    dataStoreOrder: [],
  },
}));

// 2. Define global window/document mock APIs for OIDC / PKCE logic in Node
const mockLocation = {
  href: 'http://localhost:5173/',
};

const mockWindow = {
  location: mockLocation,
  history: {
    replaceState: vi.fn(),
  },
  crypto: {
    getRandomValues: (arr: Uint32Array) => {
      for (let i = 0; i < arr.length; i++) {
        arr[i] = Math.floor(Math.random() * 100000);
      }
      return arr;
    },
    subtle: {
      digest: async (_algo: string, _data: ArrayBuffer) => {
        return new ArrayBuffer(32);
      }
    }
  }
};

vi.stubGlobal('window', mockWindow);
vi.stubGlobal('document', {
  title: 'OpenCAMA Test',
});

// Now import the functions to test
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { normalizeDomain, getOIDCRedirectUri, fetchOIDCConfig, fetchInstanceMetadata } from './civil-integration';

describe('normalizeDomain', () => {
  it('adds https:// if no transport scheme is present', () => {
    expect(normalizeDomain('leepa.civillabs.app')).toBe('https://leepa.civillabs.app');
    expect(normalizeDomain('localhost:8080')).toBe('https://localhost:8080');
  });

  it('keeps http:// if explicitly provided', () => {
    expect(normalizeDomain('http://localhost:8080')).toBe('http://localhost:8080');
  });

  it('keeps https:// if explicitly provided', () => {
    expect(normalizeDomain('https://leepa.civillabs.app')).toBe('https://leepa.civillabs.app');
  });

  it('trims whitespace', () => {
    expect(normalizeDomain('  leepa.civillabs.app  ')).toBe('https://leepa.civillabs.app');
  });
});

describe('getOIDCRedirectUri', () => {
  beforeEach(() => {
    mockLocation.href = 'http://localhost:5173/';
  });

  it('returns current href without query params or hash', () => {
    mockLocation.href = 'http://localhost:5173/page?query=1#hash';
    expect(getOIDCRedirectUri()).toBe('http://localhost:5173/page');
  });

  it('falls back to http://localhost:5173/ if loaded from file:// scheme', () => {
    mockLocation.href = 'file:///path/to/dist/index.html';
    expect(getOIDCRedirectUri()).toBe('http://localhost:5173/');
  });
});

describe('fetchInstanceMetadata', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore window mock
    vi.stubGlobal('window', mockWindow);
  });

  it('returns parsed json on success', async () => {
    const mockResponse = { auth_issuer_url: 'https://auth.example.com' };
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 200,
      ok: true,
      json: async () => mockResponse,
    } as Response);

    const result = await fetchInstanceMetadata('https://gateway.example.com');
    expect(result).toEqual(mockResponse);
    expect(fetch).toHaveBeenCalledWith(
      'https://gateway.example.com/civil.public.instance.v1.InstanceService/GetInstanceMetadata',
      expect.objectContaining({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      })
    );
  });

  it('throws Invalid Civil OS domain on 404', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 404,
      ok: false,
    } as Response);

    await expect(fetchInstanceMetadata('https://gateway.example.com'))
      .rejects.toThrow('Invalid Civil OS domain');
  });

  it('throws issue occurred error on other failures', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      status: 500,
      ok: false,
    } as Response);

    await expect(fetchInstanceMetadata('https://gateway.example.com'))
      .rejects.toThrow('An issue with the Civil OS instance occurred');
  });

  it('throws issue occurred error on fetch error', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(fetchInstanceMetadata('https://gateway.example.com'))
      .rejects.toThrow('An issue with the Civil OS instance occurred');
  });
});

describe('fetchOIDCConfig', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    // Restore window mock
    vi.stubGlobal('window', mockWindow);
  });

  it('returns well-known openid config on success', async () => {
    const mockConfig = {
      authorization_endpoint: 'https://auth.example.com/oauth2/auth',
      token_endpoint: 'https://auth.example.com/oauth2/token',
    };
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => mockConfig,
    } as Response);

    const result = await fetchOIDCConfig('https://auth.example.com');
    expect(result).toEqual(mockConfig);
    expect(fetch).toHaveBeenCalledWith('https://auth.example.com/.well-known/openid-configuration');
  });

  it('falls back to standard Dex endpoints on fetch failure', async () => {
    vi.mocked(fetch).mockRejectedValueOnce(new TypeError('Failed to fetch'));

    const result = await fetchOIDCConfig('https://auth.example.com/');
    expect(result).toEqual({
      authorization_endpoint: 'https://auth.example.com/auth',
      token_endpoint: 'https://auth.example.com/token',
    });
  });

  it('falls back to standard Dex endpoints on non-ok status', async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: false,
      status: 404,
    } as Response);

    const result = await fetchOIDCConfig('https://auth.example.com');
    expect(result).toEqual({
      authorization_endpoint: 'https://auth.example.com/auth',
      token_endpoint: 'https://auth.example.com/token',
    });
  });
});
