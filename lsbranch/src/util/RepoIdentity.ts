// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { minimatch } from 'minimatch';
import { FileSystem } from '@rushstack/node-core-library';
import { getGitPathsAsync, GitRepositoryError, readOptionalGitFileAsync } from './GitRepository';

export interface IRepoIdentity {
  commonDirectory: string;
  remoteKeys: string[];
}

function decodeConfigValue(raw: string): string {
  let value: string = '';
  let pendingSpaces: string = '';
  let quoted: boolean = false;
  for (let index: number = 0; index < raw.length; index++) {
    const character: string = raw[index];
    if (!quoted && (character === '#' || character === ';')) {
      break;
    }

    if (character === '"') {
      value += pendingSpaces;
      pendingSpaces = '';
      quoted = !quoted;
    } else if (character === '\\') {
      const escaped: string | undefined = raw[++index];
      const escapes: Record<string, string> = { n: '\n', t: '\t', b: '\b', '"': '"', '\\': '\\' };
      if (escaped === undefined || escapes[escaped] === undefined) {
        throw new GitRepositoryError('Invalid escape in Git configuration');
      }

      value += pendingSpaces + escapes[escaped];
      pendingSpaces = '';
    } else if (!quoted && /\s/.test(character)) {
      if (value) {
        pendingSpaces += character;
      }
    } else {
      value += pendingSpaces + character;
      pendingSpaces = '';
    }
  }

  if (quoted) {
    throw new GitRepositoryError('Unterminated quote in Git configuration');
  }

  return value;
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
    pattern = path.join(os.homedir(), pattern.slice(2));
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
    let section: string = '';
    let subsection: string = '';
    for (const line of contents.replace(/\\\r?\n/g, '').split(/\r?\n/)) {
      if (!line.trim() || /^\s*[#;]/.test(line)) {
        continue;
      }

      if (line.trimStart().startsWith('[')) {
        const header: RegExpMatchArray | null = line.match(
          /^\s*\[([a-zA-Z0-9.-]+)(?:\s+"((?:[^"\\]|\\.)*)")?\]\s*(?:[#;].*)?$/
        );
        if (!header) {
          throw new GitRepositoryError('Invalid section header in Git configuration');
        }

        section = header[1].toLowerCase();
        subsection = header[2] === undefined ? '' : decodeConfigValue(`"${header[2]}"`);
        if (section.startsWith('remote.')) {
          section = 'remote';
        }

        continue;
      }

      const entry: RegExpMatchArray | null = line.match(/^\s*([a-zA-Z][a-zA-Z0-9-]*)\s*(?:=\s*(.*))?$/);
      if (!entry) {
        throw new GitRepositoryError('Invalid entry in Git configuration');
      }

      const key: string = entry[1].toLowerCase();
      const value: string = decodeConfigValue(entry[2] ?? 'true');
      if (section === 'remote' && key === 'url') {
        if (!value) {
          throw new GitRepositoryError('An empty remote URL makes repository identity uncertain');
        }

        urls.push(value);
      } else if (key === 'path' && (section === 'include' || section === 'includeif')) {
        if (section === 'include' || gitDirectories.some((directory) =>
          includeConditionMatches(subsection, filename, directory, branch)
        )) {
          const includedPath: string = value.startsWith('~/')
            ? path.join(os.homedir(), value.slice(2))
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
  const head: string | undefined = await readOptionalGitFileAsync(path.join(gitDirectory, 'HEAD'));
  const branch: string = head?.startsWith('ref: refs/heads/') ? head.trim().slice('ref: refs/heads/'.length) : '';
  const urls: string[] = await readRemoteUrlsAsync(
    path.join(canonicalCommonDirectory, 'config'), [gitDirectory, canonicalGitDirectory], branch, new Set()
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
