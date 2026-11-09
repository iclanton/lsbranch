// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';
import { Executable, FileSystem, FolderItem } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync } from '../RepoData';
import { getGitPathsAsync } from '../GitRepository';

const COMMIT: string = 'a'.repeat(40);

describe(getRepoDataAsync.name, () => {
  let fixturePath: string;
  let repo: LSBranchConfigurationSchemaRepo;

  async function writeFileAsync(filename: string, contents: string): Promise<void> {
    const fullPath: string = `${fixturePath}/${filename}`;
    await FileSystem.writeFileAsync(fullPath, contents, { ensureFolderExists: true });
  }

  beforeEach(async () => {
    fixturePath = `${os.tmpdir()}/lsbranch-refs-test-${randomUUID()}`;
    repo = { path: `${fixturePath}/repo` };
    await writeFileAsync('repo/.git/HEAD', 'ref: refs/heads/main\n');
    jest.spyOn(Executable, 'spawn').mockImplementation(() => {
      throw new Error('Git subprocesses must not be launched');
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await FileSystem.deleteFolderAsync(fixturePath);
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
    const worktree: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/worktree` };
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

  it('resolves relative gitdir paths from the canonical checkout directory', async () => {
    const checkout: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/nested/alias` };
    await writeFileAsync('checkout/.git', 'gitdir: ../repo/.git\n');
    await FileSystem.ensureFolderAsync(`${fixturePath}/nested`);
    await FileSystem.createSymbolicLinkJunctionAsync({
      linkTargetPath: `${fixturePath}/checkout`,
      newLinkPath: checkout.path
    });
    await writeFileAsync('nested/repo/.git/HEAD', 'ref: refs/heads/wrong-repository\n');

    await expect(getRepoDataAsync(checkout, false)).resolves.toEqual({
      repo: checkout, data: { checkedOutBranch: 'main' }
    });
  });

  it('resolves relative commondir paths from the canonical Git directory', async () => {
    const worktree: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/worktree` };
    await writeFileAsync('repo/.git/worktrees/linked/HEAD', 'ref: refs/heads/linked\n');
    await writeFileAsync('repo/.git/worktrees/linked/commondir', '../..\n');
    await writeFileAsync('repo/.git/packed-refs', `${COMMIT} refs/heads/main\n`);
    await FileSystem.ensureFolderAsync(`${fixturePath}/nested`);
    await FileSystem.createSymbolicLinkJunctionAsync({
      linkTargetPath: `${fixturePath}/repo/.git/worktrees/linked`,
      newLinkPath: `${fixturePath}/nested/git-alias`
    });
    await writeFileAsync('worktree/.git', `gitdir: ${fixturePath}/nested/git-alias\n`);
    await writeFileAsync('packed-refs', `${COMMIT} refs/heads/wrong-repository\n`);

    await expect(getRepoDataAsync(worktree, true)).resolves.toEqual({
      repo: worktree, data: { checkedOutBranch: 'linked', otherBranches: ['main'] }
    });
  });

  it('supports a gitdir file without a commondir file', async () => {
    const checkout: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/checkout` };
    await writeFileAsync('checkout/.git', 'gitdir: ../repo/.git\n');

    await expect(getRepoDataAsync(checkout, false)).resolves.toEqual({
      repo: checkout,
      data: { checkedOutBranch: 'main' }
    });
  });

  it('detects a normal .git directory without a statistics call', async () => {
    const statistics: jest.SpyInstance = jest.spyOn(FileSystem, 'getStatisticsAsync');

    await expect(getGitPathsAsync(repo.path)).resolves.toEqual({
      gitDirectory: `${repo.path}/.git`,
      commonDirectory: `${repo.path}/.git`
    });
    expect(statistics).not.toHaveBeenCalled();
  });

  it('preserves absolute gitdir and commondir paths without resolution', async () => {
    const worktreePath: string = `${fixturePath}/absolute-worktree`;
    const gitDirectory: string = `${fixturePath}/repo/.git/worktrees/absolute`;
    const commonDirectory: string = `${fixturePath}/repo/.git`;
    await writeFileAsync('absolute-worktree/.git', `gitdir: ${gitDirectory}\n`);
    await writeFileAsync('repo/.git/worktrees/absolute/commondir', `${commonDirectory}\n`);
    const resolve: jest.SpyInstance = jest.spyOn(path, 'resolve');

    await expect(getGitPathsAsync(worktreePath)).resolves.toEqual({ gitDirectory, commonDirectory });
    expect(resolve).not.toHaveBeenCalled();
  });

  it('does not confuse permission errors with a .git directory', async () => {
    const permissionError: NodeJS.ErrnoException = Object.assign(new Error('Permission denied'), {
      code: 'EACCES', errno: -13, syscall: 'open'
    });
    jest.spyOn(FileSystem, 'readFileAsync').mockRejectedValue(permissionError);

    await expect(getRepoDataAsync(repo, false)).resolves.toEqual({ repo, error: permissionError });
  });

  it.each<[string, string[]]>([
    ['feature/*', ['feature/current']],
    ['feature/**', ['feature/current', 'feature/nested/topic']],
    ['release-?', ['release-a']],
    ['{main,release-*}', ['main', 'release-a', 'release-long']],
    ['@(main|release-a)', ['main', 'release-a']],
    ['feature/[c]*', ['feature/current']],
    ['absent*', []]
  ])('matches the local branch glob %j', async (pattern, matches) => {
    await writeFileAsync('repo/.git/HEAD', 'ref: refs/heads/feature/current\n');
    await writeFileAsync('repo/.git/refs/heads/feature/current', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/refs/heads/main', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/packed-refs', [
      `${COMMIT} refs/heads/feature/nested/topic`,
      `${COMMIT} refs/heads/release-a`,
      `${COMMIT} refs/heads/release-long`,
      `${COMMIT} refs/remotes/origin/absent-remote`,
      ''
    ].join('\n'));

    await expect(getRepoDataAsync(repo, false, pattern)).resolves.toEqual({
      repo,
      data: {
        checkedOutBranch: 'feature/current',
        matchingBranches: matches,
        hasLocalBranch: matches.length > 0,
        branchIsCheckedOut: matches.includes('feature/current')
      }
    });
  });

  it.each(['topic{one,two}', 'topic(one)', 'topic+name', 'topic!name'])(
    'finds a literal stored branch name containing glob syntax %j',
    async (branch) => {
      await writeFileAsync('repo/.git/packed-refs', `${COMMIT} refs/heads/${branch}\n`);

      await expect(getRepoDataAsync(repo, false, branch)).resolves.toEqual({
        repo,
        data: {
          checkedOutBranch: 'main',
          matchingBranches: [branch],
          hasLocalBranch: true,
          branchIsCheckedOut: false
        }
      });
    }
  );

  it('preserves literal matches alongside glob-expanded matches without duplicates', async () => {
    const branch: string = 'topic{one,two}';
    await writeFileAsync('repo/.git/refs/heads/topicone', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/packed-refs', [
      `${COMMIT} refs/heads/topicone`,
      `${COMMIT} refs/heads/topictwo`,
      `${COMMIT} refs/heads/${branch}`,
      ''
    ].join('\n'));

    const result = await getRepoDataAsync(repo, false, branch);

    expect(result).toHaveProperty('data.matchingBranches', ['topicone', 'topictwo', branch]);
  });

  it('does not read a symbolic-link ref target', async () => {
    await writeFileAsync('repo/.git/refs/heads/link', `${COMMIT}\n`);
    const headsDirectory: string = `${repo.path}/.git/refs/heads`;
    const entries: FolderItem[] = await FileSystem.readFolderItemsAsync(headsDirectory);
    jest.spyOn(entries[0], 'isSymbolicLink').mockReturnValue(true);
    jest.spyOn(FileSystem, 'readFolderItemsAsync').mockResolvedValue(entries);
    const readFile: jest.SpyInstance = jest.spyOn(FileSystem, 'readFileAsync');

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo, error: new Error('Symbolic links in local branch refs are not supported: link')
    });
    expect(readFile).not.toHaveBeenCalledWith(`${headsDirectory}/link`);
  });

  it('rejects symbolic-link branch directories before traversing them', async () => {
    const targetDirectory: string = `${fixturePath}/external-refs`;
    await FileSystem.ensureFolderAsync(`${repo.path}/.git/refs`);
    await FileSystem.ensureFolderAsync(targetDirectory);
    await FileSystem.createSymbolicLinkJunctionAsync({
      linkTargetPath: targetDirectory,
      newLinkPath: `${repo.path}/.git/refs/heads`
    });
    const readFolder: jest.SpyInstance = jest.spyOn(FileSystem, 'readFolderItemsAsync');

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo, error: new Error('Symbolic links in local branch refs are not supported: refs/heads')
    });
    expect(readFolder).not.toHaveBeenCalled();
  });

  it.each(['', 'invalid', 'ref: refs/remotes/origin/main\n'])('reports invalid HEAD contents %j', async (head) => {
    await writeFileAsync('repo/.git/HEAD', head);
    const result = await getRepoDataAsync(repo, false);

    expect(result).toHaveProperty('error');
  });

  it('reports a missing Git directory per repository', async () => {
    const missingRepo: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/missing` };

    await expect(getRepoDataAsync(missingRepo, true)).resolves.toEqual({
      repo: missingRepo,
      error: new Error(".git folder doesn't exist")
    });
  });

  it('reports a missing HEAD file', async () => {
    await FileSystem.deleteFileAsync(`${repo.path}/.git/HEAD`);

    await expect(getRepoDataAsync(repo, false)).resolves.toEqual({
      repo,
      error: new Error(".git/HEAD file doesn't exist")
    });
  });

  it('reports an invalid gitdir file', async () => {
    const invalidRepo: LSBranchConfigurationSchemaRepo = { path: `${fixturePath}/invalid` };
    await writeFileAsync('invalid/.git', 'not a gitdir file');

    const result = await getRepoDataAsync(invalidRepo, false);

    expect(result).toHaveProperty('error');
  });

  it('reports corrupt packed and loose references', async () => {
    await writeFileAsync('repo/.git/packed-refs', 'corrupt');
    const packedResult = await getRepoDataAsync(repo, true);
    expect(packedResult).toHaveProperty('error');
    await FileSystem.deleteFileAsync(`${repo.path}/.git/packed-refs`);
    await writeFileAsync('repo/.git/refs/heads/corrupt', 'invalid hash');
    const looseResult = await getRepoDataAsync(repo, true);
    expect(looseResult).toHaveProperty('error');
  });

  it('finds loose and packed branches but not remote-tracking branches', async () => {
    await writeFileAsync('repo/.git/refs/heads/main', `${COMMIT}\n`);
    await writeFileAsync('repo/.git/packed-refs', [
      `${COMMIT} refs/heads/feature/nested`,
      `${COMMIT} refs/remotes/origin/remote-only`,
      ''
    ].join('\n'));

    await expect(getRepoDataAsync(repo, false, 'main')).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: true, branchIsCheckedOut: true, matchingBranches: ['main'] }
    });
    await expect(getRepoDataAsync(repo, false, 'feature/nested')).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: true, branchIsCheckedOut: false, matchingBranches: ['feature/nested'] }
    });
    await expect(getRepoDataAsync(repo, false, 'remote-only')).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: false, branchIsCheckedOut: false, matchingBranches: [] }
    });
  });

  it('does not find an unborn HEAD name without a stored branch reference', async () => {
    await expect(getRepoDataAsync(repo, false, 'main')).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: false, branchIsCheckedOut: false, matchingBranches: [] }
    });
  });

  it.each(['closing]', '@', 'foo./bar', '-name', 'HEAD'])('accepts valid stored local ref name %j', async (branch) => {
    await writeFileAsync('repo/.git/packed-refs', `${COMMIT} refs/heads/${branch}\n`);

    await expect(getRepoDataAsync(repo, false, branch)).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', hasLocalBranch: true, branchIsCheckedOut: false, matchingBranches: [branch] }
    });
  });

  it.each([
    '[extensions]\n\trefStorage = reftable\n',
    '[extensions]\n\trefStorage = "reftable" # comment\n',
    '[extensions]\n\trefStorage = reftable ; comment\n'
  ])('explicitly rejects unsupported reftable storage in %j', async (config) => {
    await writeFileAsync('repo/.git/config', config);

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo,
      error: new Error('Git reftable reference storage is not supported')
    });
  });

  it('does not treat a refStorage key outside extensions as a storage backend', async () => {
    await writeFileAsync('repo/.git/config', '[alias]\n refStorage = reftable\n');

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', otherBranches: [] }
    });
  });

  it('uses the final extensions.refStorage value', async () => {
    await writeFileAsync('repo/.git/config', '[extensions]\n refStorage = reftable\n refStorage = files\n');

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo, data: { checkedOutBranch: 'main', otherBranches: [] }
    });
  });

  it('does not confuse a SHA-shaped local branch with a detached HEAD', async () => {
    await writeFileAsync('repo/.git/HEAD', `${COMMIT}\n`);
    await writeFileAsync(`repo/.git/refs/heads/${COMMIT}`, `${COMMIT}\n`);

    await expect(getRepoDataAsync(repo, true)).resolves.toEqual({
      repo, data: { checkedOutBranch: COMMIT, otherBranches: [COMMIT] }
    });
    await expect(getRepoDataAsync(repo, false, COMMIT)).resolves.toEqual({
      repo, data: { checkedOutBranch: COMMIT, hasLocalBranch: true, branchIsCheckedOut: false, matchingBranches: [COMMIT] }
    });
  });
});
