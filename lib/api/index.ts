import { sha256 } from 'js-sha256';

import { ei } from '../proto';
import { decodeMessage } from './decode';
import { encodeMessage } from './encode';
import useEidsStore from '../stores/eids';
import { APP_BUILD, APP_VERSION, CLIENT_VERSION, PLATFORM, PLATFORM_STRING } from './version';

export * from './decode';
export * from './encode';
export * from './utils';
export * from './version';

const API_ROOT = 'https://egg-forwarder.carpet.workers.dev/?url=https://www.auxbrain.com';
const AUTH_API_ROOT = 'https://egg-auth-worker.carpet.workers.dev';

// Endpoints that must be routed through the authenticated API worker.
const AUTH_ENDPOINTS = new Set(['/ei_ctx/get_contracts_info', '/ei_ctx/get_contract_player_info']);

const CONFIG_GIST_URL = 'https://gist.githubusercontent.com/carpetsage/563c3a4c073f0c658f51a52975b9f929/raw/8ac535c0be50def044c0dd70265d01a157c0b5ec/config.json'
const TIMEOUT = 30000;

// A valid userId donated by a volunteer.
export const defaultUserId = atob('RUk2MjkxOTQwOTY4MjM1MDA4');

/**
 * Makes an API request.
 * @param endpoint - Path of API endpoint, e.g. /ei/coop_status.
 * @param encodedPayload - base64-encoded request payload.
 * @param apiRoot - Optional root URL for API endpoint. If omitted, the endpoint is checked against AUTH_ENDPOINTS and routed to AUTH_API_ROOT automatically when matched; otherwise it falls back to API_ROOT.
 * @returns base64-encoded response payload.
 * @throws Throws an error on network failure (including timeout) or non-2XX response.
 */
export async function request(endpoint: string, encodedPayload: string, apiRoot?: string): Promise<string> {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), TIMEOUT);
  const root = apiRoot ?? (AUTH_ENDPOINTS.has(endpoint) ? AUTH_API_ROOT : API_ROOT);
  const url = root + endpoint;
  try {
    const resp = await fetch(url, {
      method: 'POST',
      mode: 'cors',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: `data=${encodedPayload}`,
      signal: controller.signal,
    });
    const text = await resp.text();
    if (resp.status < 200 || resp.status >= 300) {
      throw new Error(`HTTP ${resp.status}: ${text}`);
    }
    return text;
  } catch (e) {
    if (e instanceof Error && e.name === 'AbortError') {
      throw new Error(`POST ${url}: timeout after ${TIMEOUT}ms.`, { cause: e });
    } else if (e instanceof TypeError) {
      throw new TypeError(
        `POST ${url}: ${e} ` +
          `(please check any ad/content blocking solution you might be using, e.g. uBlock, Brave, Pi-hole, NextDNS, etc.)`,
        { cause: e }
      );
    } else {
      throw new Error(`POST ${url} ${e}`, { cause: e });
    }
  }
}

/**
 * @param userId
 * @returns
 * @throws
 */
export async function requestContractsArchive(userId: string): Promise<ei.IContractsArchive> {
  userId = processUserId(userId);
  const requestPayload = basicRequestInfo(userId);
  const encodedRequestPayload = encodeMessage(ei.BasicRequestInfo, requestPayload);
  const encodedResponsePayload = await request('/ei_ctx/get_contracts_archive', encodedRequestPayload);
  return decodeMessage(ei.ContractsArchive, encodedResponsePayload, true) as ei.IContractsArchive;
}

export async function requestContractsInfo(
  contractIdentifiers: string[],
  userId?: string
): Promise<ei.IContractsInfoResponse> {
  userId = userId ?? defaultUserId;
  const requestPayload: ei.IContractsInfoRequest = {
    rinfo: basicRequestInfo(userId),
    contractIdentifiers,
    clientVersion: CLIENT_VERSION,
  };
  const encodedRequestPayload = encodeMessage(ei.ContractsInfoRequest, requestPayload);
  const encodedResponsePayload = await request('/ei_ctx/get_contracts_info', encodedRequestPayload);
  return decodeMessage(ei.ContractsInfoResponse, encodedResponsePayload, true) as ei.IContractsInfoResponse;
}

/**
 * Fetches the player's contract-player info (grade, total/season CXP, soul
 * power, season progress, etc.) from the authenticated `/ei_ctx/get_contract_player_info`
 * endpoint.
 *
 * The game API no longer populates `backup.contracts.lastCpi` in the backup
 * payload, so tools that used to read it directly now need to call this
 * endpoint after fetching the backup. The response is the same
 * `ContractPlayerInfo` object that used to live in the backup.
 */
export async function requestContractPlayerInfo(userId?: string): Promise<ei.IContractPlayerInfo> {
  userId = userId ?? defaultUserId;
  const requestPayload = basicRequestInfo(userId);
  const encodedRequestPayload = encodeMessage(ei.BasicRequestInfo, requestPayload);
  const encodedResponsePayload = await request('/ei_ctx/get_contract_player_info', encodedRequestPayload);
  return decodeMessage(ei.ContractPlayerInfo, encodedResponsePayload, true) as ei.IContractPlayerInfo;
}

export async function requestShellShowcase(userId?: string): Promise<ei.IShellShowcaseListingSet> {
  userId = userId ?? defaultUserId;
  const requestPayload = basicRequestInfo(userId);
  const encodedRequestPayload = encodeMessage(ei.BasicRequestInfo, requestPayload);
  const encodedResponsePayload = await request('/ei/get_shell_showcase', encodedRequestPayload);
  return decodeMessage(ei.ShellShowcaseListingSet, encodedResponsePayload, false) as ei.IShellShowcaseListingSet;
}

/**
 * Pulls ConfigResponse json from gist - proto for ConfigResponse is broken in some
 * way I don't understand and have spent too long trying to fix
 * @param [userId]
 * @returns
 * @throws
 */
export async function requestConfig(_userid?: string): Promise<ei.IConfigResponse> {
  try {
    const resp = await fetch(CONFIG_GIST_URL);
    const text = await resp.text();
    const config = JSON.parse(text);
    return ei.ConfigResponse.fromObject(config) as ei.ConfigResponse;
  } catch (e) {
    throw new Error(`Error fetching config from: ${CONFIG_GIST_URL} : ${e}`);
  }
}

/**
 * @param [userId]
 * @returns
 * @throws
 */
export async function requestPeriodicals(userId?: string): Promise<ei.IPeriodicalsResponse> {
  // A valid userId is required for a complete response.
  userId = userId ?? defaultUserId;
  const requestPayload: ei.IGetPeriodicalsRequest = {
    rinfo: basicRequestInfo(userId),
  };
  const encodedRequestPayload = encodeMessage(ei.GetPeriodicalsRequest, requestPayload);
  const encodedResponsePayload = await request('/ei/get_periodicals', encodedRequestPayload);
  return decodeMessage(ei.PeriodicalsResponse, encodedResponsePayload, true) as ei.IPeriodicalsResponse;
}

/**
 * @param userId
 * @returns
 * @throws
 */
export async function requestFirstContact(userId: string): Promise<ei.IEggIncFirstContactResponse> {
  // Keep the original (as the caller stores it in the eids store) before
  // processUserId strips any `mk2!` prefix, so the captured username keys match.
  const originalUserId = userId.trim();
  userId = processUserId(userId);
  const requestPayload: ei.IEggIncFirstContactRequest = {
    rinfo: basicRequestInfo(''),
    eiUserId: userId,
    deviceId: 'wasmegg', // This is actually bot_name for /ei/bot_first_contact, operating on an honor system.
    clientVersion: CLIENT_VERSION,
    platform: PLATFORM,
  };
  const encodedRequestPayload = encodeMessage(ei.EggIncFirstContactRequest, requestPayload);
  const encodedResponsePayload = await request('/ei/bot_first_contact', encodedRequestPayload);
  const response = decodeMessage(
    ei.EggIncFirstContactResponse,
    encodedResponsePayload,
    false
  ) as ei.IEggIncFirstContactResponse;
  // Auto-capture the in-game username so tools can display it in place of the
  // EID. This is the central choke point every tool's backup fetch flows
  // through. Never let a store hiccup break data loading.
  const userName = response.backup?.userName;
  if (userName) {
    try {
      useEidsStore().updateUsername(originalUserId, userName);
    } catch {
      // ignore — username capture is best-effort
    }
  }
  return response;
}

/**
 * @param contractId
 * @param coopCode
 * @param [userId]
 * @returns
 * @throws
 */
export async function requestCoopStatus(
  contractId: string,
  coopCode: string,
  userId?: string
): Promise<ei.IContractCoopStatusResponse> {
  // A valid userId is now required.
  userId = userId ?? defaultUserId;
  const requestPayload: ei.IContractCoopStatusRequest = {
    rinfo: basicRequestInfo(userId),
    contractIdentifier: contractId,
    coopIdentifier: coopCode,
    userId,
    clientVersion: CLIENT_VERSION,
  };
  const encodedRequestPayload = encodeMessage(ei.ContractCoopStatusRequest, requestPayload);
  const encodedResponsePayload = await request('/ei/coop_status_bot', encodedRequestPayload);
  const status = decodeMessage(
    ei.ContractCoopStatusResponse,
    encodedResponsePayload,
    true
  ) as ei.IContractCoopStatusResponse;
  if (!status.clientTimestamp) {
    status.clientTimestamp = Date.now() / 1000;
  }
  return status;
}
/**
 * @param contractId
 * @param coopCode
 * @param league - 0 for elite, 1 for standard.
 * @param grade - 0 for undefined, 1-5 for c,b,a,aa,aaa
 * @returns
 * @throws
 */
export async function requestQueryCoop(
  contractId: string,
  coopCode: string,
  league: number | undefined,
  grade: number | undefined,
  userId?: string
): Promise<ei.IQueryCoopResponse> {
  userId = userId ?? defaultUserId;
  const requestPayload: ei.IQueryCoopRequest = {
    rinfo: basicRequestInfo(userId),
    contractIdentifier: contractId,
    coopIdentifier: coopCode,
    grade: ei.Contract.PlayerGrade.GRADE_A,
  };
  const encodedRequestPayload = encodeMessage(ei.QueryCoopRequest, requestPayload);
  const encodedResponsePayload = await request('/ei/query_coop', encodedRequestPayload);
  return decodeMessage(ei.QueryCoopResponse, encodedResponsePayload, false) as ei.IQueryCoopResponse;
}

/**
 * @param userId
 * @param missionId
 * @returns
 * @throws
 */
export async function requestAfxCompleteMission(
  userId: string,
  missionId: string
): Promise<ei.ICompleteMissionResponse> {
  userId = processUserId(userId);
  return decodeCompleteMissionResponse(await requestAfxCompleteMissionRaw(userId, missionId));
}

export async function requestAfxCompleteMissionRaw(userId: string, missionId: string): Promise<string> {
  userId = processUserId(userId);
  const requestPayload: ei.IMissionRequest = {
    eiUserId: userId,
    info: {
      identifier: missionId,
    },
    rinfo: basicRequestInfo(userId),
  };
  const encodedRequestPayload = encodeMessage(ei.MissionRequest, requestPayload);
  return await request('/ei_afx/complete_mission', encodedRequestPayload);
}

export function decodeCompleteMissionResponse(payload: string): ei.ICompleteMissionResponse {
  return decodeMessage(ei.CompleteMissionResponse, payload, true) as ei.ICompleteMissionResponse;
}

export function basicRequestInfo(userId: string): ei.IBasicRequestInfo {
  return {
    eiUserId: userId,
    clientVersion: CLIENT_VERSION,
    version: APP_VERSION,
    build: APP_BUILD,
    platform: PLATFORM_STRING,
  };
}

const userIdSha256Blacklist = [
  'bba75a6d240f86d6a43d76e8e231d7b5f9a83c3078b2c7998290aad1660a50f9',
  '773b99e5d2076c6597655cca7b37124061822eff9b5b4b0f53f985eaa8476f5b',
];

// Enforces a blacklist, but allow 'mk2!EI...' as the super user bypass.
function processUserId(userId: string): string {
  if (userId.startsWith('mk2!')) {
    return userId.slice(4);
  }
  if (userIdSha256Blacklist.includes(sha256(userId))) {
    throw new Error(`${userId}: this ID has been blacklisted`);
  }
  return userId;
}
