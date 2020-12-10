// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError, Colors, IColorableSequence } from '@rushstack/node-core-library';
import { CommandLineFlagParameter } from '@rushstack/ts-command-line';

import { ILSBranchConfigRepo } from '../../config/LSBranchConfig';
import {
  getRepoDataAsync,
  IGetRepoDataErrorResult,
  IGetRepoDataResult,
  IGetRepoDataSuccessResult
} from '../../repoData/RepoData';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';
import { ADD_ACTION_NAME } from './AddAction';
import { LSBRANCH_TOOL_FILENAME } from '../LSBranchCommandLineParser';

export class LSAction extends LSBranchActionBase {
  private _jsonFlag!: CommandLineFlagParameter;

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });
  }

  public onDefineParameters(): void {
    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });
  }

  protected async onExecute(): Promise<void> {
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
    const reposData: IGetRepoDataResult[] = await Promise.all(repos.map((repo) => getRepoDataAsync(repo)));
    if (this._jsonFlag.value) {
      this._terminal.writeLine(JSON.stringify(reposData));
    } else {
      this._printDataAsTable(reposData);
    }
  }

  private _printDataAsTable(reposData: IGetRepoDataResult[]): void {
    let nameColumnLongestElementLength: number = 0;
    const rows: [string, string | IColorableSequence][] = [];
    for (const repoData of reposData) {
      const nameColumnContents: string = repoData.repo.alias || repoData.repo.path;

      const { error: getRepoDataError, data } = repoData as IGetRepoDataErrorResult &
        IGetRepoDataSuccessResult;
      let resultColumnContents: string | IColorableSequence;
      if (getRepoDataError) {
        resultColumnContents = Colors.red(getRepoDataError.message);
      } else if (data) {
        resultColumnContents = data.branchName;
      } else {
        throw new Error('Unexpected repo data result. Expected a "data" or "error" property.');
      }

      rows.push([nameColumnContents, resultColumnContents]);

      const nameColumnContentsLength: number = nameColumnContents.length;
      nameColumnLongestElementLength =
        nameColumnContentsLength > nameColumnLongestElementLength
          ? nameColumnContentsLength
          : nameColumnLongestElementLength;
    }

    const nameColumnWidth: number = nameColumnLongestElementLength + 2;

    for (const [nameColumnContents, dataColumnContents] of rows) {
      const nameColumnPaddingLength: number = nameColumnWidth - nameColumnContents.length;
      const nameColumnPadding: string = new Array(nameColumnPaddingLength + 1).join(' ');
      this._terminal.writeLine(nameColumnContents, nameColumnPadding, dataColumnContents);
    }
  }
}
