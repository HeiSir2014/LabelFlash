import { describe, expect, test } from 'bun:test';
import { EXAMPLE_SIGNER, exampleWindowsTarget } from '../testing/driver-catalog-fixtures';
import { FakeClock } from '../testing/fake-clock';
import {
  FAKE_DOWNLOAD,
  FakeDownloader,
  FakeInstaller,
  FakePrinterList,
  FakeVerifier,
} from '../testing/fake-driver-ports';
import {
  DownloadError,
  FIND_PRINTER_TIMEOUT_MS,
  type InstallFlowDeps,
  type InstallState,
  runDriverInstall,
} from './driver-install-flow';

interface Setup {
  deps: InstallFlowDeps;
  downloader: FakeDownloader;
  verifier: FakeVerifier;
  installer: FakeInstaller;
  clock: FakeClock;
}

function setup(overrides: Partial<Omit<Setup, 'deps' | 'clock'>> & { printers?: FakePrinterList } = {}): Setup {
  const clock = new FakeClock();
  const downloader = overrides.downloader ?? new FakeDownloader(FAKE_DOWNLOAD, [524_288]);
  const verifier = overrides.verifier ?? new FakeVerifier({ status: 'valid', signer: EXAMPLE_SIGNER });
  const installer = overrides.installer ?? new FakeInstaller({ kind: 'installed', needsRestart: false });
  const printers = overrides.printers ?? new FakePrinterList([['旧打印机'], ['旧打印机', '示例标签机']]);
  return {
    clock,
    downloader,
    verifier,
    installer,
    deps: {
      downloader,
      verifier,
      installer,
      listPrinters: printers.list,
      sleep: async (ms) => clock.advance(ms),
      clock,
      log: () => undefined,
    },
  };
}

async function run(
  context: Setup,
  signal = new AbortController().signal,
): Promise<{ result: InstallState; steps: string[] }> {
  const states: InstallState[] = [];
  const result = await runDriverInstall(exampleWindowsTarget(), context.deps, (state) => states.push(state), signal);
  return { result, steps: states.map((state) => (state.phase === 'running' ? state.step : state.phase)) };
}

describe('runDriverInstall', () => {
  test('downloads, verifies, installs and finds the new printer, then deletes the download', async () => {
    const context = setup({ printers: new FakePrinterList([['旧打印机'], ['旧打印机'], ['旧打印机', '示例标签机']]) });
    const { result, steps } = await run(context);
    expect(result).toEqual({ phase: 'done', newPrinters: ['示例标签机'], needsRestart: false });
    expect(steps).toEqual(['downloading', 'downloading', 'verifying', 'installing', 'finding-printer', 'done']);
    expect(context.installer.installed).toEqual([FAKE_DOWNLOAD.path]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('never runs a download whose SHA-256 differs from the catalog', async () => {
    const context = setup({ downloader: new FakeDownloader({ ...FAKE_DOWNLOAD, sha256: 'e'.repeat(64) }) });
    expect((await run(context)).result).toEqual({ phase: 'failed', failure: 'hash-mismatch', exitCode: null });
    expect(context.verifier.checked).toEqual([]);
    expect(context.installer.installed).toEqual([]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('never runs a download of the wrong size', async () => {
    const context = setup({ downloader: new FakeDownloader({ ...FAKE_DOWNLOAD, sizeBytes: 1 }) });
    expect((await run(context)).result).toMatchObject({ failure: 'size-mismatch' });
    expect(context.installer.installed).toEqual([]);
  });

  test('never runs an installer signed by someone else or not validly signed', async () => {
    const other = setup({ verifier: new FakeVerifier({ status: 'valid', signer: 'CN=别人' }) });
    expect((await run(other)).result).toMatchObject({ failure: 'signer-mismatch' });
    expect(other.installer.installed).toEqual([]);
    const invalid = setup({ verifier: new FakeVerifier({ status: 'invalid', detail: 'HashMismatch' }) });
    expect((await run(invalid)).result).toMatchObject({ failure: 'signature-invalid' });
    expect(invalid.installer.installed).toEqual([]);
  });

  test('never runs an installer when the signature itself could not be checked', async () => {
    const context = setup({ verifier: new FakeVerifier({ status: 'unverifiable', detail: 'query failed (exit 1)' }) });
    expect((await run(context)).result).toMatchObject({ failure: 'signature-unverifiable' });
    expect(context.installer.installed).toEqual([]);
  });

  test('reports a declined admin prompt and an installer error with its exit code', async () => {
    expect((await run(setup({ installer: new FakeInstaller({ kind: 'declined' }) }))).result).toMatchObject({
      failure: 'admin-declined',
    });
    const failed = setup({ installer: new FakeInstaller({ kind: 'failed', exitCode: 1603 }) });
    expect((await run(failed)).result).toEqual({ phase: 'failed', failure: 'installer-failed', exitCode: 1603 });
    expect(failed.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('reports a download error without anything to delete', async () => {
    const context = setup({
      downloader: new FakeDownloader(new DownloadError('too-large', 'larger than the catalog')),
    });
    expect((await run(context)).result).toMatchObject({ failure: 'too-large' });
    expect(context.downloader.discarded).toEqual([]);
  });

  test('stops before verifying when the operator cancels right after the download', async () => {
    const controller = new AbortController();
    const context = setup({ downloader: new FakeDownloader(FAKE_DOWNLOAD, [], () => controller.abort()) });
    expect((await run(context, controller.signal)).result).toMatchObject({ failure: 'canceled' });
    expect(context.installer.installed).toEqual([]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('stops before installing when the operator cancels during the signature check', async () => {
    const controller = new AbortController();
    const context = setup({
      verifier: new FakeVerifier({ status: 'valid', signer: EXAMPLE_SIGNER }, () => controller.abort()),
    });
    expect((await run(context, controller.signal)).result).toMatchObject({ failure: 'canceled' });
    expect(context.installer.installed).toEqual([]);
    expect(context.downloader.discarded).toEqual([FAKE_DOWNLOAD.path]);
  });

  test('finishes without a new printer when none shows up in time', async () => {
    const context = setup({ printers: new FakePrinterList([['旧打印机']]) });
    expect((await run(context)).result).toEqual({ phase: 'done', newPrinters: [], needsRestart: false });
    expect(context.clock.now() - new FakeClock().now()).toBeGreaterThanOrEqual(FIND_PRINTER_TIMEOUT_MS);
  });
});
