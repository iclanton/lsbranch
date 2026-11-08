// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ChildProcess } from 'node:child_process';
import { PassThrough } from 'node:stream';
import path from 'node:path';
import { Executable, FileSystem, IWaitForExitResult } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataResult } from '../RepoData';

describe(getRepoDataAsync.name, () => {
  const repo: LSBranchConfigurationSchemaRepo = { path: '/repo' };

  beforeEach(() => {
    jest.spyOn(Executable, 'spawn').mockReturnValue(new ChildProcess());
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it.each<[IWaitForExitResult<string>, string]>([
    [
      { exitCode: 128, signal: null, stdout: '', stderr: 'not a git repository' },
      'git branch failed with exit code 128: not a git repository'
    ],
    [
      { exitCode: null, signal: 'SIGTERM', stdout: '', stderr: '' },
      'git branch terminated by signal SIGTERM'
    ],
    [
      { exitCode: 0, signal: null, stdout: '* main\n', stderr: 'warning' },
      'git branch wrote to stderr: warning'
    ],
    [
      { exitCode: 0, signal: null, stdout: '  other\n', stderr: '' },
      'git branch did not report a checked out branch'
    ],
    [
      { exitCode: 0, signal: null, stdout: '* main\n* other\n', stderr: '' },
      'git branch reported multiple checked out branches: main, other'
    ]
  ])('returns a per-repository error for %j', async (processResult, message) => {
    jest.spyOn(Executable, 'waitForExitAsync').mockResolvedValue(processResult);

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({ repo, error: new Error(message) });
  });

  it('returns the current branch and all other branches', async () => {
    const processResult: IWaitForExitResult<string> = {
      exitCode: 0,
      signal: null,
      stdout: '* feature/nested\n  main\n  other\n',
      stderr: ''
    };
    jest.spyOn(Executable, 'waitForExitAsync').mockResolvedValue(processResult);

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      data: { checkedOutBranch: 'feature/nested', otherBranches: ['main', 'other'] }
    });
  });

  it.each<[number | null, string | null, string, string]>([
    [
      128,
      null,
      'not a git repository',
      'git branch failed with exit code 128: not a git repository'
    ],
    [null, 'SIGTERM', '', 'git branch terminated by signal SIGTERM']
  ])(
    'handles exit code %s and signal %s using the real wait helper',
    async (exitCode, signal, stderrText, message) => {
      const stdout: PassThrough = new PassThrough();
      const stderr: PassThrough = new PassThrough();
      const childProcess: ChildProcess = Object.assign(new ChildProcess(), { stdout, stderr });
      jest.spyOn(Executable, 'spawn').mockReturnValue(childProcess);

      const resultPromise: Promise<IGetRepoDataResult> = getRepoDataAsync(repo, true);
      stdout.end();
      stderr.end(stderrText);
      childProcess.emit('close', exitCode, signal);

      await expect(resultPromise).resolves.toEqual({ repo, error: new Error(message) });
    }
  );

  it('reads the expected HEAD file for an absolute repository path', async () => {
    const repoPath: string = path.resolve('repo');
    const configuredRepo: LSBranchConfigurationSchemaRepo = { path: repoPath };
    const readHead: jest.SpyInstance = jest
      .spyOn(FileSystem, 'readFileAsync')
      .mockResolvedValue('ref: refs/heads/main\n');

    await expect(getRepoDataAsync(configuredRepo, false)).resolves.toEqual({
      repo: configuredRepo,
      data: { checkedOutBranch: 'main' }
    });
    expect(readHead).toHaveBeenCalledWith(`${repoPath}/.git/HEAD`);
  });
});
