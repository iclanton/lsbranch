// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { FileSystem } from '@rushstack/node-core-library';

import { LSBranchConfigurationSchemaRepo } from '../config/LSBranchConfig';
import {
  getGitPathsAsync,
  GitRepositoryError,
  parseGitHead,
  readLocalBranchesAsync,
  readOptionalGitFileAsync
} from './GitRepository';

export interface IRepoData {
  checkedOutBranch: string;
  otherBranches?: string[];
  hasLocalBranch?: boolean;
}

interface IGetRepoDataResultBase {
  repo: LSBranchConfigurationSchemaRepo;
}

export interface IGetRepoDataErrorResult extends IGetRepoDataResultBase {
  error: Error;
}

export interface IGetRepoDataSuccessResult extends IGetRepoDataResultBase {
  data: IRepoData;
}

export type IGetRepoDataResult = IGetRepoDataErrorResult | IGetRepoDataSuccessResult;

export async function getRepoDataAsync(
  repo: LSBranchConfigurationSchemaRepo,
  getAllBranches: boolean,
  branchName?: string
): Promise<IGetRepoDataResult> {
  const { path: repoPath } = repo;
  try {
    const { gitDirectory, commonDirectory } = await getGitPathsAsync(repoPath);
    const head: string | undefined = await readOptionalGitFileAsync(path.join(gitDirectory, 'HEAD'));
    if (head === undefined) {
      throw new GitRepositoryError(".git/HEAD file doesn't exist");
    }

    const checkedOutBranch: string = parseGitHead(head);
    const data: IRepoData = { checkedOutBranch };
    if (getAllBranches || branchName !== undefined) {
      const branches: string[] = await readLocalBranchesAsync(commonDirectory);
      if (getAllBranches) {
        data.otherBranches = branches.filter((branch) => branch !== checkedOutBranch);
      }

      if (branchName !== undefined) {
        data.hasLocalBranch = branches.includes(branchName);
      }
    }

    return { repo, data };
  } catch (error) {
    if (error instanceof Error && (error instanceof GitRepositoryError || FileSystem.isErrnoException(error))) {
      return { repo, error };
    }

    throw error;
  }
}
