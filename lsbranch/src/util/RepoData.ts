// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import path from 'node:path';

import { Executable, FileSystem } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../config/LSBranchConfig';

export interface IRepoData {
  checkedOutBranch: string;
  otherBranches?: string[];
}

export interface IGetRepoDataResult {
  repo: LSBranchConfigurationSchemaRepo;
}

export interface IGetRepoDataErrorResult extends IGetRepoDataResult {
  error: Error;
}

export interface IGetRepoDataSuccessResult extends IGetRepoDataResult {
  data: IRepoData;
}

export async function getRepoDataAsync(
  repo: LSBranchConfigurationSchemaRepo,
  getAllBranches: boolean
): Promise<IGetRepoDataErrorResult | IGetRepoDataSuccessResult> {
  if (getAllBranches) {
    const spawnResult: ChildProcess = Executable.spawn('git', ['branch'], {
      currentWorkingDirectory: repo.path
    });
    const stdoutParts: string[] = [];
    const stderrParts: string[] = [];
    spawnResult.stdout?.on('data', (data: Buffer) => {
      stdoutParts.push(data.toString());
    });
    spawnResult.stderr?.on('data', (data: Buffer) => {
      stderrParts.push(data.toString());
    });
    await once(spawnResult, 'close');
    const exitCode: number = spawnResult.exitCode!;
    if (exitCode === 0) {
      if (stderrParts.length > 0) {
        return {
          repo,
          error: new Error(`git branch wrote to stderr failed: ${stderrParts.join('')}`)
        };
      }

      const outputLines: string[] = stdoutParts.join('').split('\n');
      const allBranches: string[] = [];
      const checkedOutBranches: string[] = [];
      for (const outputLine of outputLines) {
        const trimmedOutputLine: string = outputLine.trim();
        if (trimmedOutputLine) {
          if (trimmedOutputLine.startsWith('*')) {
            checkedOutBranches.push(trimmedOutputLine.substr(1).trim());
          } else {
            allBranches.push(trimmedOutputLine);
          }
        }
      }

      if (checkedOutBranches.length === 0) {
        return {
          repo,
          error: new Error(`git branch did not report a checked out branch`)
        };
      } else if (checkedOutBranches.length > 1) {
        const checkedOutBranchList: string = checkedOutBranches.join(', ');
        return {
          repo,
          error: new Error(`git branch reported multiple checked out branches: ${checkedOutBranchList}`)
        };
      } else {
        return { repo, data: { checkedOutBranch: checkedOutBranches[0], otherBranches: allBranches } };
      }
    } else {
      return {
        repo,
        error: new Error(`git branch failed with exit code ${exitCode}: ${stderrParts.join('')}`)
      };
    }
  } else {
    const gitFolderPath: string = path.join(repo.path, '.git');
    const gitHeadFilePath: string = path.join(gitFolderPath, 'HEAD');

    let gitHeadFileContents: string;
    try {
      gitHeadFileContents = await FileSystem.readFileAsync(gitHeadFilePath);
    } catch (innerError) {
      let error: Error;
      if (FileSystem.isNotExistError(innerError as NodeJS.ErrnoException)) {
        const gitFolderExists: boolean = await FileSystem.existsAsync(gitFolderPath);
        if (!gitFolderExists) {
          error = new Error(`.git folder doesn't exist`);
        } else {
          error = new Error(".git/HEAD file doesn't exist");
        }

        return { repo, error };
      } else {
        throw innerError;
      }
    }

    if (gitHeadFileContents) {
      const branchName: string = parseGitBranchOrSha(gitHeadFileContents);
      return {
        repo,
        data: {
          checkedOutBranch: branchName
        }
      };
    } else {
      return {
        repo,
        error: new Error('.git/HEAD file is empty')
      };
    }
  }
}

const REF_PREFIX: string = 'ref: ';
/**
 * The .git/HEAD file can look like:
 * ```
 * ref: refs/heads/branchname
 * ```
 *
 * Or it can contain a commit SHA
 */
function parseGitBranchOrSha(gitHeadFileContents: string): string {
  if (gitHeadFileContents.startsWith(REF_PREFIX)) {
    const ref: string = gitHeadFileContents.substr(REF_PREFIX.length).trim();
    return ref.substr(ref.indexOf('/', ref.indexOf('/') + 1) + 1);
  } else {
    return gitHeadFileContents.trim();
  }
}
