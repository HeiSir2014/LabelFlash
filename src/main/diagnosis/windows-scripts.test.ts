import { describe, expect, test } from 'bun:test';
import {
  cancelJobsScript,
  paperDeltaTicket,
  purgeQueueScript,
  restartSpoolerScript,
  SCRIPT_EXIT,
  setDriverPaperScript,
} from './windows-scripts';

const LABEL = { widthMm: 60, heightMm: 40 };
const OPTION = { kind: 'option', namespace: 'urn:labelflash-test:label-driver', localName: 'User0000000257' } as const;

describe('windows scripts', () => {
  test('every script trusts only the modules in the PowerShell home', () => {
    for (const script of [
      restartSpoolerScript(),
      purgeQueueScript('标签机A'),
      cancelJobsScript('标签机A', [1]),
      setDriverPaperScript('标签机A', OPTION, LABEL),
    ]) {
      expect(script.split('\n')).toContain("$env:PSModulePath = Join-Path $PSHOME 'Modules'");
    }
  });

  test('passes the printer name only as a PowerShell literal', () => {
    expect(purgeQueueScript("O'Neil 标签机")).toContain("$Name = 'O''Neil 标签机'");
  });

  test('runs sc.exe from the system directory, not from a name or an environment variable', () => {
    const script = restartSpoolerScript();
    expect(script).toContain("Join-Path ([Environment]::SystemDirectory) 'sc.exe'");
    expect(script).not.toContain('$env:SystemRoot');
  });

  test('cancels only whole job ids', () => {
    expect(cancelJobsScript('标签机A', [11, 12])).toContain('$Ids = @(11, 12)');
    expect(() => cancelJobsScript('标签机A', [1.5])).toThrow('job id');
    expect(() => cancelJobsScript('标签机A', [])).toThrow('job id');
  });

  test('sets the paper through a PrintTicket delta and rolls back on a bad read-back', () => {
    const script = setDriverPaperScript('标签机A', OPTION, LABEL);
    expect(script).toContain('$WidthMicrons = 60000');
    expect(script).toContain('$HeightMicrons = 40000');
    expect(script).toContain(`exit ${SCRIPT_EXIT.driverRefused}`);
    expect(script).toContain(`exit ${SCRIPT_EXIT.rolledBack}`);
    const delta = /\$Delta = '([A-Za-z0-9+/=]+)'/.exec(script)?.[1] ?? '';
    expect(Buffer.from(delta, 'base64').toString('utf8')).toBe(paperDeltaTicket(OPTION));
  });
});

describe('paperDeltaTicket', () => {
  test('names a driver option in its own namespace', () => {
    const ticket = paperDeltaTicket(OPTION);
    expect(ticket).toContain('xmlns:lf="urn:labelflash-test:label-driver"');
    expect(ticket).toContain(
      '<psf:Feature name="psk:PageMediaSize"><psf:Option name="lf:User0000000257"/></psf:Feature>',
    );
  });

  test('writes a custom size in microns', () => {
    const ticket = paperDeltaTicket({ kind: 'custom', widthMicrons: 60_000, heightMicrons: 40_000 });
    expect(ticket).toContain('<psf:Option name="psk:CustomMediaSize">');
    expect(ticket).toContain('<psf:Value xsi:type="xsd:integer">60000</psf:Value>');
    expect(ticket).toContain('<psf:Value xsi:type="xsd:integer">40000</psf:Value>');
  });

  test('refuses names that could break the XML', () => {
    expect(() => paperDeltaTicket({ ...OPTION, localName: 'a"b' })).toThrow('option name');
    expect(() => paperDeltaTicket({ ...OPTION, namespace: 'urn:x"><' })).toThrow('namespace');
  });
});
