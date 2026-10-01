// lib/api.js - small shared helpers for talking to the Steward public API.
//
// The API host is a field on the auth data (production by default), and the
// key travels in the x-api-key header.

const DEFAULT_BASE_URL = 'https://nonprofit-erp-production.up.railway.app';

const baseUrl = bundle =>
  String((bundle && bundle.authData && bundle.authData.baseUrl) || DEFAULT_BASE_URL).replace(/\/+$/, '');

const headers = bundle => ({ 'x-api-key': bundle.authData.apiKey });

module.exports = { baseUrl, headers, DEFAULT_BASE_URL };
