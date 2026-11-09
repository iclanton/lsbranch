// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { FileSystem } from '@rushstack/node-core-library';
import { getGitPathsAsync, GitRepositoryError, readOptionalGitFileAsync } from './GitRepository';
import { parseGitConfig } from './GitConfig';

export interface IRepoIdentity {
  commonDirectory: string;
  remoteKeys: string[];
}

function matchesGitGlob(value: string, pattern: string, ignoreCase: boolean = false): boolean {
  return minimatch(value, pattern, {
    dot: true,
    nocase: ignoreCase,
    nobrace: true,
    noext: true,
    nonegate: true,
    nocomment: true
  });
}

function includeConditionMatches(condition: string, filename: string, gitDirectory: string, branch: string): boolean {
  if (condition.startsWith('onbranch:')) {
    let pattern: string = condition.slice('onbranch:'.length);
    if (pattern.endsWith('/')) {
      pattern += '**';
    }

    return branch.length > 0 && matchesGitGlob(branch, pattern);
  }

  const ignoreCase: boolean = condition.startsWith('gitdir/i:');
  if (!ignoreCase && !condition.startsWith('gitdir:')) {
    throw new GitRepositoryError('Unsupported Git config include condition; repository identity is uncertain');
  }

  let pattern: string = condition.slice(ignoreCase ? 'gitdir/i:'.length : 'gitdir:'.length);
  const directoryPattern: boolean = pattern.endsWith('/');
  if (pattern.startsWith('~/')) {
    pattern = `${os.homedir()}/${pattern.slice(2)}`;
  } else if (pattern.startsWith('./')) {
    pattern = path.resolve(path.dirname(filename), pattern);
  } else if (!path.isAbsolute(pattern)) {
    pattern = `**/${pattern}`;
  }

  pattern = pattern.split(path.sep).join('/');
  if (directoryPattern) {
    pattern += pattern.endsWith('/') ? '**' : '/**';
  }

  return matchesGitGlob(gitDirectory.split(path.sep).join('/'), pattern, ignoreCase);
}

async function readRemoteUrlsAsync(
  filename: string,
  gitDirectories: string[],
  branch: string,
  stack: Set<string>
): Promise<string[]> {
  if (stack.size >= 10 || stack.has(filename)) {
    throw new GitRepositoryError('Git configuration includes are cyclic or exceed the depth limit');
  }

  const contents: string | undefined = await readOptionalGitFileAsync(filename);
  if (contents === undefined) {
    return [];
  }

  stack.add(filename);
  try {
    const urls: string[] = [];
    for (const { section, subsection, key, value } of parseGitConfig(contents)) {
      if (section === 'url' && key === 'insteadof') {
        throw new GitRepositoryError('Git insteadOf URL rewrites are not supported; repository identity is uncertain');
      } else if (section === 'extensions' && !subsection && key === 'worktreeconfig') {
        const normalizedValue: string = value.toLowerCase();
        if (!['false', 'no', 'off', '0'].includes(normalizedValue)) {
          throw new GitRepositoryError('Git worktreeConfig is not supported; repository identity is uncertain');
        }
      } else if (section === 'remote' && key === 'url') {
        if (!value) {
          throw new GitRepositoryError('An empty remote URL makes repository identity uncertain');
        }

        urls.push(value);
      } else if (key === 'path' && (section === 'include' || section === 'includeif')) {
        if (section === 'include' || gitDirectories.some((directory) =>
          includeConditionMatches(subsection, filename, directory, branch)
        )) {
          const includedPath: string = value.startsWith('~/')
            ? `${os.homedir()}/${value.slice(2)}`
            : path.resolve(path.dirname(filename), value);
          urls.push(...await readRemoteUrlsAsync(includedPath, gitDirectories, branch, stack));
        }
      }
    }

    return urls;
  } finally {
    stack.delete(filename);
  }
}

export function normalizeRemoteUrl(remote: string, repoPath: string): string {
  if (!remote) {
    throw new GitRepositoryError('An empty remote URL makes repository identity uncertain');
  }

  for (let index: number = 0; index < remote.length; index++) {
    const characterCode: number = remote.charCodeAt(index);
    if (characterCode < 32 || characterCode === 127) {
      throw new GitRepositoryError('Invalid control character in a Git remote URL');
    }
  }

  if (/^[a-zA-Z][a-zA-Z0-9+.-]*::/.test(remote)) {
    throw new GitRepositoryError('Unsupported remote helper URL; repository identity is uncertain');
  }

  if (remote.startsWith('file:')) {
    return `local:${path.resolve(fileURLToPath(remote))}`;
  }

  if (path.isAbsolute(remote) || remote.startsWith('./') || remote.startsWith('../')) {
    return `local:${path.resolve(repoPath, remote)}`;
  }

  const scp: RegExpMatchArray | null = remote.match(/^(?:[^@/:]+@)?(\[[^\]]+\]|[^/:]+):(.+)$/);
  if (scp && !remote.includes('://')) {
    return `remote:${scp[1].toLowerCase()}/${scp[2].replace(/^\/+|\/+$/g, '').replace(/\.git$/, '')}`;
  }

  if (!remote.includes('://')) {
    return `local:${path.resolve(repoPath, remote)}`;
  }

  const { protocol, search, hash, port: urlPort, pathname, hostname } = new URL(remote);
  if (!['https:', 'http:', 'ssh:', 'git:'].includes(protocol) || search || hash) {
    throw new GitRepositoryError('Unsupported remote URL format; repository identity is uncertain');
  }

  const defaultPorts: Record<string, string> = { 'ssh:': '22', 'git:': '9418', 'https:': '443', 'http:': '80' };
  const port: string = !urlPort || urlPort === defaultPorts[protocol] ? '' : `:${urlPort}`;
  const repositoryPath: string = pathname.replace(/^\/+|\/+$/g, '').replace(/\.git$/, '');
  return `remote:${hostname.toLowerCase()}${port}/${repositoryPath}`;
}

export async function getRepoIdentityAsync(repoPath: string): Promise<IRepoIdentity> {
  const { gitDirectory, commonDirectory } = await getGitPathsAsync(repoPath);
  const canonicalCommonDirectory: string = await FileSystem.getRealPathAsync(commonDirectory);
  const canonicalGitDirectory: string = gitDirectory === commonDirectory
    ? canonicalCommonDirectory
    : await FileSystem.getRealPathAsync(gitDirectory);
  const canonicalRepoPath: string = await FileSystem.getRealPathAsync(repoPath);
  const head: string | undefined = await readOptionalGitFileAsync(`${gitDirectory}/HEAD`);
  const branch: string = head?.startsWith('ref: refs/heads/') ? head.trim().slice('ref: refs/heads/'.length) : '';
  const urls: string[] = await readRemoteUrlsAsync(
    `${canonicalCommonDirectory}/config`, [gitDirectory, canonicalGitDirectory], branch, new Set()
  );
  try {
    return {
      commonDirectory: canonicalCommonDirectory,
      remoteKeys: [...new Set(urls.map((url) => normalizeRemoteUrl(url, canonicalRepoPath)))]
    };
  } catch (error) {
    if (error instanceof TypeError) {
      throw new GitRepositoryError('Invalid remote URL in Git configuration');
    }

    throw error;
  }
}
