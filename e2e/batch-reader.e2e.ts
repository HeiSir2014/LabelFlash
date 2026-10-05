import { BATCH_LIMITS } from '../src/core/batch/batch-model';
import { minimalXlsx } from '../src/main/batch/testing/minimal-xlsx';
import { callApi } from './support/app-helpers';
import { expect, test } from './support/fixtures';

/**
 * 读表格走一个单独的子进程 bundle（src/main/batch/reader-worker.ts，由 electron-vite 的
 * `?modulePath` 单独打包，见 verify:bundle）。单元测试只用假的 readSheet/子进程，这里用真正构建出来的
 * 产物（launchApp 从项目根目录按 package.json 的 main 启动，不是源码）核对子进程真的能起来、读出真实数据，
 * 以及超限的文件在交给子进程之前就被拦住。超时行为（READ_TIMEOUT_ISSUE）已经由
 * table-reader-host.test.ts 用假的子进程和可控的计时器覆盖；真的等 30 秒会让这个用例变慢又不稳定，
 * 这里不重复验证。
 */
test('reads a real .xlsx through the built table reader process', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  const bytes = minimalXlsx([
    ['编码', '颜色'],
    ['CL1', '红'],
    ['CL2', '黑'],
  ]);
  const result = await callApi(page, 'readDroppedBatchFile', '货号.xlsx', bytes);
  expect(result).toMatchObject({
    status: 'loaded',
    table: {
      name: '货号.xlsx',
      columns: ['编码', '颜色'],
      rows: [
        ['CL1', '红'],
        ['CL2', '黑'],
      ],
    },
  });
});

// IPC 校验（requireBytes）在参数进 BatchStation 之前就按大小拦下：渲染进程不可信，
// 这一步比 BatchStation 自己的上限检查更早，所以这里看到的是 IPC 调用本身被拒绝，不是一个 invalid 结果。
test('refuses a file over the size limit without starting the reader process', async ({ electronApp }) => {
  const { page } = await electronApp.launch();
  // 刚好超过上限一个字节：不用构造更大的文件也能确认是按大小拦下的，拦下之后不会再去读子进程。
  const bytes = new Uint8Array(BATCH_LIMITS.fileBytes + 1);
  await expect(callApi(page, 'readDroppedBatchFile', 'huge.csv', bytes)).rejects.toThrow('Invalid file');
});
