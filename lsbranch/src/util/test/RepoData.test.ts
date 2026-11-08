// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ChildProcess } from 'node:child_process';
import { Executable, IWaitForExitResult } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync } from '../RepoData';

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
});
