import { describe, expect, test } from 'bun:test';
import type { JobRecord } from '../types';
import { DEFAULT_WEBHOOK_SOURCES, sanitizeWebhooks, webhookSourceOf } from './webhook-model';

const ENDPOINT = {
  id: 'erp',
  name: 'ERP',
  url: 'https://erp.example.com/hooks',
  secretName: null,
  events: ['printed'],
  enabled: true,
};

const JOB: JobRecord = {
  id: 'j',
  createdAt: 0,
  raw: 'A',
  printerName: 'P',
  source: 'desktop',
  status: 'printed',
  forced: false,
};

describe('webhook sources', () => {
  // 批量、PDF 一次几千上万张，每张一条通知会把接收方和本机队列都压垮：默认不发，接口自己勾上才发。
  test('defaults to scans, phones, the local API and LAN sharing, without batch and PDF', () => {
    expect(DEFAULT_WEBHOOK_SOURCES).toEqual(['scan', 'mobile', 'api', 'ipp']);
    expect(sanitizeWebhooks([ENDPOINT])[0]?.sources).toEqual([...DEFAULT_WEBHOOK_SOURCES]);
  });

  test('keeps the chosen sources and drops unknown ones', () => {
    expect(sanitizeWebhooks([{ ...ENDPOINT, sources: ['batch', 'bogus', 'scan'] }])[0]?.sources).toEqual([
      'scan',
      'batch',
    ]);
    expect(sanitizeWebhooks([{ ...ENDPOINT, sources: [] }])[0]?.sources).toEqual([]);
  });

  test('tells where a print record came from, reprints counted with their origin', () => {
    expect(webhookSourceOf(JOB)).toBe('scan');
    expect(webhookSourceOf({ ...JOB, source: 'history' })).toBe('scan');
    expect(webhookSourceOf({ ...JOB, source: 'mobile' })).toBe('mobile');
    expect(webhookSourceOf({ ...JOB, source: 'api', caller: 'key:k1' })).toBe('api');
    expect(webhookSourceOf({ ...JOB, source: 'history', caller: 'key:k1' })).toBe('api');
    expect(webhookSourceOf({ ...JOB, source: 'batch', batch: { id: 'b', row: 1, copy: 1 } })).toBe('batch');
    expect(webhookSourceOf({ ...JOB, source: 'history', batch: { id: 'b', row: 1, copy: 1 } })).toBe('batch');
    expect(webhookSourceOf({ ...JOB, source: 'pdf', pdf: { file: 'a.pdf', page: 1, piece: 1, bitmap: 'x' } })).toBe(
      'pdf',
    );
    expect(webhookSourceOf({ ...JOB, source: 'ipp', ipp: { client: '192.168.1.2', user: '' } })).toBe('ipp');
  });
});
