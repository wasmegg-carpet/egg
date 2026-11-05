/**
 * @module isTestingEnvironment
 * @description True only on localhost, a bare IP address (e.g. a LAN IP hitting a local dev
 * server), and the staging deploy — gates testing/bug-reporting tools (and other dev-only
 * affordances) that regular production users shouldn't see or need.
 */

const IPV4_HOSTNAME = /^\d{1,3}(\.\d{1,3}){3}$/;

export const isTestingEnvironment =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' ||
    IPV4_HOSTNAME.test(window.location.hostname) ||
    window.location.hostname === 'ascension-planner--wasmegg-carpet.netlify.app');
