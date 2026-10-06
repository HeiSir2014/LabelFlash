import { describe, expect, test } from 'bun:test';
import { FakeClock } from '../testing/fake-clock';
import {
  booleanAttr,
  integerAttr,
  integerValue,
  keywordAttr,
  mimeTypeAttr,
  nameAttr,
  stringValue,
  stringValues,
  uriAttr,
} from './ipp-attributes';
import { GROUP_TAGS, OPERATIONS, STATUS } from './ipp-constants';
import { IppJobBook } from './ipp-job-book';
import { handleIppRequest, IPP_MESSAGES, type IppRequestContext, UNTITLED_JOB } from './ipp-operations';
import {
  attributeIn,
  ippRequest,
  MINIMAL_PDF,
  TEST_MORE_INFO_URI,
  TEST_PRINTER_URI,
  testPrinter,
} from './testing/ipp-requests';

function createContext(overrides: Partial<IppRequestContext> = {}): IppRequestContext {
  const clock = new FakeClock();
  return {
    printer: testPrinter(),
    printerUri: TEST_PRINTER_URI,
    moreInfoUri: TEST_MORE_INFO_URI,
    authentication: 'none',
    client: '192.168.1.23',
    decision: 'allowed',
    book: new IppJobBook(clock),
    pathJobId: null,
    startedAt: clock.now(),
    nowMs: clock.now(),
    ...overrides,
  };
}

const printJob = (options: Parameters<typeof ippRequest>[1] = {}) => ippRequest(OPERATIONS.printJob, options);
const NO_DATA = new Uint8Array();

describe('handleIppRequest envelope', () => {
  test('answers IPP 1.x with 1.1 and 2.x with 2.0', () => {
    const context = createContext();
    const v1 = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 1, minor: 0 } }),
      NO_DATA,
      context,
    );
    expect(v1.response.version).toEqual({ major: 1, minor: 1 });
    const v2 = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 2, minor: 2 } }),
      NO_DATA,
      context,
    );
    expect(v2.response.version).toEqual({ major: 2, minor: 0 });
  });

  test('refuses other versions, a bad envelope, other charsets and unknown operations', () => {
    const context = createContext();
    const code = (message: Parameters<typeof handleIppRequest>[0]) =>
      handleIppRequest(message, NO_DATA, context).response.code;
    expect(code(ippRequest(OPERATIONS.getPrinterAttributes, { version: { major: 3, minor: 0 } }))).toBe(
      STATUS.versionNotSupported,
    );
    expect(code(ippRequest(OPERATIONS.getPrinterAttributes, { requestId: 0 }))).toBe(STATUS.badRequest);
    const noCharset = ippRequest(OPERATIONS.getPrinterAttributes);
    noCharset.groups[0]?.attributes.shift();
    expect(code(noCharset)).toBe(STATUS.badRequest);
    const latin1 = ippRequest(OPERATIONS.getPrinterAttributes);
    const charset = latin1.groups[0]?.attributes[0];
    if (charset !== undefined) {
      charset.values = [{ kind: 'string', tag: 0x47, value: 'iso-8859-1' }];
    }
    expect(code(latin1)).toBe(STATUS.charsetNotSupported);
    expect(code(ippRequest(0x0005))).toBe(STATUS.operationNotSupported);
  });

  test('echoes the request id and answers in Chinese UTF-8', () => {
    const { response } = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, { requestId: 42 }),
      NO_DATA,
      createContext(),
    );
    expect(response.requestId).toBe(42);
    expect(stringValue(attributeIn(response, GROUP_TAGS.operation, 'attributes-charset'))).toBe('utf-8');
    expect(stringValue(attributeIn(response, GROUP_TAGS.operation, 'attributes-natural-language'))).toBe('zh-cn');
  });
});

describe('Get-Printer-Attributes', () => {
  test('returns the requested printer attributes', () => {
    const { response } = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, {
        operation: [keywordAttr('requested-attributes', 'printer-name', 'media-default')],
      }),
      NO_DATA,
      createContext(),
    );
    expect(response.code).toBe(STATUS.ok);
    const printer = response.groups.find((group) => group.tag === GROUP_TAGS.printer);
    expect(printer?.attributes.map((item) => item.name)).toEqual(['media-default', 'printer-name']);
  });

  test('says the printer is gone when its paper is no longer shared', () => {
    const { response } = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes),
      NO_DATA,
      createContext({ printer: null }),
    );
    expect(response.code).toBe(STATUS.notFound);
  });

  test('needs a printer-uri', () => {
    const { response } = handleIppRequest(
      ippRequest(OPERATIONS.getPrinterAttributes, { printerUri: null }),
      NO_DATA,
      createContext(),
    );
    expect(response.code).toBe(STATUS.badRequest);
  });
});

describe('Print-Job', () => {
  test('accepts a document from an allowed computer', () => {
    const context = createContext();
    const outcome = handleIppRequest(
      printJob({
        operation: [nameAttr('job-name', '面单'), nameAttr('requesting-user-name', 'zhang')],
        job: [integerAttr('copies', 2)],
      }),
      MINIMAL_PDF,
      context,
    );
    expect(outcome.response.code).toBe(STATUS.ok);
    expect(integerValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state'))).toBe(3);
    expect(stringValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-uri'))).toBe(`${TEST_PRINTER_URI}/jobs/1`);
    expect(outcome.accepted).toMatchObject({
      job: { id: 1, name: '面单', user: 'zhang', client: '192.168.1.23', state: 'pending' },
      document: { format: 'application/pdf', copies: 2 },
      needsApproval: false,
    });
  });

  test('holds a job from a new computer until the operator answers', () => {
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, createContext({ decision: 'ask' }));
    expect(integerValue(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state'))).toBe(4);
    expect(stringValues(attributeIn(outcome.response, GROUP_TAGS.job, 'job-state-reasons'))).toEqual([
      'job-held-for-authorization',
    ]);
    expect(outcome.accepted?.needsApproval).toBe(true);
    expect(outcome.accepted?.job.name).toBe(UNTITLED_JOB);
  });

  test('refuses a computer the operator turned down', () => {
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, createContext({ decision: 'denied' }));
    expect(outcome.response.code).toBe(STATUS.forbidden);
    expect(stringValue(attributeIn(outcome.response, GROUP_TAGS.operation, 'status-message'))).toBe(
      IPP_MESSAGES.denied,
    );
    expect(outcome.accepted).toBeNull();
  });

  test('checks the document', () => {
    const context = createContext();
    const code = (message: Parameters<typeof handleIppRequest>[0], data: Uint8Array) =>
      handleIppRequest(message, data, context).response.code;
    expect(code(printJob(), NO_DATA)).toBe(STATUS.badRequest);
    expect(code(printJob(), new TextEncoder().encode('%!PS'))).toBe(STATUS.documentFormatNotSupported);
    expect(
      code(printJob({ operation: [mimeTypeAttr('document-format', 'application/postscript')] }), MINIMAL_PDF),
    ).toBe(STATUS.documentFormatNotSupported);
    expect(code(printJob({ operation: [mimeTypeAttr('document-format', 'image/jpeg')] }), MINIMAL_PDF)).toBe(
      STATUS.documentFormatError,
    );
    expect(code(printJob({ operation: [keywordAttr('compression', 'gzip')] }), MINIMAL_PDF)).toBe(
      STATUS.compressionNotSupported,
    );
  });

  test('cleans control characters out of names and cuts long ones', () => {
    const outcome = handleIppRequest(
      printJob({
        operation: [nameAttr('job-name', `a\u0000b\nc${'字'.repeat(200)}`), nameAttr('requesting-user-name', ' \t ')],
      }),
      MINIMAL_PDF,
      createContext(),
    );
    expect(outcome.accepted?.job.name.startsWith('abc字')).toBe(true);
    expect([...(outcome.accepted?.job.name ?? '')]).toHaveLength(100);
    expect(outcome.accepted?.job.user).toBe('');
  });

  test('substitutes unsupported settings unless fidelity is asked for', () => {
    const lenient = handleIppRequest(
      printJob({
        job: [
          integerAttr('copies', 150),
          keywordAttr('sides', 'two-sided-long-edge'),
          keywordAttr('job-sheets', 'standard'),
        ],
      }),
      MINIMAL_PDF,
      createContext(),
    );
    expect(lenient.response.code).toBe(STATUS.okIgnoredOrSubstituted);
    expect(lenient.accepted?.document.copies).toBe(99);
    const unsupported = lenient.response.groups.find((group) => group.tag === GROUP_TAGS.unsupported);
    expect(unsupported?.attributes.map((item) => item.name)).toEqual(['copies', 'sides', 'job-sheets']);
    const strict = handleIppRequest(
      printJob({
        operation: [booleanAttr('ipp-attribute-fidelity', true)],
        job: [keywordAttr('sides', 'two-sided-long-edge')],
      }),
      MINIMAL_PDF,
      createContext(),
    );
    expect(strict.response.code).toBe(STATUS.attributesOrValuesNotSupported);
    expect(strict.accepted).toBeNull();
  });

  test('says busy when too many jobs are open', () => {
    const context = createContext();
    for (const client of ['192.168.1.1', '192.168.1.2', '192.168.1.3', '192.168.1.4']) {
      handleIppRequest(printJob(), MINIMAL_PDF, { ...context, client });
    }
    expect(handleIppRequest(printJob(), MINIMAL_PDF, { ...context, client: '192.168.1.5' }).response.code).toBe(
      STATUS.busy,
    );
  });
});

describe('Validate-Job', () => {
  test('checks the settings without creating a job', () => {
    const context = createContext();
    const outcome = handleIppRequest(ippRequest(OPERATIONS.validateJob), NO_DATA, context);
    expect(outcome.response.code).toBe(STATUS.ok);
    expect(outcome.accepted).toBeNull();
    expect(context.book.activeCount()).toBe(0);
    expect(
      handleIppRequest(ippRequest(OPERATIONS.validateJob), NO_DATA, { ...context, decision: 'denied' }).response.code,
    ).toBe(STATUS.forbidden);
  });
});

describe('Get-Jobs, Get-Job-Attributes and Cancel-Job', () => {
  function withJob() {
    const context = createContext();
    const outcome = handleIppRequest(printJob(), MINIMAL_PDF, context);
    const id = outcome.accepted?.job.id ?? 0;
    return { context, id };
  }

  test('lists open jobs with their ids and URIs by default', () => {
    const { context } = withJob();
    const { response } = handleIppRequest(ippRequest(OPERATIONS.getJobs), NO_DATA, context);
    const jobs = response.groups.filter((group) => group.tag === GROUP_TAGS.job);
    expect(jobs.map((group) => group.attributes.map((item) => item.name))).toEqual([['job-id', 'job-uri']]);
    const completed = handleIppRequest(
      ippRequest(OPERATIONS.getJobs, { operation: [keywordAttr('which-jobs', 'completed')] }),
      NO_DATA,
      context,
    );
    expect(completed.response.groups.filter((group) => group.tag === GROUP_TAGS.job)).toHaveLength(0);
    const bad = handleIppRequest(
      ippRequest(OPERATIONS.getJobs, { operation: [keywordAttr('which-jobs', 'fetchable')] }),
      NO_DATA,
      context,
    );
    expect(bad.response.code).toBe(STATUS.attributesOrValuesNotSupported);
  });

  // 任务名、用户名是对方电脑的隐私：别的电脑查不到，只看得到自己交的任务。
  test('shows a computer only its own jobs', () => {
    const { context, id } = withJob();
    const other = { ...context, client: '192.168.1.99' };
    const list = handleIppRequest(ippRequest(OPERATIONS.getJobs), NO_DATA, other);
    expect(list.response.groups.filter((group) => group.tag === GROUP_TAGS.job)).toHaveLength(0);
    const one = handleIppRequest(
      ippRequest(OPERATIONS.getJobAttributes, { operation: [integerAttr('job-id', id)] }),
      NO_DATA,
      other,
    );
    expect(one.response.code).toBe(STATUS.notFound);
  });

  test('describes one job found by id or by URI', () => {
    const { context, id } = withJob();
    const byId = handleIppRequest(
      ippRequest(OPERATIONS.getJobAttributes, { operation: [integerAttr('job-id', id)] }),
      NO_DATA,
      context,
    );
    expect(stringValue(attributeIn(byId.response, GROUP_TAGS.job, 'job-name'))).toBe(UNTITLED_JOB);
    const byUri = handleIppRequest(
      ippRequest(OPERATIONS.getJobAttributes, {
        printerUri: null,
        operation: [uriAttr('job-uri', `${TEST_PRINTER_URI}/jobs/${id}`)],
      }),
      NO_DATA,
      context,
    );
    expect(byUri.response.code).toBe(STATUS.ok);
    const byPath = handleIppRequest(ippRequest(OPERATIONS.getJobAttributes), NO_DATA, { ...context, pathJobId: id });
    expect(byPath.response.code).toBe(STATUS.ok);
    const missing = handleIppRequest(
      ippRequest(OPERATIONS.getJobAttributes, { operation: [integerAttr('job-id', 99)] }),
      NO_DATA,
      context,
    );
    expect(missing.response.code).toBe(STATUS.notFound);
  });

  test('cancels only jobs from the same computer', () => {
    const { context, id } = withJob();
    const cancel = ippRequest(OPERATIONS.cancelJob, { operation: [integerAttr('job-id', id)] });
    expect(handleIppRequest(cancel, NO_DATA, { ...context, client: '192.168.1.99' }).response.code).toBe(
      STATUS.notAuthorized,
    );
    expect(handleIppRequest(cancel, NO_DATA, context).response.code).toBe(STATUS.ok);
    expect(context.book.get(id)?.state).toBe('canceled');
    expect(handleIppRequest(cancel, NO_DATA, context).response.code).toBe(STATUS.notPossible);
  });
});
