// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { FileSystem } from '@rushstack/node-core-library';
import { Minimatch } from 'minimatch';

import { LSBranchConfigurationSchemaRepo } from '../config/LSBranchConfig';
import { GitConfigError } from './GitConfig';
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
  branchIsCheckedOut?: boolean;
  matchingBranches?: string[];
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
  branchPattern?: string
): Promise<IGetRepoDataResult> {
  const { path: repoPath } = repo;
  try {
    const { gitDirectory, commonDirectory } = await getGitPathsAsync(repoPath);
    const head: string | undefined = await readOptionalGitFileAsync(`${gitDirectory}/HEAD`);
    if (head === undefined) {
      throw new GitRepositoryError(".git/HEAD file doesn't exist");
    }

    const checkedOutBranch: string = parseGitHead(head);
    const hasBranchHead: boolean = head.trim().startsWith('ref: refs/heads/');
    const data: IRepoData = { checkedOutBranch };
    if (getAllBranches || branchPattern !== undefined) {
      const branches: string[] = await readLocalBranchesAsync(commonDirectory);
      if (getAllBranches) {
        data.otherBranches = branches.filter((branch) => !hasBranchHead || branch !== checkedOutBranch);
      }

      if (branchPattern !== undefined) {
        const matcher: Minimatch = new Minimatch(branchPattern, { nonegate: true, nocomment: true });
        const matchingBranches: string[] = branches.filter((branch) =>
          branch === branchPattern || matcher.match(branch)
        );
        data.matchingBranches = matchingBranches;
        data.hasLocalBranch = matchingBranches.length > 0;
        data.branchIsCheckedOut = hasBranchHead && matchingBranches.includes(checkedOutBranch);
      }
    }

    return { repo, data };
  } catch (error) {
    if (error instanceof Error && (
      error instanceof GitRepositoryError || error instanceof GitConfigError || FileSystem.isErrnoException(error)
    )) {
      return { repo, error };
    }

    throw error;
  }
}
