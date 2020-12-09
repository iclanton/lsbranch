// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError, Terminal } from '@rushstack/node-core-library';
import { CommandLineAction, CommandLineFlagParameter } from '@rushstack/ts-command-line';
import CliTable from 'cli-table';

import { ILSBranchConfigRepo, LSBranchConfig } from '../../config/LSBranchConfig';
import {
  getRepoDataAsync,
  IGetRepoDataErrorResult,
  IGetRepoDataResult,
  IGetRepoDataSuccessResult
} from '../../repoData/RepoData';

export interface ILSActionOptions {
  terminal: Terminal;
  configPath: string | undefined;
}

export class LSAction extends CommandLineAction {
  private _terminal: Terminal;
  private _configPath: string | undefined;
  private _jsonFlag!: CommandLineFlagParameter;

  public constructor(options: ILSActionOptions) {
    super({
      actionName: 'ls',
      summary: 'List branches.',
      documentation: ''
    });

    this._terminal = options.terminal;
    this._configPath = options.configPath;
  }

  public onDefineParameters(): void {
    this._jsonFlag = this.defineFlagParameter({
      parameterLongName: '--json',
      description: 'If specified, present data in JSON format.'
    });
  }

  protected async onExecute(): Promise<void> {
    const config: LSBranchConfig = new LSBranchConfig(this._configPath);

    const configExists: boolean = await config.getConfigExistsAsync();
    if (!configExists) {
      const configPath: string = this._configPath || LSBranchConfig.getDefaultConfigPath();
      this._terminal.writeErrorLine(`Config file does not exist: ${configPath}`);
      throw new AlreadyReportedError();
    }

    const validationResult: boolean = await config.validateAsync(this._terminal);
    if (!validationResult) {
      this._terminal.writeErrorLine('Found config validation errors.');
      throw new AlreadyReportedError();
    }

    const repos: ILSBranchConfigRepo[] = await config.getConfigReposAsync();
    const reposData: IGetRepoDataResult[] = await Promise.all(repos.map((repo) => getRepoDataAsync(repo)));
    if (this._jsonFlag.value) {
      this._terminal.writeLine(JSON.stringify(reposData));
    } else {
      const table: CliTable = new CliTable({
        chars: {
          'bottom-left': '',
          'bottom-mid': '',
          'bottom-right': '',
          'left-mid': '',
          'mid-mid': '',
          'right-mid': '',
          'top-left': '',
          'top-mid': '',
          'top-right': '',
          bottom: '',
          left: '',
          mid: '',
          middle: ' ', // Single space
          right: '',
          top: ''
        },
        style: { 'padding-left': 0, 'padding-right': 0 }
      });

      for (const getRepoDataResult of reposData) {
        const repoDataError: IGetRepoDataErrorResult = getRepoDataResult as IGetRepoDataErrorResult;
        const repoData: IGetRepoDataSuccessResult = getRepoDataResult as IGetRepoDataSuccessResult;
        let resultColumnContents;
        if (repoDataError.error) {
          resultColumnContents = repoDataError.error.message;
        } else if (repoData.data) {
          resultColumnContents = repoData.data.branchName;
        } else {
          throw new Error('Unexpected repo data result. Expected a "data" or "error" property.');
        }

        table.push([getRepoDataResult.repo.alias || getRepoDataResult.repo.path, resultColumnContents]);
      }

      this._terminal.writeLine(table.toString());
    }
  }
}
