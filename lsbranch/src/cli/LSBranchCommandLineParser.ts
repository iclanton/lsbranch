// Copyright (c) Ian Clanton-Thuon. All rights reserved. Licensed under the MIT license.
// See LICENSE in the project root for license information.

import { CommandLineParser, CommandLineStringParameter } from '@rushstack/ts-command-line';
import { AlreadyReportedError } from '@rushstack/node-core-library';
import { Terminal, ConsoleTerminalProvider } from '@rushstack/terminal';

import { ILSBranchActionBaseOptions } from './actions/LSBranchActionBase';
import { LSAction } from './actions/LSAction';
import { AddAction } from './actions/AddAction';
import { FindAction } from './actions/FindAction';
import { RemoveAction } from './actions/RemoveAction';
import { LSBRANCH_CONFIG_FILENAME, LSBranchConfig } from '../config/LSBranchConfig';

export const LSBRANCH_TOOL_FILENAME: string = 'lsbranch';

export class LSBranchCommandLineParser extends CommandLineParser {
  readonly #terminal: Terminal;
  readonly #configPathParameter: CommandLineStringParameter;

  public get terminal(): Terminal {
    return this.#terminal;
  }

  public constructor() {
    super({
      toolFilename: LSBRANCH_TOOL_FILENAME,
      toolDescription: 'LSBranch is a simple tool for listing the active branches in git clones.'
    });

    this.#terminal = new Terminal(new ConsoleTerminalProvider());

    const actionOptions: ILSBranchActionBaseOptions = {
      terminal: this.terminal,
      config: new LSBranchConfig(() => this.#configPathParameter.value)
    };

    this.addAction(new LSAction(actionOptions));
    this.addAction(new AddAction(actionOptions));
    this.addAction(new FindAction(actionOptions));
    this.addAction(new RemoveAction(actionOptions));

    this.#configPathParameter = this.defineStringParameter({
      parameterLongName: '--config',
      parameterShortName: '-c',
      argumentName: 'PATH',
      description: `Override the config file path. Defaults to ~/${LSBRANCH_CONFIG_FILENAME}`
    });
  }

  public override async executeWithoutErrorHandlingAsync(args?: string[]): Promise<void> {
    const argv: string[] = args ?? process.argv.slice(2);
    let actionIndex: number = 0;
    while (actionIndex < argv.length) {
      const argument: string = argv[actionIndex];
      if (argument === '--config' || argument === '-c') {
        const value: string | undefined = argv[actionIndex + 1];
        if (value === undefined || value.startsWith('-')) {
          return super.executeWithoutErrorHandlingAsync(argv);
        }

        actionIndex += 2;
      } else if (argument.startsWith('--config=') || (argument.startsWith('-c') && argument.length > 2)) {
        actionIndex++;
      } else {
        break;
      }
    }

    const argument: string | undefined = argv[actionIndex];
    if (argument === undefined || (argument.startsWith('-') && argument !== '-h' && argument !== '--help')) {
      // ts-command-line has no default action; insert it after the global options.
      return super.executeWithoutErrorHandlingAsync([
        ...argv.slice(0, actionIndex),
        'ls',
        ...argv.slice(actionIndex)
      ]);
    }

    return super.executeWithoutErrorHandlingAsync(argv);
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
