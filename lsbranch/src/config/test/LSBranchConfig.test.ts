// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { FileSystem, JsonFile } from '@rushstack/node-core-library';
import { StringBufferTerminalProvider, Terminal } from '@rushstack/terminal';

import { LSBranchConfig, LSBranchConfigurationSchemaRepo, LSBranchRepoSelector } from '../LSBranchConfig';
import type { LSBranchConfigurationSchema } from '../lsbranchrc.schema.json.d.ts';

describe(LSBranchConfig.name, () => {
  let terminalProvider: StringBufferTerminalProvider;
  let terminal: Terminal;

  beforeEach(() => {
    terminalProvider = new StringBufferTerminalProvider(true);
    terminal = new Terminal(terminalProvider);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('rejects empty repository paths in the configuration schema', async () => {
    jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue(JSON.stringify({ repos: [{ path: '' }] }));
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.getConfigReposAsync()).rejects.toThrow(/fewer than 1 character/);
  });

  it.each(['.', 'a', 'relative/repo', 'C:relative', ' '])(
    'rejects a relative repository path of %j',
    async (repoPath) => {
      jest
        .spyOn(FileSystem, 'readFileAsync')
        .mockResolvedValue(JSON.stringify({ repos: [{ path: repoPath }] }));
      const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

      await expect(config.getConfigReposAsync()).rejects.toThrow('absolute-path');
    }
  );

  it.each([path.resolve('repo'), path.parse(process.cwd()).root])(
    'accepts an absolute repository path of %j',
    async (repoPath) => {
      const repo: LSBranchConfigurationSchemaRepo = { path: repoPath };
      jest.spyOn(FileSystem, 'readFileAsync').mockResolvedValue(JSON.stringify({ repos: [repo] }));
      const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

      await expect(config.getConfigReposAsync()).resolves.toEqual([repo]);
    }
  );

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

    await expect(Promise.all([config.getConfigExistsAsync(), config.getConfigReposAsync()])).rejects.toBe(
      error
    );
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
    await config.getConfigReposAsync();
    readRepoPath.mockClear();

    await config.setLastUpdateCheckAsync();

    expect(readRepoPath).not.toHaveBeenCalled();
    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(false);
    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('rebuilds counters after successfully adding a repository', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [] });
    jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(true);
    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(false);
    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('reports duplicate paths and aliases during validation', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [
        { path: '/repo', alias: 'Shared' },
        { path: '/repo', alias: 'Shared' }
      ]
    });
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.validateAsync(terminal)).resolves.toBe(false);

    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it.each<LSBranchRepoSelector>([{ path: '/repo' }, { alias: 'Repo' }])(
    'removes exactly the selected repository %j and preserves metadata',
    async (selector) => {
      const retainedRepo: LSBranchConfigurationSchemaRepo = { path: '/retained', alias: 'Retained' };
      jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
        repos: [{ path: '/repo', alias: 'Repo' }, retainedRepo],
        lastUpdateCheck: 123
      });
      const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
      const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

      await expect(config.tryRemoveRepoAsync(selector, terminal)).resolves.toBe(true);

      expect(saveConfig).toHaveBeenCalledWith(
        { repos: [retainedRepo], lastUpdateCheck: 123 },
        config.configPath,
        { updateExistingFile: true, prettyFormatting: true }
      );
      await expect(config.getConfigReposAsync()).resolves.toEqual([retainedRepo]);
      await expect(config.tryAddRepoAsync({ path: '/repo', alias: 'Repo' }, terminal)).resolves.toBe(true);
    }
  );

  it('reports an unmatched removal without saving', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [{ path: '/repo' }] });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.tryRemoveRepoAsync({ alias: 'Absent' }, terminal)).resolves.toBe(false);

    expect(saveConfig).not.toHaveBeenCalled();
    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('refuses ambiguous removal without saving', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: '/one', alias: 'Shared' }, { path: '/two', alias: 'Shared' }]
    });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.tryRemoveRepoAsync({ alias: 'Shared' }, terminal)).resolves.toBe(false);

    expect(saveConfig).not.toHaveBeenCalled();
    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('preserves configuration and counters if removal cannot be saved', async () => {
    const repo: LSBranchConfigurationSchemaRepo = { path: '/repo', alias: 'Repo' };
    const error: Error = new Error('Unable to save configuration');
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({ repos: [repo] });
    jest.spyOn(JsonFile, 'saveAsync').mockRejectedValue(error);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.tryRemoveRepoAsync({ alias: 'Repo' }, terminal)).rejects.toBe(error);
    await expect(config.getConfigReposAsync()).resolves.toEqual([repo]);
    await expect(config.tryAddRepoAsync({ path: '/repo' }, terminal)).resolves.toBe(false);
  });

  it('reports all conflicts when adding a repository', async () => {
    jest.spyOn(JsonFile, 'loadAndValidateAsync').mockResolvedValue({
      repos: [{ path: '/repo', alias: 'Shared' }]
    });
    const saveConfig: jest.SpyInstance = jest.spyOn(JsonFile, 'saveAsync').mockResolvedValue(true);
    const config: LSBranchConfig = new LSBranchConfig(() => '/config.json');

    await expect(config.tryAddRepoAsync({ path: '/repo', alias: 'Shared' }, terminal)).resolves.toBe(false);

    expect(saveConfig).not.toHaveBeenCalled();
    expect(terminalProvider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });
});
