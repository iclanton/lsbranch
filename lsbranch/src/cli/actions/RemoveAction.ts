// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import path from 'node:path';
import { AlreadyReportedError } from '@rushstack/node-core-library';
import { CommandLineStringParameter } from '@rushstack/ts-command-line';

import { LSBranchRepoSelector } from '../../config/LSBranchConfig';
import {
  ALIAS_PARAMETER_NAME,
  ILSBranchActionBaseOptions,
  LSBranchActionBase,
  PATH_PARAMETER_NAME
} from './LSBranchActionBase';

export class RemoveAction extends LSBranchActionBase {
  readonly #pathParameter: CommandLineStringParameter;
  readonly #aliasParameter: CommandLineStringParameter;

  protected readonly _outputIsMachineReadable: boolean = false;

  public constructor(options: ILSBranchActionBaseOptions) {
    super(options, {
      actionName: 'remove',
      summary: 'Unregister a repository.',
      documentation: 'Remove a registered repository by path or alias, without deleting its files.'
    });
    this.#pathParameter = this.defineStringParameter({
      parameterLongName: PATH_PARAMETER_NAME,
      argumentName: 'REPO_PATH',
      description: `The path of the registered repository to remove. Mutually exclusive with ${ALIAS_PARAMETER_NAME}.`
    });

    this.#aliasParameter = this.defineStringParameter({
      parameterLongName: ALIAS_PARAMETER_NAME,
      argumentName: 'ALIAS',
      description: `The exact alias of the registered repository to remove. Mutually exclusive with ${PATH_PARAMETER_NAME}.`
    });
  }

  protected override async _executeInnerAsync(): Promise<void> {
    const { _config: config, _terminal: terminal } = this;
    const { value: repoPath } = this.#pathParameter;
    const { value: alias } = this.#aliasParameter;
    let selector: LSBranchRepoSelector;
    if (repoPath !== undefined && alias === undefined) {
      selector = { path: path.resolve(repoPath) };
    } else if (alias !== undefined && repoPath === undefined) {
      selector = { alias };
    } else {
      terminal.writeErrorLine(`Specify exactly one of ${PATH_PARAMETER_NAME} or ${ALIAS_PARAMETER_NAME}.`);
      throw new AlreadyReportedError();
    }

    await this._getConfiguredReposAsync();
    if (!(await config.tryRemoveRepoAsync(selector, terminal))) {
      throw new AlreadyReportedError();
    }

    terminal.writeLine(`Removed registered repository: ${selector.alias ?? selector.path}`);
  }
}
