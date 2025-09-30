// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser, CommandLineStringParameter } from '@rushstack/ts-command-line';
import { AlreadyReportedError } from '@rushstack/node-core-library';
import { Terminal, ConsoleTerminalProvider } from '@rushstack/terminal';

import { ILSBranchActionBaseOptions } from './actions/LSBranchActionBase';
import { LSAction } from './actions/LSAction';
import { AddAction } from './actions/AddAction';
import { LSBRANCH_CONFIG_FILENAME, LSBranchConfig } from '../config/LSBranchConfig';

export const LSBRANCH_TOOL_FILENAME: string = 'lsbranch';

export class LSBranchCommandLineParser extends CommandLineParser {
  private readonly _terminal: Terminal;
  private readonly _configPathParameter: CommandLineStringParameter;

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

    this._configPathParameter = this.defineStringParameter({
      parameterLongName: '--config',
      parameterShortName: '-c',
      argumentName: 'PATH',
      description: `Override the config file path. Defaults to ~/${LSBRANCH_CONFIG_FILENAME}`
    });
  }

  protected override async onExecuteAsync(): Promise<void> {
    process.exitCode = 1;
    try {
      await super.onExecuteAsync();
      process.exitCode = 0;
    } catch (e) {
      if (!(e instanceof AlreadyReportedError)) {
        this.terminal.writeErrorLine(`An unexpected error occurred: ${e}`);
      }
    }
  }
}
