// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { FileSystem } from '@rushstack/node-core-library';
import path from 'path';

import { ILSBranchConfigRepo } from '../config/LSBranchConfig';

export interface IRepoData {
  branchName: string;
}

export interface IGetRepoDataResult {
  repo: ILSBranchConfigRepo;
}

export interface IGetRepoDataErrorResult extends IGetRepoDataResult {
  error: Error;
}

export interface IGetRepoDataSuccessResult extends IGetRepoDataResult {
  data: IRepoData;
}

export async function getRepoDataAsync(
  repo: ILSBranchConfigRepo
): Promise<IGetRepoDataErrorResult | IGetRepoDataSuccessResult> {
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
        branchName
      }
    };
  } else {
    return {
      repo,
      error: new Error('.git/HEAD file is empty')
    };
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
