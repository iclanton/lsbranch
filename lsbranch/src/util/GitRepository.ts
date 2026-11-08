// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { Async, FileSystem, FileSystemStats, FolderItem } from '@rushstack/node-core-library';

const INVALID_BRANCH_CHARACTERS: ReadonlySet<string> = new Set(['~', '^', ':', '?', '*', '[', '\\']);

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
  const dotGitPath: string = `${repoPath}/.git`;
  let gitDirectory: string = dotGitPath;
  try {
    const gitFile: string = await FileSystem.readFileAsync(dotGitPath);
    const match: RegExpMatchArray | null = gitFile.match(/^gitdir: ([^\r\n]+)\r?\n?$/);
    if (!match) {
      throw new GitRepositoryError('Invalid .git file: expected a gitdir path');
    }

    const gitDirPath: string = match[1];
    gitDirectory = path.isAbsolute(gitDirPath) ? gitDirPath : path.resolve(repoPath, gitDirPath);
  } catch (error) {
    if (FileSystem.isNotExistError(error)) {
      throw new GitRepositoryError(".git folder doesn't exist");
    }

    if (!FileSystem.isDirectoryError(error)) {
      throw error;
    }
  }

  const commonDirFile: string | undefined = await readOptionalGitFileAsync(`${gitDirectory}/commondir`);
  let commonDirectory: string = gitDirectory;
  if (commonDirFile !== undefined) {
    const commonDir: string = commonDirFile.replace(/[\r\n]+$/, '');
    if (!commonDir || /[\r\n]/.test(commonDir)) {
      throw new GitRepositoryError('Invalid Git commondir path');
    }

    commonDirectory = path.isAbsolute(commonDir) ? commonDir : path.resolve(gitDirectory, commonDir);
    const stats: FileSystemStats = await FileSystem.getStatisticsAsync(commonDirectory);
    if (!stats.isDirectory()) {
      throw new GitRepositoryError('The Git common directory is not a directory');
    }
  }

  return { gitDirectory, commonDirectory };
}

export function isValidLocalBranchName(branch: string): boolean {
  for (let index: number = 0; index < branch.length; index++) {
    const characterCode: number = branch.charCodeAt(index);
    if (characterCode <= 32 || characterCode === 127 || INVALID_BRANCH_CHARACTERS.has(branch[index])) {
      return false;
    }
  }

  return (
    branch.length > 0 &&
    !branch.endsWith('.') &&
    !branch.includes('..') &&
    !branch.includes('@{') &&
    branch.split('/').every((part) => part.length > 0 && !part.startsWith('.') && !part.endsWith('.lock'))
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
  const reftable: string | undefined = await readOptionalGitFileAsync(`${commonDirectory}/config`);
  if (reftable && /^\s*refStorage\s*=\s*"?reftable"?\s*$/im.test(reftable)) {
    throw new GitRepositoryError('Git reftable reference storage is not supported');
  }

  const branches: Set<string> = new Set();
  const packedRefs: string | undefined = await readOptionalGitFileAsync(`${commonDirectory}/packed-refs`);
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
    let entries: FolderItem[];
    try {
      entries = await FileSystem.readFolderItemsAsync(directory);
    } catch (error) {
      if (FileSystem.isNotExistError(error)) {
        return;
      }

      throw error;
    }

    await Async.forEachAsync(entries, async (entry) => {
      const { name } = entry;
      const branch: string = `${prefix}${name}`;
      const filename: string = `${directory}/${name}`;
      if (entry.isSymbolicLink()) {
        throw new GitRepositoryError(`Symbolic links in local branch refs are not supported: ${branch}`);
      }

      if (entry.isDirectory()) {
        await readLooseRefsAsync(filename, `${branch}/`);
      } else if (entry.isFile() && isValidLocalBranchName(branch)) {
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

  const headsDirectory: string = `${commonDirectory}/refs/heads`;
  try {
    const stats: FileSystemStats = await FileSystem.getLinkStatisticsAsync(headsDirectory);
    if (stats.isSymbolicLink()) {
      throw new GitRepositoryError('Symbolic links in local branch refs are not supported: refs/heads');
    }
  } catch (error) {
    if (!FileSystem.isNotExistError(error)) {
      throw error;
    }
  }

  await readLooseRefsAsync(headsDirectory, '');
  return [...branches].sort();
}
