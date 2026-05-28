import test from 'node:test';
import assert from 'node:assert/strict';
import { generateReleaseData } from '../scripts/generate-releases.mjs';
import { runReported } from './helpers/openlogos-reporter.mjs';

function createFetchResponse(payload, options = {}) {
  const {
    status = 200,
    headers = {},
  } = options;
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name) {
        const key = Object.keys(headers).find((item) => item.toLowerCase() === name.toLowerCase());
        return key ? headers[key] : null;
      },
    },
    async json() {
      return payload;
    },
    body: {
      async cancel() {},
    },
  };
}

function createRegistryPackument() {
  return {
    'dist-tags': {
      latest: '9.9.9',
    },
    time: {
      modified: '2026-05-28T00:00:00.000Z',
      '9.9.9': '2026-05-28T00:00:00.000Z',
    },
    versions: {
      '9.9.9': {
        dist: {
          tarball: 'https://example.com/openlogos-9.9.9.tgz',
          size: 1234,
          unpackedSize: 4321,
          fileCount: 12,
        },
        engines: {
          node: '>=18',
        },
        dependencies: {
          yaml: '^2.8.3',
        },
        license: 'Apache-2.0',
        gitHead: 'abcdef1234567890',
      },
    },
  };
}

test('UT-S19-05: strict 模式下 registry 失败必须抛错，不允许回退缓存', async () => runReported('UT-S19-05', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => {
    throw new Error('registry unavailable');
  };
  try {
    await assert.rejects(
      () => generateReleaseData({
        strict: true,
        logger: { log() {}, warn() {} },
      }),
      /Strict release data generation failed: registry unavailable/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
}));

test('UT-S19-06: strict 模式下生成成功时 latestVersion 与 registry latest 一致', async () => runReported('UT-S19-06', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const target = String(url);
    if (target.includes('registry.npmjs.org')) {
      return createFetchResponse(createRegistryPackument());
    }
    if (target.endsWith('.tgz')) {
      return createFetchResponse({}, {
        status: 200,
        headers: {
          'content-length': '2048',
        },
      });
    }
    throw new Error(`unexpected fetch url: ${target}, method=${init.method ?? 'GET'}`);
  };

  try {
    const result = await generateReleaseData({
      strict: true,
      logger: { log() {}, warn() {} },
    });
    assert.equal(result.fromCache, false);
    assert.equal(result.data.latestVersion, '9.9.9');
    assert.equal(result.data.versionCount, 1);
    assert.equal(result.data.versions[0].version, '9.9.9');
    assert.equal(result.data.versions[0].size, 2048);
  } finally {
    globalThis.fetch = originalFetch;
  }
}));
