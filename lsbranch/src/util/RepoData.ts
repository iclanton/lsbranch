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
  getAllBranches: boolean
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
    if (getAllBranches) {
      const branches: string[] = await readLocalBranchesAsync(commonDirectory);
      data.otherBranches = branches.filter((branch) => branch !== checkedOutBranch);
    }

    return { repo, data };
  } catch (error) {
    if (error instanceof Error && (error instanceof GitRepositoryError || FileSystem.isErrnoException(error))) {
      return { repo, error };
    }

    throw error;
  }
}
