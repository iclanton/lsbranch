// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import fs from 'node:fs/promises';
import type { Dirent, Stats } from 'node:fs';
import path from 'node:path';
import { Async, FileSystem } from '@rushstack/node-core-library';

export interface IGitPaths {
  gitDirectory: string;
  commonDirectory: string;
}

export class GitRepositoryError extends Error {}

export async function readOptionalGitFileAsync(filename: string): Promise<string | undefined> {
  try {
    return await FileSystem.readFileAsync(filename);
  } catch (error) {
    if (FileSystem.isNotExistError(error)) {
      return undefined;
    }

    throw error;
  }
}

export async function getGitPathsAsync(repoPath: string): Promise<IGitPaths> {
  const dotGitPath: string = path.join(repoPath, '.git');
  let gitDirectory: string = dotGitPath;
  try {
    const stats: Stats = await fs.stat(dotGitPath);
    if (stats.isFile()) {
      const gitFile: string = await FileSystem.readFileAsync(dotGitPath);
      const match: RegExpMatchArray | null = gitFile.match(/^gitdir: ([^\r\n]+)\r?\n?$/);
      if (!match) {
        throw new GitRepositoryError('Invalid .git file: expected a gitdir path');
      }

      gitDirectory = path.resolve(repoPath, match[1]);
    } else if (!stats.isDirectory()) {
      throw new GitRepositoryError('.git is neither a directory nor a gitdir file');
    }
  } catch (error) {
    if (FileSystem.isNotExistError(error)) {
      throw new GitRepositoryError(".git folder doesn't exist");
    }

    throw error;
  }

  const commonDirFile: string | undefined = await readOptionalGitFileAsync(path.join(gitDirectory, 'commondir'));
  let commonDirectory: string = gitDirectory;
  if (commonDirFile !== undefined) {
    const commonDir: string = commonDirFile.trim();
    if (!commonDir) {
      throw new GitRepositoryError('The Git commondir file is empty');
    }

    commonDirectory = path.resolve(gitDirectory, commonDir);
    const stats: Stats = await fs.stat(commonDirectory);
    if (!stats.isDirectory()) {
      throw new GitRepositoryError('The Git common directory is not a directory');
    }
  }

  return { gitDirectory, commonDirectory };
}

export function isValidLocalBranchName(branch: string): boolean {
  for (let index: number = 0; index < branch.length; index++) {
    const characterCode: number = branch.charCodeAt(index);
    if (characterCode <= 32 || characterCode === 127) {
      return false;
    }
  }

  return (
    branch.length > 0 &&
    branch !== '@' &&
    !branch.startsWith('-') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    !/[~^:?*[\]\\]/.test(branch) &&
    branch.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.') && !part.endsWith('.lock'))
  );
}

export function parseGitHead(headContents: string): string {
  const head: string = headContents.trim();
  if (!head) {
    throw new GitRepositoryError('.git/HEAD file is empty');
  }

  if (head.startsWith('ref: refs/heads/')) {
    const branch: string = head.slice('ref: refs/heads/'.length);
    if (isValidLocalBranchName(branch)) {
      return branch;
    }
  } else if (/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(head)) {
    return head;
  }

  throw new GitRepositoryError('Invalid Git HEAD: expected a local branch reference or commit hash');
}

export async function readLocalBranchesAsync(commonDirectory: string): Promise<string[]> {
  const reftable: string | undefined = await readOptionalGitFileAsync(path.join(commonDirectory, 'config'));
  if (reftable && /^\s*refStorage\s*=\s*"?reftable"?\s*$/im.test(reftable)) {
    throw new GitRepositoryError('Git reftable reference storage is not supported');
  }

  const branches: Set<string> = new Set();
  const packedRefs: string | undefined = await readOptionalGitFileAsync(path.join(commonDirectory, 'packed-refs'));
  if (packedRefs !== undefined) {
    for (const line of packedRefs.split(/\r?\n/)) {
      if (!line || line.startsWith('#') || line.startsWith('^')) {
        continue;
      }

      const match: RegExpMatchArray | null = line.match(/^(?:[0-9a-f]{40}|[0-9a-f]{64}) (refs\/.+)$/i);
      if (!match) {
        throw new GitRepositoryError('Invalid packed-refs record');
      }

      const ref: string = match[1];
      if (ref.startsWith('refs/heads/')) {
        const branch: string = ref.slice('refs/heads/'.length);
        if (!isValidLocalBranchName(branch)) {
          throw new GitRepositoryError('Invalid local branch name in packed-refs');
        }

        branches.add(branch);
      }
    }
  }

  async function readLooseRefsAsync(directory: string, prefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await fs.readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (FileSystem.isNotExistError(error)) {
        return;
      }

      throw error;
    }

    await Async.forEachAsync(entries, async (entry) => {
      const { name } = entry;
      const branch: string = `${prefix}${name}`;
      const filename: string = path.join(directory, name);
      if (entry.isDirectory()) {
        await readLooseRefsAsync(filename, `${branch}/`);
      } else if ((entry.isFile() || entry.isSymbolicLink()) && isValidLocalBranchName(branch)) {
        const contents: string | undefined = await readOptionalGitFileAsync(filename);
        if (contents === undefined) {
          return;
        }

        const ref: string = contents.trim();
        if (!/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(ref) && !/^ref: refs\/[^\s]+$/.test(ref)) {
          throw new GitRepositoryError(`Invalid loose branch reference: ${branch}`);
        }

        branches.add(branch);
      }
    }, { concurrency: 15 });
  }

  await readLooseRefsAsync(path.join(commonDirectory, 'refs', 'heads'), '');
  return [...branches].sort();
}
