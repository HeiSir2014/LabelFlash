import { describe, expect, test } from 'bun:test';
import { corsHeaders } from './cors';

const SITE = 'https://erp.example.com';

describe('corsHeaders', () => {
  test('allows an authorized website, including the private network preflight', () => {
    expect(corsHeaders(SITE, true, { privateNetworkRequested: true })).toEqual({
      'access-control-allow-origin': SITE,
      'access-control-allow-methods': 'GET, POST, OPTIONS',
      'access-control-allow-headers': 'authorization, content-type',
      'access-control-max-age': '600',
      'access-control-allow-private-network': 'true',
      vary: 'Origin',
    });
  });

  test('answers the private network question only when the browser asks it', () => {
    expect(corsHeaders(SITE, true, { privateNetworkRequested: false })).not.toHaveProperty(
      'access-control-allow-private-network',
    );
  });

  // 没授权的网站拿不到允许跨域的响应头：浏览器不让它读结果，授权框只出现在电脑上。
  test('gives nothing to a website that is not authorized', () => {
    expect(corsHeaders('https://new.example.com', false, { privateNetworkRequested: true })).toEqual({
      vary: 'Origin',
    });
  });
});
