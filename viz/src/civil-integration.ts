import { S } from './state.js';
import type { DataStore } from './types.js';
import { createLayerState, registerLayer } from './layers.js';
import { addOrUpdateSourceForLayer } from './rendering.js';
import { renderSettingsDataSourcesSection } from './main.js';
import {
  btnNewCivilOSDataSource,
  civilSetupOverlay,
  civilDomainInput,
  civilSetupError,
  btnCancelCivilSetup,
  btnConfirmCivilSetup
} from './dom-refs.js';

export function normalizeDomain(domain: string): string {
  let clean = domain.trim();
  if (!/^https?:\/\//i.test(clean)) {
    clean = 'https://' + clean;
  }
  return clean;
}

export async function fetchInstanceMetadata(normalizedDomain: string) {
  try {
    const url = `${normalizedDomain}/civil.public.instance.v1.InstanceService/GetInstanceMetadata`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (response.status === 404) {
      throw new Error("Invalid Civil OS domain");
    }
    if (!response.ok) {
      throw new Error("An issue with the Civil OS instance occurred");
    }
    const data = await response.json();
    return data;
  } catch (e: any) {
    if (e.message === "Invalid Civil OS domain" || e.message === "An issue with the Civil OS instance occurred") {
      throw e;
    }
    throw new Error("An issue with the Civil OS instance occurred");
  }
}

export async function fetchOIDCConfig(authIssuerUrl: string) {
  let issuer = authIssuerUrl.trim();
  if (issuer.endsWith('/')) {
    issuer = issuer.slice(0, -1);
  }
  const oidcUrl = `${issuer}/.well-known/openid-configuration`;
  const response = await fetch(oidcUrl);
  if (!response.ok) {
    throw new Error("Failed to fetch OIDC configuration");
  }
  return await response.json();
}

function dec2hex(dec: number): string {
  return dec.toString(16).padStart(2, "0");
}

function generateCodeVerifier(): string {
  const array = new Uint32Array(56 / 2);
  window.crypto.getRandomValues(array);
  return Array.from(array, dec2hex).join("");
}

function sha256(plain: string): Promise<ArrayBuffer> {
  const encoder = new TextEncoder();
  const data = encoder.encode(plain);
  return window.crypto.subtle.digest("SHA-256", data);
}

function base64urlencode(a: ArrayBuffer): string {
  let str = "";
  const bytes = new Uint8Array(a);
  const len = bytes.byteLength;
  for (let i = 0; i < len; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const hashed = await sha256(verifier);
  return base64urlencode(hashed);
}

export function getOIDCRedirectUri(): string {
  let redirectUri = window.location.href.split('?')[0].split('#')[0];
  if (redirectUri.startsWith('file://')) {
    // Electron desktop application loaded from local file system
    redirectUri = 'http://localhost:5173/';
  }
  return redirectUri;
}

export async function triggerOIDCRedirect(gatewayUrl: string, authIssuerUrl: string, oidcConfig: any) {
  const verifier = generateCodeVerifier();
  const challenge = await generateCodeChallenge(verifier);
  const state = generateCodeVerifier().slice(0, 16);

  sessionStorage.setItem('civil_oidc_verifier', verifier);
  sessionStorage.setItem('civil_oidc_state', state);
  sessionStorage.setItem('civil_oidc_gateway', gatewayUrl);
  sessionStorage.setItem('civil_oidc_issuer', authIssuerUrl);
  sessionStorage.setItem('civil_oidc_config', JSON.stringify(oidcConfig));

  const authEndpoint = oidcConfig.authorization_endpoint;
  const redirectUri = getOIDCRedirectUri();

  const authUrl = `${authEndpoint}?` + new URLSearchParams({
    response_type: 'code',
    client_id: 'geovizwiz',
    redirect_uri: redirectUri,
    scope: 'openid profile email',
    state: state,
    code_challenge: challenge,
    code_challenge_method: 'S256'
  }).toString();

  window.location.href = authUrl;
}

export function createCivilLayer(store: DataStore) {
  const layer = createLayerState(store.name, store.id);
  registerLayer(layer);
  addOrUpdateSourceForLayer(layer, null as any);
}

export async function handleOIDCCallback() {
  const urlParams = new URLSearchParams(window.location.search);
  const code = urlParams.get('code');
  const state = urlParams.get('state');

  if (!code || !state) return;

  const storedState = sessionStorage.getItem('civil_oidc_state');
  const verifier = sessionStorage.getItem('civil_oidc_verifier');
  const gateway = sessionStorage.getItem('civil_oidc_gateway');
  const issuer = sessionStorage.getItem('civil_oidc_issuer');
  const configStr = sessionStorage.getItem('civil_oidc_config');

  // Clear OIDC flow details from session storage
  sessionStorage.removeItem('civil_oidc_state');
  sessionStorage.removeItem('civil_oidc_verifier');
  sessionStorage.removeItem('civil_oidc_gateway');
  sessionStorage.removeItem('civil_oidc_issuer');
  sessionStorage.removeItem('civil_oidc_config');

  // Clean parameters from browser URL bar
  window.history.replaceState({}, document.title, window.location.pathname);

  if (state !== storedState || !verifier || !gateway || !issuer || !configStr) {
    console.error("OIDC state mismatch or missing stored verifier.");
    return;
  }

  const oidcConfig = JSON.parse(configStr);

  try {
    const tokenEndpoint = oidcConfig.token_endpoint;
    const redirectUri = getOIDCRedirectUri();

    const tokenRes = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: 'geovizwiz',
        code: code,
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }).toString(),
    });

    if (!tokenRes.ok) {
      throw new Error(`Token exchange failed: ${tokenRes.statusText}`);
    }

    const tokenData = await tokenRes.json();
    const idToken = tokenData.id_token;

    const gatewayUrlObj = new URL(gateway);
    const domainName = gatewayUrlObj.hostname;
    const storeId = `store-civil-${Date.now()}`;

    // Setup TileJSON discovery
    const tileJsonUrl = `${gateway}/civil.public.tiles.v1.TileService/GetTileJson`;
    const tileJsonRes = await fetch(tileJsonUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${idToken}`
      },
      body: JSON.stringify({ sourceName: 'get_parcel_tiles' })
    });

    let tileJsonData = null;
    if (tileJsonRes.ok) {
      tileJsonData = await tileJsonRes.json();
    } else {
      tileJsonData = {
        tilejson: '3.0.0',
        name: 'parcels',
        tiles: [`${gateway}/tiles/get_parcel_tiles/{z}/{x}/{y}`],
        vector_layers: [{ id: 'parcels' }]
      };
    }

    const newStore: DataStore = {
      id: storeId,
      name: `Civil OS: ${domainName}`,
      file: null,
      asyncBuffer: null,
      geojson: { type: 'FeatureCollection', features: [] },
      numericFieldsFromSchema: [],
      categoricalFieldsFromSchema: [],
      chosenNumericFields: [],
      chosenCategoricalFields: [],
      landSizeField: null,
      landSizeUnitLabel: null,
      bldgSizeField: null,
      bldgSizeUnitLabel: null,
      salePriceField: null,
      saleDateField: null,
      validSaleField: null,
      vacantSaleField: null,
      parcelIdField: null,
      addressField: null,
      bldgQualityField: null,
      bldgConditionField: null,
      bldgAgeField: null,
      bldgEffAgeField: null,
      bldgBedsField: null,
      bldgBathsField: null,
      bldgTypeField: null,
      landTypeField: null,
      landZoningField: null,
      saleIdField: null,
      fullMarketValueField: null,
      assessedValueField: null,
      landValueField: null,
      improvementValueField: null,
      isCivil: true,
      civilGateway: gateway,
      civilAuthIssuer: issuer,
      civilToken: idToken,
      civilOIDCConfig: oidcConfig,
      civilTileJson: tileJsonData
    };

    S.dataStores.set(storeId, newStore);
    S.dataStoreOrder.push(storeId);

    renderSettingsDataSourcesSection();
    createCivilLayer(newStore);
  } catch (err) {
    console.error("Failed OIDC token exchange:", err);
    alert("Failed to sign in to Civil OS instance.");
  }
}

export function initCivilIntegration() {
  // 1. Intercept fetch to auto-redirect on 401
  const originalFetch = window.fetch;
  window.fetch = async function(input, init) {
    const response = await originalFetch(input, init);
    if (response.status === 401) {
      const urlString = typeof input === 'string' ? input : (input instanceof Request ? input.url : '');
      const stores = Array.from(S.dataStores.values());
      const civilStore = stores.find(s => s.isCivil && s.civilGateway && urlString.includes(s.civilGateway));
      if (civilStore) {
        console.warn("Received 401 from Civil OS gateway. Initiating OIDC login redirection...");
        triggerOIDCRedirect(civilStore.civilGateway || '', civilStore.civilAuthIssuer || '', civilStore.civilOIDCConfig);
      }
    }
    return response;
  };

  // 2. Setup event listeners for UI buttons
  if (btnNewCivilOSDataSource && civilSetupOverlay) {
    btnNewCivilOSDataSource.addEventListener('click', () => {
      if (civilDomainInput) civilDomainInput.value = '';
      if (civilSetupError) {
        civilSetupError.style.display = 'none';
        civilSetupError.textContent = '';
      }
      civilSetupOverlay.classList.add('show');
    });
  }

  if (btnCancelCivilSetup && civilSetupOverlay) {
    btnCancelCivilSetup.addEventListener('click', () => {
      civilSetupOverlay.classList.remove('show');
    });
  }

  if (btnConfirmCivilSetup && civilSetupOverlay && civilDomainInput && civilSetupError) {
    btnConfirmCivilSetup.addEventListener('click', async () => {
      const domain = civilDomainInput.value.trim();
      if (!domain) {
        civilSetupError.textContent = 'Please enter a domain.';
        civilSetupError.style.display = 'block';
        return;
      }

      civilSetupError.style.display = 'none';
      btnConfirmCivilSetup.disabled = true;
      btnConfirmCivilSetup.textContent = 'Setting up...';

      try {
        const normalized = normalizeDomain(domain);
        const metadata = await fetchInstanceMetadata(normalized);
        const authIssuerUrl = metadata.auth_issuer_url;
        if (!authIssuerUrl) {
          throw new Error("An issue with the Civil OS instance occurred");
        }

        const oidcConfig = await fetchOIDCConfig(authIssuerUrl);
        
        // Hide overlay and trigger redirect
        civilSetupOverlay.classList.remove('show');
        await triggerOIDCRedirect(normalized, authIssuerUrl, oidcConfig);
      } catch (err: any) {
        civilSetupError.textContent = err.message || 'An error occurred during setup.';
        civilSetupError.style.display = 'block';
      } finally {
        btnConfirmCivilSetup.disabled = false;
        btnConfirmCivilSetup.textContent = 'Confirm';
      }
    });
  }

  // 3. Process OIDC callback if present in URL
  void handleOIDCCallback();
}
