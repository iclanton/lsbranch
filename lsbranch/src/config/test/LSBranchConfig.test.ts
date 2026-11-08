// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { JsonFile } from '@rushstack/node-core-library';
import { StringBufferTerminalProvider, Terminal } from '@rushstack/terminal';

import { LSBranchConfig, LSBranchConfigurationSchemaRepo } from '../LSBranchConfig';
import type { LSBranchConfigurationSchema } from '../lsbranchrc.schema.json.d.ts';

describe(LSBranchConfig.name, () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('shares an in-flight load across concurrent callers', async () => {
    const configData: LSBranchConfigurationSchema = { repos: [{ path: '/repo' }], lastUpdateCheck: 0 };
    let resolveLoad!: (data: LSBranchConfigurationSchema) => void;
    const loadPromise: Promise<LSBranchConfigurationSchema> = new Promise((resolve) => {
      resolveLoad = resolve;
    });
    const loadConfig: jest.SpyInstance = jest
      .spyOn(JsonFile, 'loadAndValidateAsync')
      .mockReturnValue(loadPromise);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');
    const resultsPromise: Promise<[boolean, LSBranchConfigurationSchemaRepo[], boolean]> = Promise.all([
      config.getConfigExistsAsync(),
      config.getConfigReposAsync(),
      config.getShouldCheckForUpdatesAsync()
    ]);

    expect(loadConfig).toHaveBeenCalledTimes(1);
    resolveLoad(configData);
    await expect(resultsPromise).resolves.toEqual([true, configData.repos, true]);
    await config.getConfigExistsAsync();
    expect(loadConfig).toHaveBeenCalledTimes(1);
  });

  it('propagates load failures and retries on the next call', async () => {
    const error: Error = new Error('Invalid configuration');
    const loadConfig: jest.SpyInstance = jest
      .spyOn(JsonFile, 'loadAndValidateAsync')
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce({ repos: [] });
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(
      Promise.all([config.getConfigExistsAsync(), config.getConfigReposAsync()])
    ).rejects.toBe(error);
    await expect(config.getConfigExistsAsync()).resolves.toBe(true);
    expect(loadConfig).toHaveBeenCalledTimes(2);
  });

  it('loads configuration before updating its timestamp', async () => {
    const repo: LSBranchConfigurationSchemaRepo = { path: '/repo' };
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: 0 });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await config.setLastUpdateCheckAsync();

    expect(saveConfig).toHaveBeenCalledWith(
      { repos: [repo], lastUpdateCheck: expect.any(Number) },
      config.configPath,
      { updateExistingFile: true, prettyFormatting: true }
    );
    await expect(config.getConfigReposAsync()).resolves.toEqual([repo]);
  });

  it('does not rebuild repository counters for timestamp-only updates', async () => {
    const repo: LSBranchConfigurationSchemaRepo = {
      get path(): string {
        return '/repo';
      }
    };
    const readRepoPath: jest.SpyInstance = jest.spyOn(repo, 'path', 'get');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo], lastUpdateCheck: 0 });
    jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');
    const terminal: Terminal = new Terminal(new StringBufferTerminalProvider());
    await config.getConfigReposAsync();
    readRepoPath.mockClear();

    await config.setLastUpdateCheckAsync();

    expect(readRepoPath).not.toHaveBeenCalled();
    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(false);
  });

  it('rebuilds counters after successfully adding a repository', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [] });
    jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');
    const terminal: Terminal = new Terminal(new StringBufferTerminalProvider());

    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(true);
    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(false);
  });
});
