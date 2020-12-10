// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, CommandLineStringParameter } from '@rushstack/ts-command-line';
import { ILSBranchConfigRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataErrorResult } from '../../repoData/RepoData';

import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';

export const ADD_ACTION_NAME: string = 'add';

export class AddAction extends LSBranchActionBase {
  private _pathParameter!: CommandLineStringParameter;
  private _aliasParameter!: CommandLineStringParameter;
  private _noValidate!: CommandLineFlagParameter;

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: ADD_ACTION_NAME,
      summary: 'Add a repo.',
      documentation: ''
    });
  }

  public onDefineParameters(): void {
    this._pathParameter = this.defineStringParameter({
      parameterLongName: '--path',
      argumentName: 'REPO_PATH',
      description: 'The path to the repo root',
      required: true
    });

    this._aliasParameter = this.defineStringParameter({
      parameterLongName: '--alias',
      argumentName: 'ALIAS',
      description: "The repo's alias"
    });

    this._noValidate = this.defineFlagParameter({
      parameterLongName: '--no-validate',
      description: 'If specified, do not ensure that the repo being added exists and is valid.'
    });
  }

  protected async onExecute(): Promise<void> {
    const configExists: boolean = await this._config.getConfigExistsAsync();
    if (configExists) {
      const validationResult: boolean = await this._config.validateAsync(this._terminal);
      if (!validationResult) {
        this._terminal.writeErrorLine('Found config validation errors.');
        throw new AlreadyReportedError();
      }
    }

    const configRepo: ILSBranchConfigRepo = {
      path: this._pathParameter.value!,
      alias: this._aliasParameter.value
    };

    if (!this._noValidate.value) {
      const { error: getRepoDataError } = (await getRepoDataAsync(configRepo)) as IGetRepoDataErrorResult;
      if (getRepoDataError) {
        this._terminal.writeErrorLine(`Specified repo path is not valid: ${getRepoDataError.message}`);
        this._terminal.writeErrorLine(`If this is expected, provide the "${this._noValidate.longName}" flag`);
        throw new AlreadyReportedError();
      }
    }

    const addSuccessful: boolean = await this._config.tryAddRepoAsync(configRepo, this._terminal);
    if (!addSuccessful) {
      throw new AlreadyReportedError();
    }
  }
}
