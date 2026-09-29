import { describe, expect, test } from 'bun:test';
import { OPENAPI_PATHS } from './openapi';
import { ROUTES } from './router';

describe('OpenAPI description', () => {
  // 第三方照着文档生成的代码要能调通：文档里的路径和方法必须和路由表完全一致。
  test('describes exactly the routes the router serves', () => {
    const documented = Object.entries(OPENAPI_PATHS).flatMap(([path, methods]) =>
      Object.keys(methods).map((method) => `${method.toUpperCase()} ${path}`),
    );
    expect(documented.sort()).toEqual(ROUTES.map((item) => `${item.method} ${item.openApiPath}`).sort());
  });

  test('marks only the service description routes as open', () => {
    const open = Object.entries(OPENAPI_PATHS).flatMap(([path, methods]) =>
      Object.entries(methods).flatMap(([method, operation]) =>
        Array.isArray((operation as { security?: unknown[] }).security) ? [`${method.toUpperCase()} ${path}`] : [],
      ),
    );
    expect(open.sort()).toEqual(
      ROUTES.filter((item) => !item.needsCaller)
        .map((item) => `${item.method} ${item.openApiPath}`)
        .sort(),
    );
  });
});
