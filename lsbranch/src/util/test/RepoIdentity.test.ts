// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { FileSystem, PackageJsonLookup } from '@rushstack/node-core-library';
import { getRepoIdentityAsync, normalizeRemoteUrl } from '../RepoIdentity';

describe(getRepoIdentityAsync.name, () => {
  const projectDir: string | undefined = PackageJsonLookup.instance.tryGetPackageFolderFor(__dirname);
  if (projectDir === undefined) {
    throw new Error('Unable to locate the project root for repository-identity tests.');
  }

  const fixturePath: string = `${projectDir}/temp/tests/repo-identity`;
  let repoPath: string;

  async function writeConfigAsync(contents: string): Promise<void> {
    await FileSystem.writeFileAsync(`${repoPath}/.git/config`, contents);
  }

  beforeEach(async () => {
    await FileSystem.ensureEmptyFolderAsync(fixturePath);
    repoPath = `${fixturePath}/repo`;
    await FileSystem.ensureFolderAsync(`${repoPath}/.git`);
    await FileSystem.writeFileAsync(`${repoPath}/.git/HEAD`, 'ref: refs/heads/feature/nested\n');
  });

  afterEach(async () => {
    await FileSystem.deleteFolderAsync(fixturePath);
  });

  it.each([
    'https://ignored@EXAMPLE.invalid/org/repo.git/',
    'http://example.invalid/org/repo',
    'ssh://git@example.invalid:22/org/repo.git',
    'git@example.invalid:org/repo.git',
    'git://example.invalid:9418/org/repo.git'
  ])('normalizes common hosted URL %s without credentials', (url) => {
    expect(normalizeRemoteUrl(url, repoPath)).toBe('remote:example.invalid/org/repo');
  });

  it('normalizes IPv6 SSH and SCP URLs consistently', () => {
    expect(normalizeRemoteUrl('ssh://git@[::1]/org/repo.git', repoPath))
      .toBe(normalizeRemoteUrl('git@[::1]:org/repo.git', repoPath));
  });

  it('preserves nondefault ports and repository path case', () => {
    expect(normalizeRemoteUrl('ssh://git@example.invalid:2222/Org/Repo.git', repoPath))
      .toBe('remote:example.invalid:2222/Org/Repo');
  });

  it('resolves relative and file remotes without stripping local .git names', () => {
    const localRemote: string = path.resolve(`${fixturePath}/bare.git`);
    expect(normalizeRemoteUrl('../bare.git', repoPath)).toBe(`local:${localRemote}`);
    expect(normalizeRemoteUrl(pathToFileURL(localRemote).href, repoPath)).toBe(`local:${localRemote}`);
    expect(normalizeRemoteUrl(`${pathToFileURL(localRemote).href}/`, repoPath)).toBe(`local:${localRemote}`);
  });

  it('reads multiple, quoted, continued, and legacy remote URL entries', async () => {
    await writeConfigAsync([
      '[remote "origin"]',
      '  url = "https://example.invalid/org/repo.git" # comment',
      '  url = git@example.invalid:org/repo.git',
      '[remote.second]',
      '  url = https://example.invalid/org/\\',
      'other.git',
      ''
    ].join('\n'));

    await expect(getRepoIdentityAsync(repoPath)).resolves.toEqual({
      commonDirectory: await FileSystem.getRealPathAsync(`${repoPath}/.git`),
      remoteKeys: ['remote:example.invalid/org/repo', 'remote:example.invalid/org/other']
    });
  });

  it.each([
    'bare = false # cache path C:\\\n',
    '# cache path C:\\\n',
    'filemode ; explanation\n',
    'bare # explanation\n',
    'bare = false ; cache path C:\\\r\n'
  ])('preserves the next remote header after config line %j', async (line) => {
    await writeConfigAsync(`[core]\n${line}[remote "origin"]\n url = https://example.invalid/shared.git\n`);

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('does not treat an escaped backslash at the end of a value as a continuation', async () => {
    await writeConfigAsync([
      '[core]',
      ' key = value\\\\',
      '[remote "origin"]',
      ' url = https://example.invalid/shared.git',
      ''
    ].join('\n'));

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('supports quoted value continuations containing comment characters', async () => {
    await writeConfigAsync([
      '[core]',
      ' key = "comment # and ;\\',
      ' characters"',
      '[remote "origin"]',
      ' url = https://example.invalid/shared.git',
      ''
    ].join('\n'));

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('warns through an explicit unsupported error for insteadOf rewrites', async () => {
    await writeConfigAsync([
      '[url "https://example.invalid/"]',
      ' insteadOf = shortcut:',
      '[remote "origin"]',
      ' url = shortcut:org/repo.git',
      ''
    ].join('\n'));

    await expect(getRepoIdentityAsync(repoPath)).rejects.toThrow('insteadOf URL rewrites are not supported');
  });

  it.each(['true', 'yes', 'on', '1', ''])('explicitly reports enabled worktreeConfig value %j', async (value) => {
    await writeConfigAsync(`[extensions]\n worktreeConfig = ${value}\n`);
    await FileSystem.writeFileAsync(`${repoPath}/.git/config.worktree`, '[remote "origin"]\n url = https://example.invalid/shared.git\n');

    await expect(getRepoIdentityAsync(repoPath)).rejects.toThrow('worktreeConfig is not supported');
  });

  it('supports explicitly disabled worktreeConfig', async () => {
    await writeConfigAsync('[extensions]\n worktreeConfig = false # disabled\n[remote "origin"]\n url = https://example.invalid/shared.git\n');

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('reads relative configuration includes', async () => {
    await writeConfigAsync('[include]\n path = ../included.conf\n');
    await FileSystem.writeFileAsync(`${repoPath}/included.conf`, '[remote "origin"]\n url = https://example.invalid/shared.git\n');

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('supports onbranch and relative gitdir directory conditions', async () => {
    await writeConfigAsync([
      '[includeIf "onbranch:feature/"]',
      ' path = ../included.conf',
      '[includeIf "gitdir:./../"]',
      ' path = ../included.conf',
      '[includeIf "onbranch:main"]',
      ' path = ../not-used.conf',
      ''
    ].join('\n'));
    await FileSystem.writeFileAsync(`${repoPath}/included.conf`, '[remote "origin"]\n url = https://example.invalid/shared.git\n');

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('supports case-insensitive gitdir and bracketed branch patterns', async () => {
    const directoryPattern: string = repoPath.split(path.sep).join('/').toUpperCase();
    await writeConfigAsync([
      `[includeIf "gitdir/i:${directoryPattern}/"]`,
      ' path = ../included.conf',
      '[includeIf "onbranch:f[e]ature/**"]',
      ' path = ../included.conf',
      ''
    ].join('\n'));
    await FileSystem.writeFileAsync(`${repoPath}/included.conf`, '[remote "origin"]\n url = https://example.invalid/shared.git\n');

    const { remoteKeys } = await getRepoIdentityAsync(repoPath);

    expect(remoteKeys).toEqual(['remote:example.invalid/shared']);
  });

  it('reports cyclic includes rather than guessing remote identity', async () => {
    await writeConfigAsync('[include]\n path = ../cycle.conf\n');
    await FileSystem.writeFileAsync(`${repoPath}/cycle.conf`, '[include]\n path = .git/config\n');

    await expect(getRepoIdentityAsync(repoPath)).rejects.toThrow('cyclic');
  });

  it('reports unsupported include conditions explicitly', async () => {
    await writeConfigAsync('[includeIf "hasconfig:remote.*.url:*"]\n path = other.conf\n');

    await expect(getRepoIdentityAsync(repoPath)).rejects.toThrow('Unsupported Git config include condition');
  });

  it.each([
    '[remote "broken]\n url = https://example.invalid/repo.git\n',
    '[remote "origin"]\n url = "unterminated\n',
    '[remote "origin"]\n url = "\\x"\n',
    '[remote "origin"]\n url = \n',
    '[remote "origin"]\n url = ext::helper\n'
  ])('reports malformed or unsupported configuration %j', async (config) => {
    await writeConfigAsync(config);

    await expect(getRepoIdentityAsync(repoPath)).rejects.toThrow();
  });

  it('resolves local remotes and config includes consistently through directory aliases', async () => {
    const aliasPath: string = `${fixturePath}/nested/alias`;
    await FileSystem.ensureFolderAsync(`${fixturePath}/nested`);
    await FileSystem.createSymbolicLinkJunctionAsync({ linkTargetPath: repoPath, newLinkPath: aliasPath });
    await writeConfigAsync([
      '[remote "local"]',
      ' url = ../bare.git',
      '[includeIf "gitdir:./../"]',
      ' path = ../included.conf',
      ''
    ].join('\n'));
    await FileSystem.writeFileAsync(`${repoPath}/included.conf`, '[remote "origin"]\n url = https://example.invalid/shared.git\n');
    const identity = await getRepoIdentityAsync(repoPath);

    await expect(getRepoIdentityAsync(aliasPath)).resolves.toEqual(identity);
    expect(identity.remoteKeys).toContain(`local:${path.resolve(`${fixturePath}/bare.git`)}`);
  });

  it('uses the canonical common directory for linked worktrees', async () => {
    const worktreePath: string = `${fixturePath}/worktree`;
    await FileSystem.ensureFolderAsync(worktreePath);
    await FileSystem.ensureFolderAsync(`${repoPath}/.git/worktrees/linked`);
    await FileSystem.writeFileAsync(`${worktreePath}/.git`, 'gitdir: ../repo/.git/worktrees/linked\n');
    await FileSystem.writeFileAsync(`${repoPath}/.git/worktrees/linked/commondir`, '../..\n');
    await FileSystem.writeFileAsync(`${repoPath}/.git/worktrees/linked/HEAD`, 'ref: refs/heads/linked\n');
    await writeConfigAsync('[remote "origin"]\n url = https://example.invalid/shared.git\n');

    const identity = await getRepoIdentityAsync(repoPath);

    await expect(getRepoIdentityAsync(worktreePath)).resolves.toEqual(identity);
  });
});
