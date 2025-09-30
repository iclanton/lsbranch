// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { Colorize } from '@rushstack/terminal';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { ILSBranchConfigRepo } from '../../config/LSBranchConfig';
import {
  getRepoDataAsync,
  IGetRepoDataErrorResult,
  IGetRepoDataResult,
  IGetRepoDataSuccessResult
} from '../../util/RepoData';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';
import { ADD_ACTION_NAME } from './AddAction';
import { LSBRANCH_TOOL_FILENAME } from '../LSBranchCommandLineParser';

export class LSAction extends LSBranchActionBase {
  private readonly _jsonFlag: CommandLineFlagParameter;
  private readonly _allFlag: CommandLineFlagParameter;

  protected get _outputIsMachineReadable(): boolean {
    return this._jsonFlag.value;
  }

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });

    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });

    this._allFlag = this.defineFlagParameter({
      parameterLongName: '--all',
      parameterShortName: '-a',
      description: 'If specified, display all local branches.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const configExists: boolean = await this._config.getConfigExistsAsync();
    if (!configExists) {
      if (this._config.isDefaultConfigPath) {
        this._terminal.writeErrorLine(
          `No repos have been configured. Add a repo with "${LSBRANCH_TOOL_FILENAME} ${ADD_ACTION_NAME}"`
        );
      } else {
        this._terminal.writeErrorLine(`Config file does not exist: ${this._config.configPath}`);
      }

      throw new AlreadyReportedError();
    }

    const validationResult: boolean = await this._config.validateAsync(this._terminal);
    if (!validationResult) {
      this._terminal.writeErrorLine('Found config validation errors.');
      throw new AlreadyReportedError();
    }

    const repos: ILSBranchConfigRepo[] = await this._config.getConfigReposAsync();
    const getAllBranches: boolean = this._allFlag.value;
    const reposData: IGetRepoDataResult[] = await Promise.all(
      repos.map((repo) => getRepoDataAsync(repo, getAllBranches))
    );

    if (this._jsonFlag.value) {
      this._terminal.writeLine(JSON.stringify(reposData));
    } else {
      this._printDataAsTable(reposData, getAllBranches);
    }
  }

  private _printDataAsTable(reposData: IGetRepoDataResult[], printCheckedOutBranchesInGreen: boolean): void {
    let nameColumnLongestElementLength: number = 0;
    const rows: [string, string[]][] = [];
    for (const repoData of reposData) {
      const { error: getRepoDataError, data } = repoData as IGetRepoDataErrorResult &
        IGetRepoDataSuccessResult;
      let resultColumnContentsLines: string[] = [];
      if (getRepoDataError) {
        resultColumnContentsLines = [Colorize.red(getRepoDataError.message)];
      } else if (data) {
        resultColumnContentsLines = [
          printCheckedOutBranchesInGreen ? Colorize.green(data.checkedOutBranch) : data.checkedOutBranch
        ];
        if (data.otherBranches) {
          for (const otherBranch of data.otherBranches) {
            resultColumnContentsLines.push(otherBranch);
          }
        }
      } else {
        throw new Error('Unexpected repo data result. Expected a "data" or "error" property.');
      }

      const nameColumnLine: string = repoData.repo.alias || repoData.repo.path;
      rows.push([nameColumnLine, resultColumnContentsLines]);

      const nameColumnContentsLength: number = nameColumnLine.length;
      nameColumnLongestElementLength =
        nameColumnContentsLength > nameColumnLongestElementLength
          ? nameColumnContentsLength
          : nameColumnLongestElementLength;
    }

    const nameColumnWidth: number = nameColumnLongestElementLength + 2;

    for (const [nameColumnContents, dataColumnContents] of rows) {
      for (let i = 0; i < dataColumnContents.length; i++) {
        if (i === 0) {
          const nameColumnPaddingLength: number = nameColumnWidth - nameColumnContents.length;
          const nameColumnPadding: string = ' '.repeat(nameColumnPaddingLength);
          this._terminal.writeLine(nameColumnContents, nameColumnPadding, dataColumnContents[i]);
        } else {
          const nameColumnPadding: string = ' '.repeat(nameColumnWidth);
          this._terminal.writeLine(nameColumnPadding, dataColumnContents[i]);
        }
      }
    }
  }
}
