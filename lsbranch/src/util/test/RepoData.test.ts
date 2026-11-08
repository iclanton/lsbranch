// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Executable } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync } from '../RepoData';

const COMMIT: string = 'a'.repeat(40);

describe(getRepoDataAsync.name, () => {
  let fixturePath: string;
  let repo: LSBranchConfigurationSchemaRepo;

  async function writeFileAsync(filename: string, contents: string): Promise<void> {
    const fullPath: string = path.join(fixturePath, filename);
    await fs.mkdir(path.dirname(fullPath), { recursive: true });
    await fs.writeFile(fullPath, contents);
  }

  beforeEach(async () => {
    fixturePath = await fs.mkdtemp(path.join(os.tmpdir(), 'lsbranch-refs-test-'));
    repo = { path: path.join(fixturePath, 'repo') };
    await writeFileAsync('repo/.git/HEAD', 'ref: refs/heads/main\n');
    jest.spyOn(Executable, 'spawn').mockImplementation(() => {
      throw new Error('Git subprocesses must not be launched');
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await fs.rm(fixturePath, { recursive: true });
  });

  it('reads the checked-out branch without reading other references', async () => {
    await writeFileAsync('repo/.git/packed-refs', 'invalid packed refs');

    await expect(getRepoDataAsync(repo, false)).resolves.toEqual({ repo, data: { checkedOutBranch: 'main' } });
  });

  it('combines loose and packed local branches and excludes remote refs and tags', async () => {
    await writeFileAsync('repo/.git/refs/heads/main', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/refs/heads/feature/nested', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/refs/heads/main.lock', 'temporary lock');
    await writeFileAsync('repo/.git/packed-refs', [
      '# pack-refs with: peeled fully-peeled sorted',
      `${COMMIT} refs/heads/main`,
      `${COMMIT} refs/heads/packed`,
      `${COMMIT} refs/tags/release`,
      `^${COMMIT}`,
      `${COMMIT} refs/remotes/origin/remote-only`,
      ''
    ].join('\n'));

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      data: { checkedOutBranch: 'main', otherBranches: ['feature/nested', 'packed'] }
    });
    expect(Executable.spawn).not.toHaveBeenCalled();
  });

  it('lists every local branch for a detached HEAD', async () => {
    await writeFileAsync('repo/.git/HEAD', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/refs/heads/main', `${COMMIT}\n`);

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      data: { checkedOutBranch: COMMIT, otherBranches: ['main'] }
    });
  });

  it('supports an unborn branch with no stored local refs', async () => {
    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      data: { checkedOutBranch: 'main', otherBranches: [] }
    });
  });

  it('reads linked-worktree HEAD and branches from its common Git directory', async () => {
    const worktree: LSBranchConfigurationSchemaRepo = { path: path.join(fixturePath, 'worktree') };
    await writeFileAsync('worktree/.git', 'gitdir: ../repo/.git/worktrees/linked\n');
    await writeFileAsync('repo/.git/worktrees/linked/HEAD', 'ref: refs/heads/linked\n');
    await writeFileAsync('repo/.git/worktrees/linked/commondir', '../..\n');
    await writeFileAsync('repo/.git/refs/heads/main', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/packed-refs', `${COMMIT} refs/heads/linked\n`);

    await expect(getRepoDataAsync(worktree, true)).resolves.toEqual({
      repo: worktree,
      data: { checkedOutBranch: 'linked', otherBranches: ['main'] }
    });
  });

  it('supports a gitdir file without a commondir file', async () => {
    const checkout: LSBranchConfigurationSchemaRepo = { path: path.join(fixturePath, 'checkout') };
    await writeFileAsync('checkout/.git', 'gitdir: ../repo/.git\n');

    await expect(getRepoDataAsync(checkout, false)).resolves.toEqual({
      repo: checkout,
      data: { checkedOutBranch: 'main' }
    });
  });

  it.each(['', 'invalid', 'ref: refs/remotes/origin/main\n'])('reports invalid HEAD contents %j', async (head) => {
    await writeFileAsync('repo/.git/HEAD', head);
    const result = await getRepoDataAsync(repo, false);

    expect(result).toHaveProperty('error');
  });

  it('reports a missing Git directory per repository', async () => {
    const missingRepo: LSBranchConfigurationSchemaRepo = { path: path.join(fixturePath, 'missing') };

    await expect(getRepoDataAsync(missingRepo, true)).resolves.toEqual({
      repo: missingRepo,
      error: new Error(".git folder doesn't exist")
    });
  });

  it('reports a missing HEAD file', async () => {
    await fs.unlink(path.join(repo.path, '.git', 'HEAD'));

    await expect(getRepoDataAsync(repo, false)).resolves.toEqual({
      repo,
      error: new Error(".git/HEAD file doesn't exist")
    });
  });

  it('reports an invalid gitdir file', async () => {
    const invalidRepo: LSBranchConfigurationSchemaRepo = { path: path.join(fixturePath, 'invalid') };
    await writeFileAsync('invalid/.git', 'not a gitdir file');

    const result = await getRepoDataAsync(invalidRepo, false);

    expect(result).toHaveProperty('error');
  });

  it('reports corrupt packed and loose references', async () => {
    await writeFileAsync('repo/.git/packed-refs', 'corrupt');
    const packedResult = await getRepoDataAsync(repo, true);
    expect(packedResult).toHaveProperty('error');
    await fs.unlink(path.join(repo.path, '.git', 'packed-refs'));
    await writeFileAsync('repo/.git/refs/heads/corrupt', 'invalid hash');
    const looseResult = await getRepoDataAsync(repo, true);
    expect(looseResult).toHaveProperty('error');
  });

  it('explicitly rejects unsupported reftable storage', async () => {
    await writeFileAsync('repo/.git/config', '[extensions]\n\trefStorage = reftable\n');

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      error: new Error('Git reftable reference storage is not supported')
    });
  });
});
