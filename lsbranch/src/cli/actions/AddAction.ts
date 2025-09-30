// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';

import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineFlagParameter, CommandLineStringParameter } from '@rushstack/ts-command-line';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataErrorResult } from '../../util/RepoData';
import { ILSBranchActionBaseOptions, LSBranchActionBase } from './LSBranchActionBase';

export const ADD_ACTION_NAME: string = 'add';

export class AddAction extends LSBranchActionBase {
  private readonly _pathParameter: CommandLineStringParameter;
  private readonly _aliasParameter: CommandLineStringParameter;
  private readonly _noValidate: CommandLineFlagParameter;

  protected override readonly _outputIsMachineReadable: boolean = false;

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: ADD_ACTION_NAME,
      summary: 'Add a repo.',
      documentation: ''
    });

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

  protected override async _executeInnerAsync(): Promise<void> {
    const configExists: boolean = await this._config.getConfigExistsAsync();
    if (configExists) {
      const validationResult: boolean = await this._config.validateAsync(this._terminal);
      if (!validationResult) {
        this._terminal.writeErrorLine('Found config validation errors.');
        throw new AlreadyReportedError();
      }
    }

    const resolvedPath: string = path.resolve(this._pathParameter.value!);
    const configRepo: LSBranchConfigurationSchemaRepo = {
      path: resolvedPath,
      alias: this._aliasParameter.value
    };

    if (!this._noValidate.value) {
      const { error: getRepoDataError } = (await getRepoDataAsync(
        configRepo,
        false
      )) as IGetRepoDataErrorResult;
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
