// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';

import { AlreadyReportedError } from '@rushstack/node-core-library';
import {
  CommandLineFlagParameter,
  CommandLineStringParameter,
  type IRequiredCommandLineStringParameter
} from '@rushstack/ts-command-line';

import { LSBranchConfigurationSchemaRepo } from '../../config/LSBranchConfig';
import { getRepoDataAsync, IGetRepoDataResult } from '../../util/RepoData';
import {
  ADD_ACTION_NAME,
  ALIAS_PARAMETER_NAME,
  ILSBranchActionBaseOptions,
  LSBranchActionBase,
  PATH_PARAMETER_NAME
} from './LSBranchActionBase';

export class AddAction extends LSBranchActionBase {
  readonly #pathParameter: IRequiredCommandLineStringParameter;
  readonly #aliasParameter: CommandLineStringParameter;
  readonly #noValidate: CommandLineFlagParameter;

  protected override readonly _outputIsMachineReadable: boolean = false;

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: ADD_ACTION_NAME,
      summary: 'Add a repo.',
      documentation: ''
    });

    this.#pathParameter = this.defineStringParameter({
      parameterLongName: PATH_PARAMETER_NAME,
      argumentName: 'REPO_PATH',
      description: 'The path to the repo root',
      required: true
    });

    this.#aliasParameter = this.defineStringParameter({
      parameterLongName: ALIAS_PARAMETER_NAME,
      argumentName: 'ALIAS',
      description: "The repo's alias"
    });

    this.#noValidate = this.defineFlagParameter({
      parameterLongName: '--no-validate',
      description: 'If specified, do not ensure that the repo being added exists and is valid.'
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _config: config, _terminal: terminal } = this;
    const configExists: boolean = await config.getConfigExistsAsync();
    if (configExists) {
      const validationResult: boolean = await config.validateAsync(terminal);
      if (!validationResult) {
        terminal.writeErrorLine('Found config validation errors.');
        throw new AlreadyReportedError();
      }
    }

    const resolvedPath: string = path.resolve(this.#pathParameter.value);
    const configRepo: LSBranchConfigurationSchemaRepo = {
      path: resolvedPath,
      alias: this.#aliasParameter.value
    };

    if (!this.#noValidate.value) {
      const repoData: IGetRepoDataResult = await getRepoDataAsync(configRepo, false);
      if ('error' in repoData) {
        const { error } = repoData;
        terminal.writeErrorLine(`Specified repo path is not valid: ${error.message}`);
        terminal.writeErrorLine(`If this is expected, provide the "${this.#noValidate.longName}" flag`);
        throw new AlreadyReportedError();
      }
    }

    const addSuccessful: boolean = await config.tryAddRepoAsync(configRepo, terminal);
    if (!addSuccessful) {
      throw new AlreadyReportedError();
    }
  }
}
