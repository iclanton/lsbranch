// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { StringBufferTerminalProvider, Terminal } from '@rushstack/terminal';
import { GitRepositoryError } from '../GitRepository';
import { IGetRepoDataSuccessResult } from '../RepoData';
import { groupRepoResultsAsync } from '../RepoGrouping';
import * as RepoIdentity from '../RepoIdentity';

describe(groupRepoResultsAsync.name, () => {
  let provider: StringBufferTerminalProvider;
  let terminal: Terminal;
  let identities: Map<string, RepoIdentity.IRepoIdentity>;

  function result(alias: string, remoteKeys: string[] = [], commonDirectory: string = `/git/${alias}`): IGetRepoDataSuccessResult {
    const repo = { path: `/repos/${alias}`, alias };
    identities.set(repo.path, { commonDirectory, remoteKeys });
    return { repo, data: { checkedOutBranch: 'main' } };
  }

  beforeEach(() => {
    identities = new Map();
    provider = new StringBufferTerminalProvider(true);
    terminal = new Terminal(provider);
    jest.spyOn(RepoIdentity, 'getRepoIdentityAsync').mockImplementation(async (repoPath) => {
      const identity: RepoIdentity.IRepoIdentity | undefined = identities.get(repoPath);
      if (!identity) {
        throw new Error('Unexpected identity lookup');
      }

      return identity;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('groups shared remote URLs and sorts groups and aliases', async () => {
    const z = result('Zulu', ['remote:host/shared']);
    const b = result('Bravo', ['remote:host/other']);
    const a = result('Alpha', ['remote:host/shared']);

    await expect(groupRepoResultsAsync([z, b, a], terminal)).resolves.toEqual([[a, z], [b]]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toEqual([]);
  });

  it('groups linked worktrees by their common directory even without remotes', async () => {
    const b = result('Beta', [], '/shared/git');
    const a = result('Alpha', [], '/shared/git');

    await expect(groupRepoResultsAsync([b, a], terminal)).resolves.toEqual([[a, b]]);
  });

  it.each([false, true])('warns about a bridging clone independent of input order, reversed=%s', async (reversed) => {
    const a = result('Alpha', ['remote:host/a']);
    const b = result('Beta', ['remote:host/b']);
    const bridge = result('Bridge', ['remote:host/a', 'remote:host/b']);

    await expect(groupRepoResultsAsync(reversed ? [bridge, b, a] : [a, b, bridge], terminal))
      .resolves.toEqual([[a, b, bridge]]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('does not warn when alternate links make the group unambiguous', async () => {
    const a = result('Alpha', ['a', 'b']);
    const b = result('Beta', ['b', 'c']);
    const c = result('Charlie', ['c', 'a']);

    await expect(groupRepoResultsAsync([c, b, a], terminal)).resolves.toEqual([[a, b, c]]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toEqual([]);
  });

  it('keeps unrelated repositories separate', async () => {
    const b = result('Beta');
    const a = result('Alpha');

    await expect(groupRepoResultsAsync([b, a], terminal)).resolves.toEqual([[a], [b]]);
  });

  it('warns and preserves branch results when identity metadata is uncertain', async () => {
    const b = result('Beta');
    const a = result('Alpha');
    jest.spyOn(RepoIdentity, 'getRepoIdentityAsync')
      .mockRejectedValueOnce(new GitRepositoryError('Unsupported include condition'))
      .mockResolvedValueOnce({ commonDirectory: '/git/Alpha', remoteKeys: [] });

    await expect(groupRepoResultsAsync([b, a], terminal)).resolves.toEqual([[a], [b]]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toMatchSnapshot('terminal output');
  });

  it('propagates unexpected programming errors', async () => {
    const a = result('Alpha');
    const error: Error = new Error('Unexpected implementation failure');
    jest.spyOn(RepoIdentity, 'getRepoIdentityAsync').mockRejectedValue(error);

    await expect(groupRepoResultsAsync([a], terminal)).rejects.toBe(error);
  });

  it('handles a large shared group without ambiguity warnings', async () => {
    const repos = Array.from({ length: 500 }, (value, index) => result(
      `Repo${index.toString().padStart(3, '0')}`, ['remote:host/shared']
    ));

    await expect(groupRepoResultsAsync([...repos].reverse(), terminal)).resolves.toEqual([repos]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toEqual([]);
  });

  it('handles long ambiguity chains without recursive stack growth', async () => {
    const repos = Array.from({ length: 1000 }, (value, index) => result(
      `Repo${index.toString().padStart(4, '0')}`, [`edge:${index - 1}`, `edge:${index}`]
    ));

    await expect(groupRepoResultsAsync(repos, terminal)).resolves.toEqual([repos]);
    expect(provider.getAllOutputAsChunks({ asLines: true })).toHaveLength(998);
  });
});
