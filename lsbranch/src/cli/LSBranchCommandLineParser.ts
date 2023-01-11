// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser, CommandLineStringParameter } from '@rushstack/ts-command-line';
import { Terminal, ConsoleTerminalProvider, AlreadyReportedError } from '@rushstack/node-core-library';

import { ILSBranchActionBaseOptions } from './actions/LSBranchActionBase';
import { LSAction } from './actions/LSAction';
import { AddAction } from './actions/AddAction';
import { LSBranchConfig } from '../config/LSBranchConfig';

export const LSBRANCH_TOOL_FILENAME: string = 'lsbranch';

export class LSBranchCommandLineParser extends CommandLineParser {
  private _terminal: Terminal;
  private _configPathParameter!: CommandLineStringParameter;

  public get terminal(): Terminal {
    return this._terminal;
  }

  public constructor() {
    super({
      toolFilename: LSBRANCH_TOOL_FILENAME,
      toolDescription: 'LSBranch is a simple tool for listing the active branches in git clones.'
    });

    this._terminal = new Terminal(new ConsoleTerminalProvider());

    const actionOptions: ILSBranchActionBaseOptions = {
      terminal: this.terminal,
      config: new LSBranchConfig(() => this._configPathParameter.value)
    };

    this.addAction(new LSAction(actionOptions));
    this.addAction(new AddAction(actionOptions));
  }

  protected onDefineParameters(): void {
    this._configPathParameter = this.defineStringParameter({
      parameterLongName: '--config',
      parameterShortName: '-c',
      argumentName: 'PATH',
      description: 'Override the config file path. Defaults to ~/.lsbranchrc.json'
    });
  }

  protected async onExecute(): Promise<void> {
    process.exitCode = 1;
    try {
      await super.onExecute();
      process.exitCode = 0;
    } catch (e) {
      if (!(e instanceof AlreadyReportedError)) {
        this.terminal.writeErrorLine(`An unexpected error occurred: ${e}`);
      }
    }
  }
}
